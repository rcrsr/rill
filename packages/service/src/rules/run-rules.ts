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

import type { ASTNode, ParseResult } from '@rcrsr/rill';
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
    }

    // Track HostCall nodes wrapped in TypeAssertion before rules run.
    if (node.type === 'TypeAssertion') {
      const hostCall = typeAssertedHostCall(node);
      if (hostCall !== null) {
        ruleContext.assertedHostCalls.add(hostCall);
      }
    }

    // Dispatch to every enabled rule that applies to this node type.
    for (const rule of rules) {
      const ruleState = resolveRuleState(rule.code, config);
      if (ruleState === 'off') {
        continue;
      }
      if (!rule.nodeTypes.includes(node.type)) {
        continue;
      }

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
    }
  };

  traverseForRules(parsed.ast, { enter, exit });

  return sortDiagnostics(diagnostics);
}
