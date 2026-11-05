/**
 * Every rule returns [] for a node whose type is outside its `nodeTypes`,
 * and never throws. The dispatcher already buckets by `nodeTypes`; this pins
 * the in-rule guard that makes the narrowing sound.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ASTNode } from '@rcrsr/rill';
import { collectFacts } from './facts.js';
import { RULES } from './rules.js';
import { traverseForRules } from './traversal.js';
import type { RuleContext } from './types.js';

const GUARDED_CODES = [
  'ATOM_UNREGISTERED',
  'AVOID_REASSIGNMENT',
  'CAPTURE_BEFORE_BRANCH',
  'CAPTURE_INLINE_CHAIN',
  'CLOSURE_BARE_DOLLAR',
  'CLOSURE_BRACES',
  'COMPLEX_CONDITION',
  'CONDITION_TYPE',
  'FOLD_INTERMEDIATES',
  'GUARD_BARE',
  'GUARD_OVER_TRY_CATCH',
  'IMPLICIT_DOLLAR_CLOSURE',
  'IMPLICIT_DOLLAR_FUNCTION',
  'IMPLICIT_DOLLAR_METHOD',
  'INDENT_CONTINUATION',
  'LOOP_ACCUMULATOR',
  'PREFER_DO_WHILE',
  'PRESENCE_OVER_NULL_GUARD',
  'RETRY_TRIVIAL',
  'SPACING_BRACKETS',
  'SPACING_CLOSURE',
  'SPACING_MEMBER',
  'STATUS_PROBE_NO_FIELD',
  'THROWAWAY_CAPTURE',
  'UNNECESSARY_ASSERTION',
  'USE_DEFAULT_OPERATOR',
  'USE_DYNAMIC_IDENTIFIER',
  'USE_EACH',
  'USE_EMPTY_METHOD',
  'USE_UNTYPED_HOST_REF',
  'VALIDATE_EXTERNAL',
] as const;

const SOURCE = `
use<ext:app> => $app
"a" => $name
|x| ($x + 1) => $inc
$inc(1) => $r
$name -> .upper => $up
$app.fetch("u") -> .empty ? "e" ! "f"
list[1, 2] -> seq({ $ * 2 }) => $doubled
list[1, 2] -> fold(0, { $@ + $ }) => $sum
0 -> while ($ < 3) do { $ + 1 }
0 -> do { $ + 1 } while ($ < 3)
guard { $app.fetch("u") } => $g
retry<limit: 2> { $app.fetch("u") } => $t
$g.! ? "bad" ! "ok"
#SOME_ATOM
`;

function collectNodes(source: string): ASTNode[] {
  const nodes: ASTNode[] = [];
  traverseForRules(parse(source), {
    enter: (node) => {
      nodes.push(node);
    },
    exit: () => {},
  });
  return nodes;
}

function makeContext(source: string): RuleContext {
  return {
    source,
    variables: new Map(),
    variableScopes: new Map(),
    scopeStack: [],
    assertedHostCalls: new Set(),
    facts: collectFacts(parse(source)),
  };
}

describe('rule node-type guards', () => {
  const nodes = collectNodes(SOURCE);
  const context = makeContext(SOURCE);

  it.each(GUARDED_CODES)(
    'returns no diagnostics for a node outside nodeTypes of %s',
    (code) => {
      const rule = RULES.find((candidate) => candidate.code === code);
      expect(rule).toBeDefined();
      const foreign = nodes.filter(
        (node) => !rule!.nodeTypes.includes(node.type)
      );
      expect(foreign.length).toBeGreaterThan(0);

      for (const node of foreign) {
        expect(() => rule!.validate(node, context)).not.toThrow();
        expect(rule!.validate(node, context)).toEqual([]);
      }
    }
  );
});
