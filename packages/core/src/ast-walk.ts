/**
 * AST visitor and position-lookup utilities.
 *
 * Import boundary note (§NOD.2.1):
 * - This file lives at src/ level (not in runtime/), and depends only on
 *   the shared AST/type files (./ast-nodes.js, ./source-location.js).
 * - No imports from lexer/*, parser/*, or runtime/* — keeps this module
 *   usable by language-service style tooling that never touches the
 *   runtime evaluator.
 */
import type {
  ASTNode,
  DictEntryNode,
  PropertyAccess,
  VariableNode,
} from './ast-nodes.js';
import type { SourceSpan } from './source-location.js';
import type { FieldArg, TypeRef } from './value-types.js';

/**
 * Returns the direct child ASTNodes of `node`.
 *
 * Implemented as an exhaustive switch over `node.type` so that adding a
 * new member to the ASTNode union (ast-nodes.ts) breaks `pnpm typecheck`
 * until a corresponding arm is added here — see the `never`-typed
 * exhaustiveness check in the `default` arm.
 *
 * Two segment shapes carried inside node fields are not themselves
 * ASTNode union members and are never yielded directly: `PropertyAccess`
 * entries in `VariableNode.accessChain` (and `ExistenceCheck.finalAccess`)
 * and `DictEntryNode.key` variants. Their nested ASTNode children (e.g. a
 * computed field-access expression) are yielded in their place.
 *
 * `TypeRef` values (also not themselves ASTNode union members) can carry
 * ASTNode children through parameterized-type field args: a field default
 * value (`LiteralNode`) and field annotations (`NamedArgNode` /
 * `SpreadArgNode`). These are yielded via `typeRefChildren`/
 * `fieldArgsChildren` wherever a node field holds a `TypeRef`.
 */
