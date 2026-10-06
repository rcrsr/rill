/**
 * Preserved-behavior baseline for the halt-carrier migration.
 *
 * Every entry records what a caller observed from the pre-migration tree
 * when a throw site fired: the thrown class, error id, message, location,
 * span, source id and context. The values were captured once from the
 * unmodified tree by a one-shot script and are never re-derived. A parity
 * test replays each trigger through the public `@rcrsr/rill` API and
 * compares the result against the entry.
 *
 * Only `migrated` may change in later edits. It flips to `true` for an
 * entry once its site has been migrated.
 *
 * Triggers are data, not code: script source strings with serializable
 * option descriptors, plus direct-call descriptors the replaying test
 * dispatches. The host functions, module sources and scheduler named by an
 * entry are built by the replaying test, as documented on the types below.
 */

/** JSON-serializable value used in direct-call descriptors and contexts. */
export type BaselineJson =
  | string
  | number
  | boolean
  | null
  | readonly BaselineJson[]
  | { readonly [key: string]: BaselineJson };

/** Source position as recorded on a thrown error. */
interface BaselineLocation {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

/** Source span as recorded on a thrown error. */
interface BaselineSpan {
  readonly start: BaselineLocation;
  readonly end: BaselineLocation;
}

/**
 * Host functions a script trigger may name in `options.hostFunctions`.
 * The replaying test registers each one under its own name, with no
 * parameters and `anyTypeValue` as return type, behaving as follows.
 *
 * - `make_stream`: returns `createRillStream` over chunks `1, 2` whose
 *   resolve function yields `null`.
 * - `make_stream_one_chunk`: returns `createRillStream` over chunk `1`
 *   whose resolve function yields `null`.
 * - `make_stream_dispose_fail`: returns `createRillStream` over chunk `1`
 *   with a `dispose` hook that throws `new Error('dispose failed')`.
 * - `make_vec2`: returns `createVector(new Float32Array([1, 2]), 'm')`.
 * - `make_vec3`: returns `createVector(new Float32Array([1, 2, 3]), 'm')`.
 * - `return_undefined`: returns `undefined` (an invalid host result).
 * - `stream_next_twice`: async; builds `createRillStream` over chunk `1`
 *   and awaits `stream.next.fn({}, ctx)` twice, so the second call throws
 *   from inside the host function. `ctx` is the context the host function
 *   received.
 * - `compare_calendar_durations`: calls the `duration` entry of
 *   `BUILT_IN_TYPES` `protocol.compare` with
 *   `{ __rill_duration: true, months: 12, ms: 0 }` and
 *   `{ __rill_duration: true, months: 0, ms: 1000 }`, from inside the host
 *   function.
 * - `delay_then_head`: async; waits 100 ms ignoring `ctx.signal`, then
 *   returns `BUILTIN_METHODS.string.head.fn({ receiver: 5 }, ctx, location)`
 *   where `ctx` and `location` are the values the host function received.
 */
const BASELINE_HOST_FUNCTION_NAMES = [
  'make_stream',
  'make_stream_one_chunk',
  'make_stream_dispose_fail',
  'make_vec2',
  'make_vec3',
  'return_undefined',
  'stream_next_twice',
  'compare_calendar_durations',
  'delay_then_head',
] as const;

export type BaselineHostFunctionName =
  (typeof BASELINE_HOST_FUNCTION_NAMES)[number];

/**
 * Serializable runtime options for a script trigger. The replaying test
 * builds the context with `createRuntimeContext` as follows.
 *
 * - `hostFunctions`: register each named host function in `functions`.
 * - `moduleSources`: register a `module` resolver
 *   `(resource) => ({ kind: 'source', text: moduleSources[resource] })`
 *   and set `parseSource: (text) => parse(text)`.
 * - `scheduler: 'fast-expiry'`: pass a scheduler whose `setTimeout(fn)`
 *   ignores the requested duration and fires after 5 ms with the real
 *   `setTimeout`, and whose `clearTimeout` delegates to the real one.
 * - `captureDisposeLog`: run the script, wait 10 ms, call `dispose()` and
 *   capture the log text. The script itself completes without throwing.
 *   Install `onLogEvent` and read the single event's `detail`; in a second
 *   run install only `onLog` and expect the single line to equal
 *   `runtime: pass<async> body halted: ` followed by `logText`.
 */
export interface BaselineScriptOptions {
  readonly hostFunctions?: readonly BaselineHostFunctionName[] | undefined;
  readonly moduleSources?: { readonly [resource: string]: string } | undefined;
  readonly scheduler?: 'fast-expiry' | undefined;
  readonly captureDisposeLog?: boolean | undefined;
}

/**
 * Direct-call descriptors, dispatched by `target`.
 *
 * - `protocol-convert`: find the `BUILT_IN_TYPES` entry named `typeName`
 *   and call `protocol.convertTo[toType](value)`.
 * - `builtin-method`: call `BUILTIN_METHODS[group][method].fn(args, ctx,
 *   location)` with `ctx` from `createRuntimeContext({})`.
 */
export type BaselineDirectCall =
  | {
      readonly target: 'protocol-convert';
      readonly typeName: string;
      readonly toType: string;
      readonly value: BaselineJson;
    }
  | {
      readonly target: 'builtin-method';
      readonly group: 'string' | 'list';
      readonly method: string;
      readonly args: { readonly [name: string]: BaselineJson };
      readonly location: BaselineLocation;
    };

/**
 * How an entry fires its site.
 *
 * - `script`: run `source` through `parse` and `execute` with the context
 *   described by `options`; `guardRecovers` is the outcome of running the
 *   same source wrapped as `guard {\n<source>\n}`.
 * - `direct`: dispatch `call`; `justification` states why no script path
 *   reaches the site (or, for provenance entries, why the call is direct).
 * - `unreachable`: no public path fires the site; nothing is replayable and
 *   the observable fields come from code-identical sibling sites.
 */
type BaselineTrigger =
  | {
      readonly kind: 'script';
      readonly source: string;
      readonly options?: BaselineScriptOptions | undefined;
    }
  | {
      readonly kind: 'direct';
      readonly call: BaselineDirectCall;
      readonly justification: string;
    }
  | { readonly kind: 'unreachable'; readonly justification: string };

type BaselineRole = 'site' | 'provenance' | 'boundary';

type BaselinePath =
  | 'host-call-location'
  | 'script-callable-source'
  | 'use-module'
  | 'timeout-expired'
  | 'async-pass-log';

/**
 * One preserved observation.
 *
 * `siteId` is `<repo-relative path>:<pre-migration line>` and is a stable
 * label. The tuple (`siteId`, `role`, `path`) is unique. Error fields are
 * the values observed by the caller of the trigger; `context` is `null`
 * when the error's `context` was `undefined`. For `async-pass-log` entries
 * the script completes without throwing, so every error field and
 * `guardRecovers` is `null` and `logText` carries the observation.
 * `migrated` is the only field later edits may change.
 */
export interface BaselineEntry {
  readonly siteId: string;
  readonly role: BaselineRole;
  readonly path: BaselinePath | null;
  readonly trigger: BaselineTrigger;
  readonly thrownClass: 'RuntimeError' | 'RuntimeHaltSignal' | null;
  readonly errorId: string | null;
  readonly message: string | null;
  readonly rawMessage: string | null;
  readonly location: BaselineLocation | null;
  readonly span: BaselineSpan | null;
  readonly sourceId: string | null;
  readonly context: { readonly [key: string]: BaselineJson } | null;
  readonly guardRecovers: boolean | null;
  readonly logText: string | null;
  readonly migrated: boolean;
}

export const HALT_MIGRATION_BASELINE: readonly BaselineEntry[] = [
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:107',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '5 -> .head',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'head requires list or string, got number at 1:6',
    rawMessage: 'head requires list or string, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:139',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '5 -> .tail',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'tail requires list or string, got number at 1:6',
    rawMessage: 'tail requires list or string, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:171',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'ordered[a: 1] -> .first',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message:
      'first requires list, string, dict, or iterator, got ordered at 1:18',
    rawMessage: 'first requires list, string, dict, or iterator, got ordered',
    location: {
      line: 1,
      column: 18,
      offset: 17,
    },
    span: {
      start: {
        line: 1,
        column: 18,
        offset: 17,
      },
      end: {
        line: 1,
        column: 18,
        offset: 17,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:179',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '5 -> .first',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message:
      'first requires list, string, dict, or iterator, got number at 1:6',
    rawMessage: 'first requires list, string, dict, or iterator, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:256',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '5 -> .at(0)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'Cannot call .at() on number at 1:6',
    rawMessage: 'Cannot call .at() on number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:586',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(0,0,1) -> .keys',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'keys() requires dict receiver, got duration at 1:20',
    rawMessage: 'keys() requires dict receiver, got duration',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:602',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(0,0,1) -> .values',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'values() requires dict receiver, got duration at 1:20',
    rawMessage: 'values() requires dict receiver, got duration',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:618',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(0,0,1) -> .entries',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'entries() requires dict receiver, got duration at 1:20',
    rawMessage: 'entries() requires dict receiver, got duration',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:632',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .has(2)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'has() requires list receiver, got number at 1:6',
    rawMessage: 'has() requires list receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:639',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> .has()',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'has() expects 1 argument, got 0 at 1:12',
    rawMessage: 'has() expects 1 argument, got 0',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:655',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .has_any(list[1])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'has_any() requires list receiver, got number at 1:6',
    rawMessage: 'has_any() requires list receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:662',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> .has_any()',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'has_any() expects 1 argument, got 0 at 1:12',
    rawMessage: 'has_any() expects 1 argument, got 0',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:670',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> .has_any(1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'has_any() expects list argument, got number at 1:12',
    rawMessage: 'has_any() expects list argument, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:687',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .has_all(list[1])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'has_all() requires list receiver, got number at 1:6',
    rawMessage: 'has_all() requires list receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:694',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> .has_all()',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'has_all() expects 1 argument, got 0 at 1:12',
    rawMessage: 'has_all() expects 1 argument, got 0',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:702',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> .has_all(1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'has_all() expects list argument, got number at 1:12',
    rawMessage: 'has_all() expects list argument, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:724',
    role: 'site',
    path: null,
    trigger: {
      kind: 'direct',
      call: {
        target: 'builtin-method',
        group: 'list',
        method: 'reverse',
        args: {
          receiver: 1,
        },
        location: {
          line: 1,
          column: 1,
          offset: 0,
        },
      },
      justification:
        'script dispatch rejects a non-list receiver before mReverse runs ("Method not supported on number"), so only a direct method call reaches the check',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'reverse() requires list receiver, got number at 1:1',
    rawMessage: 'reverse() requires list receiver, got number',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 1,
        offset: 0,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: null,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:736',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .dimensions',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'dimensions requires vector receiver, got number at 1:6',
    rawMessage: 'dimensions requires vector receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:748',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .model',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'model requires vector receiver, got number at 1:6',
    rawMessage: 'model requires vector receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:760',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .similarity(1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'similarity requires vector receiver, got number at 1:6',
    rawMessage: 'similarity requires vector receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:768',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'make_vec2() -> .similarity(1)',
      options: {
        hostFunctions: ['make_vec2'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'expected vector, got number at 1:16',
    rawMessage: 'expected vector, got number',
    location: {
      line: 1,
      column: 16,
      offset: 15,
    },
    span: {
      start: {
        line: 1,
        column: 16,
        offset: 15,
      },
      end: {
        line: 1,
        column: 16,
        offset: 15,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:775',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'make_vec2() -> .similarity(make_vec3())',
      options: {
        hostFunctions: ['make_vec2', 'make_vec3'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'vector dimension mismatch: 2 vs 3 at 1:16',
    rawMessage: 'vector dimension mismatch: 2 vs 3',
    location: {
      line: 1,
      column: 16,
      offset: 15,
    },
    span: {
      start: {
        line: 1,
        column: 16,
        offset: 15,
      },
      end: {
        line: 1,
        column: 16,
        offset: 15,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:799',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .dot(1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'dot requires vector receiver, got number at 1:6',
    rawMessage: 'dot requires vector receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:807',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'make_vec2() -> .dot(1)',
      options: {
        hostFunctions: ['make_vec2'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'expected vector, got number at 1:16',
    rawMessage: 'expected vector, got number',
    location: {
      line: 1,
      column: 16,
      offset: 15,
    },
    span: {
      start: {
        line: 1,
        column: 16,
        offset: 15,
      },
      end: {
        line: 1,
        column: 16,
        offset: 15,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:814',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'make_vec2() -> .dot(make_vec3())',
      options: {
        hostFunctions: ['make_vec2', 'make_vec3'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'vector dimension mismatch: 2 vs 3 at 1:16',
    rawMessage: 'vector dimension mismatch: 2 vs 3',
    location: {
      line: 1,
      column: 16,
      offset: 15,
    },
    span: {
      start: {
        line: 1,
        column: 16,
        offset: 15,
      },
      end: {
        line: 1,
        column: 16,
        offset: 15,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:830',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .distance(1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'distance requires vector receiver, got number at 1:6',
    rawMessage: 'distance requires vector receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:838',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'make_vec2() -> .distance(1)',
      options: {
        hostFunctions: ['make_vec2'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'expected vector, got number at 1:16',
    rawMessage: 'expected vector, got number',
    location: {
      line: 1,
      column: 16,
      offset: 15,
    },
    span: {
      start: {
        line: 1,
        column: 16,
        offset: 15,
      },
      end: {
        line: 1,
        column: 16,
        offset: 15,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:845',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'make_vec2() -> .distance(make_vec3())',
      options: {
        hostFunctions: ['make_vec2', 'make_vec3'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'vector dimension mismatch: 2 vs 3 at 1:16',
    rawMessage: 'vector dimension mismatch: 2 vs 3',
    location: {
      line: 1,
      column: 16,
      offset: 15,
    },
    span: {
      start: {
        line: 1,
        column: 16,
        offset: 15,
      },
      end: {
        line: 1,
        column: 16,
        offset: 15,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:862',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .norm',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'norm requires vector receiver, got number at 1:6',
    rawMessage: 'norm requires vector receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:879',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '1 -> .normalize',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'normalize requires vector receiver, got number at 1:6',
    rawMessage: 'normalize requires vector receiver, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:87',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> seq(5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R040',
    message: 'seq: body must be a closure, got number at 1:12',
    rawMessage: 'seq: body must be a closure, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'seq',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:138',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '"a" -> .repeat(10001) -> .split("") -> seq({ $ })',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R010',
    message: 'seq: iteration exceeded 10000 iterations at 1:40',
    rawMessage: 'seq: iteration exceeded 10000 iterations',
    location: {
      line: 1,
      column: 40,
      offset: 39,
    },
    span: {
      start: {
        line: 1,
        column: 40,
        offset: 39,
      },
      end: {
        line: 1,
        column: 40,
        offset: 39,
      },
    },
    sourceId: null,
    context: {
      limit: 10000,
      iterations: 10001,
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 40,
              offset: 39,
            },
            end: {
              line: 1,
              column: 40,
              offset: 39,
            },
          },
          functionName: 'seq',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:204',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> fan(5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R040',
    message: 'fan: body must be a closure, got number at 1:12',
    rawMessage: 'fan: body must be a closure, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'fan',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:215',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> fan({ $ }, 5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'fan: options must be a dict, got number at 1:12',
    rawMessage: 'fan: options must be a dict, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'fan',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:226',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> fan({ $ }, dict[concurrency: "x"])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'fan: options.concurrency must be a number, got string at 1:12',
    rawMessage: 'fan: options.concurrency must be a number, got string',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'fan',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:237',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> fan({ $ }, dict[concurrency: 0.5])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message:
      'fan: options.concurrency must be a positive integer, got 0.5 at 1:12',
    rawMessage: 'fan: options.concurrency must be a positive integer, got 0.5',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'fan',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:248',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> fan({ $ }, dict[batch: 1])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message:
      "fan: unknown option 'batch'; recognized options are 'concurrency' at 1:12",
    rawMessage:
      "fan: unknown option 'batch'; recognized options are 'concurrency'",
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'fan',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:346',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> acc(0, 5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R040',
    message: 'acc: body must be a closure, got number at 1:12',
    rawMessage: 'acc: body must be a closure, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'acc',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:411',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '"a" -> .repeat(10001) -> .split("") -> acc(0, { $@ })',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R010',
    message: 'acc: iteration exceeded 10000 iterations at 1:40',
    rawMessage: 'acc: iteration exceeded 10000 iterations',
    location: {
      line: 1,
      column: 40,
      offset: 39,
    },
    span: {
      start: {
        line: 1,
        column: 40,
        offset: 39,
      },
      end: {
        line: 1,
        column: 40,
        offset: 39,
      },
    },
    sourceId: null,
    context: {
      limit: 10000,
      iterations: 10001,
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 40,
              offset: 39,
            },
            end: {
              line: 1,
              column: 40,
              offset: 39,
            },
          },
          functionName: 'acc',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:487',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> fold(0, 5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R040',
    message: 'fold: body must be a closure, got number at 1:12',
    rawMessage: 'fold: body must be a closure, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'fold',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:515',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '"a" -> .repeat(10001) -> .split("") -> fold(0, { $@ })',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R010',
    message: 'fold: iteration exceeded 10000 iterations at 1:40',
    rawMessage: 'fold: iteration exceeded 10000 iterations',
    location: {
      line: 1,
      column: 40,
      offset: 39,
    },
    span: {
      start: {
        line: 1,
        column: 40,
        offset: 39,
      },
      end: {
        line: 1,
        column: 40,
        offset: 39,
      },
    },
    sourceId: null,
    context: {
      limit: 10000,
      iterations: 10001,
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 40,
              offset: 39,
            },
            end: {
              line: 1,
              column: 40,
              offset: 39,
            },
          },
          functionName: 'fold',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:591',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> filter(5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R040',
    message: 'filter: body must be a closure, got number at 1:12',
    rawMessage: 'filter: body must be a closure, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'filter',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:602',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> filter({ $ }, 5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'filter: options must be a dict, got number at 1:12',
    rawMessage: 'filter: options must be a dict, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'filter',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:613',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> filter({ $ }, dict[concurrency: "x"])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'filter: options.concurrency must be a number, got string at 1:12',
    rawMessage: 'filter: options.concurrency must be a number, got string',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'filter',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:624',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> filter({ $ }, dict[concurrency: 0.5])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message:
      'filter: options.concurrency must be a positive integer, got 0.5 at 1:12',
    rawMessage:
      'filter: options.concurrency must be a positive integer, got 0.5',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'filter',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:635',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> filter({ $ }, dict[batch: 1])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message:
      "filter: unknown option 'batch'; recognized options are 'concurrency' at 1:12",
    rawMessage:
      "filter: unknown option 'batch'; recognized options are 'concurrency'",
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'filter',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId:
      'packages/core/src/runtime/ext/builtins/functions/collections.ts:681',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'list[1] -> filter({ 5 })',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'filter: predicate must return bool, got number at 1:12',
    rawMessage: 'filter: predicate must return bool, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 12,
              offset: 11,
            },
            end: {
              line: 1,
              column: 12,
              offset: 11,
            },
          },
          functionName: 'filter',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:164',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'datetime("2026-03-13T08:00:00Z") -> .add(5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'datetime.add() requires a duration argument at 1:37',
    rawMessage: 'datetime.add() requires a duration argument',
    location: {
      line: 1,
      column: 37,
      offset: 36,
    },
    span: {
      start: {
        line: 1,
        column: 37,
        offset: 36,
      },
      end: {
        line: 1,
        column: 37,
        offset: 36,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:226',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'datetime("2026-03-13T08:00:00Z") -> .diff(5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'datetime.diff() requires a datetime argument at 1:37',
    rawMessage: 'datetime.diff() requires a datetime argument',
    location: {
      line: 1,
      column: 37,
      offset: 36,
    },
    span: {
      start: {
        line: 1,
        column: 37,
        offset: 36,
      },
      end: {
        line: 1,
        column: 37,
        offset: 36,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:337',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(1,0,0) -> .total_ms',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'total_ms is not defined for calendar durations at 1:20',
    rawMessage: 'total_ms is not defined for calendar durations',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:393',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(0,0,1) -> .add(5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'duration.add() requires a duration argument at 1:20',
    rawMessage: 'duration.add() requires a duration argument',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:412',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(0,0,1) -> .subtract(5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'duration.subtract() requires a duration argument at 1:20',
    rawMessage: 'duration.subtract() requires a duration argument',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:422',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(0,0,1) -> .subtract(duration(0,0,2))',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'duration.subtract() would produce negative result at 1:20',
    rawMessage: 'duration.subtract() would produce negative result',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:440',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(0,0,1) -> .multiply("a")',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'duration.multiply() requires a number argument at 1:20',
    rawMessage: 'duration.multiply() requires a number argument',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:447',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(0,0,1) -> .multiply(-1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'duration.multiply() requires non-negative number at 1:20',
    rawMessage: 'duration.multiply() requires non-negative number',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:456',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source:
        '|x| ($x * $x) => $sq\n10 -> $sq -> $sq -> $sq -> $sq -> $sq -> $sq -> $sq -> $sq => $big\nduration(0,0,1) -> .multiply($big) -> .multiply($big)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'duration.multiply() would produce a non-finite result at 3:39',
    rawMessage: 'duration.multiply() would produce a non-finite result',
    location: {
      line: 3,
      column: 39,
      offset: 126,
    },
    span: {
      start: {
        line: 3,
        column: 39,
        offset: 126,
      },
      end: {
        line: 3,
        column: 39,
        offset: 126,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/temporal/methods.ts:463',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(1,0,0) -> .multiply(0.1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message:
      'duration.multiply() would produce a fractional month value at 1:20',
    rawMessage: 'duration.multiply() would produce a fractional month value',
    location: {
      line: 1,
      column: 20,
      offset: 19,
    },
    span: {
      start: {
        line: 1,
        column: 20,
        offset: 19,
      },
      end: {
        line: 1,
        column: 20,
        offset: 19,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/functions/core.ts:172',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'range(0, 5, 0)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'range step cannot be zero at 1:1',
    rawMessage: 'range step cannot be zero',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 1,
        offset: 0,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 1,
              offset: 0,
            },
            end: {
              line: 1,
              column: 1,
              offset: 0,
            },
          },
          functionName: 'range',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/functions/core.ts:221',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'repeat("a", -1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R001',
    message: 'repeat count cannot be negative at 1:1',
    rawMessage: 'repeat count cannot be negative',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 1,
        offset: 0,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 1,
              offset: 0,
            },
            end: {
              line: 1,
              column: 1,
              offset: 0,
            },
          },
          functionName: 'repeat',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/functions/core.ts:287',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '5 -> chain(list[5])',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R040',
    message: 'chain: list element must be a closure, got number at 1:6',
    rawMessage: 'chain: list element must be a closure, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 6,
              offset: 5,
            },
            end: {
              line: 1,
              column: 6,
              offset: 5,
            },
          },
          functionName: 'chain',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/functions/core.ts:308',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '5 -> chain(5)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R040',
    message:
      'chain: second argument must be a closure or list of closures, got number at 1:6',
    rawMessage:
      'chain: second argument must be a closure or list of closures, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 6,
              offset: 5,
            },
            end: {
              line: 1,
              column: 6,
              offset: 5,
            },
          },
          functionName: 'chain',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/entry.ts:39',
    role: 'site',
    path: null,
    trigger: {
      kind: 'direct',
      call: {
        target: 'builtin-method',
        group: 'string',
        method: 'len',
        args: {},
        location: {
          line: 1,
          column: 1,
          offset: 0,
        },
      },
      justification:
        'script dispatch always binds a receiver argument, so only a direct method call with an empty args record reaches the missing-receiver check',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R044',
    message: "Missing required parameter 'receiver' at 1:1",
    rawMessage: "Missing required parameter 'receiver'",
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 1,
        offset: 0,
      },
    },
    sourceId: null,
    context: null,
    guardRecovers: null,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/constructors.ts:146',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'make_stream_dispose_fail() -> seq({ $ })',
      options: {
        hostFunctions: ['make_stream_dispose_fail'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R002',
    message: 'dispose failed at 1:31',
    rawMessage: 'dispose failed',
    location: {
      line: 1,
      column: 31,
      offset: 30,
    },
    span: {
      start: {
        line: 1,
        column: 31,
        offset: 30,
      },
      end: {
        line: 1,
        column: 31,
        offset: 30,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 31,
              offset: 30,
            },
            end: {
              line: 1,
              column: 31,
              offset: 30,
            },
          },
          functionName: 'seq',
        },
        {
          location: {
            start: {
              line: 1,
              column: 31,
              offset: 30,
            },
            end: {
              line: 1,
              column: 31,
              offset: 30,
            },
          },
          functionName: 'next',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/constructors.ts:156',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source:
        'make_stream_one_chunk() => $s\n$s.next() => $a\n$a.next() => $b\n$b.next()',
      options: {
        hostFunctions: ['make_stream_one_chunk'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R002',
    message: 'Stream already consumed; cannot re-iterate at 4:3',
    rawMessage: 'Stream already consumed; cannot re-iterate',
    location: {
      line: 4,
      column: 3,
      offset: 64,
    },
    span: {
      start: {
        line: 4,
        column: 3,
        offset: 64,
      },
      end: {
        line: 4,
        column: 3,
        offset: 64,
      },
    },
    sourceId: null,
    context: {
      alreadyConsumed: true,
      callStack: [
        {
          location: {
            start: {
              line: 4,
              column: 3,
              offset: 64,
            },
            end: {
              line: 4,
              column: 3,
              offset: 64,
            },
          },
          functionName: 'next',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/constructors.ts:173',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source:
        'make_stream_one_chunk() => $s\n$s.next() => $a\n$a.next() => $b\n$a.next()',
      options: {
        hostFunctions: ['make_stream_one_chunk'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R002',
    message: 'Stream already consumed; cannot re-iterate at 4:3',
    rawMessage: 'Stream already consumed; cannot re-iterate',
    location: {
      line: 4,
      column: 3,
      offset: 64,
    },
    span: {
      start: {
        line: 4,
        column: 3,
        offset: 64,
      },
      end: {
        line: 4,
        column: 3,
        offset: 64,
      },
    },
    sourceId: null,
    context: {
      alreadyConsumed: true,
      callStack: [
        {
          location: {
            start: {
              line: 4,
              column: 3,
              offset: 64,
            },
            end: {
              line: 4,
              column: 3,
              offset: 64,
            },
          },
          functionName: 'next',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/constructors.ts:181',
    role: 'site',
    path: null,
    trigger: {
      kind: 'unreachable',
      justification:
        'the exhausted-but-not-stale check cannot fire through any public path: exhaustion is recorded only while the frontier step is consumed, and that step is marked stale before the next one exists, so every earlier step is already stale; observable fields are copied from the code-identical sibling sites (message, errorId, context) with location-less shape',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R002',
    message: 'Stream already consumed; cannot re-iterate',
    rawMessage: 'Stream already consumed; cannot re-iterate',
    location: null,
    span: null,
    sourceId: null,
    context: {
      alreadyConsumed: true,
    },
    guardRecovers: null,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/constructors.ts:204',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'make_stream() => $s\n$s -> seq({ $ })\n$s -> seq({ $ })',
      options: {
        hostFunctions: ['make_stream'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R002',
    message: 'Stream already consumed; cannot re-iterate at 3:7',
    rawMessage: 'Stream already consumed; cannot re-iterate',
    location: {
      line: 3,
      column: 7,
      offset: 43,
    },
    span: {
      start: {
        line: 3,
        column: 7,
        offset: 43,
      },
      end: {
        line: 3,
        column: 7,
        offset: 43,
      },
    },
    sourceId: null,
    context: {
      alreadyConsumed: true,
      callStack: [
        {
          location: {
            start: {
              line: 3,
              column: 7,
              offset: 43,
            },
            end: {
              line: 3,
              column: 7,
              offset: 43,
            },
          },
          functionName: 'seq',
        },
        {
          location: {
            start: {
              line: 3,
              column: 7,
              offset: 43,
            },
            end: {
              line: 3,
              column: 7,
              offset: 43,
            },
          },
          functionName: 'next',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/callable.ts:797',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'return_undefined()',
      options: {
        hostFunctions: ['return_undefined'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R085',
    message:
      "Host function 'return_undefined' returned an invalid value at <root>: undefined at 1:1",
    rawMessage:
      "Host function 'return_undefined' returned an invalid value at <root>: undefined",
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 1,
        offset: 0,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 1,
              offset: 0,
            },
            end: {
              line: 1,
              column: 1,
              offset: 0,
            },
          },
          functionName: 'return_undefined',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/string.ts:62',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '"abc" -> number',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R038',
    message: 'cannot convert string "abc" to number at 1:1',
    rawMessage: 'cannot convert string "abc" to number',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 16,
        offset: 15,
      },
    },
    sourceId: null,
    context: {
      value: 'abc',
    },
    guardRecovers: true,
    logText: null,
    migrated: false,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/string.ts:86',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '"abc" -> bool',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R036',
    message: 'cannot convert string to bool at 1:1',
    rawMessage: 'cannot convert string to bool',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 14,
        offset: 13,
      },
    },
    sourceId: null,
    context: {
      source: 'string',
      target: 'bool',
    },
    guardRecovers: true,
    logText: null,
    migrated: false,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/number.ts:55',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: '5 -> bool',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R036',
    message: 'cannot convert number to bool at 1:1',
    rawMessage: 'cannot convert number to bool',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 10,
        offset: 9,
      },
    },
    sourceId: null,
    context: {
      source: 'number',
      target: 'bool',
    },
    guardRecovers: true,
    logText: null,
    migrated: false,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/duration.ts:82',
    role: 'site',
    path: null,
    trigger: {
      kind: 'script',
      source: 'duration(1,0,0) < duration(0,0,1)',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R002',
    message: 'Cannot order durations with different calendar components',
    rawMessage: 'Cannot order durations with different calendar components',
    location: null,
    span: null,
    sourceId: null,
    context: null,
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/string.ts:62',
    role: 'provenance',
    path: null,
    trigger: {
      kind: 'direct',
      call: {
        target: 'protocol-convert',
        typeName: 'string',
        toType: 'number',
        value: 'abc',
      },
      justification:
        'provenance entries call the BUILT_IN_TYPES converter directly, bypassing the conversion-boundary remap, so the raw site is distinguished from an unmigrated one',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R064',
    message: 'cannot convert string "abc" to number',
    rawMessage: 'cannot convert string "abc" to number',
    location: null,
    span: null,
    sourceId: null,
    context: null,
    guardRecovers: null,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/string.ts:86',
    role: 'provenance',
    path: null,
    trigger: {
      kind: 'direct',
      call: {
        target: 'protocol-convert',
        typeName: 'string',
        toType: 'bool',
        value: 'abc',
      },
      justification:
        'provenance entries call the BUILT_IN_TYPES converter directly, bypassing the conversion-boundary remap, so the raw site is distinguished from an unmigrated one',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R065',
    message: 'cannot convert string "abc" to bool',
    rawMessage: 'cannot convert string "abc" to bool',
    location: null,
    span: null,
    sourceId: null,
    context: null,
    guardRecovers: null,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/number.ts:55',
    role: 'provenance',
    path: null,
    trigger: {
      kind: 'direct',
      call: {
        target: 'protocol-convert',
        typeName: 'number',
        toType: 'bool',
        value: 5,
      },
      justification:
        'provenance entries call the BUILT_IN_TYPES converter directly, bypassing the conversion-boundary remap, so the raw site is distinguished from an unmigrated one',
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R066',
    message: 'cannot convert number 5 to bool',
    rawMessage: 'cannot convert number 5 to bool',
    location: null,
    span: null,
    sourceId: null,
    context: null,
    guardRecovers: null,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/constructors.ts:204',
    role: 'boundary',
    path: 'host-call-location',
    trigger: {
      kind: 'script',
      source: 'stream_next_twice()',
      options: {
        hostFunctions: ['stream_next_twice'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R002',
    message: 'Stream already consumed; cannot re-iterate at 1:1',
    rawMessage: 'Stream already consumed; cannot re-iterate',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 1,
        offset: 0,
      },
    },
    sourceId: null,
    context: {
      alreadyConsumed: true,
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 1,
              offset: 0,
            },
            end: {
              line: 1,
              column: 1,
              offset: 0,
            },
          },
          functionName: 'stream_next_twice',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/duration.ts:82',
    role: 'boundary',
    path: 'host-call-location',
    trigger: {
      kind: 'script',
      source: 'compare_calendar_durations()',
      options: {
        hostFunctions: ['compare_calendar_durations'],
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R002',
    message: 'Cannot order durations with different calendar components at 1:1',
    rawMessage: 'Cannot order durations with different calendar components',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 1,
        offset: 0,
      },
    },
    sourceId: null,
    context: {
      callStack: [
        {
          location: {
            start: {
              line: 1,
              column: 1,
              offset: 0,
            },
            end: {
              line: 1,
              column: 1,
              offset: 0,
            },
          },
          functionName: 'compare_calendar_durations',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:107',
    role: 'boundary',
    path: 'script-callable-source',
    trigger: {
      kind: 'script',
      source: 'use<module:lib> => $f\n5 -> $f',
      options: {
        moduleSources: {
          lib: '|x| ($x -> .head)',
          top: '5 -> .head',
        },
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'head requires list or string, got number at 1:12',
    rawMessage: 'head requires list or string, got number',
    location: {
      line: 1,
      column: 12,
      offset: 11,
    },
    span: {
      start: {
        line: 1,
        column: 12,
        offset: 11,
      },
      end: {
        line: 1,
        column: 12,
        offset: 11,
      },
    },
    sourceId: 'module:lib',
    context: {
      sourceText: '|x| ($x -> .head)',
      callStack: [
        {
          location: {
            start: {
              line: 2,
              column: 6,
              offset: 27,
            },
            end: {
              line: 2,
              column: 6,
              offset: 27,
            },
          },
          functionName: '<closure>',
        },
      ],
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:107',
    role: 'boundary',
    path: 'use-module',
    trigger: {
      kind: 'script',
      source: 'use<module:top>',
      options: {
        moduleSources: {
          lib: '|x| ($x -> .head)',
          top: '5 -> .head',
        },
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R003',
    message: 'head requires list or string, got number at 1:6',
    rawMessage: 'head requires list or string, got number',
    location: {
      line: 1,
      column: 6,
      offset: 5,
    },
    span: {
      start: {
        line: 1,
        column: 6,
        offset: 5,
      },
      end: {
        line: 1,
        column: 6,
        offset: 5,
      },
    },
    sourceId: 'module:top',
    context: {
      sourceText: '5 -> .head',
    },
    guardRecovers: false,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:107',
    role: 'boundary',
    path: 'timeout-expired',
    trigger: {
      kind: 'script',
      source: 'timeout<total: duration(0,0,1)> { delay_then_head() }',
      options: {
        hostFunctions: ['delay_then_head'],
        scheduler: 'fast-expiry',
      },
    },
    thrownClass: 'RuntimeError',
    errorId: 'RILL-R082',
    message: 'timeout<total:> exceeded after 86400000ms at 1:1',
    rawMessage: 'timeout<total:> exceeded after 86400000ms',
    location: {
      line: 1,
      column: 1,
      offset: 0,
    },
    span: {
      start: {
        line: 1,
        column: 1,
        offset: 0,
      },
      end: {
        line: 1,
        column: 54,
        offset: 53,
      },
    },
    sourceId: null,
    context: {
      durationMs: 86400000,
    },
    guardRecovers: true,
    logText: null,
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/ext/builtins/methods/bodies.ts:107',
    role: 'boundary',
    path: 'async-pass-log',
    trigger: {
      kind: 'script',
      source: '"x" -> pass<async: true> { 5 -> .head }',
      options: {
        captureDisposeLog: true,
      },
    },
    thrownClass: null,
    errorId: null,
    message: null,
    rawMessage: null,
    location: null,
    span: null,
    sourceId: null,
    context: null,
    guardRecovers: null,
    logText: 'head requires list or string, got number at 1:33',
    migrated: true,
  },
  {
    siteId: 'packages/core/src/runtime/core/types/protocols/duration.ts:82',
    role: 'boundary',
    path: 'async-pass-log',
    trigger: {
      kind: 'script',
      source: '"x" -> pass<async: true> { duration(1,0,0) < duration(0,0,1) }',
      options: {
        captureDisposeLog: true,
      },
    },
    thrownClass: null,
    errorId: null,
    message: null,
    rawMessage: null,
    location: null,
    span: null,
    sourceId: null,
    context: null,
    guardRecovers: null,
    logText: 'Cannot order durations with different calendar components',
    migrated: true,
  },
];
