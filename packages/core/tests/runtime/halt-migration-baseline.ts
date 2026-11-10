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
 * entry once its site has been migrated. An entry is removed, never edited,
 * when a later change alters its contract on purpose.
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
];
