/**
 * Validates that captures use inline syntax when continuing the chain.
 *
 * Detects a separate capture followed by immediate variable usage:
 *   prompt("Read file") => $raw
 *   $raw -> log
 *
 * Suggests inline capture:
 *   prompt("Read file") => $raw -> log
 *
 * This is an informational rule - both patterns work, but inline is
 * clearer.
 *
 * The source rule (flow.ts:95-169) reads sibling statements off
 * `context.ast.statements`, which the validator sets once to the
 * top-level ScriptNode's statement list for the whole traversal.
 * `statements.indexOf(statement)` therefore returns -1 for any statement
 * nested inside a block, so the source rule can only ever fire on
 * top-level script statements, never inside a closure body, conditional
 * branch, or loop body. This port targets the `Script` node directly and
 * walks its own top-level `statements` array to reproduce that same
 * top-level-only lookahead without adding a new field to `RuleContext`.
 */

import type { ASTNode, ScriptNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import {
  findChainCapture,
  getInnerStatement,
  getPrimaryFromHead,
  isImmediatelyChained,
} from './capture-chain.js';

// ============================================================
// HELPERS
// ============================================================

/** Check consecutive statement pairs in a statement list for the pattern. */
function checkStatementList(
  statements: readonly ASTNode[],
  source: string
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < statements.length - 1; i++) {
    const statement = statements[i];
    if (!statement) continue;
    const innerStatement = getInnerStatement(statement);
    if (!innerStatement) continue;

    const captureNode = findChainCapture(innerStatement.expression);
    if (!captureNode) continue;

    const capturedVarName = captureNode.name;

    const nextStatement = statements[i + 1];
    if (!nextStatement) continue;
    const nextInnerStatement = getInnerStatement(nextStatement);
    if (!nextInnerStatement) continue;

    const nextChain = nextInnerStatement.expression;
    const headPrimary = getPrimaryFromHead(nextChain);

    if (
      headPrimary &&
      isImmediatelyChained(i, headPrimary, statements) &&
      headPrimary.type === 'Variable' &&
      headPrimary.name === capturedVarName
    ) {
      diagnostics.push({
        code: 'CAPTURE_INLINE_CHAIN',
        message: `Consider inline capture: '=> $${capturedVarName} -> ...' instead of separate statements`,
        severity: 'info',
        location: captureNode.span.start,
        context: extractContextLine(captureNode.span.start.line, source),
        fix: null,
      });
    }
  }

  return diagnostics;
}

// ============================================================
// RULE
// ============================================================

export const captureInlineChain: Rule = {
  code: 'CAPTURE_INLINE_CHAIN',
  nodeTypes: ['Script'],
  defaultSeverity: 'info',
  category: 'flow',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const scriptNode = node as ScriptNode;
    return checkStatementList(scriptNode.statements, context.source);
  },
};

registeredRules.push(captureInlineChain);
