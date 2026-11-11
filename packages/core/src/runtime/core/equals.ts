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
  InvokeNode,
  PipeInvokeNode,
  MethodCallNode,
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
  ExistenceCheck,
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
} from '../../types.js';
import { isPipeChainNode } from '../../types.js';
import { throwFatalHostHalt } from './types/halt.js';
import { isObjectRecord } from './types/guards.js';
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
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) {
      if (x !== y) return false;
      continue;
    }
    if (!cmp(x, y)) return false;
  }
  return true;
}

/** Reusable pair comparator for `arrayEquals(..., astEqualsPair)` call sites. */
const astEqualsPair = (x: ASTNode, y: ASTNode): boolean => astEquals(x, y);

/**
 * Narrow `b` to the variant of its union whose `type` matches `a`'s.
 * Replaces casts after a same-type comparison.
 */
function sameNodeType<
  T extends { readonly type: string },
  U extends { readonly type: string },
>(a: T, b: U): b is Extract<U, { readonly type: T['type'] }> {
  return a.type === b.type;
}

export function astEquals(a: ASTNode, b: ASTNode): boolean {
  // Different node types are never equal
  if (a.type !== b.type) return false;

  switch (a.type) {
    case 'Block':
      return sameNodeType(a, b) && blockEquals(a, b);

    case 'Statement':
      return sameNodeType(a, b) && statementEquals(a, b);

    case 'AnnotatedStatement':
      return sameNodeType(a, b) && annotatedStatementEquals(a, b);

    case 'PipeChain': {
      // The top-level type check already guarantees matching types; this
      // narrowing is defensive and unreachable in normal execution.
      if (!sameNodeType(a, b)) {
        throwFatalHostHalt(
          { fn: 'astEquals' },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Expected matching PipeChain node for equality comparison'
        );
      }
      return pipeChainEquals(a, b);
    }

    case 'PostfixExpr':
      return sameNodeType(a, b) && postfixExprEquals(a, b);

    case 'StringLiteral':
      return sameNodeType(a, b) && stringLiteralEquals(a, b);

    case 'NumberLiteral':
      return sameNodeType(a, b) && a.value === b.value;

    case 'BoolLiteral':
      return sameNodeType(a, b) && a.value === b.value;

    case 'Variable':
      return sameNodeType(a, b) && variableEquals(a, b);

    case 'HostCall':
      return sameNodeType(a, b) && functionCallEquals(a, b);

    case 'ClosureCall':
      return sameNodeType(a, b) && closureCallEquals(a, b);

    case 'MethodCall':
      return sameNodeType(a, b) && methodCallEquals(a, b);

    case 'Invoke':
      return sameNodeType(a, b) && invokeEquals(a, b);

    case 'IndexAccess':
      return sameNodeType(a, b) && expressionEquals(a.index, b.index);

    case 'AnnotationAccess':
      return sameNodeType(a, b) && a.key === b.key;

    case 'PipeInvoke':
      return sameNodeType(a, b) && pipeInvokeEquals(a, b);

    case 'Conditional':
      return sameNodeType(a, b) && conditionalEquals(a, b);

    case 'WhileLoop':
      return sameNodeType(a, b) && whileLoopEquals(a, b);

    case 'DoWhileLoop':
      return sameNodeType(a, b) && doWhileLoopEquals(a, b);

    case 'ListSpread':
      return sameNodeType(a, b) && listSpreadEquals(a, b);

    case 'Dict':
      return sameNodeType(a, b) && dictEquals(a, b);

    case 'DictEntry':
      return sameNodeType(a, b) && dictEntryEquals(a, b);

    case 'Closure':
      return sameNodeType(a, b) && closureEquals(a, b);

    case 'ClosureParam':
      return sameNodeType(a, b) && closureParamEquals(a, b);

    case 'BinaryExpr':
      return sameNodeType(a, b) && binaryExprEquals(a, b);

    case 'UnaryExpr':
      return sameNodeType(a, b) && unaryExprEquals(a, b);

    case 'GroupedExpr':
      return sameNodeType(a, b) && groupedExprEquals(a, b);

    case 'Destructure':
      return sameNodeType(a, b) && destructureEquals(a, b);

    case 'DestructPattern':
      return sameNodeType(a, b) && destructElemEquals(a, b);

    case 'Slice':
      return sameNodeType(a, b) && sliceEquals(a, b);

    case 'ListLiteral':
      return sameNodeType(a, b) && listLiteralEquals(a, b);

    case 'DictLiteral':
      return sameNodeType(a, b) && dictLiteralEquals(a, b);

    case 'TupleLiteral':
      return sameNodeType(a, b) && tupleLiteralEquals(a, b);

    case 'OrderedLiteral':
      return sameNodeType(a, b) && orderedLiteralEquals(a, b);

    case 'Destruct':
      return sameNodeType(a, b) && destructNodeEquals(a, b);

    case 'Capture': {
      if (!sameNodeType(a, b)) return false;
      if (a.name !== b.name) return false;
      // Compare inlineShape
      const aShape = a.inlineShape;
      const bShape = b.inlineShape;
      if ((aShape === null) !== (bShape === null)) return false;
      if (aShape !== null && bShape !== null) {
        if (!astEquals(aShape, bShape)) return false;
      }
      // Compare typeRef
      const aRef = a.typeRef;
      const bRef = b.typeRef;
      if (aRef === null && bRef === null) return true;
      if (aRef === null || bRef === null) return false;
      return typeRefEquals(aRef, bRef);
    }

    case 'Break':
    case 'Return':
    case 'Pass':
      return true; // Break, Return, and Pass nodes have no value property

    case 'Interpolation':
      return sameNodeType(a, b) && expressionEquals(a.expression, b.expression);

    case 'PartialExpression':
      return sameNodeType(a, b) && partialExpressionEquals(a, b);

    case 'RecoveryError':
      return sameNodeType(a, b) && recoveryErrorEquals(a, b);

    default:
      // Node kinds without a dedicated comparator compare field by field.
      return structuralNodeEquals(a, b);
  }
}

