/**
 * Runtime Context Factory
 *
 * Creates and configures the runtime context for script execution.
 * Public API for host applications.
 */

import { RuntimeError } from '../../types.js';
import { BUILTIN_FUNCTIONS } from '../ext/builtins.js';
import { BUILT_IN_TYPES } from './types/registrations.js';
import type {
  RuntimeCallbacks,
  RuntimeContext,
  RuntimeOptions,
  SchemeResolver,
  InvalidMeta,
} from './types/runtime.js';
import { bindDictCallables } from './types/runtime.js';
import type { RillValue } from './types/structures.js';
import { inferType } from './types/registrations.js';
import {
  invalidate as invalidateStatus,
  type InvalidateMeta,
} from './types/status.js';
import { createTraceFrame } from './types/trace.js';
import {
  callable,
  validateDefaultValueType,
  type ApplicationCallable,
  type RillParam,
} from './callable.js';

/**
 * Maximum time (ms) `dispose()` waits for in-flight operations before
 * logging a warning and proceeding (EC-11).
 */
const DISPOSE_TIMEOUT_MS = 5000;

/**
 * Non-enumerable slot used to stash the shared {@link LifecycleState} on
 * the factory-scope RuntimeContext. Child contexts locate it by reference
 * through the parent chain so dispose and the chained signal remain shared.
 */
const LIFECYCLE_SYMBOL: unique symbol = Symbol('rill.lifecycle');

/**
 * Shared lifecycle state between a factory-scope context and all child
 * contexts derived from it. A single object is created in
 * `createRuntimeContext` and propagated by reference to children so that
 * `dispose`, `isDisposed`, and the chained signal observe the same state.
 */
interface LifecycleState {
  readonly factoryController: AbortController;
  readonly signal: AbortSignal | undefined;
  readonly callbacks: RuntimeCallbacks;
  disposed: boolean;
  disposePromise: Promise<void> | null;
  readonly inflight: Set<Promise<unknown>>;
}

/**
 * Build the AbortSignal exposed to host-function call sites.
 *
 * When the host supplied `options.signal`, chain it with the factory-scope
 * controller via `AbortSignal.any` so either can cancel. Requires Node
 * >= 22.16.0 / 24.0.0 (DEC-6) to avoid GC bug #57736.
 */
function buildChainedSignal(
  factorySignal: AbortSignal,
  hostSignal: AbortSignal | undefined
): AbortSignal {
  if (hostSignal === undefined) return factorySignal;
  return AbortSignal.any([factorySignal, hostSignal]);
}

/**
 * Bind `invalidate`, `catch`, `dispose`, `isDisposed`, and
 * `createDisposedResult` onto a mutable context draft.
 *
 * Shared between factory-scope and child-scope construction so both
 * observe the same lifecycle state.
 */
