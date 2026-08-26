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
  RecoveryErrorNode,
  BodyNode,
  SliceNode,
  StatementNode,
  StringLiteralNode,
  ListSpreadNode,
  PartialExpressionNode,
  UnaryExprNode,
  ClosureCallNode,
  VariableNode,
  ListLiteralNode,
  DictLiteralNode,
  TupleLiteralNode,
  OrderedLiteralNode,
  DestructNode,
  SpreadArgNode,
  TypeRef,
  FieldArg,
  LiteralNode,
  BoolLiteralNode,
} from '../../types.js';
import { isPipeChainNode } from '../../types.js';
import { throwFatalHostHalt } from './types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../error-registry.js';

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

/**
 * Compare two arrays for structural equality: same length, then element-wise
 * comparison via `cmp`. Returns false on length mismatch before comparing
 * any elements.
 */
function arrayEquals<T>(
  a: readonly T[],
  b: readonly T[],
  cmp: (x: T, y: T) => boolean
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!cmp(a[i] as T, b[i] as T)) return false;
  }
  return true;
}

/** Reusable pair comparator for `arrayEquals(..., astEqualsPair)` call sites. */
const astEqualsPair = (x: ASTNode, y: ASTNode): boolean => astEquals(x, y);

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

    case 'PipeChain': {
      const bNode = b as ExpressionNode;
      // `a.type === b.type` was already checked above, so `bNode` is
      // guaranteed to be a PipeChainNode here. This check is a defensive
      // narrowing that is unreachable in normal execution.
      if (!isPipeChainNode(bNode)) {
        throwFatalHostHalt(
          { fn: 'astEquals' },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Expected matching PipeChain node for equality comparison'
        );
      }
      return pipeChainEquals(a, bNode);
    }

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

    case 'ListSpread':
      return listSpreadEquals(a, b as ListSpreadNode);

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

    case 'Destructure':
      return destructureEquals(a, b as DestructureNode);

    case 'DestructPattern':
      return destructElemEquals(a, b as DestructPatternNode);

    case 'Slice':
      return sliceEquals(a, b as SliceNode);

    case 'ListLiteral':
      return listLiteralEquals(a, b as ListLiteralNode);

    case 'DictLiteral':
      return dictLiteralEquals(a, b as DictLiteralNode);

    case 'TupleLiteral':
      return tupleLiteralEquals(a, b as TupleLiteralNode);

    case 'OrderedLiteral':
      return orderedLiteralEquals(a, b as OrderedLiteralNode);

    case 'Destruct':
      return destructNodeEquals(a, b as DestructNode);

    case 'Capture': {
      const bCapture = b as typeof a;
      if (a.name !== bCapture.name) return false;
      // Compare inlineShape
      const aShape = a.inlineShape;
      const bShape = bCapture.inlineShape;
      if ((aShape === null) !== (bShape === null)) return false;
      if (aShape !== null && bShape !== null) {
        if (!astEquals(aShape, bShape)) return false;
      }
      // Compare typeRef
      const aRef = a.typeRef;
      const bRef = bCapture.typeRef;
      if (aRef === null && bRef === null) return true;
      if (aRef === null || bRef === null) return false;
      if (aRef.kind !== bRef.kind) return false;
      if (aRef.kind === 'dynamic' && bRef.kind === 'dynamic')
        return aRef.varName === bRef.varName;
      if (aRef.kind === 'static' && bRef.kind === 'static')
        return typeRefStaticEquals(aRef, bRef);
      return false;
    }

    case 'Break':
    case 'Return':
    case 'Pass':
      return true; // Break, Return, and Pass nodes have no value property

    case 'Interpolation':
      return expressionEquals(
        a.expression,
        (b as InterpolationNode).expression
      );

    case 'PartialExpression':
      return partialExpressionEquals(a, b as PartialExpressionNode);

    case 'RecoveryError':
      return recoveryErrorEquals(a, b as RecoveryErrorNode);

    default:
      // For any unhandled node types, fall back to false
      return false;
  }
}

function blockEquals(a: BlockNode, b: BlockNode): boolean {
  return arrayEquals(a.statements, b.statements, (stmtA, stmtB) => {
    if (stmtA.type !== stmtB.type) return false;
    if (stmtA.type === 'AnnotatedStatement') {
      return annotatedStatementEquals(stmtA, stmtB as AnnotatedStatementNode);
    }
    return statementEquals(stmtA, stmtB as StatementNode);
  });
}

function statementEquals(a: StatementNode, b: StatementNode): boolean {
  return expressionEquals(a.expression, b.expression);
}

function annotatedStatementEquals(
  a: AnnotatedStatementNode,
  b: AnnotatedStatementNode
): boolean {
  if (!arrayEquals(a.annotations, b.annotations, annotationArgEquals))
    return false;
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
  if (a.type !== b.type) return false;
  if (a.type === 'PartialExpression') {
    return partialExpressionEquals(a, b as PartialExpressionNode);
  }
  // `a.type === b.type` was already checked above, so `b` is guaranteed to
  // be a PipeChainNode here. This check is a defensive narrowing that is
  // unreachable in normal execution.
  if (!isPipeChainNode(b)) {
    throwFatalHostHalt(
      { fn: 'expressionEquals' },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Expected matching PipeChain node for equality comparison'
    );
  }
  return pipeChainEquals(a, b);
}

