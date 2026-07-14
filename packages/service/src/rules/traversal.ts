/**
 * AST traversal for the rules engine.
 * Enter/exit visitor mirroring the AST shape defined in @rcrsr/rill's
 * `ast-unions.ts` NodeType union. Recovery/partial nodes
 * (RecoveryErrorNode, PartialExpressionNode) are traversed without special
 * casing so a malformed region never aborts the walk.
 *
 * Implemented as an explicit-stack iterative walk (mirroring
 * `@rcrsr/rill`'s `walkAst` in `ast-walk.ts`) rather than recursion, so
 * that deeply nested but syntactically valid ASTs - which rill, targeting
 * machine-generated code, will see - do not risk a `RangeError: Maximum
 * call stack size exceeded`. `getChildren` below returns the direct
 * children of a node in source (left-to-right) order; the walk pushes a
 * frame per node and calls `visitor.enter` the first time a frame is
 * visited, then pushes its children, then calls `visitor.exit` once all
 * children have been popped - preserving the same parent-before-children,
 * left-to-right, post-order-exit semantics as the original recursive walk.
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
 * Returns the direct children of `node`, in source (left-to-right) order.
 * Implemented as an exhaustive switch over `node.type` so that adding a
 * new member to the ASTNode union breaks `pnpm typecheck` until a
 * corresponding arm is added here - see the `never`-typed exhaustiveness
 * check in the `default` arm.
 */
