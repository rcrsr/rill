/**
 * Rill Parser Tests: walkAst / nodeAtPosition
 * Exercises the exported AST visitor and position-lookup utilities.
 */

import { describe, expect, it } from 'vitest';
import type { ASTNode, NodeType } from '@rcrsr/rill';
import { nodeAtPosition, parse, parseWithRecovery, walkAst } from '@rcrsr/rill';

/**
 * Full set of NodeType string literals, used as the membership oracle for
 * the reflective deep-scan below. Built from a `satisfies Record<NodeType,
 * true>` object literal so that a `NodeType` union member missing from this
 * list is a compile-time (`pnpm typecheck`) error, not a silently-passing
 * gap.
 *
 * Keeping this list independent of astChildren() is still the point: it
 * lets the test catch a missing astChildren() arm rather than agreeing
 * with it by construction. The compile-time guard only protects against
 * this list itself drifting from the NodeType union it mirrors.
 */
const KNOWN_NODE_TYPES_RECORD = {
  Script: true,
  Frontmatter: true,
  Closure: true,
  ClosureParam: true,
  Statement: true,
  PipeChain: true,
  PostfixExpr: true,
  MethodCall: true,
  Invoke: true,
  AnnotationAccess: true,
  HostCall: true,
  HostRef: true,
  ClosureCall: true,
  PipeInvoke: true,
  Variable: true,
  Capture: true,
  Conditional: true,
  WhileLoop: true,
  DoWhileLoop: true,
  Block: true,
  StringLiteral: true,
  Interpolation: true,
  NumberLiteral: true,
  BoolLiteral: true,
  ListSpread: true,
  Dict: true,
  DictEntry: true,
  Break: true,
  Return: true,
  Yield: true,
  Pass: true,
  PassBlock: true,
  TimeoutBlock: true,
  Assert: true,
  BinaryExpr: true,
  UnaryExpr: true,
  GroupedExpr: true,
  Destructure: true,
  DestructPattern: true,
  Slice: true,
  TypeAssertion: true,
  TypeCheck: true,
  AnnotatedStatement: true,
  AnnotatedExpr: true,
  NamedArg: true,
  SpreadArg: true,
  RecoveryError: true,
  PartialExpression: true,
  Error: true,
  TypeNameExpr: true,
  TypeConstructor: true,
  ClosureSigLiteral: true,
  ListLiteral: true,
  DictLiteral: true,
  TupleLiteral: true,
  OrderedLiteral: true,
  Destruct: true,
  UseExpr: true,
  GuardBlock: true,
  RetryBlock: true,
  AtomLiteral: true,
  StatusProbe: true,
} satisfies Record<NodeType, true>;

const KNOWN_NODE_TYPES = new Set<string>(Object.keys(KNOWN_NODE_TYPES_RECORD));

/**
 * Reflective oracle: walks every enumerable property of `root` (arrays and
 * plain objects), collecting every object whose `.type` is a known
 * NodeType. Independent of astChildren()'s hand-written switch, so it
 * catches a missing (or wrong) arm there.
 */
function collectNodesReflectively(root: unknown): Set<unknown> {
  const found = new Set<unknown>();
  const seen = new Set<unknown>();

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    if (
      typeof record['type'] === 'string' &&
      KNOWN_NODE_TYPES.has(record['type'])
    ) {
      found.add(value);
    }
    for (const propertyValue of Object.values(record)) visit(propertyValue);
  };

  visit(root);
  return found;
}

/**
 * Comprehensive fixture exercising pipes, dict key forms, variable access
 * chains, conditionals, loops, closures, and TypeRef-borne ASTNode children
 * (parameterized-type field defaults and annotations).
 *
 * The `$typed` closure param, the `$tc` type-constructor pipe target, and
 * the `$use_typed` use-expression closure annotation each carry a
 * parameterized type (`dict(...)`) whose `FieldArg` nests ASTNode children
 * (a `LiteralNode` default, a `NamedArgNode` annotation) inside a `TypeRef`.
 * Regression coverage: prior to the `typeRefChildren`/`fieldArgsChildren`
 * fix, `astChildren()` never descended into these, so the reflective oracle
 * (which finds every ASTNode regardless of how it's nested) disagreed with
 * `walkAst`.
 */
