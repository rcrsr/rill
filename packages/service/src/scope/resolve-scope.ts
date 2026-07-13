/**
 * Scope resolution: which names are visible at a given source offset, and
 * where each name's binding-introducing construct lives in source.
 */

import { walkAst } from '@rcrsr/rill';
import type {
  ASTNode,
  BlockNode,
  DictEntryNode,
  ParseResult,
} from '@rcrsr/rill';
import type { SourceSpan } from '@rcrsr/rill';

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

/**
 * Returns true if `offset` falls within `span`, using the same half-open
 * containment convention as core's AST position lookups:
 * `span.start.offset <= offset && offset < span.end.offset`.
 */
function spanContainsOffset(span: SourceSpan, offset: number): boolean {
  return span.start.offset <= offset && offset < span.end.offset;
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
 * Resolves a static name for a dict entry key, or `null` when the key has
 * no static name (a computed expression or a list-literal key). Mirrors the
 * equivalent helper in `document-symbols.ts`.
 */
function dictKeyName(key: DictEntryNode['key']): string | null {
  if (typeof key === 'string') return key;
  if (typeof key === 'number' || typeof key === 'boolean') return String(key);
  if (typeof key === 'object' && 'kind' in key) {
    return key.kind === 'variable' ? key.variableName : null;
  }
  return null;
}

/**
 * Resolves the key's own span when it carries one (`$var` / computed keys).
 * Mirrors the equivalent helper in `document-symbols.ts`.
 */
function dictKeySpan(key: DictEntryNode['key']): SourceSpan | undefined {
  if (typeof key === 'object' && 'kind' in key) return key.span;
  return undefined;
}