/**
 * Compare two nodes of the same kind field by field, ignoring `span`.
 * Nested nodes recurse through astEquals, so kinds with a dedicated
 * comparator keep using it. A field set to undefined equals a missing one.
 */
function structuralNodeEquals(a: ASTNode, b: ASTNode): boolean {
  if (!isObjectRecord(a) || !isObjectRecord(b)) return false;
  return fieldsEqual(a, b);
}

function fieldsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === 'span') continue;
    if (!structuralValueEquals(a[key], b[key])) return false;
  }
  return true;
}

/** Duck-type check: a string `type` tag plus a `span` marks an AST node. */
function isASTNodeLike(value: object): value is ASTNode {
  return 'span' in value && 'type' in value && typeof value.type === 'string';
}

function structuralValueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return arrayEquals(a, b, structuralValueEquals);
  }
  const aIsNode = isASTNodeLike(a);
  const bIsNode = isASTNodeLike(b);
  if (aIsNode && bIsNode) return astEquals(a, b);
  if (aIsNode || bIsNode) return false;
  if (!isObjectRecord(a) || !isObjectRecord(b)) return false;
  return fieldsEqual(a, b);
}

function blockEquals(a: BlockNode, b: BlockNode): boolean {
  return arrayEquals(a.statements, b.statements, (stmtA, stmtB) => {
    if (stmtA.type === 'AnnotatedStatement') {
      return (
        sameNodeType(stmtA, stmtB) && annotatedStatementEquals(stmtA, stmtB)
      );
    }
    return sameNodeType(stmtA, stmtB) && statementEquals(stmtA, stmtB);
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
  if (a.type === 'NamedArg') {
    if (!sameNodeType(a, b)) return false;
    if (a.name !== b.name) return false;
    return expressionEquals(a.value, b.value);
  }
  // SpreadArg
  return sameNodeType(a, b) && expressionEquals(a.expression, b.expression);
}

function expressionEquals(a: ExpressionNode, b: ExpressionNode): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'PartialExpression') {
    return sameNodeType(a, b) && partialExpressionEquals(a, b);
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
  if (!astEquals(a.head, b.head)) return false;
  if (!arrayEquals(a.pipes, b.pipes, astEqualsPair)) return false;
  return nullableEquals(a.terminator, b.terminator);
}

function postfixExprEquals(a: PostfixExprNode, b: PostfixExprNode): boolean {
  if (!astEquals(a.primary, b.primary)) return false;
  // Methods array can contain MethodCallNode or InvokeNode
  if (!arrayEquals(a.methods, b.methods, astEqualsPair)) return false;
  if (!nullableEquals(a.defaultValue, b.defaultValue)) return false;
  return existenceCheckEquals(
    a.existenceCheck ?? null,
    b.existenceCheck ?? null
  );
}

function existenceCheckEquals(
  a: ExistenceCheck | null,
  b: ExistenceCheck | null
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.finalAccess === null && b.finalAccess !== null) return false;
  if (a.finalAccess !== null && b.finalAccess === null) return false;
  if (
    a.finalAccess !== null &&
    b.finalAccess !== null &&
    !fieldAccessEquals(a.finalAccess, b.finalAccess)
  ) {
    return false;
  }
  if (a.typeRef === null && b.typeRef === null) return true;
  if (a.typeRef === null || b.typeRef === null) return false;
  return typeRefEquals(a.typeRef, b.typeRef);
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
      return b.kind === 'literal' && a.field === b.field;
    case 'variable':
      return b.kind === 'variable' && a.variableName === b.variableName;
    case 'computed':
      return b.kind === 'computed' && astEquals(a.expression, b.expression);
    case 'block':
      return b.kind === 'block' && astEquals(a.block, b.block);
    case 'alternatives':
      return (
        b.kind === 'alternatives' &&
        a.alternatives.length === b.alternatives.length &&
        a.alternatives.every((alt, i) => alt === b.alternatives[i])
      );
    case 'annotation':
      return b.kind === 'annotation' && a.key === b.key;
  }
  return throwFatalHostHalt(
    { fn: 'fieldAccessEquals' },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'Unhandled field access kind for equality comparison'
  );
}

