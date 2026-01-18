/**
 * Rill Runtime
 * Executes parsed Rill AST with pluggable context and I/O
 */
import { AbortError, AutoExceptionError, RILL_ERROR_CODES, RuntimeError, TimeoutError, } from './types.js';
// Re-export error classes for backwards compatibility
export { AbortError, AutoExceptionError, RuntimeError, TimeoutError, } from './types.js';
/** Type guard for any callable */
export function isCallable(value) {
    return (typeof value === 'object' &&
        value !== null &&
        '__type' in value &&
        value.__type === 'callable');
}
/** Type guard for script callable */
export function isScriptCallable(value) {
    return isCallable(value) && value.kind === 'script';
}
/** Type guard for runtime callable */
export function isRuntimeCallable(value) {
    return isCallable(value) && value.kind === 'runtime';
}
/** Type guard for application callable */
export function isApplicationCallable(value) {
    return isCallable(value) && value.kind === 'application';
}
/**
 * Create an application callable from a host function.
 * @param fn The function to wrap
 * @param isProperty If true, auto-invokes when accessed from dict (property-style)
 */
export function callable(fn, isProperty = false) {
    return { __type: 'callable', kind: 'application', fn, isProperty };
}
/** Type guard for dict (plain object, not array, not callable, not args) */
export function isDict(value) {
    return (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        !isCallable(value) &&
        !isArgs(value));
}
/** Type guard for RillArgs */
export function isArgs(value) {
    return (typeof value === 'object' &&
        value !== null &&
        '__rill_args' in value &&
        value.__rill_args === true);
}
/** Create args from a tuple (positional) */
function createArgsFromTuple(tuple) {
    const entries = new Map();
    for (let i = 0; i < tuple.length; i++) {
        const val = tuple[i];
        if (val !== undefined) {
            entries.set(i, val);
        }
    }
    return { __rill_args: true, entries };
}
/** Create args from a dict (named) */
function createArgsFromDict(dict) {
    const entries = new Map();
    for (const [key, value] of Object.entries(dict)) {
        entries.set(key, value);
    }
    return { __rill_args: true, entries };
}
/** Reserved dict method names that cannot be overridden */
export const RESERVED_DICT_METHODS = ['keys', 'values', 'entries'];
/** Check if a key name is reserved */
export function isReservedMethod(name) {
    return RESERVED_DICT_METHODS.includes(name);
}
// ============================================================
// RUNTIME ERROR HELPERS
// ============================================================
/** Helper to get location from an AST node */
function getNodeLocation(node) {
    return node?.span.start;
}
// ============================================================
// CONTROL FLOW SIGNALS
// ============================================================
/** Signal thrown by `break` to exit loops */
export class BreakSignal extends Error {
    value;
    constructor(value) {
        super('break');
        this.value = value;
        this.name = 'BreakSignal';
    }
}
/** Signal thrown by `return` to exit blocks */
export class ReturnSignal extends Error {
    value;
    constructor(value) {
        super('return');
        this.value = value;
        this.name = 'ReturnSignal';
    }
}
// ============================================================
// CONTEXT FACTORY
// ============================================================
const defaultCallbacks = {
    onLog: (value) => {
        console.log(formatValue(value));
    },
};
/** Infer the Rill type from a runtime value */
function inferType(value) {
    if (value === null)
        return 'string'; // null treated as empty string
    if (typeof value === 'string')
        return 'string';
    if (typeof value === 'number')
        return 'number';
    if (typeof value === 'boolean')
        return 'bool';
    if (isScriptCallable(value))
        return 'closure';
    if (isArgs(value))
        return 'args';
    if (Array.isArray(value))
        return 'tuple';
    if (typeof value === 'object')
        return 'dict';
    return 'string'; // fallback
}
/**
 * Set a variable with type checking.
 * - First assignment locks the type (inferred or explicit)
 * - Subsequent assignments must match the locked type
 * - Explicit type annotation is validated against value type
 */
function setVariable(ctx, name, value, explicitType, location) {
    const valueType = inferType(value);
    // Check explicit type annotation matches value
    if (explicitType !== null && explicitType !== valueType) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Type mismatch: cannot assign ${valueType} to $${name}:${explicitType}`, location, { variableName: name, expectedType: explicitType, actualType: valueType });
    }
    // Check if variable already has a locked type
    const lockedType = ctx.variableTypes.get(name);
    if (lockedType !== undefined && lockedType !== valueType) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Type mismatch: cannot assign ${valueType} to $${name} (locked as ${lockedType})`, location, { variableName: name, expectedType: lockedType, actualType: valueType });
    }
    // Set the variable and lock its type
    ctx.variables.set(name, value);
    if (!ctx.variableTypes.has(name)) {
        ctx.variableTypes.set(name, explicitType ?? valueType);
    }
}
/**
 * Bind callables in a dict to their containing dict.
 * This sets boundDict on each callable so they can access their container.
 */
