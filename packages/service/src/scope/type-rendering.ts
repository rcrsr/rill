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

import type { TypeRef } from '@rcrsr/rill';

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
