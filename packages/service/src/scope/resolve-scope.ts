/**
 * Scope resolution: which names are visible at a given source offset, and
 * where each name's binding-introducing construct lives in source.
 */

import { walkAst } from '@rcrsr/rill';
import type { ASTNode, BlockNode, ParseResult } from '@rcrsr/rill';
import type { SourceSpan } from '@rcrsr/rill';

import { dictKeyName, dictKeySpan } from '../dict-key.js';
import { spanContainsOffset } from './span-helpers.js';
import type { Binding, BindingKind } from './types.js';

/** An open scope discovered while walking the AST, holding its own bindings. */
interface ScopeFrame {
  readonly span: SourceSpan;
  readonly bindings: Binding[];
}

/**
 * Resolves the bindings visible at a 0-based source `offset`.
 *
 * Walks the AST once via core `walkAst`, which visits nodes in
 * parent-before-children, left-to-right order. A stack of open
 * `ScopeFrame`s (script, block, closure, grouped-expression) is derived
 * purely from span containment: a frame closes as soon as a later-visited
 * node's span starts at or past the frame's own end. `PassBlock` bodies are
 * recorded before their statements are visited and excluded from the
 * scope-opening set, so a `pass<...> { ... }` body joins the surrounding
 * scope instead of starting one of its own.
 *
 * Every binding discovered in a scope enclosing `offset` is returned
 * regardless of whether it lies textually before or after `offset` within
 * that scope. Closures share their outer scope by reference (mutable-outer
 * late binding): a name captured later in the same scope is still visible
 * to code that runs after it, so this resolver never snapshots scope at the
 * point of use.
 *
 * `RecoveryErrorNode`/`PartialExpressionNode` carry no binding-introducing
 * children of interest, so recovery regions simply contribute no bindings —
 * this function never throws. Returns `[]` when `offset` is out of range or
 * nothing resolves.
 */
export function resolveScopeAt(parsed: ParseResult, offset: number): Binding[] {
  const root = parsed.ast;
  const passBlockBodies = new Set<BlockNode>();

  const rootFrame: ScopeFrame = { span: root.span, bindings: [] };
  const allFrames: ScopeFrame[] = [rootFrame];
  const openFrames: ScopeFrame[] = [rootFrame];

  walkAst(root, (node) => {
    while (
      openFrames.length > 1 &&
      node.span.start.offset >=
        openFrames[openFrames.length - 1]!.span.end.offset
    ) {
      openFrames.pop();
    }
    const frame = openFrames[openFrames.length - 1]!;

    switch (node.type) {
      case 'PassBlock':
        passBlockBodies.add(node.body);
        break;
      case 'Capture':
        frame.bindings.push(
          createBinding(node.name, 'capture', node.span, node.span)
        );
        break;
      case 'ClosureParam':
        frame.bindings.push(
          createBinding(node.name, 'closureParam', node.span, node.span)
        );
        break;
      case 'DestructPattern': {
        const name =
          node.kind === 'variable' || node.kind === 'keyValue'
            ? node.name
            : null;
        if (name !== null) {
          frame.bindings.push(
            createBinding(name, 'destructure', node.span, node.span)
          );
        }
        break;
      }
      case 'DictEntry': {
        const name = dictKeyName(node.key);
        if (name !== null) {
          const keySpan = dictKeySpan(node.key) ?? node.span;
          frame.bindings.push(createBinding(name, 'dictKey', keySpan, keySpan));
        }
        break;
      }
      default:
        break;
    }

    if (opensScope(node, passBlockBodies)) {
      const newFrame: ScopeFrame = { span: node.span, bindings: [] };
      allFrames.push(newFrame);
      openFrames.push(newFrame);
    }
  });

  const bindings: Binding[] = [];
  for (const scopeFrame of allFrames) {
    if (spanContainsOffset(scopeFrame.span, offset)) {
      bindings.push(...scopeFrame.bindings);
    }
  }
  return bindings;
}

/**
 * Determines whether `node` opens a new scope frame. `Block` is excluded
 * when it is a `PassBlock` body, since that body shares its parent's scope
 * rather than opening its own.
 */
function opensScope(node: ASTNode, passBlockBodies: Set<BlockNode>): boolean {
  if (node.type === 'Closure' || node.type === 'GroupedExpr') return true;
  if (node.type === 'Block') return !passBlockBodies.has(node);
  return false;
}

function createBinding(
  name: string,
  kind: BindingKind,
  declarationSpan: SourceSpan,
  bindingSite: SourceSpan
): Binding {
  return { name, kind, declarationSpan, bindingSite };
}

/**
 * Resolves the single binding a `$name` read at 0-based `offset` refers to,
 * or `null` when no non-dict-key binding of that name is visible.
 *
 * `dictKey` bindings never satisfy a `$name` reference — dict keys and
 * variables are separate namespaces — so this always filters them out
 * before selecting a binding.
 *
 * For a read inside a closure body, the LAST same-named binding in scope
 * wins: a closure's outer references are mutable-outer, late-bound at call
 * time, so the binding captured latest in source is the one that will
 * actually be visible when the closure runs.
 *
 * For every other read, the NEAREST same-named binding whose site starts
 * at or before `offset` wins, matching same-type reassignment semantics
 * (`docs/topic-variables.md`): a read sees whichever capture textually
 * precedes it, not a later one. Falls back to the earliest binding when
 * none precede `offset` (e.g. a read before any binding is captured).
 */
export function findVisibleBinding(
  parsed: ParseResult,
  offset: number,
  name: string
): Binding | null {
  const candidates = resolveScopeAt(parsed, offset).filter(
    (b) => b.kind !== 'dictKey' && b.name === name
  );
  if (candidates.length === 0) return null;

  if (isInsideClosureBody(parsed.ast, offset)) {
    return candidates[candidates.length - 1]!;
  }

  let nearest: Binding | null = null;
  for (const candidate of candidates) {
    if (candidate.bindingSite.start.offset > offset) continue;
    if (
      nearest === null ||
      candidate.bindingSite.start.offset > nearest.bindingSite.start.offset
    ) {
      nearest = candidate;
    }
  }
  return nearest ?? candidates[0]!;
}

/**
 * Returns true when `offset` falls within the body span of some enclosing
 * `Closure` node — i.e. the read this offset belongs to is late-bound
 * rather than textually ordered against its outer scope.
 */
function isInsideClosureBody(root: ASTNode, offset: number): boolean {
  let found = false;
  walkAst(root, (node) => {
    if (found || node.type !== 'Closure') return;
    if (spanContainsOffset(node.body.span, offset)) found = true;
  });
  return found;
}
