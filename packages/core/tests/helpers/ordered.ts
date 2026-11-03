/**
 * Test helpers for inspecting ordered values returned by the public API.
 */

/** True when the value is a rill ordered collection. */
export function isOrdered(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rill_ordered' in value &&
    (value as Record<string, unknown>)['__rill_ordered'] === true
  );
}

/** Return the [key, value] pairs of an ordered value; throws if not ordered. */
export function orderedEntries(value: unknown): [string, unknown][] {
  if (!isOrdered(value)) throw new Error('Not an ordered value');
  return (value as { entries: [string, unknown][] }).entries;
}