function bindLifecycleMethods(
  draft: {
    invalidate: RuntimeContext['invalidate'];
    catch: RuntimeContext['catch'];
    dispose: RuntimeContext['dispose'];
    isDisposed: RuntimeContext['isDisposed'];
    createDisposedResult: RuntimeContext['createDisposedResult'];
    trackInflight: RuntimeContext['trackInflight'];
  },
  state: LifecycleState
): void {
  draft.invalidate = (error: unknown, meta: InvalidMeta): RillValue => {
    const mergedMeta = mergeMetaWithError(error, meta);
    return invalidateStatus(
      {},
      mergedMeta,
      createTraceFrame({
        site: '',
        kind: 'host',
        fn: meta.provider,
      })
    );
  };

  draft.catch = async <T>(
    thunk: () => Promise<T>,
    detector: (e: unknown) => InvalidMeta | null
  ): Promise<T | RillValue> => {
    try {
      return await thunk();
    } catch (err) {
      // Non-Error thrown (string, number, etc.) → #R999 with sanitized raw.
      if (!(err instanceof Error)) {
        return draft.invalidate(err, {
          code: 'R999',
          provider: 'catch',
          raw: { original: String(err) },
        });
      }
      const detected = detector(err);
      if (detected === null) {
        return draft.invalidate(err, {
          code: 'R999',
          provider: 'catch',
          raw: { message: sanitizeMessage(err.message) },
        });
      }
      return draft.invalidate(err, detected);
    }
  };

  draft.dispose = (): Promise<void> => {
    if (state.disposePromise !== null) return state.disposePromise;
    state.disposePromise = performDispose(state);
    return state.disposePromise;
  };

  draft.isDisposed = (): boolean => state.disposed;

  draft.createDisposedResult = (): RillValue =>
    invalidateStatus(
      {},
      { code: 'DISPOSED', provider: 'runtime', raw: {} },
      createTraceFrame({ site: '', kind: 'host', fn: 'dispose' })
    );

  draft.trackInflight = (promise: Promise<unknown>): void => {
    // Defensive: dispose() already began — do not register new work.
    if (state.disposed) return;
    state.inflight.add(promise);
    // Settle handler removes the entry regardless of fulfillment state.
    // Swallow rejections here so an unhandled-promise observer is not
    // triggered by the bookkeeping promise; actual rejection handling
    // remains the responsibility of the dispatch site.
    const forget = (): void => {
      state.inflight.delete(promise);
    };
    promise.then(forget, forget);
  };
}

/**
 * Merge an arbitrary thrown value with caller-supplied meta.
 *
 * Preserves `meta.raw` fields and fills `message` from the error when the
 * caller did not provide one. Never mutates the input meta.
 */
function mergeMetaWithError(error: unknown, meta: InvalidMeta): InvalidateMeta {
  const existingRaw = meta.raw ?? {};
  const hasMessage =
    typeof (existingRaw as { message?: unknown }).message === 'string';
  if (hasMessage) return meta;
  if (error instanceof Error) {
    return {
      code: meta.code,
      provider: meta.provider,
      raw: { ...existingRaw, message: sanitizeMessage(error.message) },
    };
  }
  return meta;
}

/**
 * Strip stack traces and trailing whitespace from error messages before
 * embedding them in `raw.message` to avoid leaking host-internal detail.
 */
function sanitizeMessage(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? '';
  return firstLine.trim();
}

/**
 * Implements the `dispose()` cascade (IR-13, EC-11):
 * 1. Abort the factory-scope controller.
 * 2. Await in-flight operations with a bounded timeout.
 * 3. On timeout, log a warning via callbacks and proceed.
 * 4. Flip the disposed flag.
 */
async function performDispose(state: LifecycleState): Promise<void> {
  state.factoryController.abort();

  if (state.inflight.size > 0) {
    try {
      await Promise.race([
        Promise.allSettled(Array.from(state.inflight)),
        timeoutReject(DISPOSE_TIMEOUT_MS),
      ]);
    } catch {
      logDisposeTimeout(state);
    }
  }

  state.disposed = true;
}

/**
 * Reject after `ms` milliseconds; used by `performDispose` to bound the
 * in-flight wait without pulling in Node's timers/promises API.
 */
function timeoutReject(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dispose-timeout')), ms);
    // Don't let the timer keep the process alive on Node.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref(): void }).unref();
    }
  });
}

/**
 * Emit a dispose-timeout warning via the existing callbacks channel.
 *
 * Prefers `onLogEvent` when the host installed it (structured diagnostic);
 * falls back to `onLog` so the warning is never silently dropped.
 */
function logDisposeTimeout(state: LifecycleState): void {
  const callbacks = state.callbacks;
  if (callbacks.onLogEvent !== undefined) {
    callbacks.onLogEvent({
      event: 'dispose_timeout',
      subsystem: 'runtime',
      timestamp: new Date().toISOString(),
      timeoutMs: DISPOSE_TIMEOUT_MS,
    });
    return;
  }
  callbacks.onLog(
    `runtime: dispose() exceeded ${DISPOSE_TIMEOUT_MS}ms waiting for in-flight operations`
  );
}

