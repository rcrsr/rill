/**
 * Flow and Capture Rules
 * Enforces conventions for capture placement and flow patterns.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type {
  ASTNode,
  StatementNode,
  PipeChainNode,
  CaptureNode,
  ConditionalNode,
  BodyNode,
  PostfixExprNode,
} from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if a node is a capture node.
 */
function isCaptureNode(node: unknown): node is CaptureNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'Capture'
  );
}

/**
 * Check if a node contains a variable reference.
 * For $ (pipe variable), checks for isPipeVar: true.
 * For named variables, checks for the variable name.
 * This is a simplified check - a full implementation would traverse the AST.
 */
function referencesVariable(node: BodyNode | null, varName: string): boolean {
  if (!node) return false;

  // Convert node to string representation and check for variable usage
  // This is a heuristic - proper implementation would need AST traversal
  const nodeStr = JSON.stringify(node);

  if (varName === '$') {
    // Pipe variable has isPipeVar: true
    return nodeStr.includes('"isPipeVar":true');
  } else {
    // Named variable
    return nodeStr.includes(`"name":"${varName}"`);
  }
}

/**
 * Get the primary expression from a PipeChain's head.
 * ArithHead can be BinaryExprNode, UnaryExprNode, or PostfixExprNode.
 */
function getPrimaryFromHead(chain: PipeChainNode): ASTNode | null {
  const head = chain.head;

  // If head is PostfixExprNode, get its primary
  if (head.type === 'PostfixExpr') {
    return (head as PostfixExprNode).primary;
  }

  // For BinaryExprNode or UnaryExprNode, we can't easily get a single primary
  return null;
}

// ============================================================
// CAPTURE_INLINE_CHAIN RULE
// ============================================================

/**
 * Validates that captures use inline syntax when continuing the chain.
 *
 * Detects separate capture followed by variable usage:
 *   prompt("Read file") => $raw
 *   $raw -> log
 *
 * Suggests inline capture:
 *   prompt("Read file") => $raw -> log
 *
 * This is an informational rule - both patterns work, but inline is clearer.
 *
 * References:
 * - docs/16_conventions.md:56-74
 */
export const CAPTURE_INLINE_CHAIN: ValidationRule = {
  code: 'CAPTURE_INLINE_CHAIN',
  category: 'flow',
  severity: 'info',
  nodeTypes: ['Statement'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const statement = node as StatementNode;
    const chain = statement.expression;

    // Check if this chain ends with a capture
    // Captures can be in terminator OR as the last pipe element
    let captureNode: CaptureNode | null = null;

    if (chain.terminator && isCaptureNode(chain.terminator)) {
      captureNode = chain.terminator;
    } else if (chain.pipes.length > 0) {
      const lastPipe = chain.pipes[chain.pipes.length - 1];
      if (lastPipe && isCaptureNode(lastPipe)) {
        captureNode = lastPipe;
      }
    }

    if (!captureNode) {
      return [];
    }

    const capturedVarName = captureNode.name;

    // Get all statements from the script
    const statements = context.ast.statements;
    const currentIndex = statements.indexOf(statement);

    if (currentIndex === -1 || currentIndex === statements.length - 1) {
      return [];
    }

    const nextStatement = statements[currentIndex + 1];
    if (!nextStatement) return [];

    // Check if next statement is a Statement wrapping a PipeChain
    if (nextStatement.type !== 'Statement') {
      return [];
    }

    const nextStmt = nextStatement as StatementNode;
    const nextChain = nextStmt.expression;

    // Check if the head of the next chain is the captured variable
    const headPrimary = getPrimaryFromHead(nextChain);
    if (
      headPrimary &&
      headPrimary.type === 'Variable' &&
      'name' in headPrimary &&
      headPrimary.name === capturedVarName
    ) {
      // Found pattern: capture on one line, immediate usage on next line
      return [
        {
          location: captureNode.span.start,
          severity: 'info',
          code: 'CAPTURE_INLINE_CHAIN',
          message: `Consider inline capture: '=> $${capturedVarName} -> ...' instead of separate statements`,
          context: extractContextLine(
            captureNode.span.start.line,
            context.source
          ),
          fix: null, // Complex fix - requires merging statements
        },
      ];
    }

    return [];
  },
};

// ============================================================
// CAPTURE_BEFORE_BRANCH RULE
// ============================================================

/**
 * Validates that values used in multiple branches are captured before the conditional.
 *
 * Detects conditionals where a function call or expression appears in multiple branches:
 *   checkStatus() -> .contains("OK") ? {
 *     "Success: {checkStatus()}"
 *   } ! {
 *     "Failed: {checkStatus()}"
 *   }
 *
 * Suggests capturing before branching:
 *   checkStatus() => $result
 *   $result -> .contains("OK") ? {
 *     "Success: {$result}"
 *   } ! {
 *     "Failed: {$result}"
 *   }
 *
 * This is an informational rule - detects potential inefficiency and clarity issues.
 *
 * References:
 * - docs/16_conventions.md:76-88
 */
export const CAPTURE_BEFORE_BRANCH: ValidationRule = {
  code: 'CAPTURE_BEFORE_BRANCH',
  category: 'flow',
  severity: 'info',
  nodeTypes: ['Conditional'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const conditional = node as ConditionalNode;

    // Check if both branches exist
    if (!conditional.elseBranch) {
      return [];
    }

    // For piped conditionals (input is null), we can still suggest capturing
    // For explicit conditionals, check if input is complex
    const inputExpr = conditional.input;

    // If input exists and is already a simple variable, no need to capture
    if (inputExpr && inputExpr.type === 'PipeChain') {
      const headPrimary = getPrimaryFromHead(inputExpr);
      if (
        headPrimary &&
        headPrimary.type === 'Variable' &&
        inputExpr.pipes.length === 0 &&
        !inputExpr.terminator
      ) {
        return [];
      }
    }

    // Look for patterns where the input value might be used in both branches
    // This is heuristic-based: we check if there's a $ reference in both branches
    // which would be the piped value from the conditional input

    const thenReferences = referencesVariable(conditional.thenBranch, '$');
    // elseBranch can be BodyNode or ConditionalNode (for else-if chains)
    const elseBranch = conditional.elseBranch;
    const elseReferences =
      elseBranch && elseBranch.type !== 'Conditional'
        ? referencesVariable(elseBranch, '$')
        : false;

    // If $ is used in both branches, suggest capturing the input value
    // This makes it available in both branches with a clear name
    if (thenReferences && elseReferences) {
      return [
        {
          location: conditional.span.start,
          severity: 'info',
          code: 'CAPTURE_BEFORE_BRANCH',
          message:
            'Consider capturing value before conditional when used in multiple branches',
          context: extractContextLine(
            conditional.span.start.line,
            context.source
          ),
          fix: null, // Complex fix - requires AST restructuring
        },
      ];
    }

    return [];
  },
};
