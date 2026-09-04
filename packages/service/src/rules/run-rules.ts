/**
 * Rules engine orchestrator.
 * Runs two linear AST passes: a bottom-up fact-collection pass (`facts.ts`)
 * that computes every subtree fact the rules need, then a top-down dispatch
 * pass that invokes each rule on `enter`. No rule re-walks a subtree; total
 * node visits are 2n, independent of nesting depth.
 * Dispatches every visited node to the rules registered in
 * `rules-registry.ts`, resolves final diagnostic severity from per-rule
 * config state and any global override, and returns diagnostics sorted by
 * location.
 */

import type { ASTNode, NodeType, ParseResult } from '@rcrsr/rill';
import type {
  CheckConfig,
  Diagnostic,
  DiagnosticSeverity,
  Rule,
  RuleContext,
  RuleState,
} from './types.js';
import { RULES } from './rules.js';
import { traverseForRules, typeAssertedHostCall } from './traversal.js';
import { collectFacts } from './facts.js';
import { getCollectionOpBody, isCollectionOpCall } from './collection-ops.js';

// ============================================================
// SEVERITY RESOLUTION
// ============================================================

/**
 * Resolve a rule's configured state, defaulting to 'on' when the rule has
 * no entry in `config.rules`.
 */
function resolveRuleState(code: string, config: CheckConfig): RuleState {
  return config.rules[code] ?? 'on';
}

/**
 * Resolve the final severity for a diagnostic emitted by a rule.
 * A global `config.severity` override wins outright; otherwise a `warn`
 * rule state remaps the rule's own emitted severity to 'warning'; an `on`
 * state keeps the emitted severity unchanged.
 */
function resolveDiagnosticSeverity(
  emittedSeverity: DiagnosticSeverity,
  ruleState: RuleState,
  globalOverride: DiagnosticSeverity | undefined
): DiagnosticSeverity {
  if (globalOverride !== undefined) {
    return globalOverride;
  }
  if (ruleState === 'warn') {
    return 'warning';
  }
  return emittedSeverity;
}

// ============================================================
// DIAGNOSTIC SORT
// ============================================================

/**
 * Comparator implementing line-then-column diagnostic ordering. Exported
 * so orchestrator mechanics can be exercised directly by tests.
 */
export function compareDiagnosticLocation(
  a: Diagnostic,
  b: Diagnostic
): number {
  if (a.location.line !== b.location.line) {
    return a.location.line - b.location.line;
  }
  return a.location.column - b.location.column;
}

/**
 * Sort diagnostics by line number first, then column number. Stable sort
 * preserves original order for diagnostics at the same location.
 */
function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareDiagnosticLocation);
}

// ============================================================
// RULE BUCKETING
// ============================================================

/** A rule paired with its pre-resolved (never 'off') configured state. */
interface EnabledRule {
  readonly rule: Rule;
  readonly ruleState: RuleState;
}

/**
 * Buckets enabled rules by the node types they target, resolving each
 * rule's configured state once up front instead of per visited node.
 * Rules are iterated in registry order, so each bucket preserves that
 * order; the O(41) per-node `nodeTypes.includes` scan collapses into a
 * single `Map` lookup during traversal.
 */
function buildEnabledRuleBuckets(
  rules: readonly Rule[],
  config: CheckConfig
): Map<NodeType, EnabledRule[]> {
  const buckets = new Map<NodeType, EnabledRule[]>();
  for (const rule of rules) {
    const ruleState = resolveRuleState(rule.code, config);
    if (ruleState === 'off') {
      continue;
    }
    for (const nodeType of rule.nodeTypes) {
      let bucket = buckets.get(nodeType);
      if (!bucket) {
        bucket = [];
        buckets.set(nodeType, bucket);
      }
      bucket.push({ rule, ruleState });
    }
  }
  return buckets;
}

// ============================================================
// ORCHESTRATOR
// ============================================================

/**
 * Run the rules engine against a parsed script.
 * Traverses `parsed.ast` once, invoking every rule in `rules` (defaults to
 * the shared registry) whose `nodeTypes` matches the visited node and
 * whose configured state is not 'off'. Never throws: malformed regions
 * (RecoveryErrorNode, PartialExpressionNode) are traversed like any other
 * node and simply produce no rule matches unless a rule explicitly targets
 * them. A rule whose own `validate` throws (e.g. on an unexpected partial
 * shape) is isolated: its contribution for that node is skipped and every
 * other rule still runs, so one misbehaving rule cannot blank out
 * diagnostics for the whole document.
 */
