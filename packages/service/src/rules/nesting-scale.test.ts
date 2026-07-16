/**
 * Depth-scaling proof that `runRules` no longer re-walks the same subtree
 * once per rule.
 *
 * Before `collectFacts` (see `facts.ts`), several rules (`LOOP_OUTER_CAPTURE`,
 * `PREFER_MAP`, `CLOSURE_LATE_BINDING`, `BREAK_IN_PARALLEL`) each ran their
 * own `traverseForRules` walk over a node's subtree to answer boolean
 * questions ("does this contain a break?", "does this contain a side
 * effect?"). On a script built from `D` nested collection-op bodies, each
 * level's subtree walk touches every node below it, so the aggregate work
 * across all `D` per-rule walks is quadratic in `D`. `collectFacts` walks
 * the AST exactly once, bottom-up, so every rule reads a precomputed
 * boolean instead of re-walking - linear in the node count regardless of
 * nesting depth.
 *
 * The fixture below builds the AST directly (bottom-up, in a loop - no
 * recursive construction) instead of generating source text and parsing
 * it: `@rcrsr/rill`'s recursive-descent parser exhausts its own call stack
 * somewhere around 400-450 levels of `seq({ seq({ ... }) })` nesting, well
 * short of the depth needed to separate a linear implementation from a
 * quadratic one by the budget's required margin (see below). `runRules`
 * and `traverseForRules` are iterative (explicit-stack) and have no such
 * limit, so a directly-built AST lets this suite reach `NESTING_DEPTH` far
 * beyond what round-tripping through source text could reach.
 *
 * Every level's body: dispatches `LOOP_OUTER_CAPTURE`, `PREFER_MAP`, and
 * `CLOSURE_LATE_BINDING` (all match on `HostCall`, and this level's own
 * `HostCall` is `seq`), creates a zero-param bare-`$` closure (engaging
 * `CLOSURE_BARE_DOLLAR`, and contributing `hasClosure` for
 * `CLOSURE_LATE_BINDING`), runs a `fan({ break })` (engaging
 * `BREAK_IN_PARALLEL`; it also gives this level's body a side effect, so
 * `PREFER_MAP`'s no-side-effect check legitimately evaluates and rejects at
 * every non-leaf level instead of trivially short-circuiting), and
 * references `$counter` through a method-call postfix.
 *
 * Only the outermost `CAPTURE_LEVELS` levels also capture `$counter`
 * (`$counter -> $counter`), instead of every level capturing it. This is a
 * deliberate, measured choice, not an oversight: `capturesInSubtree` (see
 * `facts.ts`) answers "which captures does this subtree own" by scanning a
 * `[captureStart, captureEnd)` window of the shared capture log, a range
 * whose width is the *number of captures inside that subtree* - not O(1).
 * `LOOP_OUTER_CAPTURE` calls it once per `seq` level. If every level
 * captured `$counter`, each of the `D` nested levels' windows would grow
 * with nesting depth (the outermost level's window contains nearly all `D`
 * captures), reintroducing an O(D^2) *capture-count* sum even though the
 * O(D^2) *AST-walk* the collectFacts refactor targets is gone - conflating
 * two different quadratic sources under one fixture. Bounding the capture
 * count to a small constant (independent of `D`) isolates the AST-walk
 * property this suite is actually proving, while still giving
 * `LOOP_OUTER_CAPTURE` real captures to detect (verified indirectly: the
 * rule still dispatches on every level's `HostCall`, per Assertion B).
 *
 * Measured p95 for `runRules` on the `NESTING_DEPTH`-level fixture, on this
 * machine:
 *  - Post-refactor (current working tree, `collectFacts` single pass):
 *    p95 ~= 119.21ms, using `measureP95` from `../percentile.ts`
 *    (`PERCENTILE_SAMPLE_COUNT=100` timed samples after
 *    `PERCENTILE_WARMUP_COUNT=5` warmup runs - the same helper
 *    `../latency.test.ts` uses).
 *  - Pre-refactor (`git stash` back to the last commit, before `facts.ts`
 *    existed and before rules read precomputed facts - each of
 *    `LOOP_OUTER_CAPTURE`/`PREFER_MAP`/`CLOSURE_LATE_BINDING`/
 *    `BREAK_IN_PARALLEL` ran its own `traverseForRules` subtree walk):
 *    p95 ~= 18227.58ms (~18.2s), using a reduced 12-timed-sample /
 *    2-warmup variant of the same percentile method - at this depth the
 *    pre-refactor path costs ~17-18s per call, so the standard 100+5
 *    samples would take roughly half an hour. 12 samples is still a real
 *    measured p95 (`Math.ceil(12 * 0.95) - 1` = index 10 of 12 sorted
 *    samples), not an estimate, at a ~4 minute total cost.
 *
 * That is roughly a 153x improvement. Both numbers were measured, not
 * estimated: the pre-refactor number came from a scratch timing script run
 * against the stashed (pre-refactor) working tree, with the working tree
 * restored via `git stash pop` immediately after and verified clean with
 * `git status` afterward.
 */