function bindDictCallables(value) {
    if (!isDict(value))
        return value;
    const dict = value;
    let hasBoundCallables = false;
    // Check if any values are callables that need binding
    for (const v of Object.values(dict)) {
        if (isCallable(v) && !v.boundDict) {
            hasBoundCallables = true;
            break;
        }
    }
    if (!hasBoundCallables)
        return value;
    // Create a new dict with bound callables
    const result = {};
    for (const [key, v] of Object.entries(dict)) {
        if (isCallable(v) && !v.boundDict) {
            result[key] = { ...v, boundDict: result };
        }
        else {
            result[key] = v;
        }
    }
    return result;
}
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
// ============================================================
// BUILT-IN FUNCTIONS
// ============================================================
const BUILTIN_FUNCTIONS = {
    /** Identity function - returns its argument */
    identity: (args) => args[0] ?? null,
    /** Return the type name of a value */
    type: (args) => inferType(args[0] ?? null),
    /** Log a value and return it unchanged (passthrough) */
    log: (args, ctx) => {
        const value = args[0] ?? null;
        ctx.callbacks.onLog(value);
        return value;
    },
    /** Convert any value to JSON string */
    json: (args) => JSON.stringify(args[0] ?? null),
};
// ============================================================
// BUILT-IN METHODS
// ============================================================
const BUILTIN_METHODS = {
    // === Conversion methods ===
    /** Convert value to string */
    str: (receiver) => formatValue(receiver),
    /** Convert value to number */
    num: (receiver) => {
        if (typeof receiver === 'number')
            return receiver;
        if (typeof receiver === 'string') {
            const n = parseFloat(receiver);
            if (!isNaN(n))
                return n;
        }
        if (typeof receiver === 'boolean')
            return receiver ? 1 : 0;
        return 0;
    },
    /** Get length of string or array */
    len: (receiver) => {
        if (typeof receiver === 'string')
            return receiver.length;
        if (Array.isArray(receiver))
            return receiver.length;
        if (receiver && typeof receiver === 'object') {
            return Object.keys(receiver).length;
        }
        return 0;
    },
    /** Trim whitespace from string */
    trim: (receiver) => formatValue(receiver).trim(),
    // === Element access methods ===
    /** Get first element of array or first char of string */
    first: (receiver) => {
        if (Array.isArray(receiver))
            return receiver[0] ?? null;
        if (typeof receiver === 'string')
            return receiver[0] ?? '';
        return null;
    },
    /** Get last element of array or last char of string */
    last: (receiver) => {
        if (Array.isArray(receiver))
            return receiver[receiver.length - 1] ?? null;
        if (typeof receiver === 'string') {
            return receiver[receiver.length - 1] ?? '';
        }
        return null;
    },
    /** Get element at index */
    at: (receiver, args) => {
        const idx = typeof args[0] === 'number' ? args[0] : 0;
        if (Array.isArray(receiver))
            return receiver[idx] ?? null;
        if (typeof receiver === 'string')
            return receiver[idx] ?? '';
        return null;
    },
    // === String operations ===
    /** Split string by separator (default: newline) */
    split: (receiver, args) => {
        const str = formatValue(receiver);
        const sep = typeof args[0] === 'string' ? args[0] : '\n';
        return str.split(sep);
    },
    /** Join array elements with separator (default: comma) */
    join: (receiver, args) => {
        const sep = typeof args[0] === 'string' ? args[0] : ',';
        if (!Array.isArray(receiver))
            return formatValue(receiver);
        return receiver.map(formatValue).join(sep);
    },
    /** Split string into lines (same as .split but newline only) */
    lines: (receiver) => {
        const str = formatValue(receiver);
        return str.split('\n');
    },
    // === Utility methods ===
    /** Check if value is empty */
    empty: (receiver) => isEmpty(receiver),
    // === Pattern matching methods ===
    /** Check if string contains substring */
    contains: (receiver, args) => {
        const str = formatValue(receiver);
        const search = formatValue(args[0] ?? '');
        return str.includes(search);
    },
    /** Match regex pattern and return capture groups as tuple. Empty tuple = no match. */
    matches: (receiver, args) => {
        const str = formatValue(receiver);
        const pattern = formatValue(args[0] ?? '');
        try {
            const match = new RegExp(pattern).exec(str);
            if (!match)
                return [];
            // Return capture groups (index 1+), or full match if no groups
            const groups = match.slice(1);
            return groups.length > 0 ? groups : [match[0]];
        }
        catch {
            return [];
        }
    },
    // === Comparison methods ===
    /** Equality check (deep structural comparison) */
    eq: (receiver, args) => deepEquals(receiver, args[0] ?? null),
    /** Inequality check (deep structural comparison) */
    ne: (receiver, args) => !deepEquals(receiver, args[0] ?? null),
    /** Less than */
    lt: (receiver, args) => {
        if (typeof receiver === 'number' && typeof args[0] === 'number') {
            return receiver < args[0];
        }
        return formatValue(receiver) < formatValue(args[0] ?? '');
    },
    /** Greater than */
    gt: (receiver, args) => {
        if (typeof receiver === 'number' && typeof args[0] === 'number') {
            return receiver > args[0];
        }
        return formatValue(receiver) > formatValue(args[0] ?? '');
    },
    /** Less than or equal */
    le: (receiver, args) => {
        if (typeof receiver === 'number' && typeof args[0] === 'number') {
            return receiver <= args[0];
        }
        return formatValue(receiver) <= formatValue(args[0] ?? '');
    },
    /** Greater than or equal */
    ge: (receiver, args) => {
        if (typeof receiver === 'number' && typeof args[0] === 'number') {
            return receiver >= args[0];
        }
        return formatValue(receiver) >= formatValue(args[0] ?? '');
    },
    // === Dict methods (reserved) ===
    /** Get all keys of a dict as a tuple of strings */
    keys: (receiver) => {
        if (isDict(receiver)) {
            return Object.keys(receiver);
        }
        return [];
    },
    /** Get all values of a dict as a tuple */
    values: (receiver) => {
        if (isDict(receiver)) {
            return Object.values(receiver);
        }
        return [];
    },
    /** Get all entries of a dict as a tuple of [key, value] pairs */
    entries: (receiver) => {
        if (isDict(receiver)) {
            return Object.entries(receiver).map(([k, v]) => [k, v]);
        }
        return [];
    },
};
// ============================================================
// AUTO-EXCEPTION CHECKING
// ============================================================
/**
 * Check if the current pipe value matches any autoException pattern.
 * Only checks string values. Throws AutoExceptionError on match.
 */
function checkAutoExceptions(value, ctx, node) {
    if (typeof value !== 'string' || ctx.autoExceptions.length === 0) {
        return;
    }
    for (const pattern of ctx.autoExceptions) {
        if (pattern.test(value)) {
            throw new AutoExceptionError(pattern.source, value, getNodeLocation(node));
        }
    }
}
// ============================================================
// TIMEOUT WRAPPER
// ============================================================
/**
 * Wrap a promise with a timeout. Returns original promise if no timeout configured.
 */
function withTimeout(promise, timeoutMs, functionName, node) {
    if (timeoutMs === undefined) {
        return promise;
    }
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(new TimeoutError(functionName, timeoutMs, getNodeLocation(node)));
            }, timeoutMs);
        }),
    ]);
}
// ============================================================
// ABORT CHECKING
// ============================================================
/**
 * Check if execution has been aborted via AbortSignal.
 * Throws AbortError if signal is aborted.
 */
function checkAborted(ctx, node) {
    if (ctx.signal?.aborted) {
        throw new AbortError(getNodeLocation(node));
    }
}
// ============================================================
// INTERPRETER
// ============================================================
export async function execute(script, context) {
    const stepper = createStepper(script, context);
    while (!stepper.done) {
        await stepper.step();
    }
    return stepper.getResult();
}
/**
 * Create a stepper for controlled step-by-step execution.
 * Allows the caller to control the execution loop and inspect state between steps.
 */
