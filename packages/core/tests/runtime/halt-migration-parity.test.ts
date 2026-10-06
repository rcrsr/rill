/**
 * Parity test for the halt-carrier migration.
 *
 * Replays every trigger recorded in `halt-migration-baseline.ts` through the
 * public `@rcrsr/rill` API and compares what the caller observes against the
 * preserved baseline. Each entry's `migrated` flag selects the provenance
 * expectation: an unmigrated site raises a plain `RuntimeError`; a migrated
 * site raises a fatal `RuntimeHaltSignal` (direct triggers) or a
 * `RuntimeError` carrying `haltValue` (script triggers through `execute()`).
 * Everything else must stay equal to the baseline in both states.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  atomName,
  BUILT_IN_TYPES,
  BUILTIN_METHODS,
  createRillStream,
  createRuntimeContext,
  createStepper,
  createVector,
  execute,
  formatHalt,
  getStatus,
  parse,
  RuntimeError,
  RuntimeHaltSignal,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
  type SourceLocation,
} from '@rcrsr/rill';
import {
  HALT_MIGRATION_BASELINE,
  type BaselineDirectCall,
  type BaselineEntry,
  type BaselineHostFunctionName,
  type BaselineJson,
  type BaselineScriptOptions,
} from './halt-migration-baseline.js';

// ============================================================
// REPLAY HELPERS
// ============================================================

// Fire-and-forget pass<async> bodies run on microtasks only, with no host
// completion signal, and dispose() aborts a body still running. One macrotask
// turn drains every pending microtask, so the body has halted by then.
function settleMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// Completion of every delay_then_head body, so a test can wait for work that
// outlives its timeout<> scope instead of sleeping.
const lateWork: Promise<void>[] = [];

async function drainLateWork(): Promise<void> {
  await Promise.all(lateWork.splice(0));
}

// Settles once a fast-expiry timer has fired; delay_then_head waits for it.
let expiryFired: Promise<void> = Promise.resolve();

async function* yieldChunks(
  values: readonly RillValue[]
): AsyncGenerator<RillValue> {
  for (const value of values) yield value;
}

function makeHostFunction(
  fn: (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    location?: SourceLocation
  ) => RillValue | Promise<RillValue>
): RillFunction {
  return { params: [], returnType: anyTypeValue, fn };
}

function makeOneChunkStream(dispose?: () => void): RillValue {
  return createRillStream({
    chunks: yieldChunks([1]),
    resolve: async (): Promise<RillValue> => null,
    ...(dispose !== undefined ? { dispose } : {}),
  });
}

function callStreamNext(
  stream: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  const next = (stream as unknown as { next: RillFunction }).next;
  return Promise.resolve(next.fn({}, ctx));
}

function buildHostFunctions(): Record<BaselineHostFunctionName, RillFunction> {
  return {
    make_stream: makeHostFunction(() =>
      createRillStream({
        chunks: yieldChunks([1, 2]),
        resolve: async (): Promise<RillValue> => null,
      })
    ),
    make_stream_one_chunk: makeHostFunction(() => makeOneChunkStream()),
    make_stream_dispose_fail: makeHostFunction(() =>
      makeOneChunkStream(() => {
        throw new Error('dispose failed');
      })
    ),
    make_vec2: makeHostFunction(() =>
      createVector(new Float32Array([1, 2]), 'm')
    ),
    make_vec3: makeHostFunction(() =>
      createVector(new Float32Array([1, 2, 3]), 'm')
    ),
    return_undefined: makeHostFunction(() => undefined as unknown as RillValue),
    stream_next_twice: makeHostFunction(async (_args, ctx) => {
      const stream = makeOneChunkStream();
      await callStreamNext(stream, ctx);
      await callStreamNext(stream, ctx);
      return null;
    }),
    compare_calendar_durations: makeHostFunction(() => {
      const definition = BUILT_IN_TYPES.find((t) => t.name === 'duration');
      const compare = definition?.protocol.compare;
      if (compare === undefined) throw new Error('duration compare missing');
      return compare(
        { __rill_duration: true, months: 12, ms: 0 } as unknown as RillValue,
        { __rill_duration: true, months: 0, ms: 1000 } as unknown as RillValue
      ) as unknown as RillValue;
    }),
    delay_then_head: makeHostFunction((_args, ctx, location) => {
      const work = (async (): Promise<RillValue> => {
        await expiryFired;
        return BUILTIN_METHODS.string['head']!.fn(
          { receiver: 5 } as unknown as Record<string, RillValue>,
          ctx,
          location
        );
      })();
      lateWork.push(
        work.then(
          () => undefined,
          () => undefined
        )
      );
      return work;
    }),
  };
}

function buildContext(
  options: BaselineScriptOptions | undefined,
  callbacks?: {
    onLog: (message: string) => void;
    onLogEvent?: (event: { detail?: string | undefined }) => void;
  }
): RuntimeContext {
  let markExpiryFired: () => void = () => undefined;
  expiryFired = new Promise<void>((resolve) => {
    markExpiryFired = resolve;
  });
  const hostFunctions = buildHostFunctions();
  const functions: Record<string, RillFunction> = {};
  for (const name of options?.hostFunctions ?? []) {
    functions[name] = hostFunctions[name];
  }
  const moduleSources = options?.moduleSources;
  return createRuntimeContext({
    functions,
    ...(moduleSources !== undefined
      ? {
          resolvers: {
            module: (resource: string) => ({
              kind: 'source' as const,
              text: moduleSources[resource] ?? '',
            }),
          },
          parseSource: (text: string) => parse(text),
        }
      : {}),
    ...(options?.scheduler === 'fast-expiry'
      ? {
          scheduler: {
            setTimeout: (fn: () => void) =>
              setTimeout(() => {
                fn();
                markExpiryFired();
              }, 5),
            clearTimeout: (handle: ReturnType<typeof setTimeout> | undefined) =>
              clearTimeout(handle),
          },
        }
      : {}),
    ...(callbacks !== undefined
      ? {
          callbacks: callbacks as unknown as NonNullable<
            Parameters<typeof createRuntimeContext>[0]
          >['callbacks'],
        }
      : {}),
  });
}

type Captured =
  | { readonly threw: true; readonly error: unknown }
  | { readonly threw: false };

async function capture(fn: () => unknown): Promise<Captured> {
  try {
    await fn();
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
}

async function captureScript(
  source: string,
  options: BaselineScriptOptions | undefined
): Promise<Captured> {
  const ctx = buildContext(options);
  try {
    return await capture(() => execute(parse(source), ctx));
  } finally {
    await ctx.dispose();
  }
}

async function runScriptValue(
  source: string,
  options: BaselineScriptOptions | undefined
): Promise<RillValue> {
  const ctx = buildContext(options);
  try {
    return (await execute(parse(source), ctx)).result;
  } finally {
    await ctx.dispose();
  }
}

function replayDirect(call: BaselineDirectCall): Promise<unknown> {
  const ctx = createRuntimeContext({});
  switch (call.target) {
    case 'protocol-convert': {
      const definition = BUILT_IN_TYPES.find((t) => t.name === call.typeName);
      const convert = definition?.protocol.convertTo?.[call.toType];
      if (convert === undefined) {
        throw new Error(`no converter ${call.typeName} to ${call.toType}`);
      }
      return Promise.resolve(
        capture(() => convert(call.value as unknown as RillValue))
      );
    }
    case 'builtin-method': {
      const method = BUILTIN_METHODS[call.group][call.method];
      if (method === undefined) {
        throw new Error(`no method ${call.group}.${call.method}`);
      }
      return Promise.resolve(
        capture(() =>
          method.fn(
            call.args as unknown as Record<string, RillValue>,
            ctx,
            call.location
          )
        )
      );
    }
  }
}

async function captureDirect(call: BaselineDirectCall): Promise<Captured> {
  return (await replayDirect(call)) as Captured;
}

function toJson(value: unknown): BaselineJson | null {
  return value === undefined
    ? null
    : (JSON.parse(JSON.stringify(value)) as BaselineJson);
}

interface Observation {
  readonly thrownClass: string;
  readonly errorId: string | null;
  readonly message: string;
  readonly rawMessage: string | null;
  readonly location: BaselineJson | null;
  readonly span: BaselineJson | null;
  readonly sourceId: string | null;
  readonly context: BaselineJson | null;
}

function observeRuntimeError(error: unknown): Observation {
  expect(error).toBeInstanceOf(RuntimeError);
  const err = error as RuntimeError;
  return {
    thrownClass: err.constructor.name,
    errorId: err.errorId,
    message: err.message,
    rawMessage: err.rawMessage,
    location: toJson(err.location),
    span: toJson(err.span),
    sourceId: err.sourceId ?? null,
    context: toJson(err.context),
  };
}

function expectedObservation(entry: BaselineEntry): Observation {
  return {
    thrownClass: entry.thrownClass ?? 'none',
    errorId: entry.errorId,
    message: entry.message ?? '',
    rawMessage: entry.rawMessage,
    location: toJson(entry.location),
    span: toJson(entry.span),
    sourceId: entry.sourceId,
    context: entry.context,
  };
}

/**
 * Maps a halt atom to its host-facing error id (`RILL_R003` to `RILL-R003`).
 *
 * Replaces only the first underscore, which is correct because every
 * baseline atom has the shape `RILL_Rnnn`. The registry's own
 * HALT_ATOM_TO_ERROR_ID table is not exported from `@rcrsr/rill`, so the
 * test derives the id itself; an atom with another shape would map wrongly.
 */
