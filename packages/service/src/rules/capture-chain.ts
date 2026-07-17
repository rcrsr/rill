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
 * silently drift apart and break it. These three helpers are the single
 * source of truth for that predicate; both rule modules import them from
 * here rather than each defining their own.
 */

import type {
  ASTNode,
  CaptureNode,
  PipeChainNode,
  PostfixExprNode,
} from '@rcrsr/rill';

/** True when `node` is a CaptureNode. */
export function isCaptureNode(node: unknown): node is CaptureNode {
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
