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
/**
 * Helper to compare two nullable values for structural equality.
 * Returns false if nullability differs, otherwise compares with astEquals.
 */
function nullableEquals(a, b) {
    if (a === null && b === null)
        return true;
    if (a === null || b === null)
        return false;
    return astEquals(a, b);
}
export function astEquals(a, b) {
    // Different node types are never equal
    if (a.type !== b.type)
        return false;
    switch (a.type) {
        case 'Block':
            return blockEquals(a, b);
        case 'Statement':
            return statementEquals(a, b);
        case 'AnnotatedStatement':
            return annotatedStatementEquals(a, b);
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
        case 'HostCall':
            return functionCallEquals(a, b);
        case 'ClosureCall':
            return closureCallEquals(a, b);
        case 'MethodCall':
            return methodCallEquals(a, b);
        case 'Invoke':
            return invokeEquals(a, b);
        case 'PipeInvoke':
            return pipeInvokeEquals(a, b);
        case 'Conditional':
            return conditionalEquals(a, b);
        case 'ForLoop':
            return forLoopEquals(a, b);
        case 'DoWhileLoop':
            return doWhileLoopEquals(a, b);
        case 'Tuple':
            return tupleEquals(a, b);
        case 'Dict':
            return dictEquals(a, b);
        case 'DictEntry':
            return dictEntryEquals(a, b);
        case 'Closure':
            return closureEquals(a, b);
        case 'ClosureParam':
            return closureParamEquals(a, b);
        case 'BinaryExpr':
            return binaryExprEquals(a, b);
        case 'UnaryExpr':
            return unaryExprEquals(a, b);
        case 'GroupedExpr':
            return groupedExprEquals(a, b);
        case 'ClosureChain':
            return closureChainEquals(a, b);
        case 'Destructure':
            return destructureEquals(a, b);
        case 'DestructPattern':
            return destructElemEquals(a, b);
        case 'Slice':
            return sliceEquals(a, b);
        case 'Spread':
            return spreadEquals(a, b);
        case 'Capture':
            return (a.name === b.name &&
                a.typeName === b.typeName);
        case 'Break':
        case 'Return':
            return true; // Break and Return nodes have no value property
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
        const stmtA = a.statements[i];
        const stmtB = b.statements[i];
        if (stmtA.type !== stmtB.type)
            return false;
        if (stmtA.type === 'AnnotatedStatement') {
            if (!annotatedStatementEquals(stmtA, stmtB))
                return false;
        }
        else {
            if (!statementEquals(stmtA, stmtB))
                return false;
        }
    }
    return true;
}
function statementEquals(a, b) {
    return expressionEquals(a.expression, b.expression);
}
function annotatedStatementEquals(a, b) {
    if (a.annotations.length !== b.annotations.length)
        return false;
    for (let i = 0; i < a.annotations.length; i++) {
        if (!annotationArgEquals(a.annotations[i], b.annotations[i]))
            return false;
    }
    return statementEquals(a.statement, b.statement);
}
function annotationArgEquals(a, b) {
    if (a.type !== b.type)
        return false;
    if (a.type === 'NamedArg') {
        const bNamed = b;
        if (a.name !== bNamed.name)
            return false;
        return expressionEquals(a.value, bNamed.value);
    }
    else {
        // SpreadArg
        const aSpread = a;
        const bSpread = b;
        return expressionEquals(aSpread.expression, bSpread.expression);
    }
}
function expressionEquals(a, b) {
    return pipeChainEquals(a, b);
}
function pipeChainEquals(a, b) {
    if (!astEquals(a.head, b.head))
        return false;
    if (a.pipes.length !== b.pipes.length)
        return false;
    for (let i = 0; i < a.pipes.length; i++) {
        if (!astEquals(a.pipes[i], b.pipes[i]))
            return false;
    }
    return nullableEquals(a.terminator, b.terminator);
}
function postfixExprEquals(a, b) {
    if (!astEquals(a.primary, b.primary))
        return false;
    if (a.methods.length !== b.methods.length)
        return false;
    for (let i = 0; i < a.methods.length; i++) {
        // Methods array can contain MethodCallNode or InvokeNode
        if (!astEquals(a.methods[i], b.methods[i]))
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
function fieldAccessEquals(a, b) {
    if (a.kind !== b.kind)
        return false;
    switch (a.kind) {
        case 'literal':
            return a.field === b.field;
        case 'variable':
            return a.variableName === b.variableName;
        case 'computed':
            return astEquals(a.expression, b.expression);
        case 'block':
            return astEquals(a.block, b.block);
        case 'alternatives':
            return (a.alternatives.length === b.alternatives.length &&
                a.alternatives.every((alt, i) => alt === b.alternatives[i]));
    }
}
function variableEquals(a, b) {
    if (a.name !== b.name)
        return false;
    if (a.isPipeVar !== b.isPipeVar)
        return false;
    if (a.accessChain.length !== b.accessChain.length)
        return false;
    for (let i = 0; i < a.accessChain.length; i++) {
        if (!propertyAccessEquals(a.accessChain[i], b.accessChain[i]))
            return false;
    }
    return true;
}
function propertyAccessEquals(a, b) {
    // Check if both are bracket access
    const aIsBracket = 'accessKind' in a && a.accessKind === 'bracket';
    const bIsBracket = 'accessKind' in b && b.accessKind === 'bracket';
    if (aIsBracket !== bIsBracket)
        return false;
    if (aIsBracket && bIsBracket) {
        return expressionEquals(a.expression, b.expression);
    }
    // Both are field access
    return fieldAccessEquals(a, b);
}
function functionCallEquals(a, b) {
    if (a.name !== b.name)
        return false;
    return argsListEquals(a.args, b.args);
}
function closureCallEquals(a, b) {
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
function pipeInvokeEquals(a, b) {
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
    if (!nullableEquals(a.input, b.input))
        return false;
    if (!nullableEquals(a.condition, b.condition))
        return false;
    if (!simpleBodyEquals(a.thenBranch, b.thenBranch))
        return false;
    return nullableEquals(a.elseBranch, b.elseBranch);
}
function forLoopEquals(a, b) {
    if (!nullableEquals(a.input, b.input))
        return false;
    return simpleBodyEquals(a.body, b.body);
}
function doWhileLoopEquals(a, b) {
    if (!nullableEquals(a.input, b.input))
        return false;
    if (!simpleBodyEquals(a.condition, b.condition))
        return false;
    return simpleBodyEquals(a.body, b.body);
}
function simpleBodyEquals(a, b) {
    if (a.type !== b.type)
        return false;
    return astEquals(a, b);
}
function binaryExprEquals(a, b) {
    if (a.op !== b.op)
        return false;
    if (!astEquals(a.left, b.left))
        return false;
    return astEquals(a.right, b.right);
}
function unaryExprEquals(a, b) {
    if (a.op !== b.op)
        return false;
    return astEquals(a.operand, b.operand);
}
function groupedExprEquals(a, b) {
    return pipeChainEquals(a.expression, b.expression);
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
function closureEquals(a, b) {
    if (a.params.length !== b.params.length)
        return false;
    for (let i = 0; i < a.params.length; i++) {
        if (!closureParamEquals(a.params[i], b.params[i]))
            return false;
    }
    return simpleBodyEquals(a.body, b.body);
}
function closureParamEquals(a, b) {
    if (a.name !== b.name)
        return false;
    if (a.typeName !== b.typeName)
        return false;
    return nullableEquals(a.defaultValue, b.defaultValue);
}
function closureChainEquals(a, b) {
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
    return nullableEquals(a.nested, b.nested);
}
function sliceEquals(a, b) {
    if (!nullableEquals(a.start, b.start))
        return false;
    if (!nullableEquals(a.stop, b.stop))
        return false;
    if (!nullableEquals(a.step, b.step))
        return false;
    return true;
}
function spreadEquals(a, b) {
    return nullableEquals(a.operand, b.operand);
}
//# sourceMappingURL=equals.js.map