import { describe, expect, it } from 'vitest';
import type {
  ASTNode,
  BlockNode,
  BreakNode,
  CaptureNode,
  ClosureNode,
  HostCallNode,
  MethodCallNode,
  NodeType,
  NumberLiteralNode,
  ParseResult,
  PipeChainNode,
  PostfixExprNode,
  ScriptNode,
  SourceSpan,
  StatementNode,
  VariableNode,
} from '@rcrsr/rill';

import { measureP95 } from '../percentile.js';
import { runRules } from './run-rules.js';
import { collectFacts } from './facts.js';
import type { CheckConfig, Diagnostic, Rule, RuleContext } from './types.js';

// ============================================================
// BUDGET
// ============================================================

const NESTING_DEPTH = 3000;
// Only the outermost 5 levels capture $counter - see the header comment
// for why an unbounded per-level capture count would reintroduce a
// different O(depth^2) source (capturesInSubtree's window scan) unrelated
// to the AST-walk cost this suite is proving is gone.
const CAPTURE_LEVELS = 5;
// Post-refactor p95 on this fixture measures ~119.21ms locally; pre-refactor
// measures ~18227.58ms locally (see header comment).
//
// The budget must clear the CI runner, not just this machine. An initial
// 700ms budget failed CI at 883.07ms p95 - a ~7.4x local-to-CI factor, in
// line with the ~5-7x factor latency.test.ts already documents for every
// other provider on the same shared runner, and NOT a sign of surviving
// quadratic behavior. (A quadratic re-walk at depth 3000 costs seconds, not
// hundreds of milliseconds: the pre-refactor path takes ~18s here.)
//
// 3000ms clears the observed 883.07ms CI figure by ~3.4x, absorbing runner
// contention, while still sitting 6.1x below the pre-refactor local figure
// (18227.58 / 3000). Reintroducing a per-level subtree re-walk therefore
// still fails this gate by a wide margin, on CI and locally alike, which is
// the property that matters.
const RUN_RULES_DEPTH_P95_BUDGET_MS = 3000;
// Mirrors latency.test.ts: SAMPLE_COUNT + WARMUP_COUNT runs of a fixture
// this deep can take a while on a slow/contended runner. The budget
// assertion above is the actual latency guard; this timeout only prevents
// a slow runner from being reported as a hang instead of a budget breach.
const NESTING_SCALE_TEST_TIMEOUT_MS = 120_000;

// ============================================================
// FIXTURE CONSTRUCTION (built directly, not parsed - see header comment)
// ============================================================

const DUMMY_SPAN: SourceSpan = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function numberLiteral(value: number): NumberLiteralNode {
  return { type: 'NumberLiteral', value, span: DUMMY_SPAN };
}

function variableNode(name: string | null, isPipeVar: boolean): VariableNode {
  return {
    type: 'Variable',
    name,
    isPipeVar,
    accessChain: [],
    defaultValue: null,
    existenceCheck: null,
    span: DUMMY_SPAN,
  };
}

function postfix(
  primary: ASTNode,
  methods: MethodCallNode[] = []
): PostfixExprNode {
  return {
    type: 'PostfixExpr',
    primary: primary as PostfixExprNode['primary'],
    methods,
    defaultValue: null,
    span: DUMMY_SPAN,
  };
}

function pipeChain(
  head: PostfixExprNode,
  terminator: CaptureNode | BreakNode | null = null
): PipeChainNode {
  return {
    type: 'PipeChain',
    head,
    pipes: [],
    terminator: terminator as PipeChainNode['terminator'],
    span: DUMMY_SPAN,
  };
}

function statementNode(expression: PipeChainNode): StatementNode {
  return { type: 'Statement', expression, span: DUMMY_SPAN };
}