const COMPREHENSIVE_FIXTURE = `
"start" -> $x

dict[
  name: "alice",
  $keyvar: 1,
  (1 + 1): 2,
  list["a", "b"]: 3
] => $d

$d.name[0].(1 + 1).{"lit"} => $chain

$x -> .eq("start") ? "yes" ! "no" => $cond

0 -> while ($ < 3) do { $ + 1 } => $loopresult

|n| ($n * 2) => $double

$double(5) => $result

|n: dict(label: string = "d")| ($n) => $typed

"start" -> dict(^(anno: 1) field: dict(sub: string = "x")) => $tc

use<host:fn>:|param: dict(name: string = "d")| => $use_typed
`;

describe('walkAst', () => {
  it('visits every node reachable from root, matching a reflective oracle scan', () => {
    const ast = parse(COMPREHENSIVE_FIXTURE);

    const visited = new Set<ASTNode>();
    walkAst(ast, (node) => visited.add(node));

    const oracle = collectNodesReflectively(ast);

    expect(visited.size).toBeGreaterThan(0);
    expect(visited).toEqual(oracle);
  });

  it('visits the LiteralNode default nested inside a typed closure param parameterized type', () => {
    // Regression: astChildren() previously never descended into
    // ClosureParamNode.typeRef, so a field default nested inside a
    // parameterized type (`dict(label: string = "d")`) was unreachable.
    const source = `|n: dict(label: string = "d")| ($n) => $typed`;
    const ast = parse(source);

    const oracle = [...collectNodesReflectively(ast)] as ASTNode[];
    const nestedDefault = oracle.find((node) => node.type === 'StringLiteral');
    expect(nestedDefault).toBeDefined();

    const visited = new Set<ASTNode>();
    walkAst(ast, (node) => visited.add(node));

    expect(visited.has(nestedDefault!)).toBe(true);
  });

  it('visits PartialExpression and RecoveryError nodes produced by parseWithRecovery', () => {
    const source = `error(1 + 2))\n"after"`;
    const result = parseWithRecovery(source);

    const visitedTypes = new Set<string>();
    walkAst(result.ast, (node) => visitedTypes.add(node.type));

    expect(visitedTypes.has('PartialExpression')).toBe(true);
    expect(visitedTypes.has('RecoveryError')).toBe(true);
  });
});

