/**
 * AST traversal for the rules engine.
 * Recursive enter/exit visitor mirroring the AST shape defined in
 * @rcrsr/rill's `ast-unions.ts` NodeType union. Recovery/partial nodes
 * (RecoveryErrorNode, PartialExpressionNode) are traversed without special
 * casing so a malformed region never aborts the walk.
 *
 * This is not a byte-for-byte port of rill-cli's visitor.ts. It diverges
 * in three places, all required by the current core AST schema:
 * - `PartialExpression` (below): rill-cli's visitor predates this node
 *   type and has no case for it; children are visited via `node.children`.
 * - `PostfixExpr.defaultValue`: also descended into. Absent from
 *   rill-cli's `PostfixExpr` case, but present on the current
 *   `PostfixExprNode` shape; skipping it would miss captures nested inside
 *   a postfix default-value expression.
 * - `Dict.defaultValue`: also descended into, for the same reason as
 *   `PostfixExpr.defaultValue` above (absent from rill-cli's `Dict` case,
 *   present on the current `DictNode` shape).
 */

import type { ASTNode, TypeAssertionNode } from '@rcrsr/rill';

// ============================================================
// VISITOR INTERFACE
// ============================================================

/**
 * Enter/exit callbacks invoked around a node's children during traversal.
 * `enter` runs before descending into children; `exit` runs after.
 */
export interface AstVisitor {
  enter(node: ASTNode): void;
  exit(node: ASTNode): void;
}

// ============================================================
// TRAVERSAL
// ============================================================

/**
 * Recursively visit every node reachable from `node`, calling
 * `visitor.enter` before descending into children and `visitor.exit`
 * after. Traversal order matches source (left-to-right, pre-order).
 */
