/**
 * AST Structural Equality
 *
 * Compares AST nodes for structural equality, ignoring source locations.
 * Used for closure equality: two closures with identical structure are equal.
 */

import type {
  AnnotatedStatementNode,
  AnnotationArg,
  ASTNode,
  BinaryExprNode,
  BlockNode,
  BracketAccess,
  ConditionalNode,
  DestructPatternNode,
  DestructureNode,
  DictEntryNode,
  DictNode,
  DoWhileLoopNode,
  ExpressionNode,
  FieldAccess,
  WhileLoopNode,
  ClosureParamNode,
  HostCallNode,
  ClosureNode,
  GroupedExprNode,
  InterpolationNode,
  InvokeNode,
  PipeInvokeNode,
  MethodCallNode,
  NumberLiteralNode,
  PipeChainNode,
  PostfixExprNode,
  PropertyAccess,
  ClosureChainNode,
  BodyNode,
  SliceNode,
  SpreadNode,
  StatementNode,
  StringLiteralNode,
  TupleNode,
  UnaryExprNode,
  ClosureCallNode,
  VariableNode,
} from '../../types.js';

/**
 * Compare two AST nodes for structural equality.
 * Ignores source locations (span) - only compares structure and values.
 */

/**
 * Helper to compare two nullable values for structural equality.
 * Returns false if nullability differs, otherwise compares with astEquals.
 */
function nullableEquals<T extends ASTNode>(a: T | null, b: T | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return astEquals(a, b);
}

export function astEquals(a: ASTNode, b: ASTNode): boolean {
  // Different node types are never equal
  if (a.type !== b.type) return false;

  switch (a.type) {
    case 'Block':
      return blockEquals(a, b as BlockNode);

    case 'Statement':
      return statementEquals(a, b as StatementNode);

    case 'AnnotatedStatement':
      return annotatedStatementEquals(a, b as AnnotatedStatementNode);

    case 'PipeChain':
      return pipeChainEquals(a, b as PipeChainNode);

    case 'PostfixExpr':
      return postfixExprEquals(a, b as PostfixExprNode);

    case 'StringLiteral':
      return stringLiteralEquals(a, b as StringLiteralNode);

    case 'NumberLiteral':
      return (a as NumberLiteralNode).value === (b as NumberLiteralNode).value;

    case 'BoolLiteral':
      return a.value === (b as typeof a).value;

    case 'Variable':
      return variableEquals(a, b as VariableNode);

    case 'HostCall':
      return functionCallEquals(a, b as HostCallNode);

    case 'ClosureCall':
      return closureCallEquals(a, b as ClosureCallNode);

    case 'MethodCall':
      return methodCallEquals(a, b as MethodCallNode);

    case 'Invoke':
      return invokeEquals(a, b as InvokeNode);

    case 'PipeInvoke':
      return pipeInvokeEquals(a, b as PipeInvokeNode);

    case 'Conditional':
      return conditionalEquals(a, b as ConditionalNode);

    case 'WhileLoop':
      return whileLoopEquals(a, b as WhileLoopNode);

    case 'DoWhileLoop':
      return doWhileLoopEquals(a, b as DoWhileLoopNode);

    case 'Tuple':
      return tupleEquals(a, b as TupleNode);

    case 'Dict':
      return dictEquals(a, b as DictNode);

    case 'DictEntry':
      return dictEntryEquals(a, b as DictEntryNode);

    case 'Closure':
      return closureEquals(a, b as ClosureNode);

    case 'ClosureParam':
      return closureParamEquals(a, b as ClosureParamNode);

    case 'BinaryExpr':
      return binaryExprEquals(a, b as BinaryExprNode);

    case 'UnaryExpr':
      return unaryExprEquals(a, b as UnaryExprNode);

    case 'GroupedExpr':
      return groupedExprEquals(a, b as GroupedExprNode);

    case 'ClosureChain':
      return closureChainEquals(a, b as ClosureChainNode);

    case 'Destructure':
      return destructureEquals(a, b as DestructureNode);

    case 'DestructPattern':
      return destructElemEquals(a, b as DestructPatternNode);

    case 'Slice':
      return sliceEquals(a, b as SliceNode);

    case 'Spread':
      return spreadEquals(a, b as SpreadNode);

    case 'Capture':
      return (
        a.name === (b as typeof a).name &&
        a.typeName === (b as typeof a).typeName
      );

    case 'Break':
    case 'Return':
      return true; // Break and Return nodes have no value property

    case 'Interpolation':
      return expressionEquals(
        a.expression,
        (b as InterpolationNode).expression
      );

    default:
      // For any unhandled node types, fall back to false
      return false;
  }
}

function blockEquals(a: BlockNode, b: BlockNode): boolean {
  if (a.statements.length !== b.statements.length) return false;
  for (let i = 0; i < a.statements.length; i++) {
    const stmtA = a.statements[i]!;
    const stmtB = b.statements[i]!;
    if (stmtA.type !== stmtB.type) return false;
    if (stmtA.type === 'AnnotatedStatement') {
      if (!annotatedStatementEquals(stmtA, stmtB as AnnotatedStatementNode))
        return false;
    } else {
      if (!statementEquals(stmtA, stmtB as StatementNode)) return false;
    }
  }
  return true;
}

