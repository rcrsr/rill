/**
 * Shared capture/chain-adjacency primitives for CAPTURE_INLINE_CHAIN and
 * THROWAWAY_CAPTURE.
 *
 * Both rules need to recognize "a statement's trailing capture" and "the
 * head-primary expression of the following statement" to decide whether a
 * capture is immediately chained into the next statement. The
 * no-double-report invariant between the two rules (a capture that
 * CAPTURE_INLINE_CHAIN reports as a chainable pattern must never also be
 * reported by THROWAWAY_CAPTURE, and vice versa) only holds if both rules
 * evaluate the identical adjacency predicate - divergent copies would
 * silently drift apart and break it. These helpers are the single source of
 * truth for that predicate; both rule modules import them from here rather
 * than each defining their own.
 */

import type {
  ASTNode,
  CaptureNode,
  PipeChainNode,
  PostfixExprNode,
  StatementNode,
} from '@rcrsr/rill';

/** True when `node` is a CaptureNode. */
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
export function getPrimaryFromHead(chain: PipeChainNode): ASTNode | null {
  const head = chain.head;
  if (head.type === 'PostfixExpr') {
    return (head as PostfixExprNode).primary;
  }
  return null;
}

/**
 * Unwrap a top-level script entry to its inner `StatementNode`, whether it
 * is a plain `Statement` or an `AnnotatedStatement` wrapping one. Returns
 * `null` for any other node type.
 *
 * Annotations (`^(key: value) statement`) prefix a statement without
 * changing its expression shape, so adjacency checks that key off a
 * statement's `expression` must see through the wrapper. Callers that need
 * the full source range (including the annotation prefix) should still use
 * the original, unwrapped node's `span`.
 */
export function getInnerStatement(node: ASTNode): StatementNode | null {
  if (node.type === 'Statement') {
    return node as StatementNode;
  }
  if (node.type === 'AnnotatedStatement') {
    return (node as { statement: StatementNode }).statement;
  }
  return null;
}

/** Find the capture node ending a statement's chain, if any. */
export function findChainCapture(chain: PipeChainNode): CaptureNode | null {
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

/**
 * True when `refNode` sits anywhere inside the top-level statement
 * immediately following the top-level statement at `captureStatementIndex`.
 *
 * A use on the very next line is not "away from its capture", whatever its
 * position within that statement. Testing only the head-primary would
 * report `x => $x` / `guard { $x.field }` as a distant single use and tell
 * the author to inline something already adjacent. Containment is decided
 * by source offset rather than by descending the statement, because rules
 * must not sub-walk the AST (see no-subwalks.test.ts).
 */
export function isImmediatelyChained(
  captureStatementIndex: number,
  refNode: ASTNode,
  statements: readonly ASTNode[]
): boolean {
  const nextStatement = statements[captureStatementIndex + 1];
  if (!nextStatement || !getInnerStatement(nextStatement)) return false;

  // Half-open interval on the reference's start offset. A statement's end
  // offset is exclusive, and a Variable node's span is zero-width, so
  // comparing ends would read a reference at the head of the next statement
  // as belonging to the previous one.
  const refStart = refNode.span.start.offset;
  return (
    refStart >= nextStatement.span.start.offset &&
    refStart < nextStatement.span.end.offset
  );
}
