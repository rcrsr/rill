/**
 * Hover: type and description info for the identifier at a source offset.
 */

import {
  BUILTIN_FUNCTIONS,
  BUILTIN_METHODS,
  introspectHandlerFromAST,
  KEYWORDS,
  walkAst,
} from '@rcrsr/rill';
import type {
  ASTNode,
  HandlerMetadataStatic,
  ParseResult,
  SourceSpan,
  TypeRef,
} from '@rcrsr/rill';

import { spanToRange } from '../span-to-range.js';
import { locateTarget } from './locate-target.js';
import { findVisibleBinding } from './resolve-scope.js';
import { typeRefToString } from './type-rendering.js';
import type { HoverInfo } from './types.js';

/**
 * Resolves hover info for the identifier at 0-based `offset`, or `null` when
 * nothing resolves.
 *
 * - Variable: shows the binding's declared type when the declaring
 *   construct (`Capture`/`ClosureParam`/`DestructPattern`) carries a `:type`
 *   annotation, otherwise an untyped description. `type` is present only
 *   when a declared or introspected type/signature exists.
 * - Closure invocation (`$fn(args)`): the signature comes from core
 *   `introspectHandlerFromAST`, keyed on the capturing variable's name.
 * - Built-in function/method: a static description built from the
 *   `BUILTIN_FUNCTIONS`/`BUILTIN_METHODS` barrel exports (method
 *   descriptions, when present, come from the method's own annotations).
 * - Reserved keyword: a static description built from `KEYWORDS`.
 * - `.field`/`[0]` access-chain segment: hovers on the segment's own
 *   sub-token span, not the whole chain, with a generic field/index
 *   description (fields carry no static type without executing the script).
 *
 * Recovery regions and unresolved names degrade to `null` rather than
 * throwing.
 */
export function getHover(
  parsed: ParseResult,
  offset: number
): HoverInfo | null {
  const target = locateTarget(parsed, offset);

  switch (target.kind) {
    case 'accessSegment':
      return {
        contents: target.description,
        range: spanToRange(target.span),
      };

    case 'variableName':
      return hoverForVariable(parsed, offset, target.name, target.span);

    case 'closureCall':
      return hoverForClosureCall(parsed, target.name, target.span);

    case 'hostCall':
      return hoverForHostCall(target.name, target.span);

    case 'methodCall':
      return hoverForMethodCall(target.name, target.span);

    case 'keyword':
    case 'boolLiteral':
      return KEYWORDS.includes(target.word)
        ? {
            contents: `keyword \`${target.word}\``,
            range: spanToRange(target.span),
          }
        : null;

    case 'none':
      return null;
  }
}

function hoverForVariable(
  parsed: ParseResult,
  offset: number,
  name: string,
  span: SourceSpan
): HoverInfo | null {
  const closureHover = hoverForClosureCall(parsed, name, span);
  if (closureHover !== null) return closureHover;

  const binding = findVisibleBinding(parsed, offset, name);
  if (binding === null) return null;

  const declaredType = findDeclaredTypeRef(parsed.ast, binding.bindingSite);
  const type =
    declaredType !== undefined ? typeRefToString(declaredType) : undefined;

  return {
    contents: `variable \`${name}\``,
    range: spanToRange(span),
    ...(type !== undefined && { type }),
  };
}

function hoverForClosureCall(
  parsed: ParseResult,
  name: string,
  span: SourceSpan
): HoverInfo | null {
  const closureSignature = introspectHandlerFromAST(parsed.ast, name);
  if (closureSignature === null) return null;

  return {
    contents: closureSignature.description ?? `closure \`${name}\``,
    range: spanToRange(span),
    type: formatClosureSignature(closureSignature),
  };
}

function formatClosureSignature(signature: HandlerMetadataStatic): string {
  const paramList = signature.params
    .map((param) => `${param.name}: ${param.type}`)
    .join(', ');
  const returnSuffix =
    signature.returnType !== undefined ? `: ${signature.returnType}` : '';
  return `|${paramList}|${returnSuffix}`;
}

function hoverForHostCall(name: string, span: SourceSpan): HoverInfo | null {
  if (!BUILTIN_FUNCTIONS.includes(name)) return null;
  return {
    contents: `built-in function \`${name}\``,
    range: spanToRange(span),
  };
}

function hoverForMethodCall(name: string, span: SourceSpan): HoverInfo | null {
  for (const bucket of Object.values(BUILTIN_METHODS)) {
    const method = bucket[name];
    if (method === undefined) continue;
    const description = method.annotations?.['description'];
    const contents =
      typeof description === 'string'
        ? description
        : `built-in method \`.${name}\``;
    return { contents, range: spanToRange(span) };
  }
  return null;
}

/**
 * Walks the AST looking for the `Capture`/`ClosureParam`/`DestructPattern`
 * node whose own span matches `bindingSite` exactly, returning its
 * `:type` annotation (or `null` when untyped, `undefined` when no matching
 * declaring node is found).
 */
function findDeclaredTypeRef(
  root: ASTNode,
  bindingSite: SourceSpan
): TypeRef | null | undefined {
  let found: TypeRef | null | undefined;
  walkAst(root, (node) => {
    if (found !== undefined) return;
    if (
      (node.type === 'Capture' ||
        node.type === 'ClosureParam' ||
        node.type === 'DestructPattern') &&
      node.span.start.offset === bindingSite.start.offset &&
      node.span.end.offset === bindingSite.end.offset
    ) {
      found = node.typeRef;
    }
  });
  return found;
}