export function traverseForRules(node: ASTNode, visitor: AstVisitor): void {
  visitor.enter(node);

  switch (node.type) {
    case 'Script':
      if (node.frontmatter) {
        traverseForRules(node.frontmatter, visitor);
      }
      for (const stmt of node.statements) {
        traverseForRules(stmt, visitor);
      }
      break;

    case 'Frontmatter':
      break;

    case 'Statement':
      traverseForRules(node.expression, visitor);
      break;

    case 'AnnotatedStatement':
      for (const arg of node.annotations) {
        traverseForRules(arg, visitor);
      }
      traverseForRules(node.statement, visitor);
      break;

    case 'NamedArg':
      traverseForRules(node.value, visitor);
      break;

    case 'SpreadArg':
      traverseForRules(node.expression, visitor);
      break;

    case 'PipeChain':
      traverseForRules(node.head, visitor);
      for (const pipe of node.pipes) {
        traverseForRules(pipe, visitor);
      }
      if (node.terminator) {
        traverseForRules(node.terminator, visitor);
      }
      break;

    case 'PostfixExpr':
      traverseForRules(node.primary, visitor);
      for (const method of node.methods) {
        traverseForRules(method, visitor);
      }
      if (node.defaultValue) {
        traverseForRules(node.defaultValue, visitor);
      }
      break;

    case 'BinaryExpr':
      traverseForRules(node.left, visitor);
      traverseForRules(node.right, visitor);
      break;

    case 'UnaryExpr':
      traverseForRules(node.operand, visitor);
      break;

    case 'GroupedExpr':
      traverseForRules(node.expression, visitor);
      break;

    case 'StringLiteral':
      for (const part of node.parts) {
        if (typeof part !== 'string') {
          traverseForRules(part, visitor);
        }
      }
      break;

    case 'Interpolation':
      traverseForRules(node.expression, visitor);
      break;

    case 'NumberLiteral':
    case 'BoolLiteral':
      break;

    case 'TupleLiteral':
      for (const element of node.elements) {
        traverseForRules(element, visitor);
      }
      break;

    case 'ListLiteral':
      for (const element of node.elements) {
        traverseForRules(element, visitor);
      }
      if (node.defaultValue) {
        traverseForRules(node.defaultValue, visitor);
      }
      break;

    case 'DictLiteral':
      for (const entry of node.entries) {
        traverseForRules(entry, visitor);
      }
      break;

    case 'OrderedLiteral':
      for (const entry of node.entries) {
        traverseForRules(entry, visitor);
      }
      break;

    case 'ListSpread':
      traverseForRules(node.expression, visitor);
      break;

    case 'Dict':
      for (const entry of node.entries) {
        traverseForRules(entry, visitor);
      }
      if (node.defaultValue) {
        traverseForRules(node.defaultValue, visitor);
      }
      break;

    case 'DictEntry':
      traverseForRules(node.value, visitor);
      break;

    case 'Closure':
      for (const param of node.params) {
        traverseForRules(param, visitor);
      }
      traverseForRules(node.body, visitor);
      break;

    case 'ClosureParam':
      if (node.defaultValue) {
        traverseForRules(node.defaultValue, visitor);
      }
      break;

    case 'Variable':
      if (node.defaultValue) {
        traverseForRules(node.defaultValue, visitor);
      }
      break;

    case 'HostCall':
      for (const arg of node.args) {
        traverseForRules(arg, visitor);
      }
      break;

    case 'ClosureCall':
      for (const arg of node.args) {
        traverseForRules(arg, visitor);
      }
      break;

    case 'MethodCall':
      for (const arg of node.args) {
        traverseForRules(arg, visitor);
      }
      break;

    case 'Invoke':
      for (const arg of node.args) {
        traverseForRules(arg, visitor);
      }
      break;

    case 'AnnotationAccess':
      break;

    case 'PipeInvoke':
      for (const arg of node.args) {
        traverseForRules(arg, visitor);
      }
      break;

    case 'Conditional':
      if (node.input) {
        traverseForRules(node.input, visitor);
      }
      if (node.condition) {
        traverseForRules(node.condition, visitor);
      }
      traverseForRules(node.thenBranch, visitor);
      if (node.elseBranch) {
        traverseForRules(node.elseBranch, visitor);
      }
      break;

    case 'WhileLoop':
      traverseForRules(node.condition, visitor);
      traverseForRules(node.body, visitor);
      break;

    case 'DoWhileLoop':
      if (node.input) {
        traverseForRules(node.input, visitor);
      }
      traverseForRules(node.body, visitor);
      traverseForRules(node.condition, visitor);
      break;

    case 'Block':
      for (const stmt of node.statements) {
        traverseForRules(stmt, visitor);
      }
      break;

    case 'GuardBlock':
      traverseForRules(node.body, visitor);
      if (node.onCodes) {
        for (const code of node.onCodes) {
          traverseForRules(code, visitor);
        }
      }
      break;

    case 'RetryBlock':
      traverseForRules(node.body, visitor);
      if (node.onCodes) {
        for (const code of node.onCodes) {
          traverseForRules(code, visitor);
        }
      }
      break;

    case 'AtomLiteral':
      break;

    case 'StatusProbe':
      traverseForRules(node.target, visitor);
      break;

    case 'Destructure':
      for (const element of node.elements) {
        traverseForRules(element, visitor);
      }
      break;

    case 'DestructPattern':
      if (node.nested) {
        traverseForRules(node.nested, visitor);
      }
      break;

    case 'Slice':
      if (node.start) {
        traverseForRules(node.start, visitor);
      }
      if (node.stop) {
        traverseForRules(node.stop, visitor);
      }
      if (node.step) {
        traverseForRules(node.step, visitor);
      }
      break;

    case 'Destruct':
      for (const element of node.elements) {
        traverseForRules(element, visitor);
      }
      break;

    case 'TypeAssertion':
      if (node.operand) {
        traverseForRules(node.operand, visitor);
      }
      break;

    case 'TypeCheck':
      if (node.operand) {
        traverseForRules(node.operand, visitor);
      }
      break;

    case 'Assert':
      traverseForRules(node.condition, visitor);
      if (node.message) {
        traverseForRules(node.message, visitor);
      }
      break;

    case 'Capture':
    case 'Break':
    case 'Return':
    case 'Pass':
    case 'Yield':
      break;

    case 'RecoveryError':
      // Recovery error node: opaque skipped text, no children to visit.
      break;

    case 'Error':
      if (node.message) {
        traverseForRules(node.message, visitor);
      }
      break;

    case 'TypeNameExpr':
    case 'HostRef':
      break;

    case 'AnnotatedExpr':
      for (const arg of node.annotations) {
        traverseForRules(arg, visitor);
      }
      traverseForRules(node.expression, visitor);
      break;

    case 'TypeConstructor':
      for (const arg of node.args) {
        // arg.value is a TypeRef (not an ASTNode) - skip it.
        if (arg.defaultValue) {
          traverseForRules(arg.defaultValue, visitor);
        }
      }
      break;

    case 'ClosureSigLiteral':
      for (const param of node.params) {
        traverseForRules(param.typeExpr, visitor);
      }
      traverseForRules(node.returnType, visitor);
      break;

    case 'UseExpr':
      // Visit computed expression if present; typeRef is not an ASTNode.
      if (node.identifier.kind === 'computed') {
        traverseForRules(node.identifier.expression, visitor);
      }
      break;

    case 'PassBlock':
      traverseForRules(node.options, visitor);
      traverseForRules(node.body, visitor);
      break;

    case 'TimeoutBlock':
      traverseForRules(node.duration, visitor);
      traverseForRules(node.body, visitor);
      break;

    case 'PartialExpression':
      // Partial expression node: only the typed children recognized during
      // recovery are visited; the surrounding gap is opaque.
      for (const child of node.children) {
        traverseForRules(child, visitor);
      }
      break;

    default: {
      // Exhaustive check: if we reach here, a node type is missing.
      const exhaustive: never = node;
      throw new Error(
        `Unhandled node type in traverseForRules: ${(exhaustive as ASTNode).type}`
      );
    }
  }

  visitor.exit(node);
}

// ============================================================
// TYPE ASSERTION HELPER
// ============================================================

/**
 * Returns the HostCallNode wrapped by a TypeAssertion's operand, or null
 * when the operand is absent or not a bare host-call postfix expression.
 */
export function typeAssertedHostCall(node: TypeAssertionNode): ASTNode | null {
  const operand = node.operand;
  if (operand?.primary.type === 'HostCall') {
    return operand.primary;
  }
  return null;
}
