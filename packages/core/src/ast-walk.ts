/**
 * AST visitor and position-lookup utilities.
 *
 * Import boundary note:
 * - This file lives at src/ level (not in runtime/), and depends only on
 *   the shared AST/type files (./ast-nodes.js, ./source-location.js).
 * - No imports from lexer/*, parser/*, or runtime/* — keeps this module
 *   usable by language-service style tooling that never touches the
 *   runtime evaluator.
 */
import type {
  ASTNode,
  BlockNode,
  ClosureParamNode,
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
 * bracket-access expression) are yielded in their place.
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
        children.push(...typeRefChildren(node.returnTypeTarget));
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
    case 'TimeoutBlock':
      return node.options === null ? [node.body] : [node.options, node.body];
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
      if (node.existenceCheck) {
        if (node.existenceCheck.finalAccess !== null) {
          children.push(
            ...propertyAccessChildren(node.existenceCheck.finalAccess)
          );
        }
        if (node.existenceCheck.typeRef !== null) {
          children.push(...typeRefChildren(node.existenceCheck.typeRef));
        }
      }
      if (node.defaultValue !== null) children.push(node.defaultValue);
      return children;
    }
    case 'MethodCall':
      return [...node.args];
    case 'Invoke':
      return [...node.args];
    case 'AnnotationAccess':
      return [];
    case 'IndexAccess':
      return [node.index];
    case 'HostCall':
      return [...node.args];
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
        if (node.existenceCheck.finalAccess !== null) {
          children.push(
            ...propertyAccessChildren(node.existenceCheck.finalAccess)
          );
        }
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
      const children: ASTNode[] = [node.condition];
      if (node.options !== null) children.push(node.options);
      children.push(node.body);
      return children;
    }
    case 'DoWhileLoop': {
      const children: ASTNode[] = [];
      if (node.input !== null) children.push(node.input);
      if (node.options !== null) children.push(node.options);
      children.push(node.body, node.condition);
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
    case 'FnType':
      return typeRefChildren(node.typeRef);
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
    case 'MapLiteral': {
      const children: ASTNode[] = [...node.entries];
      if (node.defaultValue !== null) children.push(node.defaultValue);
      return children;
    }
    case 'MapEntry':
      return [node.key, node.value];
    case 'Destruct':
      return [...node.elements];
    case 'UseExpr': {
      const children: ASTNode[] = [];
      if (node.identifier.kind === 'computed') {
        children.push(node.identifier.expression);
      }
      if (node.typeRef !== null)
        children.push(...typeRefChildren(node.typeRef));
      return children;
    }
    case 'GuardBlock':
    case 'RetryBlock':
      return node.options === null ? [node.body] : [node.options, node.body];
    case 'AtomLiteral':
      return [];
    case 'StatusProbe':
      return [node.target];
    case 'Declaration':
      return [node.typeExpr, node.value];
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
 * none. `literal` refs yield their literal node. `union` refs recurse into
 * each member. `static` refs recurse into `args` (via `fieldArgsChildren`)
 * when parameterized.
 */
function typeRefChildren(ref: TypeRef): ASTNode[] {
  switch (ref.kind) {
    case 'dynamic':
      return [];
    case 'literal':
      return [ref.value];
    case 'union':
      return ref.members.flatMap((member) => typeRefChildren(member));
    case 'static':
      return ref.args === undefined ? [] : fieldArgsChildren(ref.args);
    case 'fn':
      return [
        ...(ref.params ?? []),
        ...(ref.outer === undefined ? [] : typeRefChildren(ref.outer)),
      ];
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
 * segment. Only `BracketAccess.expression` carries an ASTNode child; the
 * field-access kinds (`literal`, `variable`, `annotation`) carry none.
 */
function propertyAccessChildren(access: PropertyAccess): ASTNode[] {
  if ('accessKind' in access) {
    // BracketAccess
    return [access.expression];
  }
  switch (access.kind) {
    case 'literal':
    case 'variable':
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
 * `string` keys and `DictKeyVariable` carry no ASTNode
 * children. `DictKeyComputed` yields its expression. A `ListLiteralNode`
 * key is itself an ASTNode union member and is yielded directly.
 */
function dictKeyChildren(key: DictEntryNode['key']): ASTNode[] {
  if (typeof key === 'string') {
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
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    visit(node);
    const children = astChildren(node);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== undefined) stack.push(child);
    }
  }
}

/**
 * Returns true when `root` reads the piped value `$`.
 *
 * `written` counts a pipe variable (`$`, `$.x`, the implicit receiver of a
 * leading `.method`, the phantom receiver of `.?x`, a bare `...` spread).
 * Unseeded `while` and `do-while` loops and a conditional with no condition
 * also count, since each reads `$` implicitly. `used` adds `pass` and
 * `pass { }`. A call with no arguments does not count.
 *
 * The walk does not enter a closure, a block other than a construct body that
 * inherits `$` (conditional branches and guard, retry, timeout, and pass
 * bodies), or any pipe target after a chain's head. `root` itself is never a
 * boundary.
 */
export function readsPipeValue(
  root: ASTNode,
  mode: 'written' | 'used'
): boolean {
  return scanPipeReads(root, mode, 'pipe');
}

/** True for a param bound to `$` or `$@`: an unnamed fn param. */
export function isUnnamedParam(param: ClosureParamNode): boolean {
  return isUnnamedParamName(param.name);
}

/** Binding names of the unnamed fn params: `$` first, `$@` second. */
export const UNNAMED_PARAM_NAMES = ['$', '@'] as const;

/** True for the binding name of an unnamed fn param (`$` or `$@`). */
export function isUnnamedParamName(name: string): boolean {
  return (UNNAMED_PARAM_NAMES as readonly string[]).includes(name);
}

/** A code block recognized through its wrappers. */
export interface CodeBlockShape {
  readonly block: BlockNode;
}

/**
 * Recognizes a code block: a bare Block; a method-free PostfixExpr or
 * PipeChain over one; a TypeAssertion or TypeCheck over such a node; or an
 * AnnotatedExpr over any of these. Returns undefined for anything else.
 */
export function codeBlockShape(node: ASTNode): CodeBlockShape | undefined {
  switch (node.type) {
    case 'Block':
      return { block: node };
    case 'PostfixExpr':
      if (
        node.methods.length > 0 ||
        node.defaultValue !== null ||
        (node.existenceCheck !== undefined && node.existenceCheck !== null)
      ) {
        return undefined;
      }
      return codeBlockShape(node.primary);
    case 'PipeChain':
      if (node.pipes.length > 0 || node.terminator !== null) return undefined;
      return codeBlockShape(node.head);
    case 'TypeAssertion':
    case 'TypeCheck':
      return node.operand === null ? undefined : codeBlockShape(node.operand);
    case 'AnnotatedExpr':
      return codeBlockShape(node.expression);
    default:
      return undefined;
  }
}

/**
 * Counts the unnamed params a fn body reads: 0 when it reads neither `$` nor
 * `$@`, 1 when it reads `$` (or an implicit `$` form such as a leading
 * `.method` or `pass`), 2 when it reads `$@`. A read inside a nested closure
 * does not count.
 */
export function unnamedParamsRead(body: ASTNode): 0 | 1 | 2 {
  if (scanPipeReads(body, 'used', 'accumulator')) {
    return 2;
  }
  return scanPipeReads(body, 'used', 'pipe') ? 1 : 0;
}

/**
 * Shared walk behind `readsPipeValue` and `unnamedParamsRead`. `target`
 * selects the variable that counts: `$` ('pipe') or `$@` ('accumulator').
 * Implicit `$` reads (leading method, loops, pipeless conditionals) count only
 * for 'pipe'.
 */
function scanPipeReads(
  root: ASTNode,
  mode: 'written' | 'used',
  target: 'pipe' | 'accumulator'
): boolean {
  const matchesPipeVar = target === 'pipe';
  const inheriting = new Set<ASTNode>([root]);
  // Blocks that never see the enclosing `$`: a whole argument converts to a
  // function of its own params, and in 'written' mode a collection entry is
  // a held block, not a top-level read.
  const boundary = new Set<ASTNode>();
  const markBoundary = (expr: ASTNode): void => {
    const shape = codeBlockShape(expr);
    if (shape !== undefined) boundary.add(shape.block);
  };
  // A code block in a value position (head, statement, parentheses, or a
  // held entry) runs with, or is selected under, the enclosing `$`.
  const markInheriting = (expr: ASTNode): void => {
    const shape = codeBlockShape(expr);
    if (shape !== undefined && !boundary.has(shape.block)) {
      inheriting.add(shape.block);
    }
  };
  const stack: ASTNode[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    switch (node.type) {
      case 'HostCall':
      case 'MethodCall':
      case 'Invoke':
      case 'ClosureCall':
      case 'PipeInvoke':
        for (const arg of node.args) markBoundary(arg);
        break;
      default:
        break;
    }
    let children: ASTNode[];
    switch (node.type) {
      case 'Closure':
        continue;
      case 'Block':
        if (boundary.has(node) || !inheriting.has(node)) continue;
        children = astChildren(node);
        break;
      case 'Variable':
        if (matchesPipeVar ? node.isPipeVar : node.name === '@') return true;
        // `.$` and `.?$` select by the piped value.
        if (matchesPipeVar && selectsByPipeVar(node)) return true;
        children = astChildren(node);
        break;
      case 'PostfixExpr':
        // A leading `.method` has the piped value as its implicit receiver.
        if (matchesPipeVar && node.primary.type === 'MethodCall') return true;
        markInheriting(node.primary);
        children = astChildren(node);
        break;
      case 'Dict':
      case 'OrderedLiteral':
      case 'MapLiteral':
        for (const entry of node.entries) {
          if (mode === 'written') markBoundary(entry.value);
        }
        children = astChildren(node);
        break;
      case 'ListLiteral':
      case 'TupleLiteral':
        for (const element of node.elements) {
          if (mode === 'written') markBoundary(element);
        }
        children = astChildren(node);
        break;
      case 'Pass':
        if (mode === 'used' && matchesPipeVar) return true;
        children = [];
        break;
      case 'PassBlock':
        if (mode === 'used' && matchesPipeVar) return true;
        inheriting.add(node.body);
        children = astChildren(node);
        break;
      case 'GuardBlock':
      case 'RetryBlock':
      case 'TimeoutBlock':
        inheriting.add(node.body);
        children = astChildren(node);
        break;
      case 'WhileLoop':
        // A while loop seeds its accumulator from the piped value.
        if (matchesPipeVar) return true;
        children = astChildren(node);
        break;
      case 'DoWhileLoop':
        if (matchesPipeVar && node.input === null) return true;
        children = astChildren(node);
        break;
      case 'Conditional':
        // The piped form `? a ! b` takes `$` as its condition.
        if (matchesPipeVar && node.condition === null && node.input === null)
          return true;
        inheriting.add(node.thenBranch);
        if (node.elseBranch !== null) inheriting.add(node.elseBranch);
        children = astChildren(node);
        break;
      case 'PipeChain':
        markInheriting(node.head);
        // A pipe target rebinds `$` but not `$@`, so an accumulator read
        // there still reads the enclosing `$@`.
        if (matchesPipeVar) {
          children = [node.head];
        } else {
          children = astChildren(node);
          for (const pipe of node.pipes) markInheriting(pipe);
        }
        break;
      default:
        children = astChildren(node);
    }
    for (const child of children) stack.push(child);
  }
  return false;
}

/** True when a variable's access chain or probe selects by `.$`. */
function selectsByPipeVar(node: VariableNode): boolean {
  const isPipeKey = (access: PropertyAccess): boolean =>
    !('accessKind' in access) &&
    access.kind === 'variable' &&
    access.variableName === null;
  if (node.accessChain.some(isPipeKey)) return true;
  const finalAccess = node.existenceCheck?.finalAccess ?? null;
  return finalAccess !== null && isPipeKey(finalAccess);
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
 * (`FieldAccessLiteral`, `FieldAccessVariable`, `BracketAccess`) are
 * checked here so that an offset landing on one of those segments —
 * including a `BracketAccess`'s own delimiters (outside its inner
 * expression's span) — still resolves to the owning `VariableNode` rather
 * than falling through to an outer ancestor. For offsets inside a
 * `BracketAccess`'s inner expression, `astChildren` reaches the same
 * result first via its ASTNode children. `FieldAccessAnnotation` carries
 * no span of its own and is not resolvable this way.
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
    variable.existenceCheck.finalAccess !== null &&
    accessSegmentContains(variable.existenceCheck.finalAccess, offset)
  );
}

function accessSegmentContains(
  access: PropertyAccess,
  offset: number
): boolean {
  if ('accessKind' in access) return spanContains(access.span, offset);
  if (access.kind === 'literal' || access.kind === 'variable') {
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
 * children (`BracketAccess` inner expressions)
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

  for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
    const child = frame.children[frame.childIndex];
    if (child !== undefined) {
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
