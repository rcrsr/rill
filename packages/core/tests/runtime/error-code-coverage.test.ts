/**
 * Rill Runtime Tests: every error atom core raises is in the core error set
 *
 * `invalidate` throws `RILL-R084` for a code outside `ERROR_CODE_NAMES`, so a
 * halt site that passes an unlisted `ERROR_ATOMS[ERROR_IDS.X]` would fail at
 * run time instead of producing a catchable halt. This scans `src/` for every
 * such reference and checks each atom against the set.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODE_NAMES } from '../../src/constants.js';
import { ERROR_ATOMS, ERROR_IDS } from '../../src/error-registry.js';

const SRC_DIR = join(import.meta.dirname, '..', '..', 'src');
const ATOM_REF = /ERROR_ATOMS\[ERROR_IDS\.([A-Z0-9_]+)\]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function referencedIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    for (const match of readFileSync(file, 'utf8').matchAll(ATOM_REF)) {
      const id = match[1];
      if (id !== undefined) ids.add(id);
    }
  }
  return ids;
}

describe('error atoms referenced in src', () => {
  it('finds references to scan', () => {
    expect(referencedIds().size).toBeGreaterThan(0);
  });

  it('are all in the core error set', () => {
    const codes = new Set(ERROR_CODE_NAMES);
    const missing = [...referencedIds()]
      .filter((id) => id in ERROR_IDS)
      .map((id) => ERROR_ATOMS[ERROR_IDS[id as keyof typeof ERROR_IDS]])
      .filter((atom) => !codes.has(atom));
    expect(missing).toEqual([]);
  });
});
