/**
 * Type-node rendering shared by hover output and lint rule messages.
 *
 * Reimplemented from core's `runtime/core/introspection.ts` private helper
 * `typeRefToString` rather than imported: that helper is not part of the
 * `@rcrsr/rill` public barrel, and importing a core-internal module path
 * would violate the service/core layer boundary. Fidelity to the original's
 * rendering behavior is intentional so hover text matches what
 * `introspectHandlerFromAST` would have produced for the same shape.
 */

import { formatFieldKey, formatRillLiteral } from '@rcrsr/rill';
import type { FieldArg, LiteralNode, TypeRef } from '@rcrsr/rill';

function literalToString(node: LiteralNode): string | undefined {
  switch (node.type) {
    case 'NumberLiteral':
    case 'BoolLiteral':
      return String(node.value);
    case 'AtomLiteral':
      return `#${node.name}`;
    case 'StringLiteral':
      return node.parts.every((p): p is string => typeof p === 'string')
        ? formatRillLiteral(node.parts.join(''))
        : undefined;
    default:
      return undefined;
  }
}

function fieldArgToString(arg: FieldArg): string {
  const valueStr = typeRefToString(arg.value);
  const named =
    arg.name !== undefined
      ? `${formatFieldKey(arg.name)}: ${valueStr}`
      : valueStr;
  const literal =
    arg.defaultValue !== undefined
      ? literalToString(arg.defaultValue)
      : undefined;
  return literal === undefined ? named : `${named} = ${literal}`;
}

/** True for an unnamed `any` argument with no default: an unspecified slot. */
function isAnyArg(arg: FieldArg | undefined): boolean {
  return (
    arg !== undefined &&
    arg.name === undefined &&
    arg.defaultValue === undefined &&
    arg.value.kind === 'static' &&
    arg.value.typeName === 'any' &&
    (arg.value.args === undefined || arg.value.args.length === 0)
  );
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
      // A stream carries its outer type in args[1]: stream(chunk):outer.
      // An unspecified outer is dropped, and a list or stream with every
      // slot unspecified prints as its bare name.
      const rawOuter = ref.typeName === 'stream' ? ref.args[1] : undefined;
      const outer = isAnyArg(rawOuter) ? undefined : rawOuter;
      const inner = rawOuter === undefined ? ref.args : ref.args.slice(0, 1);
      if (
        (ref.typeName === 'list' || ref.typeName === 'stream') &&
        outer === undefined &&
        inner.every(isAnyArg)
      ) {
        return ref.typeName;
      }
      const args = inner.map(fieldArgToString).join(', ');
      const outerStr =
        outer === undefined ? '' : `:${typeRefToString(outer.value)}`;
      return `${ref.typeName}(${args})${outerStr}`;
    }
    case 'dynamic':
      return 'any';
    case 'union':
      return `union(${ref.members.map(typeRefToString).join(', ')})`;
    case 'literal':
      return literalToString(ref.value) ?? 'any';
  }
  throw new Error('unreachable: unhandled type reference kind');
}