export function createStepper(script, context) {
    const statements = script.statements;
    const total = statements.length;
    let index = 0;
    let lastValue = null;
    let isDone = total === 0;
    const collectVariables = () => {
        const vars = {};
        for (const [name, value] of context.variables) {
            vars[name] = value;
        }
        return vars;
    };
    return {
        get done() {
            return isDone;
        },
        get index() {
            return index;
        },
        get total() {
            return total;
        },
        get context() {
            return context;
        },
        async step() {
            if (isDone) {
                return {
                    value: lastValue,
                    done: true,
                    index: index,
                    total,
                };
            }
            const stmt = statements[index];
            if (!stmt) {
                isDone = true;
                return { value: lastValue, done: true, index, total };
            }
            // Check for abort before each step
            checkAborted(context, stmt);
            const startTime = Date.now();
            // Fire onStepStart
            context.observability.onStepStart?.({
                index,
                total,
                pipeValue: context.pipeValue,
            });
            let captured;
            try {
                // Execute the statement
                const value = await evaluateExpression(stmt.expression, context);
                // Handle capture: -> $varname or -> $varname:type
                if (stmt.capture) {
                    setVariable(context, stmt.capture.name, value, stmt.capture.typeName, stmt.capture.span.start);
                    captured = { name: stmt.capture.name, value };
                    context.observability.onCapture?.(captured);
                }
                // Update pipe value
                context.pipeValue = value;
                lastValue = value;
                // Check auto-exceptions
                checkAutoExceptions(value, context, stmt);
                // Fire onStepEnd
                context.observability.onStepEnd?.({
                    index,
                    total,
                    value,
                    durationMs: Date.now() - startTime,
                });
                index++;
                isDone = index >= total;
                return {
                    value,
                    done: isDone,
                    index: index - 1,
                    total,
                    captured,
                };
            }
            catch (error) {
                // Fire onError
                context.observability.onError?.({
                    error: error instanceof Error ? error : new Error(String(error)),
                    index,
                });
                throw error;
            }
        },
        getResult() {
            return {
                value: lastValue,
                variables: collectVariables(),
            };
        },
    };
}
async function executeStatement(stmt, ctx) {
    const value = await evaluateExpression(stmt.expression, ctx);
    // Handle capture: -> $varname or -> $varname:type
    if (stmt.capture) {
        setVariable(ctx, stmt.capture.name, value, stmt.capture.typeName, stmt.capture.span.start);
        ctx.observability.onCapture?.({ name: stmt.capture.name, value });
    }
    // Update pipe value for next statement
    ctx.pipeValue = value;
    // Check for auto-exceptions (halts execution if pattern matches)
    checkAutoExceptions(value, ctx, stmt);
    // Handle control flow terminators
    if (stmt.terminator === 'break') {
        throw new BreakSignal(value);
    }
    if (stmt.terminator === 'return') {
        throw new ReturnSignal(value);
    }
    return value;
}
async function evaluateExpression(expr, ctx) {
    return evaluatePipeChain(expr, ctx);
}
async function evaluatePipeChain(chain, ctx) {
    // Evaluate head
    let value = await evaluatePostfixExpr(chain.head, ctx);
    ctx.pipeValue = value;
    // Process each pipe target
    for (const target of chain.pipes) {
        value = await evaluatePipeTarget(target, value, ctx);
        ctx.pipeValue = value;
    }
    return value;
}
async function evaluatePostfixExpr(expr, ctx) {
    let value = await evaluatePrimary(expr.primary, ctx);
    // Apply method chain
    for (const method of expr.methods) {
        value = await evaluateMethod(method, value, ctx);
    }
    return value;
}
async function evaluatePrimary(primary, ctx) {
    switch (primary.type) {
        case 'StringLiteral':
            return evaluateString(primary, ctx);
        case 'NumberLiteral':
            return primary.value;
        case 'BoolLiteral':
            return primary.value;
        case 'Tuple':
            return evaluateTuple(primary, ctx);
        case 'Dict':
            return evaluateDict(primary, ctx);
        case 'FunctionLiteral':
            return await createClosure(primary, ctx);
        case 'Variable':
            return evaluateVariableAsync(primary, ctx);
        case 'FunctionCall':
            return evaluateFunctionCall(primary, ctx);
        case 'VariableCall':
            return evaluateVariableCall(primary, ctx);
        case 'MethodCall':
            // Bare method call: .method operates on current pipe value
            return evaluateMethod(primary, ctx.pipeValue, ctx);
        case 'Conditional':
            return evaluateConditional(primary, ctx);
        case 'WhileLoop':
            return evaluateWhileLoop(primary, ctx);
        case 'ForLoop':
            return evaluateForLoop(primary, ctx);
        case 'Block':
            // Blocks execute immediately in normal context
            return evaluateBlockExpression(primary, ctx);
        case 'Arithmetic':
            return evaluateArithmetic(primary, ctx);
        case 'Spread':
            return evaluateSpread(primary, ctx);
        default:
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Unknown primary type: ${primary.type}`, getNodeLocation(primary));
    }
}
async function evaluatePipeTarget(target, input, ctx) {
    ctx.pipeValue = input;
    switch (target.type) {
        case 'Capture':
            // Inline capture: store value and pass through (like implicit .set())
            return evaluateCapture(target, input, ctx);
        case 'FunctionCall':
            return evaluateFunctionCall(target, ctx);
        case 'VariableCall':
            // Pipe-style: if no args, pass piped value as first arg
            return evaluateVariableCallWithPipe(target, input, ctx);
        case 'Invoke':
            return evaluateInvoke(target, input, ctx);
        case 'MethodCall':
            return evaluateMethod(target, input, ctx);
        case 'Conditional':
            return evaluateConditional(target, ctx);
        case 'WhileLoop':
            return evaluateWhileLoop(target, ctx);
        case 'ForLoop':
            return evaluateForLoop(target, ctx);
        case 'Block':
            return evaluateBlockExpression(target, ctx);
        case 'StringLiteral':
            return evaluateString(target, ctx);
        case 'Arithmetic':
            return evaluateArithmetic(target, ctx);
        case 'ParallelSpread':
            return evaluateParallelSpread(target, input, ctx);
        case 'ParallelFilter':
            return evaluateParallelFilter(target, input, ctx);
        case 'SequentialSpread':
            return evaluateSequentialSpread(target, input, ctx);
        case 'Destructure':
            return evaluateDestructure(target, input, ctx);
        case 'Slice':
            return evaluateSlice(target, input, ctx);
        case 'Enumerate':
            return evaluateEnumerate(target, input);
        case 'Spread':
            return evaluateSpread(target, ctx);
        default:
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Unknown pipe target type: ${target.type}`, getNodeLocation(target));
    }
}
// ============================================================
// SPREAD OPERATIONS
// ============================================================
/**
 * Evaluate parallel spread: $args -> ~$closures
 *
 * Broadcasting rules:
 * - Zip: [a,b,c] -> ~[f,g,h] → f(a), g(b), h(c) in parallel
 * - Map: [a,b,c] -> ~f → f(a), f(b), f(c) in parallel
 * - Broadcast: x -> ~[f,g,h] → f(x), g(x), h(x) in parallel
 */
async function evaluateParallelSpread(node, input, ctx) {
    // Evaluate the target expression to get closure(s)
    const target = await evaluateExpression(node.target, ctx);
    const inputArray = Array.isArray(input) ? input : null;
    const targetArray = Array.isArray(target) ? target : null;
    // Determine which broadcasting mode to use
    if (inputArray && targetArray) {
        // Zip mode: [a,b,c] -> ~[f,g,h]
        if (inputArray.length !== targetArray.length) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Parallel zip requires equal lengths: got ${inputArray.length} args and ${targetArray.length} closures`, node.span.start);
        }
        const promises = inputArray.map((arg, i) => {
            const closure = targetArray[i];
            if (closure === undefined) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Missing closure at index ${i}`, node.span.start);
            }
            return invokeAsClosureOrFunction(closure, [arg], ctx, node.span.start);
        });
        return Promise.all(promises);
    }
    else if (inputArray && !targetArray) {
        // Map mode: [a,b,c] -> ~f
        const promises = inputArray.map((arg) => invokeAsClosureOrFunction(target, [arg], ctx, node.span.start));
        return Promise.all(promises);
    }
    else if (!inputArray && targetArray) {
        // Broadcast mode: x -> ~[f,g,h]
        const promises = targetArray.map((closure) => invokeAsClosureOrFunction(closure, [input], ctx, node.span.start));
        return Promise.all(promises);
    }
    else {
        // Single closure, single arg: just invoke
        const result = await invokeAsClosureOrFunction(target, [input], ctx, node.span.start);
        return [result];
    }
}
/**
 * Evaluate parallel filter: $tuple -> ~?{ condition } or ~?$predicate
 * Keeps elements where predicate returns truthy.
 * Inside the block, $ binds to the current element.
 */
async function evaluateParallelFilter(node, input, ctx) {
    // Input must be iterable (tuple)
    if (!Array.isArray(input)) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Filter requires tuple, got ${isDict(input) ? 'dict' : typeof input}`, node.span.start);
    }
    const results = [];
    // Evaluate predicate for each element
    for (const element of input) {
        // Set $ to current element
        const savedPipeValue = ctx.pipeValue;
        ctx.pipeValue = element;
        let predicateResult;
        if (node.predicate.type === 'Block') {
            // Block form: ~?{ .gt(2) }
            predicateResult = await evaluateBlockExpression(node.predicate, ctx);
        }
        else {
            // Variable form: ~?$pred - invoke closure with element as arg
            const closure = ctx.variables.get(node.predicate.name ?? '');
            if (!closure) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE, `Undefined variable: $${node.predicate.name}`, node.predicate.span.start, { variableName: node.predicate.name });
            }
            if (!isCallable(closure)) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Filter predicate must be callable, got ${typeof closure}`, node.predicate.span.start);
            }
            predicateResult = await invokeCallable(closure, [element], ctx, node.predicate.span.start);
        }
        // Keep element if predicate is truthy
        if (isTruthy(predicateResult)) {
            results.push(element);
        }
        // Restore pipe value
        ctx.pipeValue = savedPipeValue;
    }
    return results;
}
/**
 * Evaluate sequential spread: $input -> @$closures
 * Chains closures where each receives the previous result (fold).
 */
async function evaluateSequentialSpread(node, input, ctx) {
    // Evaluate the target expression to get closure(s)
    const target = await evaluateExpression(node.target, ctx);
    const closures = Array.isArray(target) ? target : [target];
    let accumulated = input;
    for (const closure of closures) {
        accumulated = await invokeAsClosureOrFunction(closure, [accumulated], ctx, node.span.start);
    }
    return accumulated;
}
/**
 * Invoke a value as either a callable or look it up as a function name.
 * This enables uniform handling in spread operations.
 */
