/**
 * Runtime Context Factory
 *
 * Creates and configures the runtime context for script execution.
 * Public API for host applications.
 */

import { RuntimeError } from '../../types.js';
import { BUILTIN_FUNCTIONS, BUILTIN_METHODS } from '../ext/builtins.js';
import type {
  RillMethod,
  RuntimeCallbacks,
  RuntimeContext,
  RuntimeOptions,
} from './types.js';
import { bindDictCallables } from './types.js';
import { formatValue, inferType, type RillValue } from './values.js';
import {
  callable,
  validateDefaultValueType,
  validateReturnType,
  type CallableParam,
} from './callable.js';

const defaultCallbacks: RuntimeCallbacks = {
  onLog: (value) => {
    console.log(formatValue(value));
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
    import('../../types.js').RillTypeName
  >();
  const functions = new Map<
    string,
    | import('./callable.js').CallableFn
    | import('./callable.js').ApplicationCallable
  >();
  const methods = new Map<string, RillMethod>();

  // Set initial variables (and infer their types)
  if (options.variables) {
    for (const [name, value] of Object.entries(options.variables)) {
      // Bind callables in dicts to their containing dict
      const boundValue = bindDictCallables(value);
      variables.set(name, boundValue);
      variableTypes.set(name, inferType(boundValue));
    }
  }

  // Set built-in functions
  for (const [name, fn] of Object.entries(BUILTIN_FUNCTIONS)) {
    functions.set(name, fn);
  }

  // Set custom functions (can override built-ins)
  if (options.functions) {
    for (const [name, definition] of Object.entries(options.functions)) {
      // All functions must be HostFunctionDefinition with params
      const { params, fn, description, returnType } = definition;

      // Validate return type at registration time (IR-1)
      if (returnType !== undefined) {
        validateReturnType(returnType, name);
      }

      // Validate default values at registration time (EC-4)
      for (const param of params) {
        validateDefaultValueType(param, name);
      }

      // Validate descriptions when requireDescriptions enabled (IR-3)
      if (options.requireDescriptions === true) {
        // Check function description (EC-2)
        if (
          description === undefined ||
          typeof description !== 'string' ||
          description.trim().length === 0
        ) {
          throw new Error(
            `Function '${name}' requires description (requireDescriptions enabled)`
          );
        }

        // Check parameter descriptions (EC-3)
        for (const param of params) {
          if (
            param.description === undefined ||
            typeof param.description !== 'string' ||
            param.description.trim().length === 0
          ) {
            throw new Error(
              `Parameter '${param.name}' of function '${name}' requires description (requireDescriptions enabled)`
            );
          }
        }
      }

      // Convert HostFunctionParam[] to CallableParam[]
      const callableParams: CallableParam[] = params.map((p) => {
        const param: CallableParam = {
          name: p.name,
          typeName: p.type ?? null,
          defaultValue: p.defaultValue ?? null,
          annotations: {}, // Host functions have no parameter annotations
        };
        if (p.description !== undefined) {
          (param as { description?: string }).description = p.description;
        }
        return param;
      });

      // Create ApplicationCallable with params field populated
      const appCallable = callable(fn, false);
      const typedCallable: import('./callable.js').ApplicationCallable = {
        ...appCallable,
        params: callableParams,
      };
      if (description !== undefined) {
        (typedCallable as { description?: string }).description = description;
      }
      if (returnType !== undefined) {
        (
          typedCallable as {
            returnType?: import('./callable.js').RillFunctionReturnType;
          }
        ).returnType = returnType;
      }

      // Store ApplicationCallable for runtime validation
      functions.set(name, typedCallable);
    }
  }

  // Set built-in methods
  for (const [name, impl] of Object.entries(BUILTIN_METHODS)) {
    methods.set(name, impl);
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

  return {
    parent: undefined,
    variables,
    variableTypes,
    functions,
    methods,
    callbacks: { ...defaultCallbacks, ...options.callbacks },
    observability: options.observability ?? {},
    pipeValue: null,
    timeout: options.timeout,
    autoExceptions,
    signal: options.signal,
    maxCallStackDepth: options.maxCallStackDepth ?? 100,
    annotationStack: [],
    callStack: [],
  };
}

/**
 * Create a child context for block scoping.
 * Child inherits parent's functions, methods, callbacks, etc.
 * but has its own variables map. Variable lookups walk the parent chain.
 */
export function createChildContext(parent: RuntimeContext): RuntimeContext {
  return {
    parent,
    variables: new Map<string, RillValue>(),
    variableTypes: new Map<string, import('../../types.js').RillTypeName>(),
    functions: parent.functions,
    methods: parent.methods,
    callbacks: parent.callbacks,
    observability: parent.observability,
    pipeValue: parent.pipeValue,
    timeout: parent.timeout,
    autoExceptions: parent.autoExceptions,
    signal: parent.signal,
    maxCallStackDepth: parent.maxCallStackDepth,
    annotationStack: parent.annotationStack,
    callStack: parent.callStack,
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