function mapAtomToErrorId(atom: string): string {
  return atom.replace('_', '-');
}

function readHaltRaw(halt: RillValue): Record<string, unknown> {
  return getStatus(halt).raw as Record<string, unknown>;
}

/**
 * Raw keys must be the message plus the baseline context keys, nothing else.
 * A script probing the carrier through `.!` must read the same message and
 * must see no field beyond the allowed keys.
 */
async function expectCarrierInvisible(
  halt: RillValue,
  entry: BaselineEntry
): Promise<void> {
  const allowed = new Set(['message', ...Object.keys(entry.context ?? {})]);
  for (const key of Object.keys(readHaltRaw(halt))) {
    expect(allowed.has(key)).toBe(true);
  }
  expect(formatHalt(halt)).not.toContain('Symbol(');

  const ctx = createRuntimeContext({ variables: { carrier: halt } });
  try {
    const run = async (source: string): Promise<RillValue> =>
      (await execute(parse(source), ctx)).result;
    expect(await run('guard { $carrier.!message } => $m\n$m')).toBe(
      getStatus(halt).message
    );
    expect(
      await run('guard { ($carrier.!code == #RILL_R003) } => $c\n$c')
    ).toBe(atomName(getStatus(halt).code) === 'RILL_R003');
  } finally {
    await ctx.dispose();
  }
}