function partialExpressionEquals(
  a: PartialExpressionNode,
  b: PartialExpressionNode
): boolean {
  if (a.message !== b.message) return false;
  return arrayEquals(a.children, b.children, expressionEquals);
}

function recoveryErrorEquals(
  a: RecoveryErrorNode,
  b: RecoveryErrorNode
): boolean {
  return a.message === b.message && a.text === b.text;
}

function pipeChainEquals(a: PipeChainNode, b: PipeChainNode): boolean {
  if (!astEquals(a.head as ASTNode, b.head as ASTNode)) return false;
  if (!arrayEquals(a.pipes, b.pipes, astEqualsPair)) return false;
  return nullableEquals(a.terminator, b.terminator);
}

function postfixExprEquals(a: PostfixExprNode, b: PostfixExprNode): boolean {
  if (!astEquals(a.primary as ASTNode, b.primary as ASTNode)) return false;
  // Methods array can contain MethodCallNode or InvokeNode
  return arrayEquals(a.methods, b.methods, astEqualsPair);
}

function stringLiteralEquals(
  a: StringLiteralNode,
  b: StringLiteralNode
): boolean {
  if (a.isMultiline !== b.isMultiline) return false;
  return arrayEquals(a.parts, b.parts, (aPart, bPart) => {
    if (typeof aPart === 'string') {
      return typeof bPart === 'string' && aPart === bPart;
    }
    if (typeof bPart === 'string') return false;
    return expressionEquals(aPart.expression, bPart.expression);
  });
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
    case 'annotation':
      return a.key === (b as typeof a).key;
  }
}

function variableEquals(a: VariableNode, b: VariableNode): boolean {
  if (a.name !== b.name) return false;
  if (a.isPipeVar !== b.isPipeVar) return false;
  return arrayEquals(a.accessChain, b.accessChain, propertyAccessEquals);
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
  if (!arrayEquals(a.accessChain, b.accessChain, (x, y) => x === y))
    return false;
  return argsListEquals(a.args, b.args);
}

function methodCallEquals(a: MethodCallNode, b: MethodCallNode): boolean {
  if (a.name !== b.name) return false;
  if (a.hasParens !== b.hasParens) return false;
  return argsListEquals(a.args, b.args);
}

function invokeEquals(a: InvokeNode, b: InvokeNode): boolean {
  return argsListEquals(a.args, b.args);
}

function pipeInvokeEquals(a: PipeInvokeNode, b: PipeInvokeNode): boolean {
  return argsListEquals(a.args, b.args);
}

function argsListEquals(
  a: (ExpressionNode | SpreadArgNode)[],
  b: (ExpressionNode | SpreadArgNode)[]
): boolean {
  return arrayEquals(a, b, (aItem, bItem) => {
    if (aItem.type === 'SpreadArg' || bItem.type === 'SpreadArg') {
      if (aItem.type !== 'SpreadArg' || bItem.type !== 'SpreadArg')
        return false;
      return expressionEquals(aItem.expression, bItem.expression);
    }
    return expressionEquals(aItem, bItem);
  });
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

function listSpreadEquals(a: ListSpreadNode, b: ListSpreadNode): boolean {
  return expressionEquals(a.expression, b.expression);
}

function dictEquals(a: DictNode, b: DictNode): boolean {
  if (!arrayEquals(a.entries, b.entries, dictEntryEquals)) return false;
  return nullableEquals(a.defaultValue, b.defaultValue);
}

function dictEntryEquals(a: DictEntryNode, b: DictEntryNode): boolean {
  // Compare keys based on type
  if (typeof a.key === 'string' && typeof b.key === 'string') {
    // String keys: compare with ===
    if (a.key !== b.key) return false;
  } else if (typeof a.key === 'number' && typeof b.key === 'number') {
    // Number keys: compare with ===
    if (a.key !== b.key) return false;
  } else if (typeof a.key === 'boolean' && typeof b.key === 'boolean') {
    // Boolean keys: compare with ===
    if (a.key !== b.key) return false;
  } else if (typeof a.key === 'object' && typeof b.key === 'object') {
    // Check for DictKeyVariable or DictKeyComputed
    if ('kind' in a.key || 'kind' in b.key) {
      // Variable/computed keys not supported in equals yet
      return false;
    }
    // ListLiteralNode keys: compare element-wise
    const aKey = a.key as ListLiteralNode;
    const bKey = b.key as ListLiteralNode;
    if (aKey.type !== bKey.type) return false;
    if (!arrayEquals(aKey.elements, bKey.elements, astEquals)) return false;
  } else {
    // Different key types are not equal
    return false;
  }
  return expressionEquals(a.value, b.value);
}

function closureEquals(a: ClosureNode, b: ClosureNode): boolean {
  if (!arrayEquals(a.params, b.params, closureParamEquals)) return false;
  return simpleBodyEquals(a.body, b.body);
}

function closureParamEquals(a: ClosureParamNode, b: ClosureParamNode): boolean {
  if (a.name !== b.name) return false;
  // Compare typeRef: both null, or same kind and same value
  if (a.typeRef === null && b.typeRef === null) {
    // both untyped — ok
  } else if (a.typeRef === null || b.typeRef === null) {
    return false;
  } else if (!typeRefEquals(a.typeRef, b.typeRef)) {
    return false;
  }
  return nullableEquals(a.defaultValue, b.defaultValue);
}

function destructureEquals(a: DestructureNode, b: DestructureNode): boolean {
  return arrayEquals(a.elements, b.elements, destructElemEquals);
}

function destructElemEquals(
  a: DestructPatternNode,
  b: DestructPatternNode
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.name !== b.name) return false;
  if (a.key !== b.key) return false;
  // Compare typeRef: delegate to typeRefEquals for all kinds (static, dynamic, union)
  if (a.typeRef === null && b.typeRef === null) {
    // both untyped — ok
  } else if (a.typeRef === null || b.typeRef === null) {
    return false;
  } else if (!typeRefEquals(a.typeRef, b.typeRef)) {
    return false;
  }
  return nullableEquals(a.nested, b.nested);
}

