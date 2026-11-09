/**
 * Rill Runtime Tests: timing test isolation
 *
 * A test that asserts on wall-clock ratios through `scalingRatio` must run
 * alone, after the rest of the suite, or another file's CPU use moves its
 * ratio. `vitest.config.ts` runs `*.timing.test.ts` that way. A timing test
 * under any other name runs beside the unit files and flakes under load, so
 * this test fails it by name.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TESTS_DIR = join(import.meta.dirname, '..');
const SCALING_IMPORT = /from\s+'[^']*helpers\/scaling(\.js)?'/;

function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(path));
    else if (entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('timing test isolation', () => {
  const files = testFiles(TESTS_DIR);

  it('names every test that uses scalingRatio *.timing.test.ts', () => {
    const misnamed = files.filter(
      (file) =>
        SCALING_IMPORT.test(readFileSync(file, 'utf8')) &&
        !file.endsWith('.timing.test.ts')
    );
    expect(misnamed).toEqual([]);
  });

  it('finds the timing tests it guards', () => {
    const timing = files.filter((file) => file.endsWith('.timing.test.ts'));
    expect(timing.length).toBeGreaterThanOrEqual(3);
  });
});
