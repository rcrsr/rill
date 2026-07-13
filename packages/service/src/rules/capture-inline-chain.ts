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

import type {
  ASTNode,
  CaptureNode,
  PipeChainNode,
  PostfixExprNode,
  ScriptNode,
  StatementNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// HELPERS
// ============================================================

function isCaptureNode(node: unknown): node is CaptureNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    (node as { type: unknown }).type === 'Capture'
  );
}

/**
 * Get the primary expression from a PipeChain's head.
 * ArithHead can be BinaryExprNode, UnaryExprNode, or PostfixExprNode.
 */
function getPrimaryFromHead(chain: PipeChainNode): ASTNode | null {
  const head = chain.head;
  if (head.type === 'PostfixExpr') {
    return (head as PostfixExprNode).primary;
  }
  return null;
}

/** Find the capture node ending a statement's chain, if any. */
function findChainCapture(chain: PipeChainNode): CaptureNode | null {
  if (chain.terminator && isCaptureNode(chain.terminator)) {
    return chain.terminator;
  }
  if (chain.pipes.length > 0) {
    const lastPipe = chain.pipes[chain.pipes.length - 1];
    if (lastPipe && isCaptureNode(lastPipe)) {
      return lastPipe;
    }
  }
  return null;
}

/** Check consecutive statement pairs in a statement list for the pattern. */
function checkStatementList(
  statements: readonly ASTNode[],
  source: string
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < statements.length - 1; i++) {
    const statement = statements[i];
    if (!statement || statement.type !== 'Statement') continue;

    const captureNode = findChainCapture(
      (statement as StatementNode).expression
    );
    if (!captureNode) continue;

    const capturedVarName = captureNode.name;

    const nextStatement = statements[i + 1];
    if (!nextStatement || nextStatement.type !== 'Statement') continue;

    const nextChain = (nextStatement as StatementNode).expression;
    const headPrimary = getPrimaryFromHead(nextChain);

    if (
      headPrimary &&
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

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const scriptNode = node as ScriptNode;
    return checkStatementList(scriptNode.statements, context.source);
  },
};

registeredRules.push(captureInlineChain);