function getChildren(node: ASTNode): ASTNode[] {
  switch (node.type) {
    case 'Script': {
      const children: ASTNode[] = [];
      if (node.frontmatter) children.push(node.frontmatter);
      children.push(...node.statements);
      return children;
    }

    case 'Frontmatter':
      return [];

    case 'Statement':
      return [node.expression];

    case 'AnnotatedStatement':
      return [...node.annotations, node.statement];

    case 'NamedArg':
      return [node.value];

    case 'SpreadArg':
      return [node.expression];

    case 'PipeChain': {
      const children: ASTNode[] = [node.head, ...node.pipes];
      if (node.terminator) children.push(node.terminator);
      return children;
    }

    case 'PostfixExpr': {
      const children: ASTNode[] = [node.primary, ...node.methods];
      if (node.defaultValue) children.push(node.defaultValue);
      return children;
    }

    case 'BinaryExpr':
      return [node.left, node.right];

    case 'UnaryExpr':
      return [node.operand];

    case 'GroupedExpr':
      return [node.expression];

    case 'StringLiteral':
      return node.parts.filter(
        (part): part is Exclude<(typeof node.parts)[number], string> =>
          typeof part !== 'string'
      );

    case 'Interpolation':
      return [node.expression];

    case 'NumberLiteral':
    case 'BoolLiteral':
      return [];

    case 'TupleLiteral':
      return [...node.elements];

    case 'ListLiteral': {
      const children: ASTNode[] = [...node.elements];
      if (node.defaultValue) children.push(node.defaultValue);
      return children;
    }

    case 'DictLiteral':
      return [...node.entries];

    case 'OrderedLiteral':
      return [...node.entries];

    case 'ListSpread':
      return [node.expression];

    case 'Dict': {
      const children: ASTNode[] = [...node.entries];
      if (node.defaultValue) children.push(node.defaultValue);
      return children;
    }

    case 'DictEntry':
      return [node.value];

    case 'Closure':
      return [...node.params, node.body];

    case 'ClosureParam':
      return node.defaultValue ? [node.defaultValue] : [];

    case 'Variable':
      return node.defaultValue ? [node.defaultValue] : [];

    case 'HostCall':
      return [...node.args];

    case 'ClosureCall':
      return [...node.args];

    case 'MethodCall':
      return [...node.args];

    case 'Invoke':
      return [...node.args];

    case 'AnnotationAccess':
      return [];

    case 'PipeInvoke':
      return [...node.args];

    case 'Conditional': {
      const children: ASTNode[] = [];
      if (node.input) children.push(node.input);
      if (node.condition) children.push(node.condition);
      children.push(node.thenBranch);
      if (node.elseBranch) children.push(node.elseBranch);
      return children;
    }

    case 'WhileLoop':
      return [node.condition, node.body];

    case 'DoWhileLoop': {
      const children: ASTNode[] = [];
      if (node.input) children.push(node.input);
      children.push(node.body, node.condition);
      return children;
    }

    case 'Block':
      return [...node.statements];

    case 'GuardBlock': {
      const children: ASTNode[] = [node.body];
      if (node.onCodes) children.push(...node.onCodes);
      return children;
    }

    case 'RetryBlock': {
      const children: ASTNode[] = [node.body];
      if (node.onCodes) children.push(...node.onCodes);
      return children;
    }

    case 'AtomLiteral':
      return [];

    case 'StatusProbe':
      return [node.target];

    case 'Destructure':
      return [...node.elements];

    case 'DestructPattern':
      return node.nested ? [node.nested] : [];

    case 'Slice': {
      const children: ASTNode[] = [];
      if (node.start) children.push(node.start);
      if (node.stop) children.push(node.stop);
      if (node.step) children.push(node.step);
      return children;
    }

    case 'Destruct':
      return [...node.elements];

    case 'TypeAssertion':
      return node.operand ? [node.operand] : [];

    case 'TypeCheck':
      return node.operand ? [node.operand] : [];

    case 'Assert': {
      const children: ASTNode[] = [node.condition];
      if (node.message) children.push(node.message);
      return children;
    }

    case 'Capture':
    case 'Break':
    case 'Return':
    case 'Pass':
    case 'Yield':
      return [];

    case 'RecoveryError':
      // Recovery error node: opaque skipped text, no children to visit.
      return [];

    case 'Error':
      return node.message ? [node.message] : [];

    case 'TypeNameExpr':
    case 'HostRef':
      return [];

    case 'AnnotatedExpr':
      return [...node.annotations, node.expression];

    case 'TypeConstructor': {
      const children: ASTNode[] = [];
      for (const arg of node.args) {
        // arg.value is a TypeRef (not an ASTNode) - skip it.
        if (arg.defaultValue) children.push(arg.defaultValue);
      }
      return children;
    }

    case 'ClosureSigLiteral':
      return [...node.params.map((param) => param.typeExpr), node.returnType];

    case 'UseExpr':
      // Visit computed expression if present; typeRef is not an ASTNode.
      return node.identifier.kind === 'computed'
        ? [node.identifier.expression]
        : [];

    case 'PassBlock':
      return [node.options, node.body];

    case 'TimeoutBlock':
      return [node.duration, node.body];

    case 'PartialExpression':
      // Partial expression node: only the typed children recognized during
      // recovery are visited; the surrounding gap is opaque.
      return [...node.children];

    default: {
      // Exhaustive check: if we reach here, a node type is missing.
      const exhaustive: never = node;
      throw new Error(
        `Unhandled node type in traverseForRules: ${(exhaustive as ASTNode).type}`
      );
    }
  }
}

/**
 * Visit every node reachable from `node`, calling `visitor.enter` before
 * descending into children and `visitor.exit` after. Traversal order
 * matches source (left-to-right, pre-order enter / post-order exit).
 *
 * Implemented as an explicit-stack iterative walk rather than recursion -
 * see the module comment for rationale.
 */
export function traverseForRules(node: ASTNode, visitor: AstVisitor): void {
  interface Frame {
    readonly node: ASTNode;
    childrenPushed: boolean;
  }

  const stack: Frame[] = [{ node, childrenPushed: false }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;

    if (!frame.childrenPushed) {
      visitor.enter(frame.node);
      frame.childrenPushed = true;
      const children = getChildren(frame.node);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i]!, childrenPushed: false });
      }
      continue;
    }

    visitor.exit(frame.node);
    stack.pop();
  }
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
