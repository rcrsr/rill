/**
 * Hierarchical document outline: one `DocumentSymbol` per top-level capture
 * (`=> $name`), closure literal (`|params| body`), and dict entry key.
 */

import { walkAst } from '@rcrsr/rill';
import type { ASTNode, ParseResult, SourceSpan } from '@rcrsr/rill';
import { dictKeyName, dictKeySpan } from './dict-key.js';
import { spanToRange } from './span-to-range.js';
import type { DocumentSymbol } from './types.js';

/**
 * Builds a flat outline of a parsed rill document.
 *
 * Traverses the AST via core `walkAst`, which visits every node
 * (`RecoveryErrorNode`/`PartialExpressionNode` included) without throwing,
 * so a partially-recovered parse yields whatever symbols are resolvable
 * instead of failing. An empty or fully-unparseable script yields `[]`.
 */
export function documentSymbols(parsed: ParseResult): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  // ClosureNode is anonymous: it carries no name of its own. When a closure
  // literal is captured directly (`|x| (...) => $name`), the enclosing
  // PipeChain's terminator holds the name. PipeChain is visited before its
  // `head` subtree (walkAst is parent-before-children), and the full AST
  // already exists in memory, so `node.terminator` is readable at that point
  // regardless of visit order. Record the mapping here, then consume it when
  // the walk reaches the ClosureNode itself.
  //
  // A capture whose value is a closure names the closure, not a separate
  // variable: it surfaces as a single `function` symbol, so the CaptureNode
  // terminator itself is recorded in `namesClosure` and skipped when the
  // walk later visits it as a plain Capture.
  const closureCaptureSpan = new Map<ASTNode, SourceSpan>();
  const closureName = new Map<ASTNode, string>();
  const namesClosure = new Set<ASTNode>();

  walkAst(parsed.ast, (node) => {
    switch (node.type) {
      case 'PipeChain': {
        const head = node.head;
        if (
          head.type === 'PostfixExpr' &&
          head.methods.length === 0 &&
          head.defaultValue === null &&
          head.primary.type === 'Closure'
        ) {
          // A directly-captured closure (`|x| (...) => $name`) surfaces the
          // capture as either the sole entry in `pipes` (bare `=>`/`->`
          // capture) or as `terminator` (capture ending a longer chain);
          // either shape names the same closure literal.
          const capture =
            node.terminator?.type === 'Capture'
              ? node.terminator
              : node.pipes.length === 1 && node.pipes[0]?.type === 'Capture'
                ? node.pipes[0]
                : null;
          if (capture !== null) {
            closureName.set(head.primary, capture.name);
            closureCaptureSpan.set(head.primary, capture.span);
            namesClosure.add(capture);
          }
        }
        break;
      }
      case 'Capture': {
        if (namesClosure.has(node)) break;
        const range = spanToRange(node.span);
        symbols.push({
          name: node.name,
          kind: 'variable',
          range,
          // CaptureNode.span already runs from the leading `$` through the
          // optional `:type` suffix, i.e. essentially the name token; no
          // narrower name-only span exists on this node, so range and
          // selectionRange coincide.
          selectionRange: range,
        });
        break;
      }
      case 'Closure': {
        const name = closureName.get(node);
        if (name === undefined) break;
        const nameSpan = closureCaptureSpan.get(node);
        symbols.push({
          name,
          kind: 'function',
          range: spanToRange(node.span),
          // Prefer the capturing CaptureNode's span for selectionRange since
          // ClosureNode itself is anonymous and has no name token; fall back
          // to the closure's own span when it is not directly captured.
          selectionRange:
            nameSpan !== undefined
              ? spanToRange(nameSpan)
              : spanToRange(node.span),
        });
        break;
      }
      case 'DictEntry': {
        const name = dictKeyName(node.key);
        if (name === null) break;
        const keySpan = dictKeySpan(node.key);
        symbols.push({
          name,
          kind: 'field',
          range: spanToRange(node.span),
          selectionRange:
            keySpan !== undefined
              ? spanToRange(keySpan)
              : spanToRange(node.span),
        });
        break;
      }
      default:
        break;
    }
  });

  return symbols;
}