async function invokeAsCallableOrFunction(callableOrName, args, ctx, location) {
    // If it's any callable (script or runtime), invoke it
    if (isCallable(callableOrName)) {
        return invokeCallable(callableOrName, args, ctx, location);
    }
    // If it's a string, try to look it up as a function name
    if (typeof callableOrName === 'string') {
        const fn = ctx.functions.get(callableOrName);
        if (fn) {
            const result = fn(args, ctx, location);
            return result instanceof Promise ? result : result;
        }
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_FUNCTION, `Unknown function: ${callableOrName}`, location, { functionName: callableOrName });
    }
    throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Expected callable or function name, got ${typeof callableOrName}`, location);
}
// Legacy alias
const invokeAsClosureOrFunction = invokeAsCallableOrFunction;
/**
 * Evaluate inline capture: store value and return unchanged (pass-through).
 * Semantically: "-> $a ->" ≡ "-> $a.set($) ->"
 */
function evaluateCapture(node, input, ctx) {
    setVariable(ctx, node.name, input, node.typeName, node.span.start);
    ctx.observability.onCapture?.({ name: node.name, value: input });
    return input; // Identity pass-through
}
// ============================================================
// EXTRACTION OPERATORS
// ============================================================
/**
 * Evaluate destructure: :<$a, $b, $c> or :<key: $var>
 * Extracts elements from tuples/dicts into variables.
 * Returns the original input unchanged.
 */
function evaluateDestructure(node, input, ctx) {
    const isTuple = Array.isArray(input);
    const isDictInput = isDict(input);
    // Determine pattern type from first non-skip element
    const firstNonSkip = node.elements.find((e) => e.kind !== 'skip');
    const isKeyPattern = firstNonSkip?.kind === 'keyValue';
    if (isKeyPattern) {
        // Dict destructuring: :<key: $var, ...>
        if (!isDictInput) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Key destructure requires dict, got ${isTuple ? 'tuple' : typeof input}`, node.span.start);
        }
        for (const elem of node.elements) {
            if (elem.kind === 'skip')
                continue;
            if (elem.kind === 'nested') {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Nested destructure not supported in dict patterns', elem.span.start);
            }
            if (elem.kind !== 'keyValue' || elem.key === null || elem.name === null) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Dict destructure requires key: $var patterns', elem.span.start);
            }
            const dictInput = input;
            if (!(elem.key in dictInput)) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Key '${elem.key}' not found in dict`, elem.span.start, { key: elem.key, availableKeys: Object.keys(dictInput) });
            }
            const dictValue = dictInput[elem.key];
            if (dictValue === undefined) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Key '${elem.key}' has undefined value`, elem.span.start);
            }
            setVariable(ctx, elem.name, dictValue, elem.typeName, elem.span.start);
        }
    }
    else {
        // Tuple destructuring: :<$a, $b, $c>
        if (!isTuple) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Positional destructure requires tuple, got ${isDictInput ? 'dict' : typeof input}`, node.span.start);
        }
        const tupleInput = input;
        if (node.elements.length !== tupleInput.length) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Destructure pattern has ${node.elements.length} elements, tuple has ${tupleInput.length}`, node.span.start);
        }
        for (let i = 0; i < node.elements.length; i++) {
            const elem = node.elements[i];
            const value = tupleInput[i];
            if (elem === undefined || value === undefined) {
                continue; // Should not happen due to length check above
            }
            if (elem.kind === 'skip')
                continue;
            if (elem.kind === 'nested' && elem.nested) {
                // Recursively destructure nested value
                evaluateDestructure(elem.nested, value, ctx);
                continue;
            }
            if (elem.name === null) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Invalid destructure element', elem.span.start);
            }
            setVariable(ctx, elem.name, value, elem.typeName, elem.span.start);
        }
    }
    return input; // Return original input unchanged
}
/**
 * Evaluate slice: /<start:stop:step>
 * Extracts a portion of tuple or string using Python-style slicing.
 */
function evaluateSlice(node, input, ctx) {
    const isTuple = Array.isArray(input);
    const isString = typeof input === 'string';
    if (!isTuple && !isString) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Slice requires tuple or string, got ${isDict(input) ? 'dict' : typeof input}`, node.span.start);
    }
    // Evaluate bounds
    const startBound = node.start ? evaluateSliceBound(node.start, ctx) : null;
    const stopBound = node.stop ? evaluateSliceBound(node.stop, ctx) : null;
    const stepBound = node.step ? evaluateSliceBound(node.step, ctx) : null;
    // Apply Python slice semantics based on input type
    if (isTuple) {
        return applySlice(input, input.length, startBound, stopBound, stepBound);
    }
    // isString is true at this point
    return applySlice(input, input.length, startBound, stopBound, stepBound);
}
/**
 * Evaluate a slice bound to a number
 */
function evaluateSliceBound(bound, ctx) {
    if (bound === null) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Slice bound is null', undefined);
    }
    switch (bound.type) {
        case 'NumberLiteral':
            return bound.value;
        case 'Variable': {
            const value = evaluateVariable(bound, ctx);
            if (typeof value !== 'number') {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Slice bound must be number, got ${typeof value}`, bound.span.start);
            }
            return value;
        }
        case 'Arithmetic':
            return evaluateArithmetic(bound, ctx);
    }
}
/**
 * Apply Python-style slice semantics
 */
function applySlice(input, len, start, stop, step) {
    const actualStep = step ?? 1;
    if (actualStep === 0) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Slice step cannot be zero', undefined);
    }
    // Normalize indices (handle negatives, clamp to bounds)
    const normalizeIndex = (idx, defaultVal, forStep) => {
        if (idx === null)
            return defaultVal;
        let normalized = idx < 0 ? len + idx : idx;
        // Clamp to valid range based on step direction
        if (forStep > 0) {
            normalized = Math.max(0, Math.min(len, normalized));
        }
        else {
            normalized = Math.max(-1, Math.min(len - 1, normalized));
        }
        return normalized;
    };
    const actualStart = normalizeIndex(start, actualStep > 0 ? 0 : len - 1, actualStep);
    const actualStop = normalizeIndex(stop, actualStep > 0 ? len : -1, actualStep);
    // Collect indices
    const indices = [];
    if (actualStep > 0) {
        for (let i = actualStart; i < actualStop; i += actualStep) {
            indices.push(i);
        }
    }
    else {
        for (let i = actualStart; i > actualStop; i += actualStep) {
            indices.push(i);
        }
    }
    // Extract elements
    if (Array.isArray(input)) {
        return indices.map((i) => input[i]);
    }
    else {
        return indices.map((i) => input[i]).join('');
    }
}
/**
 * Evaluate spread: *expr or -> *
 * Converts tuple or dict to args type for unpacking at closure invocation.
 */
