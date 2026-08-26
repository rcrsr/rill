/**
 * Structural safety of `traverseForRules` (stack-depth, visit order), plus
 * parity between the rules engine's own `getChildren`/`traverseForRules`
 * (traversal.ts, private) and `@rcrsr/rill`'s exported `walkAst` (backed by
 * core's private `astChildren`). Both traversals must visit exactly the
 * same node set, in the same order, for every node reachable from a
 * script's AST - if they diverge, a rule dispatched over `traverseForRules`
 * silently skips nodes that core's own tooling (and the runtime) considers
 * reachable.
 *
 * The parity tests below never import core's private `astChildren` - only
 * the exported `walkAst` - per the guard-test remedy licensed by ADR-0031
 * CON-6 for the getChildren/astChildren duplication (rather than
 * re-exporting astChildren from core to de-duplicate; see traversal.ts's
 * `getChildren` doc comment).
 */
import { describe, expect, it } from 'vitest';
import type {
  ASTNode,
  NumberLiteralNode,
  PostfixExprNode,
  SourceSpan,
  UnaryExprNode,
} from '@rcrsr/rill';
import { parseWithRecovery, walkAst } from '@rcrsr/rill';
import { traverseForRules } from './traversal.js';
import { loadCorpusSnippets } from './corpus-loader.js';

// ============================================================
// STRUCTURAL SAFETY: STACK DEPTH AND VISIT ORDER
// ============================================================

const SPAN: SourceSpan = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

/**
 * Hand-builds a chain of `depth` nested UnaryExprNode wrappers around a
 * PostfixExpr(NumberLiteral) leaf. `UnaryExprNode.operand` is typed as
 * `UnaryExprNode | PostfixExprNode`, so this shape is directly buildable
 * without going through the parser (which recurses per nesting level
 * itself and would hit its own stack limit at the depths this test needs).
 */
function buildDeeplyNestedUnaryExpr(depth: number): ASTNode {
  const leaf: NumberLiteralNode = {
    type: 'NumberLiteral',
    value: 1,
    span: SPAN,
  };
  const postfix: PostfixExprNode = {
    type: 'PostfixExpr',
    primary: leaf,
    methods: [],
    defaultValue: null,
    span: SPAN,
  };

  let node: UnaryExprNode | PostfixExprNode = postfix;
  for (let i = 0; i < depth; i++) {
    node = { type: 'UnaryExpr', op: '-', operand: node, span: SPAN };
  }
  return node;
}

describe('traverseForRules', () => {
  it('walks a deeply nested AST without a stack overflow', () => {
    // Deep enough to overflow V8's default recursive call stack for this
    // shape (empirically well past the ~10k-15k depth a naive recursive
    // visitor tolerates).
    const depth = 50_000;
    const root = buildDeeplyNestedUnaryExpr(depth);

    let enterCount = 0;
    let exitCount = 0;

    expect(() => {
      traverseForRules(root, {
        enter: () => {
          enterCount++;
        },
        exit: () => {
          exitCount++;
        },
      });
    }).not.toThrow();

    // depth UnaryExpr nodes + 1 PostfixExpr + 1 NumberLiteral leaf.
    expect(enterCount).toBe(depth + 2);
    expect(exitCount).toBe(depth + 2);
  });

  it('visits nodes parent-before-children and exits in reverse (post-order)', () => {
    const root = buildDeeplyNestedUnaryExpr(3);

    const entered: string[] = [];
    const exited: string[] = [];

    traverseForRules(root, {
      enter: (node) => entered.push(node.type),
      exit: (node) => exited.push(node.type),
    });

    expect(entered).toEqual([
      'UnaryExpr',
      'UnaryExpr',
      'UnaryExpr',
      'PostfixExpr',
      'NumberLiteral',
    ]);
    expect(exited).toEqual([
      'NumberLiteral',
      'PostfixExpr',
      'UnaryExpr',
      'UnaryExpr',
      'UnaryExpr',
    ]);
  });
});

// ============================================================
// COLLECTION HELPERS
// ============================================================

/** Collect every node visited by `traverseForRules`, in enter order. */
function collectViaTraverseForRules(root: ASTNode): ASTNode[] {
  const visited: ASTNode[] = [];
  traverseForRules(root, {
    enter(node) {
      visited.push(node);
    },
    exit() {
      // no-op: only enter order is compared
    },
  });
  return visited;
}

/** Collect every node visited by core's exported `walkAst`, in visit order. */
function collectViaWalkAst(root: ASTNode): ASTNode[] {
  const visited: ASTNode[] = [];
  walkAst(root, (node) => {
    visited.push(node);
  });
  return visited;
}

