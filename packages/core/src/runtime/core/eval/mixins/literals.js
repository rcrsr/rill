/**
 * LiteralsMixin: String, Tuple, Dict, Closure, and Pass Evaluation
 *
 * Handles evaluation of literal values including:
 * - Pass keyword (returns current pipe value)
 * - String literals with interpolation
 * - Tuple literals
 * - Dict literals with callable binding
 * - Closure creation with late binding
 * - Block-closure creation for expression-position blocks
 *
 * Interface requirements (from spec):
 * - evaluatePass(node) -> Promise<RillValue> [IR-4]
 * - evaluateString(node) -> Promise<string>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 * - createBlockClosure(node) -> ScriptCallable
 *
 * Error Handling:
 * - Pass throws RUNTIME_UNDEFINED_VARIABLE if $ not bound [EC-5]
 * - String interpolation errors propagate from evaluateExpression() [EC-6]
 * - Dict/tuple evaluation errors propagate from nested expressions [EC-7]
 *
 * @internal
 */
import { RuntimeError } from '../../../../types.js';
import { formatValue, isReservedMethod } from '../../values.js';
import { isCallable, } from '../../callable.js';
import { getVariable } from '../../context.js';
/**
 * Capture annotation context at closure creation time.
 *
 * Evaluates annotation expressions in current context and returns structured object
 * with closure-level and parameter-level annotations.
 *
 * Closure-level annotations are captured from the annotation stack (statement-level
 * annotations like `^(doc: "test")` that precede the closure definition).
 *
 * @param ctx - Runtime context with annotation stack
 * @param closureNode - Closure AST node with parameter annotations
 * @param evaluateExpression - Expression evaluator function
 * @returns Object with annotations and paramAnnotations as evaluated values
 *
 * @internal
 */
async function captureClosureAnnotations(ctx, closureNode, evaluateExpression) {
    // Capture closure-level annotations from annotation stack
    // When a closure is created within an annotated statement like:
    // ^(doc: "test") |x|($x * 2) :> $fn
    // The annotation stack contains the evaluated annotations from the statement
    const annotations = ctx.annotationStack.at(-1) ?? {};
    // Capture parameter-level annotations
    const paramAnnotations = {};
    for (const param of closureNode.params) {
        if (param.annotations && param.annotations.length > 0) {
            const paramAnnots = await evaluateAnnotations(param.annotations, evaluateExpression);
            paramAnnotations[param.name] = paramAnnots;
        }
    }
    return { annotations, paramAnnotations };
}
/**
 * Evaluate annotation arguments to a dict of key-value pairs.
 * Handles both named arguments and spread arguments.
 *
 * @param annotations - Annotation arguments from AST
 * @param evaluateExpression - Expression evaluator function
 * @returns Record of annotation key-value pairs
 *
 * @internal
 */
async function evaluateAnnotations(annotations, evaluateExpression) {
    const result = {};
    for (const arg of annotations) {
        if (arg.type === 'NamedArg') {
            const namedArg = arg;
            result[namedArg.name] = await evaluateExpression(namedArg.value);
        }
        else {
            // SpreadArg: spread tuple/dict keys as annotations
            const spreadArg = arg;
            const spreadValue = await evaluateExpression(spreadArg.expression);
            if (typeof spreadValue === 'object' &&
                spreadValue !== null &&
                !Array.isArray(spreadValue) &&
                !isCallable(spreadValue)) {
                // Dict: spread all key-value pairs
                Object.assign(result, spreadValue);
            }
            else if (Array.isArray(spreadValue)) {
                // Tuple/list: not valid for annotations (need named keys)
                throw new RuntimeError('RILL-R002', 'Annotation spread requires dict with named keys, got list', spreadArg.span.start);
            }
            else {
                throw new RuntimeError('RILL-R002', `Annotation spread requires dict, got ${typeof spreadValue}`, spreadArg.span.start);
            }
        }
    }
    return result;
}
/**
 * LiteralsMixin implementation.
 *
 * Provides evaluation of literal values. Pass returns the current pipe value,
 * string literals support interpolation, closures are created with late binding,
 * and dict callables are automatically bound to their containing dict.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluateExpression() (from future CoreMixin composition)
 * - evaluatePrimary() (from future CoreMixin composition)
 *
 * Methods added:
 * - evaluatePass(node) -> Promise<RillValue>
 * - evaluateString(node) -> Promise<string>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 * - createBlockClosure(node) -> ScriptCallable
 */