// ============================================================
// BASELINE SELECTION
// ============================================================

const BASELINE: readonly BaselineEntry[] = HALT_MIGRATION_BASELINE;
const SITES = BASELINE.filter((e) => e.role === 'site');
const PROVENANCE = BASELINE.filter((e) => e.role === 'provenance');
const BOUNDARIES = BASELINE.filter((e) => e.role === 'boundary');

const CONVERTER_SITE_IDS: readonly string[] = [
  'packages/core/src/runtime/core/types/protocols/string.ts:62',
  'packages/core/src/runtime/core/types/protocols/string.ts:86',
  'packages/core/src/runtime/core/types/protocols/number.ts:55',
];

const EXPECTED_SITE_LINES: Readonly<Record<string, readonly number[]>> = {
  'ext/builtins/methods/bodies.ts': [
    107, 139, 171, 179, 256, 586, 602, 618, 632, 655, 687, 724, 736, 748, 760,
    768, 775, 799, 807, 814, 830, 838, 845, 862, 879, 639, 662, 670, 694, 702,
  ],
  'ext/builtins/functions/collections.ts': [
    87, 204, 346, 487, 591, 138, 411, 515, 215, 226, 237, 248, 602, 613, 624,
    635, 681,
  ],
  'ext/builtins/temporal/methods.ts': [
    164, 226, 337, 393, 412, 422, 440, 447, 456, 463,
  ],
  'ext/builtins/functions/core.ts': [172, 221, 287, 308],
  'ext/builtins/methods/entry.ts': [39],
  'core/types/constructors.ts': [146, 156, 173, 181, 204],
  'core/callable.ts': [797],
  'core/types/protocols/string.ts': [62, 86],
  'core/types/protocols/number.ts': [55],
  'core/types/protocols/duration.ts': [82],
};

const EXPECTED_SITE_IDS: readonly string[] = Object.entries(
  EXPECTED_SITE_LINES
).flatMap(([file, lines]) =>
  lines.map((line) => `packages/core/src/runtime/${file}:${line}`)
);

function tagOf(entry: BaselineEntry): string {
  return `${entry.siteId.replace('packages/core/src/runtime/', '')} [${entry.role}${entry.path !== null ? ` ${entry.path}` : ''}]`;
}