describe('nodeAtPosition', () => {
  it('returns the deepest containing node for a variable nested in a dict value', () => {
    // Note: VariableNode.span (parser-variables.ts) covers only the
    // leading `$name` token, not any access-chain suffix, so an offset is
    // chosen inside the `.id` segment (which does carry its own span)
    // rather than on the bare `$x` token itself.
    const source = `dict[name: $x.id] => $d`;
    const ast = parse(source);

    // Locate the inner VariableNode ($x) by reflective scan to compute its
    // offset independently of astChildren().
    const oracle = [...collectNodesReflectively(ast)] as ASTNode[];
    const innerVariable = oracle.find(
      (node) =>
        node.type === 'Variable' &&
        (node as { name: string | null }).name === 'x'
    );
    expect(innerVariable).toBeDefined();
    const offset = source.indexOf('.id') + 1;

    const found = nodeAtPosition(ast, offset);
    expect(found).not.toBeNull();
    expect(found).toBe(innerVariable);

    // The enclosing Dict node also contains this offset but is not the
    // deepest match.
    const dictNode = oracle.find((node) => node.type === 'Dict');
    expect(found).not.toBe(dictNode);
  });

  it('is inclusive at span.start.offset and exclusive at span.end.offset', () => {
    const source = `42 -> $x`;
    const ast = parse(source);

    const numberNode = [...collectNodesReflectively(ast)].find(
      (node) => (node as ASTNode).type === 'NumberLiteral'
    ) as ASTNode;
    expect(numberNode).toBeDefined();

    const startFound = nodeAtPosition(ast, numberNode.span.start.offset);
    expect(startFound).toBe(numberNode);

    const endFound = nodeAtPosition(ast, numberNode.span.end.offset);
    expect(endFound).not.toBe(numberNode);
  });

  it('returns null for an offset outside the root span', () => {
    const source = `1 -> $x`;
    const ast = parse(source);

    expect(nodeAtPosition(ast, -1)).toBeNull();
    expect(nodeAtPosition(ast, 10_000)).toBeNull();
  });

  it('contains nothing for an empty span', () => {
    // Real parsed spans are never zero-width, so construct a synthetic
    // leaf node (no children, so containment relies solely on its own
    // span) with a zero-width span to exercise the empty-span rule.
    const location = { line: 1, column: 1, offset: 0 };
    const zeroWidthLeaf: ASTNode = {
      type: 'BoolLiteral',
      value: true,
      span: { start: location, end: location },
    };

    expect(nodeAtPosition(zeroWidthLeaf, 0)).toBeNull();
  });

  it('descends through computed field access to find the inner expression', () => {
    const source = `$data.(1 + 1).name`;
    const ast = parse(source);

    const oracle = [...collectNodesReflectively(ast)] as ASTNode[];
    const postfixExpr = oracle.find(
      (node) => node.type === 'PostfixExpr' && node.span.start.offset === 0
    );
    expect(postfixExpr).toBeDefined();

    // Offset at the first operand inside the computed key `(1 + 1)`.
    // Node spans in this parser extend to the start of the next token
    // (trailing whitespace included), so the leftmost leaf — not the
    // enclosing BinaryExpr — is the deepest match here; what matters is
    // that resolution actually descended into the computed expression
    // rather than stopping at the outer PostfixExpr/Variable.
    const found = nodeAtPosition(ast, source.indexOf('1'));
    expect(found).not.toBeNull();
    expect(found!.type).toBe('NumberLiteral');
    expect(found).not.toBe(postfixExpr);
  });

  it('returns the enclosing Variable for an offset on a computed field-access delimiter', () => {
    // Regression: FieldAccessComputed carries its own span (the `.` token
    // through the closing `)`), which is wider than its inner expression's
    // span. An offset on the delimiter itself (here the opening `.(`) is
    // inside FieldAccessComputed.span but outside the inner expression's
    // span, and must still resolve to the owning VariableNode rather than
    // falling through to an outer ancestor.
    const source = `$data.(1 + 1)`;
    const ast = parse(source);

    const oracle = [...collectNodesReflectively(ast)] as ASTNode[];
    const variableNode = oracle.find((node) => node.type === 'Variable');
    expect(variableNode).toBeDefined();

    const delimiterOffset = source.indexOf('.(');
    const found = nodeAtPosition(ast, delimiterOffset);
    expect(found).toBe(variableNode);
  });

  it('descends through block field access to find a node inside the block', () => {
    const source = `$data.{"lit"}`;
    const ast = parse(source);

    const oracle = [...collectNodesReflectively(ast)] as ASTNode[];
    const stringLiteral = oracle.find((node) => node.type === 'StringLiteral');
    expect(stringLiteral).toBeDefined();

    const found = nodeAtPosition(ast, stringLiteral!.span.start.offset);
    expect(found).toBe(stringLiteral);
  });

  it('returns the enclosing Variable for an offset over a span-less literal field-access segment without crashing', () => {
    const source = `$data.name`;
    const ast = parse(source);

    const oracle = [...collectNodesReflectively(ast)] as ASTNode[];
    const variableNode = oracle.find((node) => node.type === 'Variable') as
      | (ASTNode & { name: string | null })
      | undefined;
    expect(variableNode).toBeDefined();

    // Offset squarely inside the `.name` segment text, which carries no
    // span of its own — must resolve to the enclosing Variable.
    const nameOffset = source.indexOf('name') + 1;
    expect(() => nodeAtPosition(ast, nameOffset)).not.toThrow();
    const found = nodeAtPosition(ast, nameOffset);
    expect(found).toBe(variableNode);
  });

  it('descends through a computed dict key to find the key expression', () => {
    const source = `dict[(1 + 1): "value"]`;
    const ast = parse(source);

    const oracle = [...collectNodesReflectively(ast)] as ASTNode[];
    const dictEntry = oracle.find((node) => node.type === 'DictEntry');
    expect(dictEntry).toBeDefined();

    // Offset inside the computed key `(1 + 1)`: must resolve into the
    // key expression subtree, not stop at DictEntry/Dict.
    const found = nodeAtPosition(ast, source.indexOf('1'));
    expect(found).not.toBeNull();
    expect(found!.type).toBe('NumberLiteral');
    expect(found).not.toBe(dictEntry);
  });

  it('resolves an offset over a plain string dict key without throwing', () => {
    const source = `dict[name: "alice"]`;
    const ast = parse(source);

    const nameOffset = source.indexOf('name') + 1;
    expect(() => nodeAtPosition(ast, nameOffset)).not.toThrow();
    const found = nodeAtPosition(ast, nameOffset);
    expect(found).not.toBeNull();
    expect(['DictEntry', 'Dict']).toContain(found!.type);
  });
});