// Built-in functions that are genuinely variadic and must skip arg validation.
// log: tests call log("msg", extraValue) — extra args are silently ignored.
// chain: pipe form sends 1 arg when signature declares 2 (pipeValue is the first).
const UNTYPED_BUILTINS = new Set(['log', 'chain']);

// Built-in methods that do their own internal arg validation with specific error
// messages expected by protected language tests. Generic marshalArgs
// must not fire before the method body's own check.
export const UNVALIDATED_METHOD_PARAMS = new Set(['has', 'has_any', 'has_all']);

/**
 * Derive the set of method names that handle their own receiver type checking.
 * Collects names from methods where skipReceiverValidation is true.
 * Methods without the flag default to standard RILL-R003 receiver validation.
 */
function deriveUnvalidatedMethodReceivers(
  registrations: readonly import('./types/registrations.js').TypeDefinition[]
): ReadonlySet<string> {
  const bypass = new Set<string>();
  for (const reg of registrations) {
    for (const [name, method] of Object.entries(reg.methods)) {
      if (method.skipReceiverValidation) {
        bypass.add(name);
      }
    }
  }
  return Object.freeze(bypass);
}

// Module-level caches: parse signatures once at load time, not per context creation.

type BuiltinFnEntry = {
  appCallable: import('./callable.js').ApplicationCallable;
};
const BUILTIN_FN_CACHE = new Map<string, BuiltinFnEntry>();

function initBuiltinCaches(): void {
  for (const [name, entry] of Object.entries(BUILTIN_FUNCTIONS)) {
    if (UNTYPED_BUILTINS.has(name)) {
      BUILTIN_FN_CACHE.set(name, { appCallable: callable(entry.fn, false) });
      continue;
    }
    const appCallable = callable(entry.fn, false);
    const typedCallable: import('./callable.js').ApplicationCallable = {
      ...appCallable,
      params: entry.params as RillParam[],
      returnType: entry.returnType,
    };
    BUILTIN_FN_CACHE.set(name, { appCallable: typedCallable });
  }
}

// Initialise once at module load.
initBuiltinCaches();

const defaultCallbacks: RuntimeCallbacks = {
  onLog: (message) => {
    console.log(message);
  },
};

/**
 * Create a runtime context for script execution.
 * This is the main entry point for configuring the Rill runtime.
 */