const REPLAYABLE = BASELINE.filter(
  (e) => e.trigger.kind !== 'unreachable' && e.thrownClass !== null
);
const LOG_ENTRIES = BASELINE.filter(
  (e) =>
    e.trigger.kind === 'script' && e.trigger.options?.captureDisposeLog === true
);

type ScriptTrigger = Extract<BaselineEntry['trigger'], { kind: 'script' }>;
type DirectTrigger = Extract<BaselineEntry['trigger'], { kind: 'direct' }>;

function collectScriptReplays(
  entries: readonly BaselineEntry[],
  withLog: boolean
): { entry: BaselineEntry; trigger: ScriptTrigger }[] {
  return entries.flatMap((entry) =>
    entry.trigger.kind === 'script' &&
    (entry.trigger.options?.captureDisposeLog === true) === withLog
      ? [{ entry, trigger: entry.trigger }]
      : []
  );
}

const SCRIPT_REPLAYS = collectScriptReplays(REPLAYABLE, false);
const LOG_REPLAYS = collectScriptReplays(LOG_ENTRIES, true);
const DIRECT_REPLAYS: { entry: BaselineEntry; trigger: DirectTrigger }[] =
  REPLAYABLE.flatMap((entry) =>
    entry.trigger.kind === 'direct' ? [{ entry, trigger: entry.trigger }] : []
  );

// ============================================================
// BASELINE STRUCTURE
// ============================================================