function statementEquals(a: StatementNode, b: StatementNode): boolean {
  return expressionEquals(a.expression, b.expression);
}

function annotatedStatementEquals(
  a: AnnotatedStatementNode,
  b: AnnotatedStatementNode
): boolean {
  if (a.annotations.length !== b.annotations.length) return false;
  for (let i = 0; i < a.annotations.length; i++) {
    if (!annotationArgEquals(a.annotations[i]!, b.annotations[i]!))
      return false;
  }
  return statementEquals(a.statement, b.statement);
}

function annotationArgEquals(a: AnnotationArg, b: AnnotationArg): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'NamedArg') {
    const bNamed = b as typeof a;
    if (a.name !== bNamed.name) return false;
    return expressionEquals(a.value, bNamed.value);
  } else {
    // SpreadArg
    const aSpread = a;
    const bSpread = b as typeof aSpread;
    return expressionEquals(aSpread.expression, bSpread.expression);
  }
}

function expressionEquals(a: ExpressionNode, b: ExpressionNode): boolean {
  return pipeChainEquals(a, b);
}

function pipeChainEquals(a: PipeChainNode, b: PipeChainNode): boolean {
  if (!astEquals(a.head as ASTNode, b.head as ASTNode)) return false;
  if (a.pipes.length !== b.pipes.length) return false;
  for (let i = 0; i < a.pipes.length; i++) {
    if (!astEquals(a.pipes[i]! as ASTNode, b.pipes[i]! as ASTNode))
      return false;
  }
  return nullableEquals(a.terminator, b.terminator);
}

function postfixExprEquals(a: PostfixExprNode, b: PostfixExprNode): boolean {
  if (!astEquals(a.primary as ASTNode, b.primary as ASTNode)) return false;
  if (a.methods.length !== b.methods.length) return false;
  for (let i = 0; i < a.methods.length; i++) {
    // Methods array can contain MethodCallNode or InvokeNode
    if (!astEquals(a.methods[i]! as ASTNode, b.methods[i]! as ASTNode))
      return false;
  }
  return true;
}

function stringLiteralEquals(
  a: StringLiteralNode,
  b: StringLiteralNode
): boolean {
  if (a.isMultiline !== b.isMultiline) return false;
  if (a.parts.length !== b.parts.length) return false;
  for (let i = 0; i < a.parts.length; i++) {
    const aPart = a.parts[i]!;
    const bPart = b.parts[i]!;
    if (typeof aPart === 'string') {
      if (typeof bPart !== 'string' || aPart !== bPart) return false;
    } else {
      if (typeof bPart === 'string') return false;
      if (!expressionEquals(aPart.expression, bPart.expression)) return false;
    }
  }
  return true;
}

function fieldAccessEquals(a: FieldAccess, b: FieldAccess): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'literal':
      return a.field === (b as typeof a).field;
    case 'variable':
      return a.variableName === (b as typeof a).variableName;
    case 'computed':
      return astEquals(
        a.expression as ASTNode,
        (b as typeof a).expression as ASTNode
      );
    case 'block':
      return astEquals(a.block as ASTNode, (b as typeof a).block as ASTNode);
    case 'alternatives':
      return (
        a.alternatives.length === (b as typeof a).alternatives.length &&
        a.alternatives.every(
          (alt, i) => alt === (b as typeof a).alternatives[i]
        )
      );
  }
}

function variableEquals(a: VariableNode, b: VariableNode): boolean {
  if (a.name !== b.name) return false;
  if (a.isPipeVar !== b.isPipeVar) return false;
  if (a.accessChain.length !== b.accessChain.length) return false;
  for (let i = 0; i < a.accessChain.length; i++) {
    if (!propertyAccessEquals(a.accessChain[i]!, b.accessChain[i]!))
      return false;
  }
  return true;
}

function propertyAccessEquals(a: PropertyAccess, b: PropertyAccess): boolean {
  // Check if both are bracket access
  const aIsBracket = 'accessKind' in a && a.accessKind === 'bracket';
  const bIsBracket = 'accessKind' in b && b.accessKind === 'bracket';

  if (aIsBracket !== bIsBracket) return false;

  if (aIsBracket && bIsBracket) {
    return expressionEquals(
      (a as BracketAccess).expression,
      (b as BracketAccess).expression
    );
  }

  // Both are field access
  return fieldAccessEquals(a as FieldAccess, b as FieldAccess);
}

function functionCallEquals(a: HostCallNode, b: HostCallNode): boolean {
  if (a.name !== b.name) return false;
  return argsListEquals(a.args, b.args);
}

function closureCallEquals(a: ClosureCallNode, b: ClosureCallNode): boolean {
  if (a.name !== b.name) return false;
  if (a.accessChain.length !== b.accessChain.length) return false;
  for (let i = 0; i < a.accessChain.length; i++) {
    if (a.accessChain[i] !== b.accessChain[i]) return false;
  }
  return argsListEquals(a.args, b.args);
}