function sliceEquals(a: SliceNode, b: SliceNode): boolean {
  if (!nullableEquals(a.start, b.start)) return false;
  if (!nullableEquals(a.stop, b.stop)) return false;
  if (!nullableEquals(a.step, b.step)) return false;
  return true;
}

function listLiteralEquals(a: ListLiteralNode, b: ListLiteralNode): boolean {
  return arrayEquals(a.elements, b.elements, astEqualsPair);
}

function dictLiteralEquals(a: DictLiteralNode, b: DictLiteralNode): boolean {
  return arrayEquals(a.entries, b.entries, dictEntryEquals);
}

function tupleLiteralEquals(a: TupleLiteralNode, b: TupleLiteralNode): boolean {
  return arrayEquals(a.elements, b.elements, astEqualsPair);
}

function orderedLiteralEquals(
  a: OrderedLiteralNode,
  b: OrderedLiteralNode
): boolean {
  return arrayEquals(a.entries, b.entries, dictEntryEquals);
}

function destructNodeEquals(a: DestructNode, b: DestructNode): boolean {
  return arrayEquals(a.elements, b.elements, destructElemEquals);
}

/**
 * Compare two static TypeRef variants for structural equality.
 * Recursively compares args arrays, including named/positional forms.
 */
function typeRefStaticEquals(
  a: TypeRef & { kind: 'static' },
  b: TypeRef & { kind: 'static' }
): boolean {
  if (a.typeName !== b.typeName) return false;
  return typeRefArgListEquals(a.args, b.args);
}

/**
 * Compare two optional FieldArg arrays for structural equality.
 */
function typeRefArgListEquals(
  a: FieldArg[] | undefined,
  b: FieldArg[] | undefined
): boolean {
  const aArgs = a ?? [];
  const bArgs = b ?? [];
  return arrayEquals(aArgs, bArgs, (aArg, bArg) => {
    if (aArg.name !== bArg.name) return false;
    if (!typeRefEquals(aArg.value, bArg.value)) return false;
    if (!literalNodeEquals(aArg.defaultValue, bArg.defaultValue)) return false;
    return fieldAnnotationsEquals(aArg.annotations, bArg.annotations);
  });
}

/**
 * Compare two optional FieldArg annotation arrays for structural equality.
 * Both-absent and both-empty are equivalent (both return true).
 */
function fieldAnnotationsEquals(
  a: AnnotationArg[] | undefined,
  b: AnnotationArg[] | undefined
): boolean {
  const aAnns = a ?? [];
  const bAnns = b ?? [];
  return arrayEquals(aAnns, bAnns, annotationArgEquals);
}

/**
 * Compare two TypeRef values for structural equality.
 */
function typeRefEquals(a: TypeRef, b: TypeRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'dynamic' && b.kind === 'dynamic')
    return a.varName === b.varName;
  if (a.kind === 'static' && b.kind === 'static')
    return typeRefStaticEquals(a, b);
  if (a.kind === 'union' && b.kind === 'union') {
    return arrayEquals(a.members, b.members, typeRefEquals);
  }
  return false;
}

/**
 * Compare two optional LiteralNode values for structural equality.
 * Both-undefined returns true. One-undefined returns false.
 * Complex nodes (ListLiteral, Dict, Closure) return false defensively.
 */
function literalNodeEquals(
  a: LiteralNode | undefined,
  b: LiteralNode | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.type !== b.type) return false;

  switch (a.type) {
    case 'NumberLiteral':
      return a.value === (b as NumberLiteralNode).value;
    case 'BoolLiteral':
      return a.value === (b as BoolLiteralNode).value;
    case 'StringLiteral': {
      const bStr = b as StringLiteralNode;
      if (a.parts.length !== 1 || bStr.parts.length !== 1) return false;
      return a.parts[0] === bStr.parts[0];
    }
    case 'ListLiteral':
    case 'Dict':
    case 'Closure':
      return false;
    default:
      return false;
  }
}