async function evaluateSpread(node, ctx) {
    // Get the value to spread
    let value;
    if (node.operand === null) {
        // Pipe target form: -> * (use current pipe value)
        value = ctx.pipeValue;
    }
    else {
        // Prefix form: *expr
        value = await evaluateExpression(node.operand, ctx);
    }
    // Convert to args based on type
    if (Array.isArray(value)) {
        return createArgsFromTuple(value);
    }
    if (isDict(value)) {
        return createArgsFromDict(value);
    }
    throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Spread requires tuple or dict, got ${inferType(value)}`, node.span.start);
}
/**
 * Evaluate enumerate: @<>
 * Transforms tuple/dict into tuple of dicts with index/value (and key for dicts).
 */
function evaluateEnumerate(node, input) {
    if (Array.isArray(input)) {
        // Tuple enumeration: [[index: 0, value: x], ...]
        return input.map((value, index) => ({
            index,
            value,
        }));
    }
    if (isDict(input)) {
        // Dict enumeration: [[index: 0, key: "k", value: v], ...]
        // Keys sorted alphabetically for deterministic output
        const keys = Object.keys(input).sort();
        return keys.map((key, index) => ({
            index,
            key,
            value: input[key],
        }));
    }
    throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Enumerate requires tuple or dict, got ${typeof input}`, node.span.start);
}
// ============================================================
// LITERAL EVALUATION
// ============================================================
async function evaluateString(node, ctx) {
    // Handle interpolation
    let result = '';
    for (const part of node.parts) {
        if (typeof part === 'string') {
            result += part;
        }
        else {
            // Interpolation node - for now just use the expression
            // TODO: Properly handle interpolation nodes when lexer supports them
            result += formatValue(ctx.pipeValue);
        }
    }
    // Handle {$fn(args)} patterns - variable calls (must come before {$name} pattern)
    // Supports: {$fn()}, {$fn("str")}, {$fn(123)}, {$fn($var)}, {$fn($)}
    const varCallPattern = /\{\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\(\s*([^)]*)\s*\)\s*\}/g;
    const varCallMatches = [...result.matchAll(varCallPattern)];
    for (const match of varCallMatches.reverse()) {
        // Process in reverse to preserve indices
        const fullMatch = match[0];
        const fnName = match[1] ?? '';
        const argsStr = match[2] ?? '';
        const closure = ctx.variables.get(fnName);
        if (closure && isCallable(closure)) {
            const args = parseInterpolationArgs(argsStr, ctx);
            const callResult = await invokeCallable(closure, args, ctx, node.span.start);
            result =
                result.slice(0, match.index) +
                    formatValue(callResult) +
                    result.slice(match.index + fullMatch.length);
        }
    }
    // Handle {$} and {$.field} patterns - pipe variable
    result = result.replace(/\{\s*\$(?![a-zA-Z_])([^}]*)\}/g, (_match, field) => {
        let value = ctx.pipeValue;
        const trimmed = field.trim();
        if (trimmed) {
            value = accessField(value, trimmed.slice(1)); // Remove leading .
        }
        return formatValue(value);
    });
    // Handle {$name} and {$name.field} patterns - named variables
    // If the variable is a closure, auto-invoke it (with $ as arg if it has params)
    const varPattern = /\{\s*\$([a-zA-Z_][a-zA-Z0-9_]*)([^}]*)\}/g;
    const varMatches = [...result.matchAll(varPattern)];
    for (const match of varMatches.reverse()) {
        const fullMatch = match[0];
        const name = match[1] ?? '';
        const field = match[2] ?? '';
        const idx = match.index;
        if (!ctx.variables.has(name)) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE, `Undefined variable: $${name}`, getNodeLocation(node), { variableName: name });
        }
        let value = ctx.variables.get(name) ?? null;
        // Auto-invoke closures
        if (isScriptCallable(value)) {
            const args = value.params.length > 0 ? [ctx.pipeValue] : [];
            value = await invokeScriptCallable(value, args, ctx, node.span.start);
        }
        const trimmed = field.trim();
        if (trimmed) {
            value = accessField(value, trimmed.slice(1)); // Remove leading .
        }
        result =
            result.slice(0, idx) +
                formatValue(value) +
                result.slice(idx + fullMatch.length);
    }
    // Handle {.method} patterns - call method on current pipe value
    // Note: String interpolation only supports sync methods (built-ins)
    result = result.replace(/\{\s*\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g, (_match, methodName) => {
        const method = BUILTIN_METHODS[methodName];
        if (method) {
            // Built-in methods are synchronous, so we can safely cast
            const methodResult = method(ctx.pipeValue, [], ctx);
            return formatValue(methodResult);
        }
        return `{.${methodName}}`; // Return unchanged if method not found
    });
    return result;
}
/** Parse simple arguments from string interpolation: "str", 123, $var, $ */
function parseInterpolationArgs(argsStr, ctx) {
    const trimmed = argsStr.trim();
    if (!trimmed)
        return [];
    const args = [];
    // Simple comma-split (doesn't handle strings with commas, but good enough for now)
    const parts = trimmed.split(',').map((p) => p.trim());
    for (const part of parts) {
        if (part.startsWith('"') && part.endsWith('"')) {
            // String literal
            args.push(part.slice(1, -1));
        }
        else if (/^-?\d+(\.\d+)?$/.test(part)) {
            // Number literal
            args.push(parseFloat(part));
        }
        else if (part === '$') {
            // Pipe variable
            args.push(ctx.pipeValue);
        }
        else if (part.startsWith('$')) {
            // Named variable
            const varName = part.slice(1);
            args.push(ctx.variables.get(varName) ?? null);
        }
        else if (part === 'true') {
            args.push(true);
        }
        else if (part === 'false') {
            args.push(false);
        }
        else {
            // Unknown - treat as string
            args.push(part);
        }
    }
    return args;
}
async function evaluateTuple(node, ctx) {
    const elements = [];
    for (const elem of node.elements) {
        elements.push(await evaluateExpression(elem, ctx));
    }
    return elements;
}
/**
 * Check if an expression is a function literal: () { } or (params) { }
 * Used for dict closure detection - only function literals become dict closures.
 */