function astChildren(node: ASTNode): ASTNode[] {
  switch (node.type) {
    case 'Script': {
      const children: ASTNode[] = [];
      if (node.frontmatter !== null) children.push(node.frontmatter);
      children.push(...node.statements);
      return children;
    }
    case 'Frontmatter':
      return [];
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
      if (node.defaultValue !== null) children.push(node.defaultValue);
      if (node.annotations !== undefined) children.push(...node.annotations);
      if (node.typeRef !== null)
        children.push(...typeRefChildren(node.typeRef));
      return children;
    }
    case 'Statement':
      return [node.expression];
    case 'Capture':
      return node.typeRef !== null ? typeRefChildren(node.typeRef) : [];
    case 'Break':
      return [];
    case 'Return':
      return [];
    case 'Yield':
      return [];
    case 'Pass':
      return [];
    case 'PassBlock':
      return [node.options, node.body];
    case 'TimeoutBlock':
      return [node.duration, node.body];
    case 'Assert': {
      const children: ASTNode[] = [node.condition];
      if (node.message !== null) children.push(node.message);
      return children;
    }
    case 'Error':
      return node.message !== null ? [node.message] : [];
    case 'PipeChain': {
      const children: ASTNode[] = [node.head, ...node.pipes];
      if (node.terminator !== null) children.push(node.terminator);
      return children;
    }
    case 'PostfixExpr': {
      const children: ASTNode[] = [node.primary, ...node.methods];
      if (node.defaultValue !== null) children.push(node.defaultValue);
      return children;
    }
    case 'MethodCall':
      return [...node.args];
    case 'Invoke':
      return [...node.args];
    case 'AnnotationAccess':
      return [];
    case 'HostCall':
      return [...node.args];
    case 'HostRef':
      return [];
    case 'ClosureCall':
      return [...node.args];
    case 'PipeInvoke':
      return [...node.args];
    case 'Variable': {
      const children: ASTNode[] = [];
      for (const access of node.accessChain) {
        children.push(...propertyAccessChildren(access));
      }
      if (node.existenceCheck !== null) {
        children.push(
          ...propertyAccessChildren(node.existenceCheck.finalAccess)
        );
        if (node.existenceCheck.typeRef !== null) {
          children.push(...typeRefChildren(node.existenceCheck.typeRef));
        }
      }
      if (node.defaultValue !== null) children.push(node.defaultValue);
      return children;
    }
    case 'Conditional': {
      const children: ASTNode[] = [];
      if (node.input !== null) children.push(node.input);
      if (node.condition !== null) children.push(node.condition);
      children.push(node.thenBranch);
      if (node.elseBranch !== null) children.push(node.elseBranch);
      return children;
    }
    case 'WhileLoop': {
      const children: ASTNode[] = [node.condition, node.body];
      if (node.annotations !== undefined) children.push(...node.annotations);
      return children;
    }
    case 'DoWhileLoop': {
      const children: ASTNode[] = [];
      if (node.input !== null) children.push(node.input);
      children.push(node.body, node.condition);
      if (node.annotations !== undefined) children.push(...node.annotations);
      return children;
    }
    case 'Block':
      return [...node.statements];
    case 'StringLiteral':
      return node.parts.filter(
        (part): part is Exclude<(typeof node.parts)[number], string> =>
          typeof part !== 'string'
      );
    case 'Interpolation':
      return [node.expression];
    case 'NumberLiteral':
      return [];
    case 'BoolLiteral':
      return [];
    case 'ListSpread':
      return [node.expression];
    case 'Dict': {
      const children: ASTNode[] = [...node.entries];
      if (node.defaultValue !== null) children.push(node.defaultValue);
      return children;
    }
    case 'DictEntry':
      return [...dictKeyChildren(node.key), node.value];
    case 'BinaryExpr':
      return [node.left, node.right];
    case 'UnaryExpr':
      return [node.operand];
    case 'GroupedExpr':
      return [node.expression];
    case 'Destructure':
      return [...node.elements];
    case 'DestructPattern': {
      const children: ASTNode[] = [];
      if (node.nested !== null) children.push(node.nested);
      if (node.typeRef !== null)
        children.push(...typeRefChildren(node.typeRef));
      return children;
    }
    case 'Slice': {
      const children: ASTNode[] = [];
      if (node.start !== null) children.push(node.start);
      if (node.stop !== null) children.push(node.stop);
      if (node.step !== null) children.push(node.step);
      return children;
    }
    case 'TypeAssertion': {
      const children: ASTNode[] = [];
      if (node.operand !== null) children.push(node.operand);
      children.push(...typeRefChildren(node.typeRef));
      return children;
    }
    case 'TypeCheck': {
      const children: ASTNode[] = [];
      if (node.operand !== null) children.push(node.operand);
      children.push(...typeRefChildren(node.typeRef));
      return children;
    }
    case 'TypeConstructor':
      return fieldArgsChildren(node.args);
    case 'ClosureSigLiteral':
      return [...node.params.map((param) => param.typeExpr), node.returnType];
    case 'AnnotatedStatement':
      return [...node.annotations, node.statement];
    case 'AnnotatedExpr':
      return [...node.annotations, node.expression];
    case 'NamedArg':
      return [node.value];
    case 'SpreadArg':
      return [node.expression];
    case 'RecoveryError':
      return [];
    case 'PartialExpression':
      return [...node.children];
    case 'TypeNameExpr':
      return [];
    case 'ListLiteral': {
      const children: ASTNode[] = [...node.elements];
      if (node.defaultValue !== null) children.push(node.defaultValue);
      return children;
    }
    case 'DictLiteral':
      return [...node.entries];
    case 'TupleLiteral':
      return [...node.elements];
    case 'OrderedLiteral':
      return [...node.entries];
    case 'Destruct':
      return [...node.elements];
    case 'UseExpr': {
      const children: ASTNode[] = [];
      if (node.identifier.kind === 'computed') {
        children.push(node.identifier.expression);
      }
      if (node.typeRef !== null)
        children.push(...typeRefChildren(node.typeRef));
      if (node.closureAnnotation !== null) {
        for (const param of node.closureAnnotation) {
          if (param.defaultValue !== undefined)
            children.push(param.defaultValue);
          children.push(...typeRefChildren(param.typeRef));
        }
      }
      return children;
    }
    case 'GuardBlock': {
      const children: ASTNode[] = [node.body];
      if (node.onCodes !== undefined) children.push(...node.onCodes);
      return children;
    }
    case 'RetryBlock': {
      const children: ASTNode[] = [node.body];
      if (node.onCodes !== undefined) children.push(...node.onCodes);
      return children;
    }
    case 'AtomLiteral':
      return [];
    case 'StatusProbe':
      return [node.target];
    default: {
      const exhaustive: never = node;
      throw new Error(
        `astChildren: unrecognized ASTNode type: ${String((exhaustive as ASTNode).type)}`
      );
    }
  }
}

/**
 * Yields child ASTNodes carried inside a `FieldArg[]` list (parameterized
 * type args on a `TypeConstructorNode` or a `static` `TypeRef`). For each
 * arg: its `defaultValue` (a `LiteralNode`), its `annotations`
 * (`NamedArgNode` / `SpreadArgNode`), and the recursive children of its
 * nested `value: TypeRef`.
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
 * `args` (via `fieldArgsChildren`) when parameterized.
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
 * Yields child ASTNodes carried inside a span-less property-access
 * segment. Only `FieldAccessComputed.expression`, `FieldAccessBlock.block`,
 * and `BracketAccess.expression` carry ASTNode children; the remaining
 * segment kinds (`literal`, `variable`, `alternatives`, `annotation`)
 * carry none.
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
 * key is itself an ASTNode union member and is yielded directly.
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
 * Pre-order depth-first traversal of the AST reachable from `root`.
 * Calls `visit` once for every ASTNode, including RecoveryErrorNode and
 * PartialExpressionNode. Span-less segments (FieldAccess/BracketAccess
 * variants, DictEntryNode.key variants) are descended through to reach
 * their ASTNode children but are never themselves passed to `visit`.
 *
 * Implemented as an explicit-stack iterative walk (rather than recursion)
 * so that deeply nested ASTs do not risk a `RangeError: Maximum call stack
 * size exceeded`. Children are pushed onto the stack in reverse order so
 * they pop, and are visited, in source (left-to-right) order — preserving
 * the same parent-before-children, left-to-right visit order as the
 * recursive form.
 */