describe('halt migration parity', () => {
  describe('halt migration baseline structure', () => {
    it('holds exactly 72 site entries whose ids equal the migrate list', () => {
      expect(SITES).toHaveLength(72);
      expect(EXPECTED_SITE_IDS).toHaveLength(72);
      expect(new Set(SITES.map((e) => e.siteId)).size).toBe(72);
      expect(SITES.map((e) => e.siteId).sort()).toEqual(
        [...EXPECTED_SITE_IDS].sort()
      );
    });

    it('holds exactly 3 provenance entries, all direct converter calls', () => {
      expect(PROVENANCE).toHaveLength(3);
      expect(PROVENANCE.map((e) => e.siteId).sort()).toEqual(
        [...CONVERTER_SITE_IDS].sort()
      );
      for (const entry of PROVENANCE) {
        expect(entry.trigger.kind).toBe('direct');
      }
    });

    it('holds at least one boundary entry for each of the 5 boundary paths', () => {
      for (const path of [
        'host-call-location',
        'script-callable-source',
        'use-module',
        'timeout-expired',
        'async-pass-log',
      ]) {
        expect(
          BOUNDARIES.filter((e) => e.path === path).length
        ).toBeGreaterThan(0);
      }
    });

    it('keeps (siteId, role, path) unique', () => {
      const keys = BASELINE.map((e) => `${e.siteId}|${e.role}|${e.path}`);
      expect(new Set(keys).size).toBe(BASELINE.length);
    });

    it('marks guardRecovers true for exactly the 3 converter site entries', () => {
      const recovering = SITES.filter((e) => e.guardRecovers === true).map(
        (e) => e.siteId
      );
      expect(recovering.sort()).toEqual([...CONVERTER_SITE_IDS].sort());
      const duration = SITES.find((e) => e.siteId.endsWith('duration.ts:82'));
      expect(duration?.guardRecovers).toBe(false);
    });

    it('names the one unreachable site entry and counts it among the 72', () => {
      const unreachable = BASELINE.filter(
        (e) => e.trigger.kind === 'unreachable'
      );
      expect(unreachable.map((e) => e.siteId)).toEqual([
        'packages/core/src/runtime/core/types/constructors.ts:181',
      ]);
      expect(unreachable[0]?.role).toBe('site');
      expect(SITES).toContain(unreachable[0]);
    });
  });

  // ============================================================
  // ENTRY REPLAY: site, provenance and boundary entries
  // ============================================================

  describe('halt migration replay', () => {
    describe('script entries', () => {
      for (const { entry, trigger } of SCRIPT_REPLAYS) {
        it(`matches baseline for ${tagOf(entry)} through execute()`, async () => {
          const result = await captureScript(trigger.source, trigger.options);
          expect(result.threw).toBe(true);
          if (!result.threw) return;
          const observed = observeRuntimeError(result.error);
          expect(observed).toEqual(expectedObservation(entry));

          const haltValue = (result.error as RuntimeError).haltValue;
          const haltCatchable = (result.error as RuntimeError).haltCatchable;
          const converterSite = CONVERTER_SITE_IDS.includes(entry.siteId);
          // A timeout-expired boundary reports the scope's own RILL-R082, not the
          // underlying site's halt, so it carries no site provenance to assert.
          const siteProvenance =
            entry.role === 'site' ||
            (entry.role === 'boundary' && entry.path !== 'timeout-expired');
          if (siteProvenance && !converterSite) {
            if (entry.migrated) {
              expect(haltValue).toBeDefined();
              expect(haltCatchable).toBe(false);
            } else {
              expect(haltValue).toBeUndefined();
            }
          }
          if (entry.migrated && haltValue !== undefined) {
            await expectCarrierInvisible(haltValue, entry);
          }
        });

        it(`keeps guardRecovers equal to baseline for ${tagOf(entry)}`, async () => {
          const guarded = await captureScript(
            `guard {\n${trigger.source}\n}`,
            trigger.options
          );
          expect(guarded.threw).toBe(!entry.guardRecovers);
        });
      }
    });

    describe('direct entries', () => {
      for (const { entry, trigger } of DIRECT_REPLAYS) {
        it(`matches baseline for ${tagOf(entry)} through a direct call`, async () => {
          const result = await captureDirect(trigger.call);
          expect(result.threw).toBe(true);
          if (!result.threw) return;

          if (entry.migrated && entry.role !== 'boundary') {
            expect(result.error).toBeInstanceOf(RuntimeHaltSignal);
            const halt = result.error as RuntimeHaltSignal;
            expect(halt.catchable).toBe(false);
            const status = getStatus(halt.value);
            expect(mapAtomToErrorId(atomName(status.code))).toBe(entry.errorId);
            expect(status.message).toBe(entry.rawMessage);
            const rest = Object.fromEntries(
              Object.entries(readHaltRaw(halt.value)).filter(
                ([key]) => key !== 'message'
              )
            );
            expect(toJson(rest)).toEqual(entry.context ?? {});
            await expectCarrierInvisible(halt.value, entry);
          } else {
            expect(observeRuntimeError(result.error)).toEqual(
              expectedObservation(entry)
            );
            expect((result.error as RuntimeError).haltValue).toBeUndefined();
          }
        });
      }
    });

    it('skips replay for the single unreachable site entry', () => {
      const unreachable = BASELINE.filter(
        (e) => e.trigger.kind === 'unreachable'
      );
      expect(unreachable).toHaveLength(1);
      expect(unreachable[0]?.siteId).toBe(
        'packages/core/src/runtime/core/types/constructors.ts:181'
      );
      expect(REPLAYABLE).not.toContain(unreachable[0]);
      expect(REPLAYABLE.length + unreachable.length + LOG_ENTRIES.length).toBe(
        BASELINE.length
      );
    });

    describe('log entries', () => {
      for (const { entry, trigger } of LOG_REPLAYS) {
        it(`keeps deferred log text equal to baseline for ${tagOf(entry)}`, async () => {
          const lines: string[] = [];
          const events: string[] = [];
          for (const withEvent of [false, true]) {
            const ctx = buildContext(trigger.options, {
              onLog: (message: string): void => {
                lines.push(message);
              },
              ...(withEvent
                ? {
                    onLogEvent: (event: {
                      detail?: string | undefined;
                    }): void => {
                      events.push(event.detail ?? '');
                    },
                  }
                : {}),
            });
            await execute(parse(trigger.source), ctx);
            await settleMicrotasks();
            await ctx.dispose();
          }
          expect(events).toEqual([entry.logText]);
          // The line-only run emits one line; the event run routes to onLogEvent.
          expect(lines).toEqual([
            `runtime: pass<async> body halted: ${entry.logText}`,
          ]);

          // The suffix appears only for sites that carry a location.
          const site = SITES.find((s) => s.siteId === entry.siteId);
          const hasSuffix = /at \d+:\d+$/.test(entry.logText ?? '');
          expect(hasSuffix).toBe(site?.location !== null);
        });
      }
    });
  });

  // ============================================================
  // PROVENANCE OF THE CONVERTER SITES
  // ============================================================

  describe('converter provenance', () => {
    it('yields RILL-R038 for string to number conversion in a script', async () => {
      const entry = SITES.find((e) => e.siteId.endsWith('string.ts:62'));
      const result = await captureScript('"abc" -> number', undefined);
      expect(result.threw).toBe(true);
      if (!result.threw) return;
      expect((result.error as RuntimeError).errorId).toBe('RILL-R038');
      expect((result.error as RuntimeError).message).toBe(entry?.message);
    });

    it('recovers guard { "abc" -> number } with #RILL_R038, not #RILL_R064', async () => {
      const result = await runScriptValue(
        'guard { "abc" -> number } => $r\n($r.!code == #RILL_R038)',
        undefined
      );
      expect(result).toBe(true);
    });

    it('recovers bool conversions in a script as #RILL_R036', async () => {
      for (const source of ['"abc" -> bool', '5 -> bool']) {
        const result = await runScriptValue(
          `guard { ${source} } => $r\n($r.!code == #RILL_R036)`,
          undefined
        );
        expect(result).toBe(true);
      }
    });

    it('throws RILL_R064 directly from the migrated string to number converter, or RuntimeError when unmigrated', async () => {
      const entry = PROVENANCE.find((e) => e.siteId.endsWith('string.ts:62'));
      expect(entry).toBeDefined();
      if (entry === undefined || entry.trigger.kind !== 'direct') return;
      const result = await captureDirect(entry.trigger.call);
      expect(result.threw).toBe(true);
      if (!result.threw) return;
      if (entry.migrated) {
        expect(result.error).toBeInstanceOf(RuntimeHaltSignal);
        const halt = result.error as RuntimeHaltSignal;
        expect(halt.catchable).toBe(false);
        expect(atomName(getStatus(halt.value).code)).toBe('RILL_R064');
      } else {
        expect(result.error).toBeInstanceOf(RuntimeError);
        expect((result.error as RuntimeError).errorId).toBe('RILL-R064');
      }
    });
  });

  // ============================================================
  // GUARD AND TIMEOUT INTERACTION
  // ============================================================

  describe('guard and timeout interaction', () => {
    const headSite = SITES.find((e) => e.siteId.endsWith('bodies.ts:107'));
    const expiry = BOUNDARIES.find((e) => e.path === 'timeout-expired');

    it('halts a site inside guard unrecovered and gives the host RILL-R003 with the baseline text', async () => {
      expect(headSite?.guardRecovers).toBe(false);
      const result = await captureScript('guard {\n5 -> .head\n}', undefined);
      expect(result.threw).toBe(true);
      if (!result.threw) return;
      const err = result.error as RuntimeError;
      expect(err.errorId).toBe(headSite?.errorId);
      expect(err.errorId).toBe('RILL-R003');
      expect(err.rawMessage).toBe(headSite?.rawMessage);
      expect(err.message).toBe(
        `${headSite?.rawMessage} at 2:${headSite?.location?.column}`
      );
      expect(await runScriptValue('guard { 1 } => $r\n$r', undefined)).toBe(1);
    });

    it('recovers a site firing after timeout expiry inside guard as #RILL_R082', async () => {
      const options = {
        hostFunctions: ['delay_then_head'],
        scheduler: 'fast-expiry',
      } as const;
      const source =
        'guard { timeout<total: duration(0,0,1)> { delay_then_head() } } => $r\n($r.!code == #RILL_R082)';
      const result = await runScriptValue(source, options);
      expect(result).toBe(true);
      // Let the late site finish so it cannot leak into a later test.
      await drainLateWork();
    });

    it('reports the late site as RILL-R082 without guard, not the site error', async () => {
      expect(expiry?.errorId).toBe('RILL-R082');
      expect(expiry?.guardRecovers).toBe(true);
      if (expiry === undefined || expiry.trigger.kind !== 'script') return;
      const result = await captureScript(
        expiry.trigger.source,
        expiry.trigger.options
      );
      expect(result.threw).toBe(true);
      if (!result.threw) return;
      expect((result.error as RuntimeError).errorId).toBe('RILL-R082');
      expect((result.error as RuntimeError).context).toEqual({
        durationMs: 86400000,
      });
      await drainLateWork();
    });
  });

  // ============================================================
  // LOCATION AND SOURCE BOUNDARIES
  // ============================================================

  describe('location and source boundaries', () => {
    it('replays location-less sites without an at-suffix in the message', async () => {
      const locationless = REPLAYABLE.filter(
        (e) => e.location === null && e.role !== 'boundary'
      );
      expect(locationless.length).toBeGreaterThan(0);
      for (const entry of locationless) {
        const trigger = entry.trigger;
        const captured =
          trigger.kind === 'script'
            ? await captureScript(trigger.source, trigger.options)
            : trigger.kind === 'direct'
              ? await captureDirect(trigger.call)
              : { threw: false as const };
        expect(captured.threw).toBe(true);
        if (!captured.threw) continue;
        const message =
          captured.error instanceof RuntimeHaltSignal
            ? getStatus(captured.error.value).message
            : (captured.error as RuntimeError).message;
        expect(message).toBe(entry.rawMessage);
        expect(/ at \d+:\d+$/.test(message)).toBe(false);
      }
    });

    it('gives a location-less site reached through a host call the call location', async () => {
      const hostCalls = BOUNDARIES.filter(
        (e) => e.path === 'host-call-location'
      );
      expect(hostCalls.length).toBeGreaterThan(0);
      for (const entry of hostCalls) {
        const trigger = entry.trigger;
        if (trigger.kind !== 'script') continue;
        const result = await captureScript(trigger.source, trigger.options);
        expect(result.threw).toBe(true);
        if (!result.threw) continue;
        const err = result.error as RuntimeError;
        expect(entry.location).not.toBeNull();
        expect(err.location).toEqual(entry.location);
        expect(err.message).toBe(
          `${entry.rawMessage} at ${entry.location?.line}:${entry.location?.column}`
        );
      }
    });

    it('carries the module source id and text for a site inside a use-loaded module', async () => {
      const moduleEntries = BOUNDARIES.filter(
        (e) => e.path === 'use-module' || e.path === 'script-callable-source'
      );
      expect(moduleEntries).toHaveLength(2);
      for (const entry of moduleEntries) {
        const trigger = entry.trigger;
        if (trigger.kind !== 'script') continue;
        const result = await captureScript(trigger.source, trigger.options);
        expect(result.threw).toBe(true);
        if (!result.threw) continue;
        const err = result.error as RuntimeError;
        expect(err.sourceId ?? null).toBe(entry.sourceId);
        expect(entry.context).not.toBeNull();
        expect(err.context?.['sourceText']).toBe(entry.context?.['sourceText']);
        expect(typeof err.context?.['sourceText']).toBe('string');
      }
    });

    it('omits source id and source text for the same site with no module in play', async () => {
      const entry = BOUNDARIES.find((e) => e.path === 'script-callable-source');
      const result = await captureScript(
        '|x| ($x -> .head) => $f\n5 -> $f',
        undefined
      );
      expect(result.threw).toBe(true);
      if (!result.threw) return;
      const err = result.error as RuntimeError;
      expect(err.errorId).toBe(entry?.errorId);
      expect(err.rawMessage).toBe(entry?.rawMessage);
      expect(err.sourceId ?? null).toBeNull();
      expect(err.context?.['sourceText']).toBeUndefined();
    });
  });

  // ============================================================
  // STEPPER AND TIMEOUT BEFORE EXPIRY
  // ============================================================

  describe('halt behavior at execution boundaries', () => {
    const headSite = SITES.find((e) => e.siteId.endsWith('bodies.ts:107'));

    it('returns the last completed statement value from stepper getResult after a site halts', async () => {
      const ctx = createRuntimeContext({});
      const stepper = createStepper(parse('7\n5 -> .head'), ctx);
      const first = await stepper.step();
      expect(first.value).toBe(7);
      const failure = await capture(() => stepper.step());
      expect(failure.threw).toBe(true);
      if (!failure.threw) return;
      const err = failure.error as RuntimeError;
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe(headSite?.errorId);
      expect(err.rawMessage).toBe(headSite?.rawMessage);
      expect(stepper.getResult().result).toBe(7);
      await ctx.dispose();
    });

    it('propagates its own error when a site fires inside timeout before expiry', async () => {
      const result = await captureScript(
        'timeout<total: duration(0,0,1)> { 5 -> .head }',
        { scheduler: 'fast-expiry' }
      );
      expect(result.threw).toBe(true);
      if (!result.threw) return;
      const err = result.error as RuntimeError;
      expect(err.errorId).toBe(headSite?.errorId);
      expect(err.rawMessage).toBe(headSite?.rawMessage);
      expect(err.errorId).not.toBe('RILL-R082');
      expect(err.errorId).not.toBe('RILL-R083');
    });
  });
});