export function createRuntimeContext(
  options: RuntimeOptions = {}
): RuntimeContext {
  const variables = new Map<string, RillValue>();
  const variableTypes = new Map<
    string,
    import('../../types.js').RillTypeName | import('./values.js').TypeStructure
  >();
  const functions = new Map<
    string,
    | import('./callable.js').CallableFn
    | import('./callable.js').ApplicationCallable
  >();
  // Set initial variables (and infer their types)
  if (options.variables) {
    for (const [name, value] of Object.entries(options.variables)) {
      // Bind callables in dicts to their containing dict
      const boundValue = bindDictCallables(value);
      variables.set(name, boundValue);
      variableTypes.set(
        name,
        inferType(boundValue) as import('../../types.js').RillTypeName
      );
    }
  }

  // Set built-in functions from module-level cache (parsed once at load time).
  for (const [name, cached] of BUILTIN_FN_CACHE) {
    functions.set(name, cached.appCallable);
  }

  // Set custom functions (can override built-ins)
  if (options.functions) {
    for (const [name, definition] of Object.entries(options.functions)) {
      const params = definition.params as RillParam[];
      const description = definition.annotations?.['description'] as
        | string
        | undefined;

      // Validate default values at registration time (EC-4)
      for (const param of params) {
        validateDefaultValueType(param, name);
      }

      // Validate descriptions when requireDescriptions enabled (IR-6)
      if (options.requireDescriptions === true) {
        // Check function description (EC-10)
        if (
          description === undefined ||
          typeof description !== 'string' ||
          description.trim().length === 0
        ) {
          throw new RuntimeError(
            'RILL-R069',
            `Function '${name}' requires description (requireDescriptions enabled)`
          );
        }

        // Check parameter descriptions (EC-11)
        for (const param of params) {
          const paramDesc = param.annotations['description'];
          if (
            paramDesc === undefined ||
            typeof paramDesc !== 'string' ||
            paramDesc.trim().length === 0
          ) {
            throw new RuntimeError(
              'RILL-R070',
              `Parameter '${param.name}' of function '${name}' requires description (requireDescriptions enabled)`
            );
          }
        }
      }

      // Direct RillFunction mapping (AC-15: only structured form accepted)
      const appCallable: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        isProperty: false,
        fn: definition.fn,
        params,
        annotations: definition.annotations ?? {},
        returnType: definition.returnType,
      };

      functions.set(name, appCallable);
    }
  }

  // Compile autoException patterns into RegExp objects
  const autoExceptions: RegExp[] = [];
  if (options.autoExceptions) {
    for (const pattern of options.autoExceptions) {
      try {
        autoExceptions.push(new RegExp(pattern));
      } catch {
        throw new RuntimeError(
          'RILL-R011',
          `Invalid autoException pattern: ${pattern}`,
          undefined,
          { pattern }
        );
      }
    }
  }

  const resolvers = new Map<string, SchemeResolver>(
    options.resolvers ? Object.entries(options.resolvers) : []
  );
  const resolverConfigs = new Map<string, unknown>(
    options.configurations?.resolvers
      ? Object.entries(options.configurations.resolvers)
      : []
  );

  // EC-1: Validate no duplicate type names in registrations.
  const seenTypeNames = new Set<string>();
  for (const reg of BUILT_IN_TYPES) {
    if (seenTypeNames.has(reg.name)) {
      throw new RuntimeError(
        'RILL-R071',
        `Duplicate type registration '${reg.name}'`
      );
    }
    seenTypeNames.add(reg.name);
  }

  // EC-2: Validate every registration has protocol.format.
  for (const reg of BUILT_IN_TYPES) {
    if (!reg.protocol.format) {
      throw new RuntimeError(
        'RILL-R072',
        `Type '${reg.name}' missing required format protocol`
      );
    }
  }

  // Derive typeNames from registrations (replaces VALID_TYPE_NAMES in context).
  const typeNames: readonly string[] = Object.freeze(
    BUILT_IN_TYPES.map((r) => r.name)
  );

  // Derive leafTypes from registrations where isLeaf === true, plus 'any'
  // which has no registration but rejects type arguments (AC-4).
  const leafTypes: ReadonlySet<string> = Object.freeze(
    new Set([
      ...BUILT_IN_TYPES.filter((r) => r.isLeaf).map((r) => r.name),
      'any',
    ])
  );

  // Derive method dicts from registration.methods (absorbs buildTypeMethodDicts
  // logic). Validates EC-6: duplicate method on same type.
  const methodRegistry = new Map<string, Set<string>>();
  const typeMethodDicts = new Map<
    string,
    Readonly<Record<string, RillValue>>
  >();

  for (const reg of BUILT_IN_TYPES) {
    const methods = reg.methods;
    if (!methods || Object.keys(methods).length === 0) continue;

    const seen = methodRegistry.get(reg.name) ?? new Set<string>();
    methodRegistry.set(reg.name, seen);

    const existing = typeMethodDicts.get(reg.name) ?? {};
    const dict: Record<string, RillValue> = { ...existing };

    for (const [name, fn] of Object.entries(methods)) {
      if (seen.has(name)) {
        throw new RuntimeError(
          'RILL-R073',
          `Duplicate method '${name}' on type '${reg.name}'`
        );
      }
      seen.add(name);
      const appCallable: ApplicationCallable = {
        __type: 'callable',
        kind: 'application',
        params: fn.params as RillParam[],
        returnType: fn.returnType,
        annotations: fn.annotations ?? {},
        isProperty: false,
        fn: fn.fn,
      };
      dict[name] = appCallable;
    }

    typeMethodDicts.set(reg.name, Object.freeze(dict));
  }

  // Derive bypass set from registrations: method names that handle their own
  // receiver type checking. Generic RILL-R003 must not fire before the method body.
  const unvalidatedMethodReceivers =
    deriveUnvalidatedMethodReceivers(BUILT_IN_TYPES);

  // BC-5: Freeze all derived collections after creation.
  Object.freeze(typeNames);
  Object.freeze(typeMethodDicts);

  // Suppress unused-variable warning for typeNames (consumed in later phases).
  void typeNames;

  // Factory-scope AbortController: its signal is the ExtensionFactoryCtx.signal
  // surface (wired in task 3.5) and is chained with the host-supplied signal
  // (when present) for host-function call sites.
  const factoryController = new AbortController();
  const mergedCallbacks: RuntimeCallbacks = {
    ...defaultCallbacks,
    ...options.callbacks,
  };
  const lifecycle: LifecycleState = {
    factoryController,
    signal: buildChainedSignal(factoryController.signal, options.signal),
    callbacks: mergedCallbacks,
    disposed: false,
    disposePromise: null,
    inflight: new Set(),
  };

  const ctx: RuntimeContext = {
    parent: undefined,
    variables,
    variableTypes,
    functions,
    typeMethodDicts,
    leafTypes,
    unvalidatedMethodReceivers,
    callbacks: mergedCallbacks,
    observability: options.observability ?? {},
    pipeValue: null,
    timeout: options.timeout,
    autoExceptions,
    signal: lifecycle.signal,
    // Lifecycle methods bound below via bindLifecycleMethods; transient
    // placeholders satisfy strict interface typing until that call returns.
    invalidate: () => null,
    catch: async () => null,
    dispose: async () => undefined,
    isDisposed: () => false,
    createDisposedResult: () => null,
    trackInflight: () => {},
    maxCallStackDepth: options.maxCallStackDepth ?? 100,
    annotationStack: [],
    callStack: [],
    metadata: options.metadata,
    hostContext: options.hostContext ?? {},
    immediateAnnotation: undefined,
    resolvers,
    resolverConfigs,
    resolvingSchemes: new Set(),
    parseSource: options.parseSource,
    timezone: options.timezone,
    nowMs: options.nowMs,
  };

  bindLifecycleMethods(ctx, lifecycle);

  // Stash lifecycle state so createChildContext can find it by walking to
  // the root. Non-enumerable to avoid leaking into structural comparisons.
  Object.defineProperty(ctx, LIFECYCLE_SYMBOL, {
    value: lifecycle,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return ctx;
}

/**
 * Walk the parent chain to find the shared {@link LifecycleState} stashed
 * by `createRuntimeContext`. Returns `undefined` for minimal literal
 * contexts (e.g. `eval/index.ts:assertType`) that never participate in
 * dispose flow.
 */
function findLifecycleState(ctx: RuntimeContext): LifecycleState | undefined {
  // Walk via `parent`; the lifecycle lives on the root factory-scope ctx.
  let cursor: RuntimeContext | undefined = ctx;
  while (cursor !== undefined) {
    const slot = (cursor as unknown as Record<symbol, unknown>)[
      LIFECYCLE_SYMBOL
    ];
    if (slot !== undefined) return slot as LifecycleState;
    cursor = cursor.parent;
  }
  return undefined;
}

/**
 * Create a child context for block scoping.
 * Child inherits parent's functions, methods, callbacks, etc.
 * but has its own variables map. Variable lookups walk the parent chain.
 *
 * Child contexts inherit the parent's lifecycle state (disposed flag,
 * chained signal, and dispose promise) by reference so a single
 * `dispose()` call cascades across the entire scope tree.
 */
export function createChildContext(
  parent: RuntimeContext,
  overrides?: { sourceId?: string; sourceText?: string }
): RuntimeContext {
  const child: RuntimeContext = {
    parent,
    variables: new Map<string, RillValue>(),
    variableTypes: new Map<
      string,
      | import('../../types.js').RillTypeName
      | import('./values.js').TypeStructure
    >(),
    functions: parent.functions,
    typeMethodDicts: parent.typeMethodDicts,
    leafTypes: parent.leafTypes,
    unvalidatedMethodReceivers: parent.unvalidatedMethodReceivers,
    callbacks: parent.callbacks,
    observability: parent.observability,
    pipeValue: parent.pipeValue,
    timeout: parent.timeout,
    autoExceptions: parent.autoExceptions,
    signal: parent.signal,
    // Inherit the parent-bound methods. When the parent was produced by
    // `createRuntimeContext`, these are real implementations sharing
    // lifecycle state via closure. Rebinding here would break dispose
    // idempotency across scopes.
    invalidate: parent.invalidate,
    catch: parent.catch,
    dispose: parent.dispose,
    isDisposed: parent.isDisposed,
    createDisposedResult: parent.createDisposedResult,
    trackInflight: parent.trackInflight,
    maxCallStackDepth: parent.maxCallStackDepth,
    annotationStack: parent.annotationStack,
    callStack: parent.callStack,
    metadata: parent.metadata,
    hostContext: parent.hostContext,
    immediateAnnotation: undefined,
    resolvers: parent.resolvers,
    resolverConfigs: parent.resolverConfigs,
    resolvingSchemes: parent.resolvingSchemes,
    parseSource: parent.parseSource,
    sourceId: overrides?.sourceId ?? parent.sourceId,
    sourceText: overrides?.sourceText ?? parent.sourceText,
  };
  // Suppress unused-variable warning for findLifecycleState; exposed for
  // future callers that need to inspect the shared state without reaching
  // into the parent's closures (e.g. dispatch-site guards in task 3.3).
  void findLifecycleState;
  return child;
}

/**
 * Get a variable value, walking the parent chain.
 * Returns undefined if not found in any scope.
 */
export function getVariable(
  ctx: RuntimeContext,
  name: string
): RillValue | undefined {
  if (ctx.variables.has(name)) {
    return ctx.variables.get(name);
  }
  if (ctx.parent) {
    return getVariable(ctx.parent, name);
  }
  return undefined;
}

/**
 * Check if a variable exists in any scope.
 */
export function hasVariable(ctx: RuntimeContext, name: string): boolean {
  if (ctx.variables.has(name)) {
    return true;
  }
  if (ctx.parent) {
    return hasVariable(ctx.parent, name);
  }
  return false;
}

/**
 * Extract call stack from RuntimeError.
 * Returns empty array if no call stack attached.
 *
 * Constraints:
 * - O(1) access (stored on error instance)
 * - Returns defensive copy (immutable)
 */
export function getCallStack(
  error: import('../../types.js').RillError
): readonly import('../../types.js').CallFrame[] {
  // EC-1: Non-RillError passed
  if (
    !error ||
    typeof error !== 'object' ||
    !(error instanceof Error) ||
    !('errorId' in error)
  ) {
    throw new TypeError('Expected RillError instance');
  }

  // Return defensive copy from context or empty array
  const callStack = (
    error.context as
      | { callStack?: import('../../types.js').CallFrame[] }
      | undefined
  )?.callStack;
  return callStack ? [...callStack] : [];
}

/**
 * Push frame onto call stack before function/closure execution.
 *
 * Constraints:
 * - Stack depth limited by maxCallStackDepth option
 * - Older frames dropped when limit exceeded
 */
export function pushCallFrame(
  ctx: RuntimeContext,
  frame: import('../../types.js').CallFrame
): void {
  ctx.callStack.push(frame);

  // Drop older frames if limit exceeded
  if (ctx.callStack.length > ctx.maxCallStackDepth) {
    ctx.callStack.shift();
  }
}

/**
 * Pop frame from call stack after function/closure returns.
 */
export function popCallFrame(ctx: RuntimeContext): void {
  // EC-2: Pop on empty stack is no-op (defensive)
  if (ctx.callStack.length > 0) {
    ctx.callStack.pop();
  }
}