function isFunctionLiteralExpr(expr) {
    if (expr.pipes.length > 0)
        return false;
    if (expr.head.methods.length > 0)
        return false;
    return expr.head.primary.type === 'FunctionLiteral';
}
async function evaluateDict(node, ctx) {
    const result = {};
    for (const entry of node.entries) {
        // Check for reserved method names
        if (isReservedMethod(entry.key)) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Cannot use reserved method name '${entry.key}' as dict key`, entry.span.start, { key: entry.key, reservedMethods: RESERVED_DICT_METHODS });
        }
        // Function literals in dicts become dict closures with late-bound $
        // Syntax: [key: () { $.name }] or [key: (x) { $x }]
        if (isFunctionLiteralExpr(entry.value)) {
            const fnLit = entry.value.head.primary;
            const closure = await createClosure(fnLit, ctx);
            result[entry.key] = closure;
        }
        else {
            // Everything else (including bare blocks { }) executes immediately
            result[entry.key] = await evaluateExpression(entry.value, ctx);
        }
    }
    // Bind callables to this dict ($ = this for dict methods)
    for (const key of Object.keys(result)) {
        const value = result[key];
        if (value !== undefined && isCallable(value)) {
            // Create a new callable with boundDict set
            result[key] = {
                ...value,
                boundDict: result,
            };
        }
    }
    return result;
}
/** Create a closure from a function literal, capturing current variables */
async function createClosure(node, ctx) {
    // Capture current variable bindings (shallow copy)
    const capturedVars = new Map(ctx.variables);
    // Convert FuncParamNode[] to CallableParam[], evaluating defaults
    const params = [];
    for (const param of node.params) {
        let defaultValue = null;
        if (param.defaultValue) {
            defaultValue = await evaluatePrimary(param.defaultValue, ctx);
        }
        params.push({
            name: param.name,
            typeName: param.typeName,
            defaultValue,
        });
    }
    // Property-style: no params means auto-invoke when accessed from dict
    const isProperty = params.length === 0;
    return {
        __type: 'callable',
        kind: 'script',
        params,
        body: node.body,
        capturedVars,
        isProperty,
    };
}
// ============================================================
// VARIABLE EVALUATION
// ============================================================
/**
 * Evaluate a variable reference.
 * Note: This is synchronous but may return a closure that should be auto-invoked.
 * The caller should use evaluateVariableAsync for full dict closure support.
 */
function evaluateVariable(node, ctx) {
    let value;
    if (node.isPipeVar) {
        value = ctx.pipeValue;
    }
    else if (node.name) {
        value = ctx.variables.get(node.name) ?? null;
    }
    else {
        value = null;
    }
    // Apply field access
    for (const access of node.fieldAccess) {
        value = accessField(value, access.field);
    }
    return value;
}
/**
 * Evaluate a variable reference with async support for dict callables.
 * Auto-invokes property-style callables that are bound to a dict.
 */
async function evaluateVariableAsync(node, ctx) {
    let value;
    if (node.isPipeVar) {
        value = ctx.pipeValue;
    }
    else if (node.name) {
        value = ctx.variables.get(node.name) ?? null;
    }
    else {
        value = null;
    }
    // Apply field access
    for (const access of node.fieldAccess) {
        value = accessField(value, access.field);
        // Auto-invoke property-style callables bound to a dict
        if (isCallable(value) && value.isProperty && value.boundDict) {
            value = await invokeCallable(value, [], ctx, node.span.start);
        }
    }
    return value;
}
function accessField(value, field) {
    if (value === null)
        return null;
    if (typeof field === 'number') {
        if (Array.isArray(value))
            return value[field] ?? null;
        if (typeof value === 'string')
            return value[field] ?? '';
        return null;
    }
    // Don't allow field access on closures (they're opaque function values)
    if (typeof value === 'object' && !Array.isArray(value) && !isScriptCallable(value)) {
        return value[field] ?? null;
    }
    return null;
}
// ============================================================
// FUNCTION & METHOD EVALUATION
// ============================================================
async function evaluateFunctionCall(node, ctx) {
    // Check for abort
    checkAborted(ctx, node);
    const fn = ctx.functions.get(node.name);
    if (!fn) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_FUNCTION, `Unknown function: ${node.name}`, getNodeLocation(node), { functionName: node.name });
    }
    // Save pipeValue before evaluating arguments
    const savedPipeValue = ctx.pipeValue;
    // Evaluate arguments
    const args = [];
    for (const arg of node.args) {
        args.push(await evaluateExpression(arg, ctx));
    }
    // Restore pipeValue after argument evaluation
    ctx.pipeValue = savedPipeValue;
    // If no args provided and we have a pipe value, use it as first arg
    if (args.length === 0 && ctx.pipeValue !== null) {
        args.push(ctx.pipeValue);
    }
    // Fire onFunctionCall
    ctx.observability.onFunctionCall?.({ name: node.name, args });
    const startTime = Date.now();
    // Execute function with optional timeout, passing location
    const location = getNodeLocation(node);
    const result = fn(args, ctx, location);
    let value;
    if (result instanceof Promise) {
        value = await withTimeout(result, ctx.timeout, node.name, node);
    }
    else {
        value = result;
    }
    // Fire onFunctionReturn
    ctx.observability.onFunctionReturn?.({
        name: node.name,
        value,
        durationMs: Date.now() - startTime,
    });
    return value;
}
/**
 * Evaluate a variable call: $fn(args) - invokes closure stored in variable.
 * Follows implied $ pattern: $fn() with no args receives ctx.pipeValue as first arg
 * (same as .method() receiving $ implicitly).
 */
async function evaluateVariableCall(node, ctx) {
    return evaluateVariableCallWithPipe(node, ctx.pipeValue, ctx);
}
/**
 * Evaluate variable call with optional pipe value.
 * If pipeInput is provided and no args, passes it as first arg.
 */
async function evaluateVariableCallWithPipe(node, pipeInput, ctx) {
    const closure = ctx.variables.get(node.name);
    if (!closure) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE, `Unknown variable: $${node.name}`, getNodeLocation(node), { variableName: node.name });
    }
    if (!isCallable(closure)) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Variable $${node.name} is not a function (got ${typeof closure})`, getNodeLocation(node), { variableName: node.name, actualType: typeof closure });
    }
    // Save pipeValue before evaluating arguments
    const savedPipeValue = ctx.pipeValue;
    // Evaluate arguments
    const args = [];
    for (const arg of node.args) {
        args.push(await evaluateExpression(arg, ctx));
    }
    // Restore pipeValue after argument evaluation
    ctx.pipeValue = savedPipeValue;
    // Pipe-style argument passing for script callables:
    // If no explicit args and we have a pipe input, pass it as first arg
    // BUT only if:
    // - The first param has no default (otherwise use the default)
    // - The pipeInput is not a callable (avoid passing callable to itself after capture)
    if (isScriptCallable(closure) &&
        args.length === 0 &&
        pipeInput !== null &&
        closure.params.length > 0) {
        const firstParam = closure.params[0];
        if (firstParam?.defaultValue === null && !isCallable(pipeInput)) {
            args.push(pipeInput);
        }
    }
    // Call the callable
    return invokeCallable(closure, args, ctx, node.span.start);
}
/**
 * Invoke any callable (script, runtime, or application) with given arguments.
 * This is the unified entry point for all callable invocation.
 */