function methodCallEquals(a: MethodCallNode, b: MethodCallNode): boolean {
  if (a.name !== b.name) return false;
  return argsListEquals(a.args, b.args);
}

function invokeEquals(a: InvokeNode, b: InvokeNode): boolean {
  return argsListEquals(a.args, b.args);
}

function pipeInvokeEquals(a: PipeInvokeNode, b: PipeInvokeNode): boolean {
  return argsListEquals(a.args, b.args);
}

function argsListEquals(a: ExpressionNode[], b: ExpressionNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!expressionEquals(a[i]!, b[i]!)) return false;
  }
  return true;
}

function conditionalEquals(a: ConditionalNode, b: ConditionalNode): boolean {
  if (!nullableEquals(a.input, b.input)) return false;
  if (!nullableEquals(a.condition, b.condition)) return false;
  if (!simpleBodyEquals(a.thenBranch, b.thenBranch)) return false;
  return nullableEquals(a.elseBranch, b.elseBranch);
}

function whileLoopEquals(a: WhileLoopNode, b: WhileLoopNode): boolean {
  if (!astEquals(a.condition as ASTNode, b.condition as ASTNode)) return false;
  return simpleBodyEquals(a.body, b.body);
}

function doWhileLoopEquals(a: DoWhileLoopNode, b: DoWhileLoopNode): boolean {
  if (!nullableEquals(a.input, b.input)) return false;
  if (!simpleBodyEquals(a.condition, b.condition)) return false;
  return simpleBodyEquals(a.body, b.body);
}

function simpleBodyEquals(a: BodyNode, b: BodyNode): boolean {
  if (a.type !== b.type) return false;
  return astEquals(a as ASTNode, b as ASTNode);
}

function binaryExprEquals(a: BinaryExprNode, b: BinaryExprNode): boolean {
  if (a.op !== b.op) return false;
  if (!astEquals(a.left as ASTNode, b.left as ASTNode)) return false;
  return astEquals(a.right as ASTNode, b.right as ASTNode);
}

function unaryExprEquals(a: UnaryExprNode, b: UnaryExprNode): boolean {
  if (a.op !== b.op) return false;
  return astEquals(a.operand as ASTNode, b.operand as ASTNode);
}

function groupedExprEquals(a: GroupedExprNode, b: GroupedExprNode): boolean {
  return pipeChainEquals(a.expression, b.expression);
}

function tupleEquals(a: TupleNode, b: TupleNode): boolean {
  return argsListEquals(a.elements, b.elements);
}

function dictEquals(a: DictNode, b: DictNode): boolean {
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    if (!dictEntryEquals(a.entries[i]!, b.entries[i]!)) return false;
  }
  if (!nullableEquals(a.defaultValue, b.defaultValue)) return false;
  return true;
}

function dictEntryEquals(a: DictEntryNode, b: DictEntryNode): boolean {
  // Handle both string keys and TupleNode keys
  if (typeof a.key === 'string' && typeof b.key === 'string') {
    if (a.key !== b.key) return false;
  } else if (typeof a.key !== 'string' && typeof b.key !== 'string') {
    if (!tupleEquals(a.key, b.key)) return false;
  } else {
    return false; // One string, one tuple - not equal
  }
  return expressionEquals(a.value, b.value);
}

function closureEquals(a: ClosureNode, b: ClosureNode): boolean {
  if (a.params.length !== b.params.length) return false;
  for (let i = 0; i < a.params.length; i++) {
    if (!closureParamEquals(a.params[i]!, b.params[i]!)) return false;
  }
  return simpleBodyEquals(a.body, b.body);
}

function closureParamEquals(a: ClosureParamNode, b: ClosureParamNode): boolean {
  if (a.name !== b.name) return false;
  if (a.typeName !== b.typeName) return false;
  return nullableEquals(a.defaultValue, b.defaultValue);
}

function closureChainEquals(a: ClosureChainNode, b: ClosureChainNode): boolean {
  return expressionEquals(a.target, b.target);
}

function destructureEquals(a: DestructureNode, b: DestructureNode): boolean {
  if (a.elements.length !== b.elements.length) return false;
  for (let i = 0; i < a.elements.length; i++) {
    if (!destructElemEquals(a.elements[i]!, b.elements[i]!)) return false;
  }
  return true;
}

function destructElemEquals(
  a: DestructPatternNode,
  b: DestructPatternNode
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.name !== b.name) return false;
  if (a.key !== b.key) return false;
  if (a.typeName !== b.typeName) return false;
  return nullableEquals(a.nested, b.nested);
}

function sliceEquals(a: SliceNode, b: SliceNode): boolean {
  if (!nullableEquals(a.start, b.start)) return false;
  if (!nullableEquals(a.stop, b.stop)) return false;
  if (!nullableEquals(a.step, b.step)) return false;
  return true;
}

function spreadEquals(a: SpreadNode, b: SpreadNode): boolean {
  return nullableEquals(a.operand, b.operand);
}
