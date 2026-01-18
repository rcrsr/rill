/**
 * Expression Evaluation
 *
 * Internal module for AST evaluation. Not part of public API.
 * All evaluation functions are internal implementation details.
 *
 * @internal
 */
import { AbortError, AutoExceptionError, RILL_ERROR_CODES, RuntimeError, TimeoutError, } from '../../types.js';
import { BUILTIN_METHODS } from '../ext/builtins.js';
import { isCallable, isDict, isScriptCallable } from './callable.js';
import { BreakSignal, ReturnSignal } from './signals.js';
import { createTupleFromDict, createTupleFromList, deepEquals, formatValue, inferType, isTuple, isReservedMethod, isTruthy, } from './values.js';
// ============================================================
// EXPORTED HELPERS (used by execute.ts)
// ============================================================
/** Helper to get location from an AST node */
function getNodeLocation(node) {
    return node?.span.start;
}
/**
 * Check if execution has been aborted via AbortSignal.
 * Throws AbortError if signal is aborted.
 */
export function checkAborted(ctx, node) {
    if (ctx.signal?.aborted) {
        throw new AbortError(getNodeLocation(node));
    }
}
/**
 * Check if the current pipe value matches any autoException pattern.
 * Only checks string values. Throws AutoExceptionError on match.
 */
export function checkAutoExceptions(value, ctx, node) {
    if (typeof value !== 'string' || ctx.autoExceptions.length === 0) {
        return;
    }
    for (const pattern of ctx.autoExceptions) {
        if (pattern.test(value)) {
            throw new AutoExceptionError(pattern.source, value, getNodeLocation(node));
        }
    }
}
/**
 * Handle statement capture: set variable and fire observability event.
 * Returns capture info if a capture occurred.
 */
export function handleCapture(capture, value, ctx) {
    if (!capture)
        return undefined;
    setVariable(ctx, capture.name, value, capture.typeName, capture.span.start);
    const captureInfo = { name: capture.name, value };
    ctx.observability.onCapture?.(captureInfo);
    return captureInfo;
}
// ============================================================
// VARIABLE MANAGEMENT
// ============================================================
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
// EXPRESSION EVALUATION
// ============================================================
/**
 * Evaluate argument expressions while preserving the current pipeValue.
 */