async function invokeCallable(callable, args, ctx, callLocation) {
    // Check for abort
    checkAborted(ctx, undefined);
    if (callable.kind === 'script') {
        return invokeScriptCallable(callable, args, ctx, callLocation);
    }
    else {
        // Both 'runtime' and 'application' callables use the same invocation logic
        return invokeFnCallable(callable, args, ctx, callLocation);
    }
}
/** Invoke a function-based callable (runtime or application) */
async function invokeFnCallable(callable, args, ctx, callLocation) {
    // For dict-bound callables, prepend the bound dict if no args provided
    const effectiveArgs = callable.boundDict && args.length === 0 ? [callable.boundDict] : args;
    const result = callable.fn(effectiveArgs, ctx, callLocation);
    return result instanceof Promise ? await result : result;
}
/** Invoke a script callable (parsed from Rill code) */
async function invokeScriptCallable(callable, args, ctx, callLocation) {
    // Check if first argument is args (unpacking)
    const firstArg = args[0];
    if (args.length === 1 && firstArg !== undefined && isArgs(firstArg)) {
        return invokeScriptCallableWithArgs(callable, firstArg, ctx, callLocation);
    }
    // Create a new context with callable's captured vars + params bound to args
    const callableCtx = {
        ...ctx,
        variables: new Map(callable.capturedVars),
        variableTypes: new Map(ctx.variableTypes),
    };
    // For dict callables, set $ to the containing dict (late-bound this)
    if (callable.boundDict) {
        callableCtx.pipeValue = callable.boundDict;
    }
    // Bind parameters to arguments (with defaults and type checking)
    for (let i = 0; i < callable.params.length; i++) {
        const param = callable.params[i];
        let value;
        if (i < args.length) {
            // Argument provided
            value = args[i];
        }
        else if (param.defaultValue !== null) {
            // Use default value
            value = param.defaultValue;
        }
        else {
            // No arg, no default - strict mode: error
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Missing argument for parameter '${param.name}' at position ${i}`, callLocation, { paramName: param.name, position: i });
        }
        // Validate parameter type (explicit or inferred from default)
        const expectedType = param.typeName ?? inferTypeFromDefault(param.defaultValue);
        if (expectedType !== null) {
            const valueType = inferType(value);
            if (valueType !== expectedType) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Parameter type mismatch: ${param.name} expects ${expectedType}, got ${valueType}`, callLocation, {
                    paramName: param.name,
                    expectedType,
                    actualType: valueType,
                });
            }
        }
        callableCtx.variables.set(param.name, value);
    }
    // Execute the callable body
    return evaluateBlockExpression(callable.body, callableCtx);
}
/** Infer type from a default value (returns null if no default) */
function inferTypeFromDefault(defaultValue) {
    if (defaultValue === null)
        return null;
    if (typeof defaultValue === 'string')
        return 'string';
    if (typeof defaultValue === 'number')
        return 'number';
    if (typeof defaultValue === 'boolean')
        return 'bool';
    return null; // Complex types don't infer
}
/** Invoke a closure with args (unpacked arguments) */
async function invokeScriptCallableWithArgs(closure, argsValue, ctx, callLocation) {
    // Create a new context with closure's captured vars
    const closureCtx = {
        ...ctx,
        variables: new Map(closure.capturedVars),
        variableTypes: new Map(ctx.variableTypes),
    };
    // For dict closures, set $ to the containing dict
    if (closure.boundDict) {
        closureCtx.pipeValue = closure.boundDict;
    }
    // Determine if args are positional (numeric keys) or named (string keys)
    const hasNumericKeys = [...argsValue.entries.keys()].some((k) => typeof k === 'number');
    const hasStringKeys = [...argsValue.entries.keys()].some((k) => typeof k === 'string');
    if (hasNumericKeys && hasStringKeys) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Args cannot mix positional (numeric) and named (string) keys', callLocation);
    }
    // Track which params have been bound
    const boundParams = new Set();
    if (hasNumericKeys) {
        // Positional args - bind by position
        for (const [key, value] of argsValue.entries) {
            const position = key;
            const param = closure.params[position];
            if (param === undefined) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Extra argument at position ${position} (closure has ${closure.params.length} params)`, callLocation, { position, paramCount: closure.params.length });
            }
            // Validate type
            const expectedType = param.typeName ?? inferTypeFromDefault(param.defaultValue);
            if (expectedType !== null) {
                const valueType = inferType(value);
                if (valueType !== expectedType) {
                    throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Parameter type mismatch: ${param.name} expects ${expectedType}, got ${valueType}`, callLocation, { paramName: param.name, expectedType, actualType: valueType });
                }
            }
            closureCtx.variables.set(param.name, value);
            boundParams.add(param.name);
        }
    }
    else if (hasStringKeys) {
        // Named args - bind by name
        const paramNames = new Set(closure.params.map((p) => p.name));
        for (const [key, value] of argsValue.entries) {
            const name = key;
            if (!paramNames.has(name)) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Unknown argument '${name}' (valid params: ${[...paramNames].join(', ')})`, callLocation, { argName: name, validParams: [...paramNames] });
            }
            const param = closure.params.find((p) => p.name === name);
            // Validate type
            const expectedType = param.typeName ?? inferTypeFromDefault(param.defaultValue);
            if (expectedType !== null) {
                const valueType = inferType(value);
                if (valueType !== expectedType) {
                    throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Parameter type mismatch: ${name} expects ${expectedType}, got ${valueType}`, callLocation, { paramName: name, expectedType, actualType: valueType });
                }
            }
            closureCtx.variables.set(name, value);
            boundParams.add(name);
        }
    }
    // Apply defaults for unbound params, error if no default
    for (const param of closure.params) {
        if (!boundParams.has(param.name)) {
            if (param.defaultValue !== null) {
                closureCtx.variables.set(param.name, param.defaultValue);
            }
            else {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Missing argument '${param.name}' (no default value)`, callLocation, { paramName: param.name });
            }
        }
    }
    // Execute the closure body
    return evaluateBlockExpression(closure.body, closureCtx);
}
/** Evaluate invoke expression: -> () or -> (args) - invokes pipe value as closure */
async function evaluateInvoke(node, input, ctx) {
    if (!isScriptCallable(input)) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Cannot invoke non-closure value (got ${typeof input})`, getNodeLocation(node));
    }
    // Save pipeValue before evaluating arguments
    const savedPipeValue = ctx.pipeValue;
    // Evaluate arguments
    const args = [];
    for (const arg of node.args) {
        args.push(await evaluateExpression(arg, ctx));
    }
    // Restore pipeValue after argument evaluation
    ctx.pipeValue = savedPipeValue;
    // Call the closure
    return invokeScriptCallable(input, args, ctx, node.span.start);
}
async function evaluateMethod(node, receiver, ctx) {
    // Check for abort
    checkAborted(ctx, node);
    // Callables don't have methods - must invoke first
    if (isCallable(receiver)) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Method .${node.name} not available on callable (invoke with -> () first)`, getNodeLocation(node), { methodName: node.name, receiverType: 'callable' });
    }
    // Save pipeValue before evaluating arguments
    const savedPipeValue = ctx.pipeValue;
    // Evaluate arguments
    const args = [];
    for (const arg of node.args) {
        args.push(await evaluateExpression(arg, ctx));
    }
    // Restore pipeValue after argument evaluation
    ctx.pipeValue = savedPipeValue;
    // Check if receiver is a dict containing a callable with this name
    if (isDict(receiver)) {
        const dictValue = receiver[node.name];
        if (dictValue !== undefined && isCallable(dictValue)) {
            return invokeCallable(dictValue, args, ctx, getNodeLocation(node));
        }
    }
    // Fall back to registered methods
    const method = ctx.methods.get(node.name);
    if (!method) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_METHOD, `Unknown method: ${node.name}`, getNodeLocation(node), { methodName: node.name });
    }
    const result = method(receiver, args, ctx, getNodeLocation(node));
    return result instanceof Promise ? await result : result;
}
// ============================================================
// CONTROL FLOW EVALUATION
// ============================================================
async function evaluateConditional(node, ctx) {
    // Evaluate condition
    let conditionResult;
    if (node.condition) {
        conditionResult = await evaluateBoolExpr(node.condition, ctx);
    }
    else {
        // No condition means truthy check on pipe value
        conditionResult = isTruthy(ctx.pipeValue);
    }
    if (conditionResult) {
        return evaluateBlock(node.thenBlock, ctx);
    }
    else if (node.elseClause) {
        if (node.elseClause.type === 'Conditional') {
            return evaluateConditional(node.elseClause, ctx);
        }
        return evaluateBlock(node.elseClause, ctx);
    }
    return ctx.pipeValue;
}
async function evaluateWhileLoop(node, ctx) {
    // Save pipeValue before evaluating options
    const inputValue = ctx.pipeValue;
    // Get max iterations
    let maxIterations = Infinity;
    if (node.maxIterations) {
        const maxVal = await evaluateExpression(node.maxIterations, ctx);
        if (typeof maxVal === 'number') {
            maxIterations = maxVal;
        }
    }
    // Restore pipeValue for loop execution
    ctx.pipeValue = inputValue;
    let iterations = 0;
    let value = ctx.pipeValue;
    try {
        while (iterations < maxIterations) {
            // Check for abort at start of each iteration
            checkAborted(ctx, node);
            // Check condition
            const conditionResult = await evaluateBoolExpr(node.condition, ctx);
            if (!conditionResult)
                break;
            // Execute body
            value = await evaluateBlock(node.body, ctx);
            ctx.pipeValue = value;
            iterations++;
        }
    }
    catch (e) {
        if (e instanceof BreakSignal) {
            return e.value;
        }
        throw e;
    }
    return value;
}
async function evaluateForLoop(node, ctx) {
    const input = ctx.pipeValue;
    const results = [];
    try {
        if (Array.isArray(input)) {
            for (const item of input) {
                // Check for abort at start of each iteration
                checkAborted(ctx, node);
                ctx.pipeValue = item;
                results.push(await evaluateBlock(node.body, ctx));
            }
        }
        else if (typeof input === 'string') {
            for (const char of input) {
                // Check for abort at start of each iteration
                checkAborted(ctx, node);
                ctx.pipeValue = char;
                results.push(await evaluateBlock(node.body, ctx));
            }
        }
        else {
            // Single value - execute once
            checkAborted(ctx, node);
            results.push(await evaluateBlock(node.body, ctx));
        }
    }
    catch (e) {
        if (e instanceof BreakSignal) {
            return e.value;
        }
        throw e;
    }
    return results;
}
async function evaluateBlock(node, ctx) {
    let lastValue = ctx.pipeValue;
    for (const stmt of node.statements) {
        lastValue = await executeStatement(stmt, ctx);
    }
    return lastValue;
}
/** Evaluate a block as an expression, catching ReturnSignal */
async function evaluateBlockExpression(node, ctx) {
    try {
        return await evaluateBlock(node, ctx);
    }
    catch (e) {
        if (e instanceof ReturnSignal) {
            return e.value;
        }
        throw e;
    }
}
// ============================================================
// BOOLEAN EXPRESSION EVALUATION
// ============================================================
async function evaluateBoolExpr(expr, ctx) {
    if (expr.type === 'Comparison') {
        return evaluateComparison(expr, ctx);
    }
    // expr.type === 'BoolExpr'
    switch (expr.op) {
        case 'or': {
            for (const operand of expr.operands) {
                if (await evaluateBoolExpr(operand, ctx))
                    return true;
            }
            return false;
        }
        case 'and': {
            for (const operand of expr.operands) {
                if (!(await evaluateBoolExpr(operand, ctx)))
                    return false;
            }
            return true;
        }
        case 'not': {
            return !(await evaluateBoolExpr(expr.operand, ctx));
        }
    }
}
async function evaluateComparison(node, ctx) {
    const left = await evaluateSimplePrimary(node.left, ctx);
    // No operator means truthy check
    if (!node.op || !node.right) {
        return isTruthy(left);
    }
    const right = await evaluateSimplePrimary(node.right, ctx);
    switch (node.op) {
        case '==':
            return deepEquals(left, right);
        case '!=':
            return !deepEquals(left, right);
        case '<':
            return left < right;
        case '>':
            return left > right;
        case '<=':
            return left <= right;
        case '>=':
            return left >= right;
        default:
            return false;
    }
}
async function evaluateSimplePrimary(node, ctx) {
    switch (node.type) {
        case 'StringLiteral':
            return evaluateString(node, ctx);
        case 'NumberLiteral':
            return node.value;
        case 'BoolLiteral':
            return node.value;
        case 'Tuple':
            return evaluateTuple(node, ctx);
        case 'Dict':
            return evaluateDict(node, ctx);
        case 'Variable':
            return evaluateVariable(node, ctx);
        case 'FunctionCall':
            return evaluateFunctionCall(node, ctx);
        case 'MethodCall':
            return evaluateMethod(node, ctx.pipeValue, ctx);
        case 'Block':
            return evaluateBlockExpression(node, ctx);
        case 'Arithmetic':
            return evaluateArithmetic(node, ctx);
        default:
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Unknown simple primary type: ${node.type}`, getNodeLocation(node));
    }
}
// ============================================================
// ARITHMETIC
// ============================================================
/**
 * Evaluate arithmetic expression: | expr |
 * No implicit type conversion - operands must be numbers.
 */