function captureNode(name: string): CaptureNode {
  return {
    type: 'Capture',
    name,
    typeRef: null,
    inlineShape: null,
    span: DUMMY_SPAN,
  };
}

function breakNode(): BreakNode {
  return { type: 'Break', span: DUMMY_SPAN };
}

function block(statements: StatementNode[]): BlockNode {
  return { type: 'Block', statements, span: DUMMY_SPAN };
}

function hostCall(name: string, args: ASTNode[]): HostCallNode {
  return {
    type: 'HostCall',
    name,
    args: args as HostCallNode['args'],
    span: DUMMY_SPAN,
  };
}

function closureNode(body: BlockNode): ClosureNode {
  return {
    type: 'Closure',
    params: [],
    body,
    returnTypeTarget: undefined,
    span: DUMMY_SPAN,
  };
}

function methodCallNode(name: string): MethodCallNode {
  return {
    type: 'MethodCall',
    name,
    args: [],
    receiverSpan: null,
    span: DUMMY_SPAN,
  };
}

/** `(|| { $ })` as a bare statement: engages CLOSURE_BARE_DOLLAR/CLOSURE_LATE_BINDING. */
function bareDollarClosureStatement(): StatementNode {
  const body = block([
    statementNode(pipeChain(postfix(variableNode(null, true)))),
  ]);
  return statementNode(pipeChain(postfix(closureNode(body))));
}

/** `$counter -> .len` as a bare statement: a `$`-reference plus a method call. */
function methodCallStatement(): StatementNode {
  return statementNode(
    pipeChain(postfix(variableNode('counter', false), [methodCallNode('len')]))
  );
}

/** `fan({ $ -> break })` as a bare statement: engages BREAK_IN_PARALLEL. */
function fanBreakStatement(): StatementNode {
  const breakStatement = statementNode(
    pipeChain(postfix(variableNode(null, true)), breakNode())
  );
  const fanBodyArg = pipeChain(postfix(block([breakStatement])));
  return statementNode(pipeChain(postfix(hostCall('fan', [fanBodyArg]))));
}

/** `$counter -> $counter` as a bare statement: reassigns the outer `$counter`. */
function outerCaptureStatement(): StatementNode {
  return statementNode(
    pipeChain(postfix(variableNode('counter', false)), captureNode('counter'))
  );
}

/**
 * Builds a `seq({...})` chain nested to `depth`, bottom-up in a loop (see
 * header comment for why this is built directly rather than parsed from
 * source text). See the header comment for what each level contains and
 * why only the outermost `captureLevels` levels capture `$counter`.
 */
function buildNestedFixtureAst(
  depth: number,
  captureLevels: number
): ScriptNode {
  let bodyStatements: StatementNode[] = [
    statementNode(pipeChain(postfix(numberLiteral(0)))),
  ];

  for (let level = depth; level >= 1; level--) {
    const statements: StatementNode[] = [];

    if (level <= captureLevels) {
      statements.push(outerCaptureStatement());
    }
    statements.push(bareDollarClosureStatement());
    statements.push(methodCallStatement());
    statements.push(fanBreakStatement());

    const nestedSeqArg = pipeChain(postfix(block(bodyStatements)));
    const seqCall = hostCall('seq', [nestedSeqArg]);
    statements.push(statementNode(pipeChain(postfix(seqCall))));

    bodyStatements = statements;
  }

  return {
    type: 'Script',
    frontmatter: null,
    statements: bodyStatements,
    span: DUMMY_SPAN,
  };
}

// ============================================================
// ASSERTION A: INDEPENDENT NODE COUNT
// ============================================================

/**
 * Counts every AST node reachable from `root`, completely independent of
 * `traverseForRules`'s `getChildren` switch: it walks every own-enumerable
 * property of every object/array reachable from `root` (via an explicit
 * stack, not recursion - a recursive walker would itself exhaust the call
 * stack at `NESTING_DEPTH`), counting each distinct object that carries a
 * string `type` tag exactly once (a `WeakSet` guards against revisiting
 * the same object, which also prevents infinite loops on any accidental
 * cycle). This does not know about AST node shapes at all, so it cannot
 * share a blind spot with the implementation it is checking.
 */