function variableEquals(a: VariableNode, b: VariableNode): boolean {
  if (a.name !== b.name) return false;
  if (a.isPipeVar !== b.isPipeVar) return false;
  if (!arrayEquals(a.accessChain, b.accessChain, propertyAccessEquals)) {
    return false;
  }
  if (!nullableEquals(a.defaultValue, b.defaultValue)) return false;
  return existenceCheckEquals(a.existenceCheck, b.existenceCheck);
}

function propertyAccessEquals(a: PropertyAccess, b: PropertyAccess): boolean {
  // Bracket access carries `accessKind`; field access never does.
  const aIsBracket = 'accessKind' in a;
  const bIsBracket = 'accessKind' in b;
  if (aIsBracket && bIsBracket) {
    return expressionEquals(a.expression, b.expression);
  }
  if (aIsBracket || bIsBracket) return false;

  // Both are field access
  return fieldAccessEquals(a, b);
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

/** Loop options such as `limit` are annotations; absent equals empty. */
function loopAnnotationsEqual(
  a: AnnotationArg[] | undefined,
  b: AnnotationArg[] | undefined
): boolean {
  return arrayEquals(a ?? [], b ?? [], annotationArgEquals);
}

function whileLoopEquals(a: WhileLoopNode, b: WhileLoopNode): boolean {
  if (!loopAnnotationsEqual(a.annotations, b.annotations)) return false;
  if (!astEquals(a.condition, b.condition)) return false;
  return simpleBodyEquals(a.body, b.body);
}

function doWhileLoopEquals(a: DoWhileLoopNode, b: DoWhileLoopNode): boolean {
  if (!loopAnnotationsEqual(a.annotations, b.annotations)) return false;
  if (!nullableEquals(a.input, b.input)) return false;
  if (!simpleBodyEquals(a.condition, b.condition)) return false;
  return simpleBodyEquals(a.body, b.body);
}

function simpleBodyEquals(a: BodyNode, b: BodyNode): boolean {
  if (a.type !== b.type) return false;
  return astEquals(a, b);
}

function binaryExprEquals(a: BinaryExprNode, b: BinaryExprNode): boolean {
  if (a.op !== b.op) return false;
  if (!astEquals(a.left, b.left)) return false;
  return astEquals(a.right, b.right);
}

function unaryExprEquals(a: UnaryExprNode, b: UnaryExprNode): boolean {
  if (a.op !== b.op) return false;
  return astEquals(a.operand, b.operand);
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
      if (!('kind' in a.key) || !('kind' in b.key)) return false;
      if (a.key.kind !== b.key.kind) return false;
      if (a.key.kind === 'variable' && b.key.kind === 'variable') {
        if (a.key.variableName !== b.key.variableName) return false;
      } else if (a.key.kind === 'computed' && b.key.kind === 'computed') {
        if (!expressionEquals(a.key.expression, b.key.expression)) return false;
      }
      return expressionEquals(a.value, b.value);
    }
    // ListLiteralNode keys: compare element-wise
    const aKey = a.key;
    const bKey = b.key;
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
  if (!returnTypeTargetEquals(a.returnTypeTarget, b.returnTypeTarget))
    return false;
  return simpleBodyEquals(a.body, b.body);
}