function evaluateArithmetic(node, ctx) {
    // Single operand (no operator)
    if (node.op === null) {
        return evaluateArithOperand(node.left, ctx, node);
    }
    // Binary operation
    const left = evaluateArithOperand(node.left, ctx, node);
    const right = evaluateArithOperand(node.right, ctx, node);
    switch (node.op) {
        case '+':
            return left + right;
        case '-':
            return left - right;
        case '*':
            return left * right;
        case '/':
            if (right === 0) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Division by zero', node.span.start);
            }
            return left / right;
        case '%':
            if (right === 0) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Modulo by zero', node.span.start);
            }
            return left % right;
    }
}
function evaluateArithOperand(operand, ctx, parent) {
    switch (operand.type) {
        case 'NumberLiteral':
            return operand.value;
        case 'Variable': {
            const value = evaluateVariable(operand, ctx);
            if (typeof value !== 'number') {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Arithmetic requires number, got ${inferType(value)}`, operand.span.start);
            }
            return value;
        }
        case 'Arithmetic':
            return evaluateArithmetic(operand, ctx);
        default:
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Invalid arithmetic operand: ${operand.type}`, parent.span.start);
    }
}
// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function formatValue(value) {
    if (value === null)
        return '';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number')
        return String(value);
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (isArgs(value)) {
        // Format args as *[entries...]
        const parts = [];
        for (const [key, val] of value.entries) {
            if (typeof key === 'number') {
                parts.push(formatValue(val));
            }
            else {
                parts.push(`${key}: ${formatValue(val)}`);
            }
        }
        return `*[${parts.join(', ')}]`;
    }
    if (isScriptCallable(value)) {
        const paramStr = value.params.map((p) => p.name).join(', ');
        return `(${paramStr}) { ... }`;
    }
    if (Array.isArray(value))
        return JSON.stringify(value);
    return JSON.stringify(value);
}
/**
 * Deep structural equality for all Rill values.
 * - Primitives: value equality
 * - Tuples: length + recursive element equality
 * - Dicts: same keys + recursive value equality (order-independent)
 * - Closures: same params + same body source location (structural identity)
 */
function deepEquals(a, b) {
    // Handle primitives and null
    if (a === b)
        return true;
    if (a === null || b === null)
        return false;
    if (typeof a !== typeof b)
        return false;
    // Primitives (string, number, boolean) - covered by === above
    if (typeof a !== 'object')
        return false;
    // Both are objects at this point
    // Check for args
    const aIsArgs = isArgs(a);
    const bIsArgs = isArgs(b);
    if (aIsArgs !== bIsArgs)
        return false;
    if (aIsArgs && bIsArgs) {
        if (a.entries.size !== b.entries.size)
            return false;
        for (const [key, aVal] of a.entries) {
            const bVal = b.entries.get(key);
            if (bVal === undefined || !deepEquals(aVal, bVal))
                return false;
        }
        return true;
    }
    // Check for closures
    const aIsClosure = isScriptCallable(a);
    const bIsClosure = isScriptCallable(b);
    if (aIsClosure !== bIsClosure)
        return false;
    if (aIsClosure && bIsClosure) {
        // Closures are equal if they have the same structure
        // Compare params (name, type, default)
        if (a.params.length !== b.params.length)
            return false;
        for (let i = 0; i < a.params.length; i++) {
            const ap = a.params[i];
            const bp = b.params[i];
            if (ap === undefined || bp === undefined)
                return false;
            if (ap.name !== bp.name)
                return false;
            if (ap.typeName !== bp.typeName)
                return false;
            if (!deepEquals(ap.defaultValue, bp.defaultValue))
                return false;
        }
        // Compare body by source location (same code = same closure)
        if (a.body.span.start.line !== b.body.span.start.line ||
            a.body.span.start.column !== b.body.span.start.column) {
            return false;
        }
        // Compare captured variables
        if (a.capturedVars.size !== b.capturedVars.size)
            return false;
        for (const [key, aVal] of a.capturedVars) {
            const bVal = b.capturedVars.get(key);
            if (bVal === undefined || !deepEquals(aVal, bVal))
                return false;
        }
        return true;
    }
    // Check for arrays (tuples)
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray)
        return false;
    if (aIsArray && bIsArray) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            const aElem = a[i];
            const bElem = b[i];
            if (aElem === undefined || bElem === undefined) {
                if (aElem !== bElem)
                    return false;
            }
            else if (!deepEquals(aElem, bElem)) {
                return false;
            }
        }
        return true;
    }
    // Both are dicts (plain objects)
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length)
        return false;
    const aDict = a;
    const bDict = b;
    for (const key of aKeys) {
        if (!(key in bDict))
            return false;
        const aVal = aDict[key];
        const bVal = bDict[key];
        if (aVal === undefined || bVal === undefined) {
            if (aVal !== bVal)
                return false;
        }
        else if (!deepEquals(aVal, bVal)) {
            return false;
        }
    }
    return true;
}
function isTruthy(value) {
    if (value === null)
        return false;
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value !== 0;
    if (typeof value === 'string')
        return value.length > 0;
    if (isArgs(value))
        return value.entries.size > 0;
    if (isScriptCallable(value))
        return true;
    if (Array.isArray(value))
        return value.length > 0;
    if (typeof value === 'object')
        return Object.keys(value).length > 0;
    return true;
}
function isEmpty(value) {
    return !isTruthy(value);
}
//# sourceMappingURL=runtime.js.map