/**
 * Runtime Context Factory
 *
 * Creates and configures the runtime context for script execution.
 * Public API for host applications.
 */
import { RILL_ERROR_CODES, RuntimeError } from '../types.js';
import { BUILTIN_FUNCTIONS, BUILTIN_METHODS } from './builtins.js';
import { bindDictCallables } from './types.js';
import { formatValue, inferType } from './values.js';
const defaultCallbacks = {
    onLog: (value) => {
        console.log(formatValue(value));
    },
};
/**
 * Create a runtime context for script execution.
 * This is the main entry point for configuring the Rill runtime.
 */
export function createRuntimeContext(options = {}) {
    const variables = new Map();
    const variableTypes = new Map();
    const functions = new Map();
    const methods = new Map();
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
        for (const [name, fn] of Object.entries(options.functions)) {
            functions.set(name, fn);
        }
    }
    // Set built-in methods
    for (const [name, impl] of Object.entries(BUILTIN_METHODS)) {
        methods.set(name, impl);
    }
    // Compile autoException patterns into RegExp objects
    const autoExceptions = [];
    if (options.autoExceptions) {
        for (const pattern of options.autoExceptions) {
            try {
                autoExceptions.push(new RegExp(pattern));
            }
            catch {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_INVALID_PATTERN, `Invalid autoException pattern: ${pattern}`, undefined, { pattern });
            }
        }
    }
    return {
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
    };
}
//# sourceMappingURL=context.js.map