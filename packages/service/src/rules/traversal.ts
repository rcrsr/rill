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
 *
 * `traverseForRules` has exactly two production callers: `run-rules.ts`
 * (the dispatch pass) and `facts.ts` (the fact-collection pass). Rules
 * must never call it directly; each rule receives facts and node
 * visits through the dispatch pass instead. `no-subwalks.test.ts`
 * enforces this by asserting no rule module imports `traverseForRules`.
 */

import type {
  ASTNode,
  DictEntryNode,
  FieldArg,
  PropertyAccess,
  TypeAssertionNode,
  TypeRef,
} from '@rcrsr/rill';

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
 * Yields child ASTNodes carried inside a span-less property-access segment.
 * Only `FieldAccessComputed.expression`, `FieldAccessBlock.block`, and
 * `BracketAccess.expression` carry ASTNode children; the remaining segment
 * kinds (`literal`, `variable`, `alternatives`, `annotation`) carry none.
 * Ported from `@rcrsr/rill`'s `ast-walk.ts` `propertyAccessChildren` to
 * bring `getChildren` to parity with core's `astChildren` - see ADR-0031
 * CON-6 (duplication licensed; remedy is parity + guard test, not
 * cross-package de-duplication).
 */
function propertyAccessChildren(access: PropertyAccess): ASTNode[] {
  if ('accessKind' in access) {
    // BracketAccess
    return [access.expression];
  }
  switch (access.kind) {
    case 'computed':
      return [access.expression];
    case 'block':
      return [access.block];
    case 'literal':
    case 'variable':
    case 'alternatives':
    case 'annotation':
      return [];
    default: {
      const exhaustive: never = access;
      throw new Error(
        `propertyAccessChildren: unrecognized PropertyAccess kind: ${String((exhaustive as { kind: string }).kind)}`
      );
    }
  }
}

/**
 * Yields child ASTNodes carried inside a `DictEntryNode.key`. Plain
 * `string | number | boolean` keys and `DictKeyVariable` carry no ASTNode
 * children. `DictKeyComputed` yields its expression. A `ListLiteralNode`
 * key is itself an ASTNode union member and is yielded directly. Ported
 * from core's `dictKeyChildren` - see the `propertyAccessChildren` comment
 * above.
 */
function dictKeyChildren(key: DictEntryNode['key']): ASTNode[] {
  if (
    typeof key === 'string' ||
    typeof key === 'number' ||
    typeof key === 'boolean'
  ) {
    return [];
  }
  if (!('kind' in key)) {
    // ListLiteralNode key: itself an ASTNode union member.
    return [key];
  }
  if (key.kind === 'variable') {
    return [];
  }
  return [key.expression];
}

/**
 * Yields child ASTNodes carried inside a `FieldArg[]` list (parameterized
 * type args on a `TypeConstructorNode` or a `static` `TypeRef`). For each
 * arg: its `defaultValue` (a `LiteralNode`), its `annotations`
 * (`NamedArgNode` / `SpreadArgNode`), and the recursive children of its
 * nested `value: TypeRef`. Ported from core's `fieldArgsChildren` - see the
 * `propertyAccessChildren` comment above.
 */
function fieldArgsChildren(args: FieldArg[]): ASTNode[] {
  const children: ASTNode[] = [];
  for (const arg of args) {
    if (arg.defaultValue !== undefined) children.push(arg.defaultValue);
    if (arg.annotations !== undefined) children.push(...arg.annotations);
    children.push(...typeRefChildren(arg.value));
  }
  return children;
}

/**
 * Yields child ASTNodes carried inside a `TypeRef`. `dynamic` refs carry
 * none. `union` refs recurse into each member. `static` refs recurse into
 * `args` (via `fieldArgsChildren`) when parameterized. Ported from core's
 * `typeRefChildren` - see the `propertyAccessChildren` comment above.
 */
function typeRefChildren(ref: TypeRef): ASTNode[] {
  switch (ref.kind) {
    case 'dynamic':
      return [];
    case 'union':
      return ref.members.flatMap((member) => typeRefChildren(member));
    case 'static':
      return ref.args === undefined ? [] : fieldArgsChildren(ref.args);
    default: {
      const exhaustive: never = ref;
      throw new Error(
        `typeRefChildren: unrecognized TypeRef kind: ${String((exhaustive as TypeRef).kind)}`
      );
    }
  }
}

