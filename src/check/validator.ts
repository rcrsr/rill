/**
 * Script Validator
 * Orchestrates validation by traversing AST and invoking enabled rules.
 */

import type {
  ScriptNode,
  ASTNode,
  CaptureNode,
  TypeAssertionNode,
} from '../types.js';
import type { CheckConfig, Diagnostic, ValidationContext } from './types.js';
import { visitNode, type RuleVisitor } from './visitor.js';
import { VALIDATION_RULES } from './rules/index.js';

// ============================================================
// VALIDATION ORCHESTRATOR
// ============================================================

/**
 * Validate script AST against all enabled rules.
 * Traverses AST using visitor pattern, invoking enabled rules for matching nodes.
 * Returns diagnostics sorted by line number, then column.
 *
 * @param ast - Parsed script AST to validate
 * @param source - Original source text for context extraction
 * @param config - Configuration determining which rules are active
 * @returns Array of diagnostics sorted by location
 */
export function validateScript(
  ast: ScriptNode,
  source: string,
  config: CheckConfig
): Diagnostic[] {
  // Create validation context
  const context: ValidationContext = {
    source,
    ast,
    config,
    diagnostics: [],
    variables: new Map(),
    assertedHostCalls: new Set(),
    variableScopes: new Map(),
    scopeStack: [],
  };

  // Create visitor that invokes enabled rules
  const visitor: RuleVisitor = {
    enter(node: ASTNode, ctx: ValidationContext): void {
      // Track closure scope entry
      if (node.type === 'Closure') {
        ctx.scopeStack.push(node);
      }

      // Track HostCall nodes wrapped in TypeAssertion BEFORE rules check
      if (node.type === 'TypeAssertion') {
        const operand = (node as TypeAssertionNode).operand;
        if (operand?.primary.type === 'HostCall') {
          ctx.assertedHostCalls.add(operand.primary);
        }
      }

      // For each enabled rule that applies to this node type
      for (const rule of VALIDATION_RULES) {
        // Skip if rule not enabled
        if (!isRuleEnabled(rule.code, ctx.config)) {
          continue;
        }

        // Skip if rule doesn't apply to this node type
        if (!rule.nodeTypes.includes(node.type)) {
          continue;
        }

        // Invoke rule validation and accumulate diagnostics
        const ruleDiagnostics = rule.validate(node, ctx);
        ctx.diagnostics.push(...ruleDiagnostics);
      }

      // Track variable captures AFTER rules check (for reassignment detection)
      if (node.type === 'Capture') {
        const captureNode = node as CaptureNode;
        if (!ctx.variables.has(captureNode.name)) {
          ctx.variables.set(captureNode.name, node.span.start);
          // Track which closure scope this variable belongs to
          const currentScope =
            ctx.scopeStack.length > 0
              ? ctx.scopeStack[ctx.scopeStack.length - 1]
              : null;
          ctx.variableScopes.set(captureNode.name, currentScope ?? null);
        }
      }
    },

    exit(node: ASTNode, ctx: ValidationContext): void {
      // Track closure scope exit
      if (node.type === 'Closure') {
        ctx.scopeStack.pop();
      }
    },
  };

  // Traverse AST with visitor
  visitNode(ast, context, visitor);

  // Sort diagnostics by location (line first, then column)
  return sortDiagnostics(context.diagnostics);
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Check if a rule is enabled based on configuration.
 * Rules are enabled if state is 'on' or 'warn'.
 */
function isRuleEnabled(ruleCode: string, config: CheckConfig): boolean {
  const state = config.rules[ruleCode];
  return state === 'on' || state === 'warn';
}

/**
 * Sort diagnostics by line number first, then column number.
 * Stable sort preserves original order for diagnostics at same location.
 */
function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    // Sort by line first
    if (a.location.line !== b.location.line) {
      return a.location.line - b.location.line;
    }
    // Then by column
    return a.location.column - b.location.column;
  });
}