async function evaluateArgs(argExprs, ctx) {
    const savedPipeValue = ctx.pipeValue;
    const args = [];
    for (const arg of argExprs) {
        args.push(await evaluateExpression(arg, ctx));
    }
    ctx.pipeValue = savedPipeValue;
    return args;
}
export async function evaluateExpression(expr, ctx) {
    return evaluatePipeChain(expr, ctx);
}
async function evaluatePipeChain(chain, ctx) { console.log("evaluatePipeChain called, terminator:", chain.terminator?.type);
    let value = await evaluatePostfixExpr(chain.head, ctx);
    ctx.pipeValue = value;
    for (const target of chain.pipes) {
        value = await evaluatePipeTarget(target, value, ctx);
        ctx.pipeValue = value;
    }
    // Handle chain terminator (capture, break, return)
    if (chain.terminator) {
        if (chain.terminator.type === 'Break') {
            throw new BreakSignal(value);
        }
        if (chain.terminator.type === 'Return') {
            throw new ReturnSignal(value);
        }
        // Capture
        handleCapture(chain.terminator, value, ctx);
    }
    return value;
}
async function evaluatePostfixExpr(expr, ctx) {
    let value = await evaluatePrimary(expr.primary, ctx);
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
            return evaluateMethod(primary, ctx.pipeValue, ctx);
        case 'Conditional':
            return evaluateConditional(primary, ctx);
        case 'WhileLoop':
            return evaluateWhileLoop(primary, ctx);
        case 'ForLoop':
            return evaluateForLoop(primary, ctx);
        case 'DoWhileLoop':
            return evaluateDoWhileLoop(primary, ctx);
        case 'Block':
            return evaluateBlockExpression(primary, ctx);
        case 'GroupedExpr':
            return evaluateGroupedExpr(primary, ctx);
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
            return evaluateCapture(target, input, ctx);
        case 'FunctionCall':
            return evaluateFunctionCall(target, ctx);
        case 'VariableCall':
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
        case 'DoWhileLoop':
            return evaluateDoWhileLoop(target, ctx);
        case 'Block':
            return evaluateBlockExpression(target, ctx);
        case 'StringLiteral':
            return evaluateString(target, ctx);
        case 'GroupedExpr':
            return evaluateGroupedExpr(target, ctx);
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
// STATEMENT EXECUTION
// ============================================================
export async function executeStatement(stmt, ctx) {
    const value = await evaluateExpression(stmt.expression, ctx);
    ctx.pipeValue = value;
    checkAutoExceptions(value, ctx, stmt);
    // Terminator handling is now inside PipeChainNode evaluation
    // (evaluatePipeChain handles capture/break/return terminators)
    return value;
}
// ============================================================
// SPREAD OPERATIONS
// ============================================================
async function evaluateParallelSpread(node, input, ctx) {
    const target = await evaluateExpression(node.target, ctx);
    const inputArray = Array.isArray(input) ? input : null;
    const targetArray = Array.isArray(target) ? target : null;
    if (inputArray && targetArray) {
        if (inputArray.length !== targetArray.length) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Parallel zip requires equal lengths: got ${inputArray.length} args and ${targetArray.length} closures`, node.span.start);
        }
        const promises = inputArray.map((arg, i) => {
            const closure = targetArray[i];
            if (closure === undefined) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Missing closure at index ${i}`, node.span.start);
            }
            return invokeAsCallableOrFunction(closure, [arg], ctx, node.span.start);
        });
        return Promise.all(promises);
    }
    else if (inputArray && !targetArray) {
        const promises = inputArray.map((arg) => invokeAsCallableOrFunction(target, [arg], ctx, node.span.start));
        return Promise.all(promises);
    }
    else if (!inputArray && targetArray) {
        const promises = targetArray.map((closure) => invokeAsCallableOrFunction(closure, [input], ctx, node.span.start));
        return Promise.all(promises);
    }
    else {
        const result = await invokeAsCallableOrFunction(target, [input], ctx, node.span.start);
        return [result];
    }
}
async function evaluateParallelFilter(node, input, ctx) {
    if (!Array.isArray(input)) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Filter requires list, got ${isDict(input) ? 'dict' : typeof input}`, node.span.start);
    }
    const results = [];
    for (const element of input) {
        const savedPipeValue = ctx.pipeValue;
        ctx.pipeValue = element;
        let predicateResult;
        if (node.predicate.type === 'Block') {
            predicateResult = await evaluateBlockExpression(node.predicate, ctx);
        }
        else {
            const closure = ctx.variables.get(node.predicate.name ?? '');
            if (!closure) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE, `Undefined variable: $${node.predicate.name}`, node.predicate.span.start, { variableName: node.predicate.name });
            }
            if (!isCallable(closure)) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Filter predicate must be callable, got ${typeof closure}`, node.predicate.span.start);
            }
            predicateResult = await invokeCallable(closure, [element], ctx, node.predicate.span.start);
        }
        if (isTruthy(predicateResult)) {
            results.push(element);
        }
        ctx.pipeValue = savedPipeValue;
    }
    return results;
}
async function evaluateSequentialSpread(node, input, ctx) {
    const target = await evaluateExpression(node.target, ctx);
    const closures = Array.isArray(target) ? target : [target];
    let accumulated = input;
    for (const closure of closures) {
        accumulated = await invokeAsCallableOrFunction(closure, [accumulated], ctx, node.span.start);
    }
    return accumulated;
}
async function invokeAsCallableOrFunction(callableOrName, args, ctx, location) {
    if (isCallable(callableOrName)) {
        return invokeCallable(callableOrName, args, ctx, location);
    }
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
function evaluateCapture(node, input, ctx) {
    setVariable(ctx, node.name, input, node.typeName, node.span.start);
    ctx.observability.onCapture?.({ name: node.name, value: input });
    return input;
}
// ============================================================
// EXTRACTION OPERATORS
// ============================================================
function evaluateDestructure(node, input, ctx) {
    const isList = Array.isArray(input);
    const isDictInput = isDict(input);
    const firstNonSkip = node.elements.find((e) => e.kind !== 'skip');
    const isKeyPattern = firstNonSkip?.kind === 'keyValue';
    if (isKeyPattern) {
        if (!isDictInput) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Key destructure requires dict, got ${isList ? 'list' : typeof input}`, node.span.start);
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
        if (!isList) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Positional destructure requires list, got ${isDictInput ? 'dict' : typeof input}`, node.span.start);
        }
        const listInput = input;
        if (node.elements.length !== listInput.length) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Destructure pattern has ${node.elements.length} elements, list has ${listInput.length}`, node.span.start);
        }
        for (let i = 0; i < node.elements.length; i++) {
            const elem = node.elements[i];
            const value = listInput[i];
            if (elem === undefined || value === undefined) {
                continue;
            }
            if (elem.kind === 'skip')
                continue;
            if (elem.kind === 'nested' && elem.nested) {
                evaluateDestructure(elem.nested, value, ctx);
                continue;
            }
            if (elem.name === null) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Invalid destructure element', elem.span.start);
            }
            setVariable(ctx, elem.name, value, elem.typeName, elem.span.start);
        }
    }
    return input;
}
async function evaluateSlice(node, input, ctx) {
    const isList = Array.isArray(input);
    const isString = typeof input === 'string';
    if (!isList && !isString) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Slice requires list or string, got ${isDict(input) ? 'dict' : typeof input}`, node.span.start);
    }
    const startBound = node.start
        ? await evaluateSliceBound(node.start, ctx)
        : null;
    const stopBound = node.stop ? await evaluateSliceBound(node.stop, ctx) : null;
    const stepBound = node.step ? await evaluateSliceBound(node.step, ctx) : null;
    if (isList) {
        return applySlice(input, input.length, startBound, stopBound, stepBound);
    }
    return applySlice(input, input.length, startBound, stopBound, stepBound);
}
async function evaluateSliceBound(bound, ctx) {
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
        case 'GroupedExpr': {
            const value = await evaluateGroupedExpr(bound, ctx);
            if (typeof value !== 'number') {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Slice bound must be number, got ${typeof value}`, bound.span.start);
            }
            return value;
        }
    }
}
function applySlice(input, len, start, stop, step) {
    const actualStep = step ?? 1;
    if (actualStep === 0) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Slice step cannot be zero', undefined);
    }
    const normalizeIndex = (idx, defaultVal, forStep) => {
        if (idx === null)
            return defaultVal;
        let normalized = idx < 0 ? len + idx : idx;
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
    if (Array.isArray(input)) {
        return indices.map((i) => input[i]);
    }
    else {
        return indices.map((i) => input[i]).join('');
    }
}
async function evaluateSpread(node, ctx) {
    let value;
    if (node.operand === null) {
        value = ctx.pipeValue;
    }
    else {
        value = await evaluateExpression(node.operand, ctx);
    }
    if (Array.isArray(value)) {
        return createTupleFromList(value);
    }
    if (isDict(value)) {
        return createTupleFromDict(value);
    }
    throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Spread requires list or dict, got ${inferType(value)}`, node.span.start);
}
function evaluateEnumerate(node, input) {
    if (Array.isArray(input)) {
        return input.map((value, index) => ({
            index,
            value,
        }));
    }
    if (isDict(input)) {
        const keys = Object.keys(input).sort();
        return keys.map((key, index) => ({
            index,
            key,
            value: input[key],
        }));
    }
    throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Enumerate requires list or dict, got ${typeof input}`, node.span.start);
}
// ============================================================
// LITERAL EVALUATION
// ============================================================
async function evaluateString(node, ctx) {
    let result = '';
    for (const part of node.parts) {
        if (typeof part === 'string') {
            result += part;
        }
        else {
            result += formatValue(ctx.pipeValue);
        }
    }
    // Handle {$fn(args)} patterns
    const varCallPattern = /\{\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\(\s*([^)]*)\s*\)\s*\}/g;
    const varCallMatches = [...result.matchAll(varCallPattern)];
    for (const match of varCallMatches.reverse()) {
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
    // Handle {$} and {$.field} patterns
    result = result.replace(/\{\s*\$(?![a-zA-Z_])([^}]*)\}/g, (_match, field) => {
        let value = ctx.pipeValue;
        const trimmed = field.trim();
        if (trimmed) {
            value = accessField(value, trimmed.slice(1));
        }
        return formatValue(value);
    });
    // Handle {$name} and {$name.field} patterns
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
        if (isScriptCallable(value)) {
            const args = value.params.length > 0 ? [ctx.pipeValue] : [];
            value = await invokeScriptCallable(value, args, ctx, node.span.start);
        }
        const trimmed = field.trim();
        if (trimmed) {
            value = accessField(value, trimmed.slice(1));
        }
        result =
            result.slice(0, idx) +
                formatValue(value) +
                result.slice(idx + fullMatch.length);
    }
    // Handle {.method} patterns
    result = result.replace(/\{\s*\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g, (_match, methodName) => {
        const method = BUILTIN_METHODS[methodName];
        if (method) {
            const methodResult = method(ctx.pipeValue, [], ctx);
            return formatValue(methodResult);
        }
        return `{.${methodName}}`;
    });
    return result;
}
function parseInterpolationArgs(argsStr, ctx) {
    const trimmed = argsStr.trim();
    if (!trimmed)
        return [];
    const args = [];
    const parts = trimmed.split(',').map((p) => p.trim());
    for (const part of parts) {
        if (part.startsWith('"') && part.endsWith('"')) {
            args.push(part.slice(1, -1));
        }
        else if (/^-?\d+(\.\d+)?$/.test(part)) {
            args.push(parseFloat(part));
        }
        else if (part === '$') {
            args.push(ctx.pipeValue);
        }
        else if (part.startsWith('$')) {
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
        if (isReservedMethod(entry.key)) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Cannot use reserved method name '${entry.key}' as dict key`, entry.span.start, { key: entry.key, reservedMethods: ['keys', 'values', 'entries'] });
        }
        if (isFunctionLiteralExpr(entry.value)) {
            const fnLit = entry.value.head.primary;
            const closure = await createClosure(fnLit, ctx);
            result[entry.key] = closure;
        }
        else {
            result[entry.key] = await evaluateExpression(entry.value, ctx);
        }
    }
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
async function createClosure(node, ctx) {
    const capturedVars = new Map(ctx.variables);
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
function getBaseVariableValue(node, ctx) {
    if (node.isPipeVar)
        return ctx.pipeValue;
    if (node.name)
        return ctx.variables.get(node.name) ?? null;
    return null;
}
function evaluateVariable(node, ctx) {
    let value = getBaseVariableValue(node, ctx);
    for (const access of node.fieldAccess) {
        value = accessField(value, access.field);
    }
    return value;
}
async function evaluateVariableAsync(node, ctx) {
    let value = getBaseVariableValue(node, ctx);
    for (const access of node.fieldAccess) {
        value = accessField(value, access.field);
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
    if (typeof value === 'object' &&
        !Array.isArray(value) &&
        !isScriptCallable(value)) {
        return value[field] ?? null;
    }
    return null;
}
// ============================================================
// FUNCTION & METHOD EVALUATION
// ============================================================
async function evaluateFunctionCall(node, ctx) {
    checkAborted(ctx, node);
    const fn = ctx.functions.get(node.name);
    if (!fn) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_FUNCTION, `Unknown function: ${node.name}`, getNodeLocation(node), { functionName: node.name });
    }
    const args = await evaluateArgs(node.args, ctx);
    if (args.length === 0 && ctx.pipeValue !== null) {
        args.push(ctx.pipeValue);
    }
    ctx.observability.onFunctionCall?.({ name: node.name, args });
    const startTime = Date.now();
    const location = getNodeLocation(node);
    const result = fn(args, ctx, location);
    let value;
    if (result instanceof Promise) {
        value = await withTimeout(result, ctx.timeout, node.name, node);
    }
    else {
        value = result;
    }
    ctx.observability.onFunctionReturn?.({
        name: node.name,
        value,
        durationMs: Date.now() - startTime,
    });
    return value;
}
async function evaluateVariableCall(node, ctx) {
    return evaluateVariableCallWithPipe(node, ctx.pipeValue, ctx);
}
async function evaluateVariableCallWithPipe(node, pipeInput, ctx) {
    const closure = ctx.variables.get(node.name);
    if (!closure) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE, `Unknown variable: $${node.name}`, getNodeLocation(node), { variableName: node.name });
    }
    if (!isCallable(closure)) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Variable $${node.name} is not a function (got ${typeof closure})`, getNodeLocation(node), { variableName: node.name, actualType: typeof closure });
    }
    const args = await evaluateArgs(node.args, ctx);
    if (isScriptCallable(closure) &&
        args.length === 0 &&
        pipeInput !== null &&
        closure.params.length > 0) {
        const firstParam = closure.params[0];
        if (firstParam?.defaultValue === null && !isCallable(pipeInput)) {
            args.push(pipeInput);
        }
    }
    return invokeCallable(closure, args, ctx, node.span.start);
}
async function invokeCallable(callable, args, ctx, callLocation) {
    checkAborted(ctx, undefined);
    if (callable.kind === 'script') {
        return invokeScriptCallable(callable, args, ctx, callLocation);
    }
    else {
        return invokeFnCallable(callable, args, ctx, callLocation);
    }
}
async function invokeFnCallable(callable, args, ctx, callLocation) {
    const effectiveArgs = callable.boundDict && args.length === 0 ? [callable.boundDict] : args;
    const result = callable.fn(effectiveArgs, ctx, callLocation);
    return result instanceof Promise ? await result : result;
}
// ============================================================
// CALLABLE INVOCATION HELPERS
// ============================================================
function createCallableContext(callable, ctx) {
    const callableCtx = {
        ...ctx,
        variables: new Map(callable.capturedVars),
        variableTypes: new Map(ctx.variableTypes),
    };
    if (callable.boundDict) {
        callableCtx.pipeValue = callable.boundDict;
    }
    return callableCtx;
}
function inferTypeFromDefault(defaultValue) {
    if (defaultValue === null)
        return null;
    const t = inferType(defaultValue);
    return t === 'string' || t === 'number' || t === 'bool' ? t : null;
}
function validateParamType(param, value, callLocation) {
    const expectedType = param.typeName ?? inferTypeFromDefault(param.defaultValue);
    if (expectedType !== null) {
        const valueType = inferType(value);
        if (valueType !== expectedType) {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Parameter type mismatch: ${param.name} expects ${expectedType}, got ${valueType}`, callLocation, { paramName: param.name, expectedType, actualType: valueType });
        }
    }
}
async function invokeScriptCallable(callable, args, ctx, callLocation) {
    const firstArg = args[0];
    if (args.length === 1 && firstArg !== undefined && isTuple(firstArg)) {
        return invokeScriptCallableWithArgs(callable, firstArg, ctx, callLocation);
    }
    const callableCtx = createCallableContext(callable, ctx);
    for (let i = 0; i < callable.params.length; i++) {
        const param = callable.params[i];
        let value;
        if (i < args.length) {
            value = args[i];
        }
        else if (param.defaultValue !== null) {
            value = param.defaultValue;
        }
        else {
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Missing argument for parameter '${param.name}' at position ${i}`, callLocation, { paramName: param.name, position: i });
        }
        validateParamType(param, value, callLocation);
        callableCtx.variables.set(param.name, value);
    }
    return evaluateSimpleBodyExpression(callable.body, callableCtx);
}
async function invokeScriptCallableWithArgs(closure, tupleValue, ctx, callLocation) {
    const closureCtx = createCallableContext(closure, ctx);
    const hasNumericKeys = [...tupleValue.entries.keys()].some((k) => typeof k === 'number');
    const hasStringKeys = [...tupleValue.entries.keys()].some((k) => typeof k === 'string');
    if (hasNumericKeys && hasStringKeys) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, 'Tuple cannot mix positional (numeric) and named (string) keys', callLocation);
    }
    const boundParams = new Set();
    if (hasNumericKeys) {
        for (const [key, value] of tupleValue.entries) {
            const position = key;
            const param = closure.params[position];
            if (param === undefined) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Extra argument at position ${position} (closure has ${closure.params.length} params)`, callLocation, { position, paramCount: closure.params.length });
            }
            validateParamType(param, value, callLocation);
            closureCtx.variables.set(param.name, value);
            boundParams.add(param.name);
        }
    }
    else if (hasStringKeys) {
        const paramNames = new Set(closure.params.map((p) => p.name));
        for (const [key, value] of tupleValue.entries) {
            const name = key;
            if (!paramNames.has(name)) {
                throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Unknown argument '${name}' (valid params: ${[...paramNames].join(', ')})`, callLocation, { argName: name, validParams: [...paramNames] });
            }
            const param = closure.params.find((p) => p.name === name);
            validateParamType(param, value, callLocation);
            closureCtx.variables.set(name, value);
            boundParams.add(name);
        }
    }
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
    return evaluateSimpleBodyExpression(closure.body, closureCtx);
}
async function evaluateInvoke(node, input, ctx) {
    if (!isScriptCallable(input)) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Cannot invoke non-closure value (got ${typeof input})`, getNodeLocation(node));
    }
    const args = await evaluateArgs(node.args, ctx);
    return invokeScriptCallable(input, args, ctx, node.span.start);
}
async function evaluateMethod(node, receiver, ctx) {
    checkAborted(ctx, node);
    if (isCallable(receiver)) {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Method .${node.name} not available on callable (invoke with -> () first)`, getNodeLocation(node), { methodName: node.name, receiverType: 'callable' });
    }
    const args = await evaluateArgs(node.args, ctx);
    if (isDict(receiver)) {
        const dictValue = receiver[node.name];
        if (dictValue !== undefined && isCallable(dictValue)) {
            return invokeCallable(dictValue, args, ctx, getNodeLocation(node));
        }
    }
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
async function evaluateConditional(node, ctx) { console.log("evaluateConditional called, condition:", node.condition?.type, "thenBranch:", node.thenBranch?.type);
    let conditionResult;
    if (node.condition) {
        conditionResult = await evaluateBoolExpr(node.condition, ctx);
    }
    else {
        conditionResult = isTruthy(ctx.pipeValue);
    }
    if (conditionResult) {
        // Use evaluateSimpleBody (not evaluateSimpleBodyExpression) so ReturnSignal
        // propagates up to the containing block rather than being caught here
        return evaluateSimpleBody(node.thenBranch, ctx);
    }
    else if (node.elseBranch) {
        if (node.elseBranch.type === 'Conditional') {
            return evaluateConditional(node.elseBranch, ctx);
        }
        return evaluateSimpleBody(node.elseBranch, ctx);
    }
    return ctx.pipeValue;
}
async function evaluateWhileLoop(node, ctx) {
    const inputValue = ctx.pipeValue;
    let maxIterations = Infinity;
    if (node.maxIterations) {
        const maxVal = await evaluateExpression(node.maxIterations, ctx);
        if (typeof maxVal === 'number') {
            maxIterations = maxVal;
        }
    }
    ctx.pipeValue = inputValue;
    let iterations = 0;
    let value = ctx.pipeValue;
    try {
        while (iterations < maxIterations) {
            checkAborted(ctx, node);
            const conditionResult = await evaluateBoolExpr(node.condition, ctx);
            if (!conditionResult)
                break;
            value = await evaluateSimpleBody(node.body, ctx);
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
                checkAborted(ctx, node);
                ctx.pipeValue = item;
                results.push(await evaluateSimpleBody(node.body, ctx));
            }
        }
        else if (typeof input === 'string') {
            for (const char of input) {
                checkAborted(ctx, node);
                ctx.pipeValue = char;
                results.push(await evaluateSimpleBody(node.body, ctx));
            }
        }
        else {
            checkAborted(ctx, node);
            results.push(await evaluateSimpleBody(node.body, ctx));
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
async function evaluateDoWhileLoop(node, ctx) {
    const inputValue = ctx.pipeValue;
    let maxIterations = Infinity;
    if (node.maxIterations) {
        const maxVal = await evaluateExpression(node.maxIterations, ctx);
        if (typeof maxVal === 'number') {
            maxIterations = maxVal;
        }
    }
    ctx.pipeValue = inputValue;
    let iterations = 0;
    let value = ctx.pipeValue;
    try {
        // Do-while: body executes first, then condition is checked
        let shouldContinue = true;
        while (shouldContinue) {
            checkAborted(ctx, node);
            value = await evaluateSimpleBody(node.body, ctx);
            ctx.pipeValue = value;
            iterations++;
            if (iterations >= maxIterations) {
                shouldContinue = false;
            }
            else {
                shouldContinue = await evaluateBoolExpr(node.condition, ctx);
            }
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
async function evaluateBlock(node, ctx) {
    let lastValue = ctx.pipeValue;
    for (const stmt of node.statements) {
        lastValue = await executeStatement(stmt, ctx);
    }
    return lastValue;
}
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
/**
 * Evaluate a simple body (Block, GroupedExpr, or PostfixExpr).
 * Used by conditionals and loops.
 */
async function evaluateSimpleBody(node, ctx) { console.log("evaluateSimpleBody called with type:", node.type);
    switch (node.type) {
        case 'Block':
            return evaluateBlock(node, ctx);
        case 'GroupedExpr':
            return evaluateGroupedExpr(node, ctx);
        case 'PostfixExpr':
            return evaluatePostfixExpr(node, ctx);
        case 'PipeChain':
            return evaluatePipeChain(node, ctx);
    }
}
/**
 * Evaluate a simple body as an expression (catches ReturnSignal).
 */
async function evaluateSimpleBodyExpression(node, ctx) {
    try {
        return await evaluateSimpleBody(node, ctx);
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
        case 'BinaryExpr':
            return evaluateBinaryExpr(node, ctx);
        case 'UnaryExpr':
            return evaluateUnaryExpr(node, ctx);
        case 'GroupedExpr':
            return evaluateGroupedExpr(node, ctx);
        case 'PostfixExpr':
            return evaluatePostfixExpr(node, ctx);
        default:
            throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Unknown simple primary type: ${node.type}`, getNodeLocation(node));
    }
}
// ============================================================
// ARITHMETIC / GROUPED EXPRESSIONS
// ============================================================
async function evaluateBinaryExpr(node, ctx) {
    const left = await evaluateArithHead(node.left, ctx);
    const right = await evaluateArithHead(node.right, ctx);
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
async function evaluateUnaryExpr(node, ctx) {
    const operand = node.operand;
    if (operand.type === 'UnaryExpr') {
        return -(await evaluateUnaryExpr(operand, ctx));
    }
    const value = await evaluatePostfixExprNumber(operand, ctx);
    return -value;
}
async function evaluateArithHead(node, ctx) {
    switch (node.type) {
        case 'BinaryExpr':
            return evaluateBinaryExpr(node, ctx);
        case 'UnaryExpr':
            return evaluateUnaryExpr(node, ctx);
        case 'PostfixExpr':
            return evaluatePostfixExprNumber(node, ctx);
    }
}
async function evaluatePostfixExprNumber(node, ctx) {
    const value = await evaluatePostfixExpr(node, ctx);
    if (typeof value !== 'number') {
        throw new RuntimeError(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR, `Arithmetic requires number, got ${inferType(value)}`, node.span.start);
    }
    return value;
}
async function evaluateGroupedExpr(node, ctx) {
    return evaluateInnerExpr(node.expression, ctx);
}
async function evaluateInnerExpr(node, ctx) {
    // Evaluate head (arithmetic or postfix)
    let value;
    switch (node.head.type) {
        case 'BinaryExpr':
            value = await evaluateBinaryExpr(node.head, ctx);
            break;
        case 'UnaryExpr':
            value = await evaluateUnaryExpr(node.head, ctx);
            break;
        case 'PostfixExpr':
            value = await evaluatePostfixExpr(node.head, ctx);
            break;
    }
    // Pipe through targets
    ctx.pipeValue = value;
    for (const target of node.pipes) {
        checkAborted(ctx, node);
        if (target.type === 'Capture') {
            value = evaluateCapture(target, value, ctx);
        }
        else {
            value = await evaluatePipeTarget(target, value, ctx);
        }
        ctx.pipeValue = value;
    }
    // Handle terminator
    if (node.terminator) {
        if (node.terminator.type === 'Break') {
            throw new BreakSignal(value);
        }
        if (node.terminator.type === 'Return') {
            throw new ReturnSignal(value);
        }
        // Capture
        handleCapture(node.terminator, value, ctx);
    }
    return value;
}
//# sourceMappingURL=evaluate.js.map