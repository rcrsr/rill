/**
 * The 'any' Type Singleton
 *
 * Import constraints:
 * - Imports only the RillTypeValue type from ./structures.js.
 *
 * This lives in its own leaf rather than values.ts because values.ts imports
 * registrations.js. The callable() factory needs only this constant, and
 * sourcing it from a leaf keeps callable-factory.ts free of the types cycle.
 */

import type { RillTypeValue } from './structures.js';

/**
 * Singleton RillTypeValue representing the 'any' type.
 * Used as the default returnType for callable() factory and ApplicationCallable.
 */
export const anyTypeValue: RillTypeValue = Object.freeze({
  __rill_type: true as const,
  typeName: 'any' as const,
  structure: { kind: 'any' as const },
});