function returnTypeTargetEquals(
  a: ClosureNode['returnTypeTarget'],
  b: ClosureNode['returnTypeTarget']
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if ('type' in a || 'type' in b) {
    if (!('type' in a) || !('type' in b)) return false;
    return astEquals(a, b);
  }
  return typeRefEquals(a, b);
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
  if (!nullableEquals(a.defaultValue, b.defaultValue)) return false;
  return fieldAnnotationsEquals(a.annotations, b.annotations);
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
  if (!nullableEquals(a.defaultValue, b.defaultValue)) return false;
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
  if (a.kind === 'literal' && b.kind === 'literal') return a.value === b.value;
  return false;
}

/**
 * Compare two optional LiteralNode values for structural equality.
 * Both-undefined returns true. One-undefined returns false.
 * Every LiteralNode member delegates to its structural comparator; the
 * switch has no default so a new member fails to compile.
 */
function literalNodeEquals(
  a: LiteralNode | undefined,
  b: LiteralNode | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;

  switch (a.type) {
    case 'StringLiteral':
      return sameNodeType(a, b) && stringLiteralEquals(a, b);
    case 'NumberLiteral':
      return sameNodeType(a, b) && a.value === b.value;
    case 'BoolLiteral':
      return sameNodeType(a, b) && a.value === b.value;
    case 'ListLiteral':
      return sameNodeType(a, b) && listLiteralEquals(a, b);
    case 'Dict':
      return sameNodeType(a, b) && dictEquals(a, b);
    case 'Closure':
      return sameNodeType(a, b) && closureEquals(a, b);
    case 'AtomLiteral':
      return sameNodeType(a, b) && a.name === b.name;
    case 'DictLiteral':
      return sameNodeType(a, b) && dictLiteralEquals(a, b);
    case 'TupleLiteral':
      return sameNodeType(a, b) && tupleLiteralEquals(a, b);
    case 'OrderedLiteral':
      return sameNodeType(a, b) && orderedLiteralEquals(a, b);
    case 'RecoveryError':
      return sameNodeType(a, b) && recoveryErrorEquals(a, b);
  }
  // Compile error here when a LiteralNode member lacks a case above.
  const unhandled: never = a;
  return unhandled;
}