/**
 * Compute both traversals' visited-node arrays for `source`'s parsed AST, so
 * every call site asserts directly (satisfying the `expect-expect` lint
 * rule) rather than delegating to a shared assertion helper.
 */
function computeParity(source: string): {
  readonly viaRules: readonly ASTNode[];
  readonly viaCore: readonly ASTNode[];
} {
  const parsed = parseWithRecovery(source);
  return {
    viaRules: collectViaTraverseForRules(parsed.ast),
    viaCore: collectViaWalkAst(parsed.ast),
  };
}

// ============================================================
// FULL-CORPUS PARITY
// ============================================================

describe('traverseForRules / walkAst parity over the full corpus', () => {
  const snippets = loadCorpusSnippets();

  it('loads a non-empty corpus', () => {
    expect(snippets.length).toBeGreaterThan(0);
  });

  it.each(snippets.map((snippet, index) => ({ ...snippet, index })))(
    'visits an identical node set for corpus snippet #$index ($file)',
    ({ source }) => {
      const { viaRules, viaCore } = computeParity(source);
      expect(viaRules.length).toBe(viaCore.length);
      expect(viaRules).toEqual(viaCore);
    }
  );
});

// ============================================================
// TARGETED PARITY: CONSTRUCTS PREVIOUSLY OMITTED BY getChildren
// ============================================================

describe('traverseForRules / walkAst parity: targeted constructs', () => {
  it('Variable computed access chain segment', () => {
    const { viaRules, viaCore } = computeParity('$data.items.(1 + 1)\n');
    expect(viaRules).toEqual(viaCore);
  });

  it('Variable bracket access chain segment', () => {
    const { viaRules, viaCore } = computeParity('$data.items[0]\n');
    expect(viaRules).toEqual(viaCore);
  });

  it('Variable block access chain segment', () => {
    const { viaRules, viaCore } = computeParity('$data.{ "key" }\n');
    expect(viaRules).toEqual(viaCore);
  });

  it('Variable existence check on a literal field', () => {
    const { viaRules, viaCore } = computeParity('$data.?field\n');
    expect(viaRules).toEqual(viaCore);
  });

  it('Variable existence check on a computed field with a type narrow', () => {
    const { viaRules, viaCore } = computeParity('$data.?(1 + 1)&string\n');
    expect(viaRules).toEqual(viaCore);
  });

  it('DictEntry computed key', () => {
    const { viaRules, viaCore } = computeParity('dict[($x -> .upper): 1]\n');
    expect(viaRules).toEqual(viaCore);
  });

  it('Capture with a parameterized :type', () => {
    const { viaRules, viaCore } = computeParity('5 => $y:list(string)\n$y\n');
    expect(viaRules).toEqual(viaCore);
  });

  it('Capture with a parameterized :type using named field args', () => {
    const { viaRules, viaCore } = computeParity(
      '5 => $y:dict(key: string, value: number)\n$y\n'
    );
    expect(viaRules).toEqual(viaCore);
  });

  it('ClosureParam with a parameterized :type default', () => {
    const { viaRules, viaCore } = computeParity(
      '5 -> |x: list(item: string = "a")| ($x)\n'
    );
    expect(viaRules).toEqual(viaCore);
  });

  it('Closure returnTypeTarget as a parameterized TypeRef', () => {
    const { viaRules, viaCore } = computeParity(
      '5 -> |x| ($x) :list(string)\n'
    );
    expect(viaRules).toEqual(viaCore);
  });

  it('UseExpr with a computed identifier and a parameterized typeRef', () => {
    const { viaRules, viaCore } = computeParity(
      'use<($x -> .upper)>:list(string)\n'
    );
    expect(viaRules).toEqual(viaCore);
  });

  it('DestructPattern with a typed variable element', () => {
    const { viaRules, viaCore } = computeParity(
      'tuple[1, 2] -> destruct<$a:number, $b:number>\n'
    );
    expect(viaRules).toEqual(viaCore);
  });

  it('TypeAssertion with a parameterized typeRef', () => {
    const { viaRules, viaCore } = computeParity('list[1, 2]:list(number)\n');
    expect(viaRules).toEqual(viaCore);
  });

  it('TypeCheck with a parameterized typeRef', () => {
    const { viaRules, viaCore } = computeParity('list[1, 2]:?list(number)\n');
    expect(viaRules).toEqual(viaCore);
  });
});