/**
 * Returns the direct children of `node`, in source (left-to-right) order.
 * Implemented as an exhaustive switch over `node.type` so that adding a
 * new member to the ASTNode union breaks `pnpm typecheck` until a
 * corresponding arm is added here - see the `never`-typed exhaustiveness
 * check in the `default` arm.
 *
 * Kept at parity with `@rcrsr/rill`'s `astChildren` (`ast-walk.ts`),
 * verified by `traversal.test.ts`'s corpus-wide parity assertion against
 * the exported `walkAst`. Not re-exported from core to de-duplicate - see
 * ADR-0031 CON-6.
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
      return [...dictKeyChildren(node.key), node.value];

    case 'Closure': {
      const children: ASTNode[] = [...node.params, node.body];
      if (node.returnTypeTarget !== undefined) {
        const target = node.returnTypeTarget;
        if ('type' in target && target.type === 'TypeConstructor') {
          children.push(target);
        } else if (!('type' in target)) {
          children.push(...typeRefChildren(target));
        }
      }
      return children;
    }

    case 'ClosureParam': {
      const children: ASTNode[] = [];
      if (node.defaultValue) children.push(node.defaultValue);
      if (node.annotations) children.push(...node.annotations);
      if (node.typeRef) children.push(...typeRefChildren(node.typeRef));
      return children;
    }

    case 'Variable': {
      const children: ASTNode[] = [];
      for (const access of node.accessChain) {
        children.push(...propertyAccessChildren(access));
      }
      if (node.existenceCheck) {
        children.push(
          ...propertyAccessChildren(node.existenceCheck.finalAccess)
        );
        if (node.existenceCheck.typeRef) {
          children.push(...typeRefChildren(node.existenceCheck.typeRef));
        }
      }
      if (node.defaultValue) children.push(node.defaultValue);
      return children;
    }

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

    case 'WhileLoop': {
      const children: ASTNode[] = [node.condition, node.body];
      if (node.annotations) children.push(...node.annotations);
      return children;
    }

    case 'DoWhileLoop': {
      const children: ASTNode[] = [];
      if (node.input) children.push(node.input);
      children.push(node.body, node.condition);
      if (node.annotations) children.push(...node.annotations);
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

    case 'DestructPattern': {
      const children: ASTNode[] = [];
      if (node.nested) children.push(node.nested);
      if (node.typeRef) children.push(...typeRefChildren(node.typeRef));
      return children;
    }

    case 'Slice': {
      const children: ASTNode[] = [];
      if (node.start) children.push(node.start);
      if (node.stop) children.push(node.stop);
      if (node.step) children.push(node.step);
      return children;
    }

    case 'Destruct':
      return [...node.elements];

    case 'TypeAssertion': {
      const children: ASTNode[] = [];
      if (node.operand) children.push(node.operand);
      children.push(...typeRefChildren(node.typeRef));
      return children;
    }

    case 'TypeCheck': {
      const children: ASTNode[] = [];
      if (node.operand) children.push(node.operand);
      children.push(...typeRefChildren(node.typeRef));
      return children;
    }

    case 'Assert': {
      const children: ASTNode[] = [node.condition];
      if (node.message) children.push(node.message);
      return children;
    }

    case 'Capture':
      return node.typeRef ? typeRefChildren(node.typeRef) : [];

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

    case 'TypeConstructor':
      return fieldArgsChildren(node.args);

    case 'ClosureSigLiteral':
      return [...node.params.map((param) => param.typeExpr), node.returnType];

    case 'UseExpr': {
      const children: ASTNode[] = [];
      if (node.identifier.kind === 'computed') {
        children.push(node.identifier.expression);
      }
      if (node.typeRef) children.push(...typeRefChildren(node.typeRef));
      if (node.closureAnnotation) {
        for (const param of node.closureAnnotation) {
          if (param.defaultValue !== undefined)
            children.push(param.defaultValue);
          children.push(...typeRefChildren(param.typeRef));
        }
      }
      return children;
    }

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