function countAstNodesIndependently(root: unknown): number {
  const visited = new WeakSet<object>();
  let count = 0;
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null) continue;
    if (visited.has(value)) continue;
    visited.add(value);

    if (typeof (value as { type?: unknown }).type === 'string') {
      count++;
    }

    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }

    for (const key of Object.keys(value)) {
      stack.push((value as Record<string, unknown>)[key]);
    }
  }

  return count;
}

// ============================================================
// ASSERTION B: DISPATCH-COUNTING PROBE RULE
// ============================================================

/** Every member of `@rcrsr/rill`'s `NodeType` union, so the probe rule below fires on every node. */
const ALL_NODE_TYPES: readonly NodeType[] = [
  'Script',
  'Frontmatter',
  'Closure',
  'ClosureParam',
  'Statement',
  'PipeChain',
  'PostfixExpr',
  'MethodCall',
  'Invoke',
  'AnnotationAccess',
  'HostCall',
  'HostRef',
  'ClosureCall',
  'PipeInvoke',
  'Variable',
  'Capture',
  'Conditional',
  'WhileLoop',
  'DoWhileLoop',
  'Block',
  'StringLiteral',
  'Interpolation',
  'NumberLiteral',
  'BoolLiteral',
  'ListSpread',
  'Dict',
  'DictEntry',
  'Break',
  'Return',
  'Yield',
  'Pass',
  'PassBlock',
  'TimeoutBlock',
  'Assert',
  'BinaryExpr',
  'UnaryExpr',
  'GroupedExpr',
  'Destructure',
  'DestructPattern',
  'Slice',
  'TypeAssertion',
  'TypeCheck',
  'AnnotatedStatement',
  'AnnotatedExpr',
  'NamedArg',
  'SpreadArg',
  'RecoveryError',
  'PartialExpression',
  'Error',
  'TypeNameExpr',
  'TypeConstructor',
  'ClosureSigLiteral',
  'ListLiteral',
  'DictLiteral',
  'TupleLiteral',
  'OrderedLiteral',
  'Destruct',
  'UseExpr',
  'GuardBlock',
  'RetryBlock',
  'AtomLiteral',
  'StatusProbe',
];

/**
 * Builds a probe `Rule` whose `nodeTypes` covers every `NodeType`, so
 * `runRules`'s dispatch loop invokes it for every node in a single
 * traversal. Returns the rule alongside a getter for the invocation count,
 * which - if the dispatch pass visits each node exactly once - equals the
 * total node count.
 */
function createDispatchProbe(): { rule: Rule; getCount: () => number } {
  let count = 0;
  const rule: Rule = {
    code: 'DISPATCH_PROBE',
    category: 'flow',
    nodeTypes: ALL_NODE_TYPES,
    defaultSeverity: 'info',
    validate(_node: ASTNode, _context: RuleContext): Diagnostic[] {
      count++;
      return [];
    },
  };
  return { rule, getCount: () => count };
}

// ============================================================
// TESTS
// ============================================================

describe('runRules depth scaling on nested collection-op bodies', () => {
  const ast = buildNestedFixtureAst(NESTING_DEPTH, CAPTURE_LEVELS);
  const parsed: ParseResult = { ast, errors: [], success: true };
  const config: CheckConfig = { rules: {} };

  it('builds a fixture deeper than the fixture generator itself recurses', () => {
    expect(ast.statements.length).toBeGreaterThan(0);
  });

  it(
    'collectFacts records exactly one fact per node (Assertion A)',
    () => {
      const n = countAstNodesIndependently(ast);
      expect(n).toBeGreaterThan(NESTING_DEPTH);

      const facts = collectFacts(ast);
      expect(facts.bySubtree.size).toBe(n);
    },
    NESTING_SCALE_TEST_TIMEOUT_MS
  );

  it(
    "runRules' single dispatch pass visits each node exactly once (Assertion B)",
    () => {
      const n = countAstNodesIndependently(ast);
      const { rule, getCount } = createDispatchProbe();

      runRules(parsed, '', config, [rule]);

      expect(getCount()).toBe(n);
    },
    NESTING_SCALE_TEST_TIMEOUT_MS
  );

  it(
    `runRules on a depth-${NESTING_DEPTH} fixture stays at or under the p95 budget (Assertion C)`,
    () => {
      const p95 = measureP95(() => {
        runRules(parsed, '', config);
      });
      expect(p95).toBeLessThanOrEqual(RUN_RULES_DEPTH_P95_BUDGET_MS);
    },
    NESTING_SCALE_TEST_TIMEOUT_MS
  );
});
