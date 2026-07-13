/**
 * Type-node and description rendering for hover output.
 *
 * Reimplemented from core's `runtime/core/introspection.ts` private helpers
 * (`typeRefToString`, `typeConstructorToString`, `formatReturnTypeTarget`,
 * `extractDescription`) rather than imported: those helpers are not part of
 * the `@rcrsr/rill` public barrel, and importing a core-internal module path
 * would violate the service/core layer boundary. Fidelity to the originals'
 * rendering behavior is intentional so hover text matches what
 * `introspectHandlerFromAST` would have produced for the same shape.
 */

import { isPipeChainNode } from '@rcrsr/rill';
import type {
  AnnotationArg,
  NamedArgNode,
  PostfixExprNode,
  StringLiteralNode,
  TypeConstructorNode,
  TypeRef,
} from '@rcrsr/rill';

/**
 * Converts a `TypeRef` to a human-readable type string. Parameterized types
 * render as `name(arg, arg, ...)`, with each named arg as `name: <type>`,
 * matching the source grammar.
 */
export function typeRefToString(ref: TypeRef | null): string {
  if (ref === null) return 'any';
  switch (ref.kind) {
    case 'static': {
      if (ref.args === undefined || ref.args.length === 0) {
        return ref.typeName;
      }
      const args = ref.args
        .map((arg) => {
          const valueStr = typeRefToString(arg.value);
          return arg.name !== undefined ? `${arg.name}: ${valueStr}` : valueStr;
        })
        .join(', ');
      return `${ref.typeName}(${args})`;
    }
    case 'dynamic':
      return 'any';
    case 'union':
      return ref.members.map(typeRefToString).join(' | ');
  }
}

/**
 * Converts a `TypeConstructorNode` (`list(...)`, `dict(...)`, `stream(...)`,
 * etc.) to its source-grammar display form. Stream constructors render as
 * `stream(<chunk>):<ret>`, falling back to `stream(<chunk>)` when no
 * resolution arg is present.
 */
export function typeConstructorToString(node: TypeConstructorNode): string {
  if (node.constructorName === 'stream') {
    const chunkArg = node.args[0];
    const retArg = node.args[1];
    const chunkStr =
      chunkArg !== undefined ? typeRefToString(chunkArg.value) : 'any';
    const retSuffix =
      retArg !== undefined ? `:${typeRefToString(retArg.value)}` : '';
    return `stream(${chunkStr})${retSuffix}`;
  }
  const args = node.args
    .map((arg) => {
      const valueStr = typeRefToString(arg.value);
      return arg.name !== undefined ? `${arg.name}: ${valueStr}` : valueStr;
    })
    .join(', ');
  return `${node.constructorName}(${args})`;
}

/**
 * Formats a closure's return-type target (the value parsed from `:T` after
 * the closure body). Returns `undefined` when no annotation is present.
 */
export function formatReturnTypeTarget(
  target: TypeRef | TypeConstructorNode | undefined
): string | undefined {
  if (target === undefined) return undefined;
  if ('type' in target && target.type === 'TypeConstructor') {
    return typeConstructorToString(target);
  }
  return typeRefToString(target as TypeRef);
}

/**
 * Extracts a description string from an annotation array. Prefers a
 * `NamedArgNode` with name `description`, falling back to `doc`, when the
 * value is a plain (non-interpolated) string literal.
 */
export function extractDescription(
  annotations: AnnotationArg[] | undefined
): string | undefined {
  if (!annotations) return undefined;
  let docFallback: string | undefined;
  for (const arg of annotations) {
    if (arg.type !== 'NamedArg') continue;
    const named = arg as NamedArgNode;
    if (named.name !== 'description' && named.name !== 'doc') continue;

    // Navigate: value -> PipeChainNode.head -> PostfixExprNode.primary -> StringLiteralNode
    if (!isPipeChainNode(named.value)) continue;
    const chain = named.value;

    const head = chain.head as PostfixExprNode;
    if (head.type !== 'PostfixExpr') continue;

    const primary = head.primary;
    if (primary.type !== 'StringLiteral') continue;

    const strNode = primary as StringLiteralNode;
    if (strNode.parts.some((p) => typeof p !== 'string')) continue;

    const value = strNode.parts.join('');
    if (named.name === 'description') return value;
    docFallback = value;
  }
  return docFallback;
}
