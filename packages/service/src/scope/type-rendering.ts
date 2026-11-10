/**
 * Type-node rendering for hover output.
 *
 * Reimplemented from core's `runtime/core/introspection.ts` private helper
 * `typeRefToString` rather than imported: that helper is not part of the
 * `@rcrsr/rill` public barrel, and importing a core-internal module path
 * would violate the service/core layer boundary. Fidelity to the original's
 * rendering behavior is intentional so hover text matches what
 * `introspectHandlerFromAST` would have produced for the same shape.
 */

import type { FieldArg, LiteralNode, TypeRef } from '@rcrsr/rill';

function literalToString(node: LiteralNode): string | undefined {
  switch (node.type) {
    case 'NumberLiteral':
    case 'BoolLiteral':
      return String(node.value);
    case 'StringLiteral':
      return node.parts.every((p): p is string => typeof p === 'string')
        ? JSON.stringify(node.parts.join(''))
        : undefined;
    default:
      return undefined;
  }
}

function fieldArgToString(arg: FieldArg): string {
  const valueStr = typeRefToString(arg.value);
  const named = arg.name !== undefined ? `${arg.name}: ${valueStr}` : valueStr;
  const literal =
    arg.defaultValue !== undefined
      ? literalToString(arg.defaultValue)
      : undefined;
  return literal === undefined ? named : `${named} = ${literal}`;
}

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
      const args = ref.args.map(fieldArgToString).join(', ');
      return `${ref.typeName}(${args})`;
    }
    case 'dynamic':
      return 'any';
    case 'union':
      return ref.members.map(typeRefToString).join(' | ');
  }
  throw new Error('unreachable: unhandled type reference kind');
}
