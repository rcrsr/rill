/**
 * Runtime Context Factory
 *
 * Creates and configures the runtime context for script execution.
 * Public API for host applications.
 */

import { RuntimeError } from '../../types.js';
import { BUILTIN_FUNCTIONS } from '../ext/builtins.js';
import { BUILT_IN_TYPES } from './type-registrations.js';
import type {
  RuntimeCallbacks,
  RuntimeContext,
  RuntimeOptions,
  SchemeResolver,
} from './types.js';
import { bindDictCallables } from './types.js';
import { inferType, type RillValue } from './values.js';
import {
  callable,
  validateDefaultValueType,
  type ApplicationCallable,
  type RillParam,
} from './callable.js';

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
  registrations: readonly import('./type-registrations.js').TypeDefinition[]
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
          throw new Error(
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
            throw new Error(
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
      throw new Error(`Duplicate type registration '${reg.name}'`);
    }
    seenTypeNames.add(reg.name);
  }

  // EC-2: Validate every registration has protocol.format.
  for (const reg of BUILT_IN_TYPES) {
    if (!reg.protocol.format) {
      throw new Error(`Type '${reg.name}' missing required format protocol`);
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
        throw new Error(`Duplicate method '${name}' on type '${reg.name}'`);
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

  return {
    parent: undefined,
    variables,
    variableTypes,
    functions,
    typeMethodDicts,
    leafTypes,
    unvalidatedMethodReceivers,
    callbacks: { ...defaultCallbacks, ...options.callbacks },
    observability: options.observability ?? {},
    pipeValue: null,
    timeout: options.timeout,
    autoExceptions,
    signal: options.signal,
    maxCallStackDepth: options.maxCallStackDepth ?? 100,
    annotationStack: [],
    callStack: [],
    metadata: options.metadata,
    immediateAnnotation: undefined,
    resolvers,
    resolverConfigs,
    resolvingSchemes: new Set(),
    parseSource: options.parseSource,
  };
}

/**
 * Create a child context for block scoping.
 * Child inherits parent's functions, methods, callbacks, etc.
 * but has its own variables map. Variable lookups walk the parent chain.
 */
export function createChildContext(
  parent: RuntimeContext,
  overrides?: { sourceId?: string; sourceText?: string }
): RuntimeContext {
  return {
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
    maxCallStackDepth: parent.maxCallStackDepth,
    annotationStack: parent.annotationStack,
    callStack: parent.callStack,
    metadata: parent.metadata,
    immediateAnnotation: undefined,
    resolvers: parent.resolvers,
    resolverConfigs: parent.resolverConfigs,
    resolvingSchemes: parent.resolvingSchemes,
    parseSource: parent.parseSource,
    sourceId: overrides?.sourceId ?? parent.sourceId,
    sourceText: overrides?.sourceText ?? parent.sourceText,
  };
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
