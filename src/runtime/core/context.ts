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
      const { params, fn, description } = definition;

      // Validate default values at registration time (EC-4)
      for (const param of params) {
        validateDefaultValueType(param, name);
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
    annotationStack: [],
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
    annotationStack: parent.annotationStack,
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
