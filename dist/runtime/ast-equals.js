/**
 * AST Structural Equality
 *
 * Compares AST nodes for structural equality, ignoring source locations.
 * Used for closure equality: two closures with identical structure are equal.
 */
/**
 * Compare two AST nodes for structural equality.
 * Ignores source locations (span) - only compares structure and values.
 */
export function astEquals(a, b) {
    // Different node types are never equal
    if (a.type !== b.type)
        return false;
    switch (a.type) {
        case 'Block':
            return blockEquals(a, b);
        case 'Statement':
            return statementEquals(a, b);
        case 'PipeChain':
            return pipeChainEquals(a, b);
        case 'PostfixExpr':
            return postfixExprEquals(a, b);
        case 'StringLiteral':
            return stringLiteralEquals(a, b);
        case 'NumberLiteral':
            return a.value === b.value;
        case 'BoolLiteral':
            return a.value === b.value;
        case 'Variable':
            return variableEquals(a, b);
        case 'FunctionCall':
            return functionCallEquals(a, b);
        case 'VariableCall':
            return variableCallEquals(a, b);
        case 'MethodCall':
            return methodCallEquals(a, b);
        case 'Invoke':
            return invokeEquals(a, b);
        case 'Conditional':
            return conditionalEquals(a, b);
        case 'WhileLoop':
            return whileLoopEquals(a, b);
        case 'ForLoop':
            return forLoopEquals(a, b);
        case 'Tuple':
            return tupleEquals(a, b);
        case 'Dict':
            return dictEquals(a, b);
        case 'DictEntry':
            return dictEntryEquals(a, b);
        case 'FunctionLiteral':
            return functionLiteralEquals(a, b);
        case 'FuncParam':
            return funcParamEquals(a, b);
        case 'Arithmetic':
            return arithmeticEquals(a, b);
        case 'BoolExpr':
            return boolExprEquals(a, b);
        case 'Comparison':
            return comparisonEquals(a, b);
        case 'ParallelSpread':
            return parallelSpreadEquals(a, b);
        case 'ParallelFilter':
            return parallelFilterEquals(a, b);
        case 'SequentialSpread':
            return sequentialSpreadEquals(a, b);
        case 'Destructure':
            return destructureEquals(a, b);
        case 'DestructElem':
            return destructElemEquals(a, b);
        case 'Slice':
            return sliceEquals(a, b);
        case 'Enumerate':
            return true; // EnumerateNode has no fields besides type and span
        case 'Spread':
            return spreadEquals(a, b);
        case 'Capture':
            return a.name === b.name && a.typeName === b.typeName;
        case 'Break':
        case 'Return':
            return a.value === null
                ? b.value === null
                : b.value !== null &&
                    astEquals(a.value, b.value);
        case 'Interpolation':
            return expressionEquals(a.expression, b.expression);
        default:
            // For any unhandled node types, fall back to false
            return false;
    }
}
function blockEquals(a, b) {
    if (a.statements.length !== b.statements.length)
        return false;
    for (let i = 0; i < a.statements.length; i++) {
        if (!statementEquals(a.statements[i], b.statements[i]))
            return false;
    }
    return true;
}
function statementEquals(a, b) {
    if (a.terminator !== b.terminator)
        return false;
    // Compare captures
    if (a.capture === null && b.capture !== null)
        return false;
    if (a.capture !== null && b.capture === null)
        return false;
    if (a.capture !== null && b.capture !== null) {
        if (a.capture.name !== b.capture.name)
            return false;
        if (a.capture.typeName !== b.capture.typeName)
            return false;
    }
    return expressionEquals(a.expression, b.expression);
}
function expressionEquals(a, b) {
    return pipeChainEquals(a, b);
}
function pipeChainEquals(a, b) {
    if (!postfixExprEquals(a.head, b.head))
        return false;
    if (a.pipes.length !== b.pipes.length)
        return false;
    for (let i = 0; i < a.pipes.length; i++) {
        if (!astEquals(a.pipes[i], b.pipes[i]))
            return false;
    }
    return true;
}
function postfixExprEquals(a, b) {
    if (!astEquals(a.primary, b.primary))
        return false;
    if (a.methods.length !== b.methods.length)
        return false;
    for (let i = 0; i < a.methods.length; i++) {
        if (!methodCallEquals(a.methods[i], b.methods[i]))
            return false;
    }
    return true;
}
function stringLiteralEquals(a, b) {
    if (a.isHeredoc !== b.isHeredoc)
        return false;
    if (a.parts.length !== b.parts.length)
        return false;
    for (let i = 0; i < a.parts.length; i++) {
        const aPart = a.parts[i];
        const bPart = b.parts[i];
        if (typeof aPart === 'string') {
            if (typeof bPart !== 'string' || aPart !== bPart)
                return false;
        }
        else {
            if (typeof bPart === 'string')
                return false;
            if (!expressionEquals(aPart.expression, bPart.expression))
                return false;
        }
    }
    return true;
}
function variableEquals(a, b) {
    if (a.name !== b.name)
        return false;
    if (a.isPipeVar !== b.isPipeVar)
        return false;
    if (a.fieldAccess.length !== b.fieldAccess.length)
        return false;
    for (let i = 0; i < a.fieldAccess.length; i++) {
        if (a.fieldAccess[i].field !== b.fieldAccess[i].field)
            return false;
    }
    return true;
}
function functionCallEquals(a, b) {
    if (a.name !== b.name)
        return false;
    return argsListEquals(a.args, b.args);
}
function variableCallEquals(a, b) {
    if (a.name !== b.name)
        return false;
    return argsListEquals(a.args, b.args);
}
function methodCallEquals(a, b) {
    if (a.name !== b.name)
        return false;
    return argsListEquals(a.args, b.args);
}
function invokeEquals(a, b) {
    return argsListEquals(a.args, b.args);
}
function argsListEquals(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (!expressionEquals(a[i], b[i]))
            return false;
    }
    return true;
}
function conditionalEquals(a, b) {
    // Compare input
    if (a.input === null && b.input !== null)
        return false;
    if (a.input !== null && b.input === null)
        return false;
    if (a.input !== null && b.input !== null) {
        if (!expressionEquals(a.input, b.input))
            return false;
    }
    // Compare condition
    if (a.condition === null && b.condition !== null)
        return false;
    if (a.condition !== null && b.condition === null)
        return false;
    if (a.condition !== null && b.condition !== null) {
        if (!boolExprEquals(a.condition, b.condition))
            return false;
    }
    // Compare then block
    if (!blockEquals(a.thenBlock, b.thenBlock))
        return false;
    // Compare else clause
    if (a.elseClause === null && b.elseClause !== null)
        return false;
    if (a.elseClause !== null && b.elseClause === null)
        return false;
    if (a.elseClause !== null && b.elseClause !== null) {
        if (!astEquals(a.elseClause, b.elseClause))
            return false;
    }
    return true;
}
function whileLoopEquals(a, b) {
    // Compare input
    if (a.input === null && b.input !== null)
        return false;
    if (a.input !== null && b.input === null)
        return false;
    if (a.input !== null && b.input !== null) {
        if (!expressionEquals(a.input, b.input))
            return false;
    }
    // Compare condition
    if (!boolExprEquals(a.condition, b.condition))
        return false;
    // Compare max iterations
    if (a.maxIterations === null && b.maxIterations !== null)
        return false;
    if (a.maxIterations !== null && b.maxIterations === null)
        return false;
    if (a.maxIterations !== null && b.maxIterations !== null) {
        if (!expressionEquals(a.maxIterations, b.maxIterations))
            return false;
    }
    return blockEquals(a.body, b.body);
}
function forLoopEquals(a, b) {
    // Compare input
    if (a.input === null && b.input !== null)
        return false;
    if (a.input !== null && b.input === null)
        return false;
    if (a.input !== null && b.input !== null) {
        if (!expressionEquals(a.input, b.input))
            return false;
    }
    return blockEquals(a.body, b.body);
}
function tupleEquals(a, b) {
    return argsListEquals(a.elements, b.elements);
}
function dictEquals(a, b) {
    if (a.entries.length !== b.entries.length)
        return false;
    for (let i = 0; i < a.entries.length; i++) {
        if (!dictEntryEquals(a.entries[i], b.entries[i]))
            return false;
    }
    return true;
}
function dictEntryEquals(a, b) {
    if (a.key !== b.key)
        return false;
    return expressionEquals(a.value, b.value);
}
function functionLiteralEquals(a, b) {
    if (a.params.length !== b.params.length)
        return false;
    for (let i = 0; i < a.params.length; i++) {
        if (!funcParamEquals(a.params[i], b.params[i]))
            return false;
    }
    return blockEquals(a.body, b.body);
}
function funcParamEquals(a, b) {
    if (a.name !== b.name)
        return false;
    if (a.typeName !== b.typeName)
        return false;
    if (a.defaultValue === null && b.defaultValue !== null)
        return false;
    if (a.defaultValue !== null && b.defaultValue === null)
        return false;
    if (a.defaultValue !== null && b.defaultValue !== null) {
        if (!astEquals(a.defaultValue, b.defaultValue))
            return false;
    }
    return true;
}
function arithmeticEquals(a, b) {
    if (a.op !== b.op)
        return false;
    if (!astEquals(a.left, b.left))
        return false;
    if (a.right === null && b.right !== null)
        return false;
    if (a.right !== null && b.right === null)
        return false;
    if (a.right !== null && b.right !== null) {
        if (!astEquals(a.right, b.right))
            return false;
    }
    return true;
}
function boolExprEquals(a, b) {
    if (a.type !== b.type)
        return false;
    if (a.type === 'Comparison') {
        return comparisonEquals(a, b);
    }
    // BoolExpr nodes
    if (a.op !== b.op)
        return false;
    if (a.op === 'not') {
        return boolExprEquals(a.operand, b.operand);
    }
    // 'and' or 'or'
    const aOperands = a.operands;
    const bOperands = b.operands;
    if (aOperands.length !== bOperands.length)
        return false;
    for (let i = 0; i < aOperands.length; i++) {
        if (!boolExprEquals(aOperands[i], bOperands[i]))
            return false;
    }
    return true;
}
function comparisonEquals(a, b) {
    if (a.op !== b.op)
        return false;
    if (!astEquals(a.left, b.left))
        return false;
    if (a.right === null && b.right !== null)
        return false;
    if (a.right !== null && b.right === null)
        return false;
    if (a.right !== null && b.right !== null) {
        if (!astEquals(a.right, b.right))
            return false;
    }
    return true;
}
function parallelSpreadEquals(a, b) {
    return expressionEquals(a.target, b.target);
}
function parallelFilterEquals(a, b) {
    if (a.predicate.type !== b.predicate.type)
        return false;
    return astEquals(a.predicate, b.predicate);
}
function sequentialSpreadEquals(a, b) {
    return expressionEquals(a.target, b.target);
}
function destructureEquals(a, b) {
    if (a.elements.length !== b.elements.length)
        return false;
    for (let i = 0; i < a.elements.length; i++) {
        if (!destructElemEquals(a.elements[i], b.elements[i]))
            return false;
    }
    return true;
}
function destructElemEquals(a, b) {
    if (a.kind !== b.kind)
        return false;
    if (a.name !== b.name)
        return false;
    if (a.key !== b.key)
        return false;
    if (a.typeName !== b.typeName)
        return false;
    if (a.nested === null && b.nested !== null)
        return false;
    if (a.nested !== null && b.nested === null)
        return false;
    if (a.nested !== null && b.nested !== null) {
        if (!destructureEquals(a.nested, b.nested))
            return false;
    }
    return true;
}
function sliceEquals(a, b) {
    // Compare start
    if (a.start === null && b.start !== null)
        return false;
    if (a.start !== null && b.start === null)
        return false;
    if (a.start !== null && b.start !== null) {
        if (!astEquals(a.start, b.start))
            return false;
    }
    // Compare stop
    if (a.stop === null && b.stop !== null)
        return false;
    if (a.stop !== null && b.stop === null)
        return false;
    if (a.stop !== null && b.stop !== null) {
        if (!astEquals(a.stop, b.stop))
            return false;
    }
    // Compare step
    if (a.step === null && b.step !== null)
        return false;
    if (a.step !== null && b.step === null)
        return false;
    if (a.step !== null && b.step !== null) {
        if (!astEquals(a.step, b.step))
            return false;
    }
    return true;
}
function spreadEquals(a, b) {
    if (a.operand === null && b.operand !== null)
        return false;
    if (a.operand !== null && b.operand === null)
        return false;
    if (a.operand !== null && b.operand !== null) {
        if (!expressionEquals(a.operand, b.operand))
            return false;
    }
    return true;
}
//# sourceMappingURL=ast-equals.js.map