export function runRules(
  parsed: ParseResult,
  source: string,
  config: CheckConfig,
  rules: readonly Rule[] = RULES
): Diagnostic[] {
  const facts = collectFacts(parsed.ast);
  const ruleBuckets = buildEnabledRuleBuckets(rules, config);

  // Loop-body Block nodes get their own scope: a bare `{...}` body of a
  // collection-op call (`seq`, `fan`, `fold`, `filter`, `acc`) or a
  // `while`/`do-while` loop. Populated up front from the AST (mirrors
  // `facts.ts`'s `collectionOpBlockBodies`) so `enter`/`exit` can push/pop
  // these Blocks onto `scopeStack` without re-deriving membership per node.
  // Scoped narrowly to loop bodies only - NOT conditional/guard/retry
  // Blocks - so a script-level variable reassigned inside one of those
  // still resolves to the enclosing (script) scope and fires reassignment
  // diagnostics as before.
  const loopBodyBlocks = new Set<ASTNode>();
  const collectLoopBodyBlocks = (node: ASTNode): void => {
    if (isCollectionOpCall(node)) {
      const body = getCollectionOpBody(node);
      if (body && body.type === 'Block') {
        loopBodyBlocks.add(body);
      }
    } else if (node.type === 'WhileLoop' || node.type === 'DoWhileLoop') {
      if (node.body.type === 'Block') {
        loopBodyBlocks.add(node.body);
      }
    }
  };
  traverseForRules(parsed.ast, {
    enter: collectLoopBodyBlocks,
    exit: () => {},
  });

  const ruleContext: RuleContext = {
    source,
    variables: new Map(),
    variableScopes: new Map(),
    scopeStack: [],
    assertedHostCalls: new Set(),
    checkerMode: config.checkerMode,
    facts,
  };

  const diagnostics: Diagnostic[] = [];

  const enter = (node: ASTNode): void => {
    // Track closure scope entry.
    if (node.type === 'Closure') {
      ruleContext.scopeStack.push(node);
    } else if (node.type === 'Block' && loopBodyBlocks.has(node)) {
      // A bare-Block loop body (collection-op or while/do-while) is its own
      // scope, distinct from sibling loop bodies at the same nesting depth.
      ruleContext.scopeStack.push(node);
    }

    // Track HostCall nodes wrapped in TypeAssertion before rules run.
    if (node.type === 'TypeAssertion') {
      const hostCall = typeAssertedHostCall(node);
      if (hostCall !== null) {
        ruleContext.assertedHostCalls.add(hostCall);
      }
    }

    // Dispatch to every enabled rule bucketed under this node type, in
    // registry order.
    const bucket = ruleBuckets.get(node.type);
    for (const { rule, ruleState } of bucket ?? []) {
      let ruleDiagnostics: Diagnostic[];
      try {
        ruleDiagnostics = rule.validate(node, ruleContext);
      } catch {
        // Isolate a throwing rule: skip its contribution for this node,
        // remaining rules keep running.
        continue;
      }
      for (const diagnostic of ruleDiagnostics) {
        diagnostics.push({
          ...diagnostic,
          severity: resolveDiagnosticSeverity(
            diagnostic.severity,
            ruleState,
            config.severity
          ),
        });
      }
    }

    // Track variable captures after rules run (reassignment detection
    // reads the pre-capture state).
    if (node.type === 'Capture') {
      if (!ruleContext.variables.has(node.name)) {
        ruleContext.variables.set(node.name, node.span.start);
        const currentScope =
          ruleContext.scopeStack.length > 0
            ? ruleContext.scopeStack[ruleContext.scopeStack.length - 1]
            : null;
        ruleContext.variableScopes.set(node.name, currentScope ?? null);
      }
    }
  };

  const exit = (node: ASTNode): void => {
    if (node.type === 'Closure') {
      ruleContext.scopeStack.pop();
    } else if (node.type === 'Block' && loopBodyBlocks.has(node)) {
      ruleContext.scopeStack.pop();
    }
  };

  traverseForRules(parsed.ast, { enter, exit });

  return sortDiagnostics(diagnostics);
}