function createLiteralsMixin(Base) {
    return class LiteralsEvaluator extends Base {
        /**
         * Evaluate pass node - returns current pipe value unchanged [IR-4].
         *
         * Pass returns ctx.pipeValue. If $ not bound (pipeValue is null),
         * throws RUNTIME_UNDEFINED_VARIABLE error [EC-5].
         *
         * @param node - PassNode from AST
         * @returns Current pipe value
         * @throws RuntimeError with RUNTIME_UNDEFINED_VARIABLE if $ not bound
         */
        async evaluatePass(node) {
            if (this.ctx.pipeValue === null) {
                throw new RuntimeError('RILL-R005', "Variable '$' not defined", node.span?.start, { variable: '$' });
            }
            return this.ctx.pipeValue;
        }
        /**
         * Evaluate string literal with interpolation.
         * Interpolation expressions are evaluated with the current pipe value preserved.
         *
         * String parts are concatenated with interpolated values formatted via formatValue().
         * Errors from interpolation expression evaluation propagate to caller.
         */
        async evaluateString(node) {
            let result = '';
            // Save pipeValue since interpolation expressions can modify it
            const savedPipeValue = this.ctx.pipeValue;
            for (const part of node.parts) {
                if (typeof part === 'string') {
                    result += part;
                }
                else {
                    // InterpolationNode: evaluate the expression
                    // Restore pipeValue before each interpolation so they all see the same value
                    this.ctx.pipeValue = savedPipeValue;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const value = await this.evaluateExpression(part.expression);
                    result += formatValue(value);
                }
            }
            // Restore pipeValue after string evaluation
            this.ctx.pipeValue = savedPipeValue;
            return result;
        }
        /**
         * Evaluate tuple literal.
         * Elements are evaluated in order and collected into an array.
         * ListSpreadNode elements are flattened inline.
         *
         * Errors from element evaluation propagate to caller.
         */
        async evaluateTuple(node) {
            const elements = [];
            for (const elem of node.elements) {
                if (elem.type === 'ListSpread') {
                    // ListSpreadNode: evaluate expression and flatten
                    const spreadResult = await this.evaluateTupleElement(elem);
                    // Spread result should be an array - flatten it
                    if (Array.isArray(spreadResult)) {
                        elements.push(...spreadResult);
                    }
                    else {
                        // Single value returned - should not happen for ListSpread
                        elements.push(spreadResult);
                    }
                }
                else {
                    // Regular element: evaluate and add
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    elements.push(await this.evaluateExpression(elem));
                }
            }
            return elements;
        }
        /**
         * Evaluate single tuple element.
         * Returns spread-able array when element is ListSpreadNode, single value otherwise.
         *
         * @param elem - Element to evaluate (ExpressionNode or ListSpreadNode)
         * @returns Flattened array for spread, single value otherwise
         * @throws RuntimeError with RUNTIME_TYPE_ERROR if spread on non-list [EC-3]
         */
        async evaluateTupleElement(elem) {
            if (elem.type === 'ListSpread') {
                // Evaluate spread expression
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const spreadValue = await this.evaluateExpression(elem.expression);
                // Verify it's a list
                if (!Array.isArray(spreadValue)) {
                    throw new RuntimeError('RILL-R002', `Spread in list literal requires list, got ${typeof spreadValue}`, elem.span?.start, { got: typeof spreadValue });
                }
                return spreadValue;
            }
            else {
                // Regular expression: evaluate and return single value
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return await this.evaluateExpression(elem);
            }
        }
        /**
         * Evaluate multi-key dict entry.
         * Expands `[["k1", "k2"]: value]` to array of key-value pairs.
         * Evaluates value once, creates entry for each key.
         *
         * @param keyTuple - TupleNode containing list of keys
         * @param value - Value expression to associate with all keys
         * @returns Array of [key, value] pairs
         * @throws RuntimeError with RUNTIME_TYPE_ERROR if tuple empty [EC-4]
         * @throws RuntimeError with RUNTIME_TYPE_ERROR if key element non-primitive [EC-5]
         */
        async evaluateDictMultiKey(keyTuple, value) {
            // Evaluate key tuple to get list of keys
            const keys = await this.evaluateTuple(keyTuple);
            // Validate non-empty [EC-4]
            if (keys.length === 0) {
                throw new RuntimeError('RILL-R002', 'Multi-key dict entry requires non-empty list', keyTuple.span?.start);
            }
            // Validate all keys are primitives [EC-5]
            for (const key of keys) {
                const keyType = typeof key;
                if (keyType !== 'string' &&
                    keyType !== 'number' &&
                    keyType !== 'boolean') {
                    throw new RuntimeError('RILL-R002', `Dict key must be string, number, or boolean, got ${keyType}`, keyTuple.span?.start, { got: keyType });
                }
            }
            // Evaluate value once
            let evaluatedValue;
            if (this.isBlockExpr(value)) {
                // Safe cast: isBlockExpr ensures head is PostfixExpr with Block primary
                const head = value.head;
                const blockNode = head.primary;
                evaluatedValue = this.createBlockClosure(blockNode);
            }
            else if (this.isClosureExpr(value)) {
                // Safe cast: isClosureExpr ensures head is PostfixExpr with Closure primary
                const head = value.head;
                const fnLit = head.primary;
                evaluatedValue = await this.createClosure(fnLit);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                evaluatedValue = await this.evaluateExpression(value);
            }
            // Create entry for each key
            const entries = [];
            for (const key of keys) {
                const stringKey = String(key);
                entries.push([stringKey, evaluatedValue]);
            }
            return entries;
        }
        /**
         * Evaluate dict literal.
         * All callables in the dict are bound to the containing dict via boundDict property.
         *
         * Reserved method names (keys, values, entries) cannot be used as dict keys.
         * Multi-key entries (tuple keys) expand to multiple entries with shared value.
         * Errors from value evaluation propagate to caller.
         */
        async evaluateDict(node) {
            const result = {};
            for (const entry of node.entries) {
                // Multi-key entries: expand to multiple key-value pairs
                if (typeof entry.key === 'object') {
                    // Check for new key types (variable/computed keys)
                    if ('kind' in entry.key) {
                        const keyObj = entry.key;
                        // Handle DictKeyVariable: resolve variable and validate string type
                        if (keyObj.kind === 'variable') {
                            const varValue = getVariable(this.ctx, keyObj.variableName);
                            // EC-6: Variable undefined
                            if (varValue === undefined) {
                                throw new RuntimeError('RILL-R005', `Variable '${keyObj.variableName}' is undefined`, entry.span.start);
                            }
                            // EC-7: Variable non-string
                            if (typeof varValue !== 'string') {
                                throw new RuntimeError('RILL-R002', `Dict key must be string, got ${typeof varValue}`, entry.span.start);
                            }
                            // Use resolved string as dict key
                            const stringKey = varValue;
                            if (isReservedMethod(stringKey)) {
                                throw new RuntimeError('RILL-R002', `Cannot use reserved method name '${stringKey}' as dict key`, entry.span.start, {
                                    key: stringKey,
                                    reservedMethods: ['keys', 'values', 'entries'],
                                });
                            }
                            // Evaluate value and store with resolved key
                            if (this.isBlockExpr(entry.value)) {
                                const head = entry.value.head;
                                const blockNode = head.primary;
                                const closure = this.createBlockClosure(blockNode);
                                result[stringKey] = closure;
                            }
                            else if (this.isClosureExpr(entry.value)) {
                                const head = entry.value.head;
                                const fnLit = head.primary;
                                const closure = await this.createClosure(fnLit);
                                result[stringKey] = closure;
                            }
                            else {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                result[stringKey] = await this.evaluateExpression(entry.value);
                            }
                            continue;
                        }
                        // Handle DictKeyComputed: evaluate expression and validate string type
                        if (keyObj.kind === 'computed') {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const computedValue = await this.evaluatePipeChain(keyObj.expression);
                            // EC-8: Computed key must evaluate to string
                            if (typeof computedValue !== 'string') {
                                throw new RuntimeError('RILL-R002', `Dict key evaluated to ${typeof computedValue}, expected string`, entry.span.start);
                            }
                            // Use resolved string as dict key
                            const stringKey = computedValue;
                            if (isReservedMethod(stringKey)) {
                                throw new RuntimeError('RILL-R002', `Cannot use reserved method name '${stringKey}' as dict key`, entry.span.start, {
                                    key: stringKey,
                                    reservedMethods: ['keys', 'values', 'entries'],
                                });
                            }
                            // Evaluate value and store with resolved key
                            if (this.isBlockExpr(entry.value)) {
                                const head = entry.value.head;
                                const blockNode = head.primary;
                                const closure = this.createBlockClosure(blockNode);
                                result[stringKey] = closure;
                            }
                            else if (this.isClosureExpr(entry.value)) {
                                const head = entry.value.head;
                                const fnLit = head.primary;
                                const closure = await this.createClosure(fnLit);
                                result[stringKey] = closure;
                            }
                            else {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                result[stringKey] = await this.evaluateExpression(entry.value);
                            }
                            continue;
                        }
                    }
                    // At this point, entry.key must be TupleNode (multi-key entry)
                    const pairs = await this.evaluateDictMultiKey(entry.key, entry.value);
                    for (const [stringKey, value] of pairs) {
                        if (isReservedMethod(stringKey)) {
                            throw new RuntimeError('RILL-R002', `Cannot use reserved method name '${stringKey}' as dict key`, entry.span.start, {
                                key: stringKey,
                                reservedMethods: ['keys', 'values', 'entries'],
                            });
                        }
                        // Apply last-write-wins semantics
                        result[stringKey] = value;
                    }
                    continue;
                }
                // Convert number and boolean keys to strings per IR-3
                // String keys: use directly as object property
                // Number keys: convert to string via String(key)
                // Boolean keys: convert to string via String(key)
                const stringKey = String(entry.key);
                if (isReservedMethod(stringKey)) {
                    throw new RuntimeError('RILL-R002', `Cannot use reserved method name '${stringKey}' as dict key`, entry.span.start, { key: stringKey, reservedMethods: ['keys', 'values', 'entries'] });
                }
                if (this.isBlockExpr(entry.value)) {
                    // Safe cast: isBlockExpr ensures head is PostfixExpr with Block primary
                    const head = entry.value.head;
                    const blockNode = head.primary;
                    const closure = this.createBlockClosure(blockNode);
                    result[stringKey] = closure;
                }
                else if (this.isClosureExpr(entry.value)) {
                    // Safe cast: isClosureExpr ensures head is PostfixExpr with Closure primary
                    const head = entry.value.head;
                    const fnLit = head.primary;
                    const closure = await this.createClosure(fnLit);
                    result[stringKey] = closure;
                }
                else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    result[stringKey] = await this.evaluateExpression(entry.value);
                }
            }
            // Bind all callables to the containing dict
            for (const key of Object.keys(result)) {
                const value = result[key];
                if (value !== undefined && isCallable(value)) {
                    result[key] = {
                        ...value,
                        boundDict: result,
                    };
                }
            }
            return result;
        }
        /**
         * Evaluate dict as dispatch table when piped [IR-2].
         *
         * Searches dict entries for key matching piped value using type-aware deep equality.
         * Returns matched value. Auto-invokes if matched value is closure.
         *
         * Type-aware matching ensures:
         * - Number key 1 matches only number input 1, not string "1"
         * - Boolean key true matches only boolean input true, not string "true"
         *
         * Multi-key support: [["k1", "k2"]: value] syntax allows multiple keys
         * to map to the same value. Key tuple is evaluated to get list of candidates.
         *
         * @param node - DictNode representing dispatch table
         * @param input - Piped value to use as lookup key
         * @returns Matched value (auto-invoked if closure)
         * @throws RuntimeError with RUNTIME_PROPERTY_NOT_FOUND if no match and no default [EC-4]
         */
        async evaluateDictDispatch(node, input) {
            // Import deepEquals for type-aware key matching
            const { deepEquals } = await import('../../values.js');
            // Search entries for matching key (process in order, return first match)
            for (const entry of node.entries) {
                let matchFound = false;
                if (typeof entry.key === 'object') {
                    // Check for new key types (variable/computed keys)
                    if ('kind' in entry.key) {
                        throw new RuntimeError('RILL-R004', `Variable and computed dict keys not yet supported`, entry.span.start);
                    }
                    // Tuple key - evaluate to get list of candidates
                    // Parser ensures entry.key is TupleNode, evaluateTuple always returns array
                    const keyValue = await this.evaluateTuple(entry.key);
                    // Check if input matches any element in the list (type-aware)
                    for (const candidate of keyValue) {
                        if (deepEquals(input, candidate)) {
                            matchFound = true;
                            break;
                        }
                    }
                }
                else {
                    // Primitive key (string, number, or boolean) - type-aware comparison
                    // deepEquals ensures number 1 != string "1", boolean true != string "true"
                    matchFound = deepEquals(input, entry.key);
                }
                if (matchFound) {
                    // Found match - evaluate and return the value
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const matchedValue = await this.evaluateExpression(entry.value);
                    return this.resolveDispatchValue(matchedValue, input, node);
                }
            }
            // No match found - check for default value
            if (node.defaultValue) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return await this.evaluateExpression(node.defaultValue);
            }
            // No match and no default - throw RUNTIME_PROPERTY_NOT_FOUND [EC-4]
            const location = node.span?.start;
            throw new RuntimeError('RILL-R009', `Dict dispatch: key '${formatValue(input)}' not found`, location, { key: input });
        }
        /**
         * Evaluate list literal as dispatch table when piped.
         *
         * Takes numeric index and returns element at that position.
         * Supports negative indices and default values.
         *
         * @param node - TupleNode representing list literal
         * @param input - Piped value to use as index (must be number)
         * @returns Element at index
         * @throws RuntimeError if input not number or index out of bounds
         */
        async evaluateListDispatch(node, input) {
            // Validate input is number
            if (typeof input !== 'number') {
                throw new RuntimeError('RILL-R002', `List dispatch requires number index, got ${typeof input}`, node.span?.start, { input, expectedType: 'number' });
            }
            // Evaluate all elements to get the list
            const elements = await this.evaluateTuple(node);
            // Truncate decimal to integer
            const index = Math.trunc(input);
            // Normalize negative indices
            const normalizedIndex = index < 0 ? elements.length + index : index;
            // Check bounds
            if (normalizedIndex < 0 || normalizedIndex >= elements.length) {
                // Check for default value
                if (node.defaultValue) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return await this.evaluateExpression(node.defaultValue);
                }
                // No match and no default - throw error
                throw new RuntimeError('RILL-R009', `List dispatch: index '${index}' not found`, node.span?.start, { index, listLength: elements.length });
            }
            // Return element at normalized index
            return elements[normalizedIndex];
        }
        /**
         * Resolve dispatch value: auto-invoke if closure, otherwise return as-is.
         * Zero-param closures (block-closures) are invoked with args = [] and pipeValue = input.
         * Parameterized closures (1+ params) throw error.
         */
        async resolveDispatchValue(value, input, node) {
            if (isCallable(value)) {
                // Check for parameterized closure (explicit user-defined params)
                // Note: Block-closures have exactly 1 param named '$'
                // Parameterized closures have 1+ params with user-defined names
                if (value.kind === 'script' && value.params.length >= 1) {
                    // Check if first param is '$' (block-closure) or user-defined (parameterized)
                    if (value.params[0].name !== '$') {
                        // Parameterized closure at terminal position: error
                        throw new RuntimeError('RILL-R002', 'Dispatch does not provide arguments for parameterized closure', node.span?.start);
                    }
                }
                // Check if callable has params to determine invocation style
                const hasParams = (value.kind === 'script' && value.params.length > 0) ||
                    (value.kind === 'application' &&
                        value.params !== undefined &&
                        value.params.length > 0);
                if (hasParams) {
                    // Application callable with params: invoke with input as argument
                    // Note: Script callables with params already threw error above
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return await this.invokeCallable(value, [input], node.span?.start);
                }
                else {
                    // Zero-param closure: invoke with args = [] and pipeValue = input
                    const savedPipeValue = this.ctx.pipeValue;
                    this.ctx.pipeValue = input;
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const result = await this.invokeCallable(value, [], node.span?.start);
                        return result;
                    }
                    finally {
                        this.ctx.pipeValue = savedPipeValue;
                    }
                }
            }
            return value;
        }
        /**
         * Runtime dict dispatch for variables: search dict for matching key.
         * Supports multi-key entries, auto-invokes closures, handles default values.
         *
         * @param dict - Runtime dict value
         * @param input - Key to search for
         * @param defaultValue - Optional default value expression node
         * @param location - Source location for error reporting
         * @returns Matched value or default
         */
        async dispatchToDict(dict, input, defaultValue, location, skipClosureResolution = false) {
            const { deepEquals } = await import('../../values.js');
            // Search dict entries for matching key
            for (const [key, value] of Object.entries(dict)) {
                // Simple key match using deep equality
                if (deepEquals(input, key)) {
                    // Skip closure resolution for hierarchical dispatch (caller handles it)
                    if (skipClosureResolution) {
                        return value;
                    }
                    // Auto-invoke closures if needed
                    return this.resolveDispatchValueRuntime(value, input, location);
                }
            }
            // No match found - check for default value
            if (defaultValue) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return await this.evaluateExpression(defaultValue);
            }
            // No match and no default - throw error
            const loc = location.span?.start;
            throw new RuntimeError('RILL-R009', `Dict dispatch: key '${formatValue(input)}' not found`, loc, { key: input });
        }
        /**
         * Runtime list dispatch for variables: return element at numeric index.
         * Supports negative indices, auto-invokes closures, handles default values.
         *
         * @param list - Runtime list value
         * @param input - Index value (must be number)
         * @param defaultValue - Optional default value expression node
         * @param location - Source location for error reporting
         * @returns Element at index or default
         */
        async dispatchToList(list, input, defaultValue, location, skipClosureResolution = false) {
            // Validate input is number
            if (typeof input !== 'number') {
                throw new RuntimeError('RILL-R002', `List dispatch requires number index, got ${typeof input}`, location.span?.start, { input, expectedType: 'number' });
            }
            // Truncate decimal to integer
            const index = Math.trunc(input);
            // Normalize negative indices
            const normalizedIndex = index < 0 ? list.length + index : index;
            // Check bounds
            if (normalizedIndex < 0 || normalizedIndex >= list.length) {
                // Check for default value
                if (defaultValue) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return await this.evaluateExpression(defaultValue);
                }
                // No default - throw error
                throw new RuntimeError('RILL-R009', `List dispatch: index '${index}' not found`, location.span?.start, { index, listLength: list.length });
            }
            // Return element at normalized index
            const element = list[normalizedIndex];
            // Skip closure resolution for hierarchical dispatch (caller handles it)
            if (skipClosureResolution) {
                return element;
            }
            // Auto-invoke closures if needed
            return this.resolveDispatchValueRuntime(element, input, location);
        }
        /**
         * Resolve dispatch value for runtime values: auto-invoke if closure.
         * Similar to resolveDispatchValue but works with runtime values.
         */
        async resolveDispatchValueRuntime(value, input, location) {
            if (isCallable(value)) {
                // Check if callable has params to determine invocation style
                const hasParams = (value.kind === 'script' && value.params.length > 0) ||
                    (value.kind === 'application' &&
                        value.params !== undefined &&
                        value.params.length > 0);
                if (hasParams) {
                    // Block-closure: invoke with input as argument
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return await this.invokeCallable(value, [input], location.span?.start);
                }
                else {
                    // Zero-param closure: invoke with args = [] and pipeValue = input
                    const savedPipeValue = this.ctx.pipeValue;
                    this.ctx.pipeValue = input;
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const result = await this.invokeCallable(value, [], location.span?.start);
                        return result;
                    }
                    finally {
                        this.ctx.pipeValue = savedPipeValue;
                    }
                }
            }
            return value;
        }
        /**
         * Create a script callable from a closure node.
         * Closures use late binding - variables are resolved in definingScope when invoked.
         *
         * Default parameter values are evaluated immediately in the current context.
         * Property-style callables (zero params) are auto-invoked on dict access.
         */
        async createClosure(node) {
            // Store reference to the defining scope for late-bound variable resolution
            const definingScope = this.ctx;
            // Capture annotations at closure creation time
            const { annotations, paramAnnotations } = await captureClosureAnnotations(this.ctx, node, 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.evaluateExpression.bind(this));
            const params = [];
            for (const param of node.params) {
                let defaultValue = null;
                if (param.defaultValue) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    defaultValue = await this.evaluatePrimary(param.defaultValue);
                }
                params.push({
                    name: param.name,
                    typeName: param.typeName,
                    defaultValue,
                    annotations: paramAnnotations[param.name] ?? {},
                });
            }
            const isProperty = params.length === 0;
            return {
                __type: 'callable',
                kind: 'script',
                params,
                body: node.body,
                definingScope,
                isProperty,
                annotations,
                paramAnnotations,
            };
        }
        /**
         * Create a script callable from a block node in expression position.
         * Block-closures have a single implicit $ parameter representing the piped value.
         *
         * No default parameter evaluation since the implicit $ has no default.
         * isProperty is always false (block-closures require $).
         */
        createBlockClosure(node) {
            // Store reference to the defining scope for late-bound variable resolution
            const definingScope = this.ctx;
            // Block-closures have exactly one parameter: $
            const params = [
                {
                    name: '$',
                    typeName: null,
                    defaultValue: null,
                    annotations: {}, // Block closures have no parameter annotations
                },
            ];
            return {
                __type: 'callable',
                kind: 'script',
                params,
                body: node,
                definingScope,
                isProperty: false,
                annotations: {}, // Block closures: no annotation support (expression-position blocks)
                paramAnnotations: {}, // Block closures have no parameter annotations
            };
        }
        /**
         * Helper: Check if expression is a bare closure (no pipes, no methods).
         * Used to detect dict entries that should be treated as closures.
         */
        isClosureExpr(expr) {
            if (expr.type !== 'PipeChain')
                return false;
            const chain = expr;
            if (chain.pipes.length > 0)
                return false;
            if (chain.head.type !== 'PostfixExpr')
                return false;
            const head = chain.head;
            if (head.methods.length > 0)
                return false;
            return head.primary.type === 'Closure';
        }
        /**
         * Helper: Check if expression is a bare block (no pipes, no methods).
         * Used to detect dict entries that should be treated as block closures.
         */
        isBlockExpr(expr) {
            if (expr.type !== 'PipeChain')
                return false;
            const chain = expr;
            if (chain.pipes.length > 0)
                return false;
            if (chain.head.type !== 'PostfixExpr')
                return false;
            const head = chain.head;
            if (head.methods.length > 0)
                return false;
            return head.primary.type === 'Block';
        }
    };
}
// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LiteralsMixin = createLiteralsMixin;
//# sourceMappingURL=literals.js.map