export function walkAst(root: ASTNode, visit: (node: ASTNode) => void): void {
  const stack: ASTNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node);
    const children = astChildren(node);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]!);
    }
  }
}

/**
 * Returns true if `offset` falls within `span` using half-open
 * containment: `span.start.offset <= offset && offset < span.end.offset`.
 * An empty span (`start.offset === end.offset`) contains nothing.
 *
 * Guards against a missing/undefined `span` (reachable for malformed or
 * hand-constructed ASTNodes from external tooling) by returning `false`
 * rather than throwing on `span.start`.
 */
function spanContains(span: SourceSpan | undefined, offset: number): boolean {
  if (span === undefined) return false;
  return span.start.offset <= offset && offset < span.end.offset;
}

/**
 * Returns true if `node`'s own span (or, for `VariableNode`, any
 * span-bearing access-chain/existence-check segment it owns) contains
 * `offset`.
 *
 * `VariableNode.span` covers only the leading `$name` token, not the
 * access chain that follows it (e.g. `.field`, `[0]`) — a pre-existing
 * parser characteristic (see `parser-variables.ts`), not something this
 * module changes. Segments that themselves carry a `span`
 * (`FieldAccessLiteral`, `FieldAccessVariable`, `FieldAccessComputed`,
 * `BracketAccess`) are checked here so that an offset landing on one of
 * those segments — including `FieldAccessComputed`'s own delimiters
 * (the `.` through the closing `)`, outside its inner expression's span)
 * — still resolves to the owning `VariableNode` rather than falling
 * through to an outer ancestor. For offsets inside `FieldAccessComputed`'s
 * inner expression, `astChildren` reaches the same result first via its
 * ASTNode children. `FieldAccessBlock`'s ASTNode children are reached only
 * via `astChildren`. `FieldAccessAlternatives` and `FieldAccessAnnotation`
 * carry no span of their own and are not resolvable this way.
 */
function ownsOffset(node: ASTNode, offset: number): boolean {
  if (spanContains(node.span, offset)) return true;
  if (node.type !== 'Variable') return false;

  const variable: VariableNode = node;
  for (const access of variable.accessChain) {
    if (accessSegmentContains(access, offset)) return true;
  }
  return (
    variable.existenceCheck !== null &&
    accessSegmentContains(variable.existenceCheck.finalAccess, offset)
  );
}

function accessSegmentContains(
  access: PropertyAccess,
  offset: number
): boolean {
  if ('accessKind' in access) return spanContains(access.span, offset);
  if (
    access.kind === 'literal' ||
    access.kind === 'variable' ||
    access.kind === 'computed'
  ) {
    return spanContains(access.span, offset);
  }
  return false;
}

/**
 * Returns the deepest ASTNode reachable from `root` whose span contains
 * `offset` (0-based absolute character offset, matching
 * `SourceLocation.offset`), or `null` if no such node exists. Descends
 * through span-less FieldAccess/DictEntryNode.key segments to reach child
 * ASTNodes but never returns a segment.
 *
 * Children are tried before `root` itself (rather than gating descent on
 * `root`'s own span first): some node shapes carry a span narrower than
 * their true source extent (see `ownsOffset`), so a matching descendant
 * can be reachable even when `root`'s own span does not contain `offset`.
 * For ordinary well-nested spans this yields the same result as gating on
 * `root` first.
 *
 * Implemented as an explicit-stack iterative depth-first walk (rather than
 * recursion) to avoid stack overflow on deeply nested ASTs, while
 * preserving the exact child-first (deepest-node) return semantics of the
 * recursive form: a matching descendant is always returned before its
 * ancestor is even checked.
 *
 * Span-based pruning: before descending into a child, `spanContains` is
 * checked against the child's own span, so subtrees whose span cannot
 * possibly contain `offset` are skipped entirely — this keeps lookup
 * latency proportional to cursor nesting depth rather than total node
 * count. The one exception is `VariableNode`: per `ownsOffset`, its own
 * `span` covers only the leading `$name` token while its access-chain
 * children (`FieldAccessComputed`/`FieldAccessBlock` inner expressions)
 * can extend further, so a `VariableNode` child is always descended into
 * unconditionally, without a span pre-check.
 */
export function nodeAtPosition(root: ASTNode, offset: number): ASTNode | null {
  interface Frame {
    readonly node: ASTNode;
    readonly children: ASTNode[];
    childIndex: number;
  }

  const stack: Frame[] = [
    { node: root, children: astChildren(root), childIndex: 0 },
  ];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;

    if (frame.childIndex < frame.children.length) {
      const child = frame.children[frame.childIndex]!;
      frame.childIndex++;
      if (child.type === 'Variable' || spanContains(child.span, offset)) {
        stack.push({
          node: child,
          children: astChildren(child),
          childIndex: 0,
        });
      }
      continue;
    }

    stack.pop();
    if (ownsOffset(frame.node, offset)) return frame.node;
  }

  return null;
}
