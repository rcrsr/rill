/**
 * Test helper that binds a test to the reference rules it checks.
 *
 * The reference checker scans `tests/language` for string-literal ids passed
 * to `rule(...)`, so callers must pass literals.
 */

import { it as vitestIt } from 'vitest';

/** Returns an `it` wrapper that cites the given reference rule ids. */
export function rule(..._ids: string[]): { it: typeof vitestIt } {
  return { it: vitestIt };
}
