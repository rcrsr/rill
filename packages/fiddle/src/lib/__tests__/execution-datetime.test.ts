/**
 * Parity tests for datetime and duration execution in Fiddle
 *
 * Verifies that datetime and duration expressions produce correct output
 * in the Fiddle executeRill() pipeline, with no Fiddle source changes needed.
 *
 * AC-FDL-DT-1: datetime expression produces identical output in Fiddle and Node
 * AC-FDL-DT-2: duration expression produces identical output in Fiddle and Node
 * AC-FDL-DT-3: now() returns datetime value (status 'success', rillTypeName 'datetime')
 * AC-FDL-DT-4: Invalid datetime expression produces error with 'runtime' category
 * AC-FDL-DT-5: Invalid duration expression produces error with 'runtime' category
 * AC-FDL-DT-6: No new dependencies in packages/fiddle/package.json
 * AC-FDL-DT-7: Zero source files in packages/fiddle/src/ modified for datetime/duration
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeRill } from '../execution.js';

// Fixed reference instant for deterministic datetime tests
const REF_ISO = '2026-03-13T08:00:00Z';

// Absolute path to the fiddle package root (process.cwd() = packages/fiddle when running tests)
const FIDDLE_ROOT = process.cwd();

describe('executeRill datetime/duration parity', () => {
  // ============================================================
  // AC-FDL-DT-1: datetime expression produces identical output
  // ============================================================

  describe('datetime expressions', () => {
    it('constructs datetime from ISO string and returns datetime rillTypeName [AC-FDL-DT-1]', async () => {
      const result = await executeRill(`datetime("${REF_ISO}")`);

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);

      const parsed = JSON.parse(result.result!);
      expect(parsed.rillTypeName).toBe('datetime');
      // 2026-03-13T08:00:00Z = 1773388800000 ms since epoch
      expect(parsed.value.unix).toBe(1773388800000);
      expect(parsed.value.iso).toBe('2026-03-13T08:00:00.000Z');
    });

    it('constructs datetime from named components via dict spread [AC-FDL-DT-1]', async () => {
      const result = await executeRill(
        'datetime(...dict[year: 2026, month: 3, day: 13])'
      );

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);

      const parsed = JSON.parse(result.result!);
      expect(parsed.rillTypeName).toBe('datetime');
      // year/month/day only defaults to midnight UTC: 2026-03-13T00:00:00Z = 1773360000000
      expect(parsed.value.unix).toBe(1773360000000);
    });
  });

  // ============================================================
  // AC-FDL-DT-2: duration expression produces identical output
  // ============================================================

  describe('duration expressions', () => {
    it('constructs duration from positional hours and returns duration rillTypeName [AC-FDL-DT-2]', async () => {
      // duration(0, 0, 0, 2) = 2 hours = 7200000 ms
      const result = await executeRill('duration(0, 0, 0, 2)');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);

      const parsed = JSON.parse(result.result!);
      expect(parsed.rillTypeName).toBe('duration');
      expect(parsed.value.months).toBe(0);
      expect(parsed.value.ms).toBe(7_200_000);
    });

    it('constructs duration from days and minutes [AC-FDL-DT-2]', async () => {
      // duration(0, 0, 1, 0, 30) = 1 day 30 min
      const result = await executeRill('duration(0, 0, 1, 0, 30)');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);

      const parsed = JSON.parse(result.result!);
      expect(parsed.rillTypeName).toBe('duration');
      // 1 day = 86400000 ms, 30 min = 1800000 ms
      expect(parsed.value.ms).toBe(86_400_000 + 1_800_000);
    });
  });

  // ============================================================
  // AC-FDL-DT-3: now() returns datetime value
  // ============================================================

  describe('now() function', () => {
    it('returns a datetime value with status success [AC-FDL-DT-3]', async () => {
      const result = await executeRill('now()');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);

      const parsed = JSON.parse(result.result!);
      expect(parsed.rillTypeName).toBe('datetime');
    });

    it('returns a unix timestamp within the current execution window [AC-FDL-DT-3]', async () => {
      const before = Date.now();
      const result = await executeRill('now() -> .unix');
      const after = Date.now();

      expect(result.status).toBe('success');

      const parsed = JSON.parse(result.result!);
      expect(parsed.rillTypeName).toBe('number');
      expect(parsed.value).toBeGreaterThanOrEqual(before);
      expect(parsed.value).toBeLessThanOrEqual(after + 50);
    });
  });

  // ============================================================
  // AC-FDL-DT-4: Invalid datetime produces runtime error
  // ============================================================

  describe('invalid datetime error handling', () => {
    it('month:13 produces runtime error [AC-FDL-DT-4]', async () => {
      const result = await executeRill(
        'datetime(...dict[year: 2026, month: 13, day: 1])'
      );

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.message).toContain('month');
    });

    it('invalid ISO string produces runtime error [AC-FDL-DT-4]', async () => {
      const result = await executeRill('datetime("not-a-date")');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
    });
  });

  // ============================================================
  // AC-FDL-DT-5: Invalid duration produces runtime error
  // ============================================================

  describe('invalid duration error handling', () => {
    it('negative hours produces runtime error [AC-FDL-DT-5]', async () => {
      // duration(0, 0, 0, -2) = hours: -2 (invalid)
      const result = await executeRill('duration(0, 0, 0, -2)');

      expect(result.status).toBe('error');
      expect(result.result).toBe(null);
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
      expect(result.error?.message).toContain('hours');
    });

    it('negative months produces runtime error [AC-FDL-DT-5]', async () => {
      // duration(0, -3) = months: -3 (invalid)
      const result = await executeRill('duration(0, -3)');

      expect(result.status).toBe('error');
      expect(result.error?.category).toBe('runtime');
    });
  });

  // ============================================================
  // AC-FDL-DT-6: No new dependencies in package.json
  // ============================================================

  describe('package.json dependencies unchanged [AC-FDL-DT-6]', () => {
    it('has no new dependencies added for datetime/duration support', () => {
      const raw = readFileSync(join(FIDDLE_ROOT, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };

      const allDeps = [
        ...Object.keys(pkg.dependencies),
        ...Object.keys(pkg.devDependencies),
      ];

      // Datetime/duration support requires no new packages beyond @rcrsr/rill
      const datetimeLibDenylist = new Set([
        'moment',
        'moment-timezone',
        'luxon',
        'dayjs',
        'date-fns',
        'date-fns-tz',
        'temporal-polyfill',
        '@js-temporal/polyfill',
      ]);
      const datetimeLibs = allDeps.filter((dep) =>
        datetimeLibDenylist.has(dep)
      );

      expect(datetimeLibs).toEqual([]);
    });

    it('retains existing core dependency @rcrsr/rill', () => {
      const raw = readFileSync(join(FIDDLE_ROOT, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw) as {
        dependencies: Record<string, string>;
      };

      expect(pkg.dependencies['@rcrsr/rill']).toBeDefined();
    });
  });

  // ============================================================
  // AC-FDL-DT-7: Zero fiddle src/ files modified for datetime/duration
  // ============================================================

  describe('fiddle source files unmodified [AC-FDL-DT-7]', () => {
    it('execution.ts does not import any datetime-specific module', () => {
      const source = readFileSync(
        join(FIDDLE_ROOT, 'src/lib/execution.ts'),
        'utf-8'
      );

      // No datetime-specific imports should exist in execution.ts
      expect(source).not.toMatch(/import.*datetime/i);
      expect(source).not.toMatch(/import.*duration/i);
    });

    it('execution.ts imports only from @rcrsr/rill and local relative paths', () => {
      const source = readFileSync(
        join(FIDDLE_ROOT, 'src/lib/execution.ts'),
        'utf-8'
      );

      // All imports come from @rcrsr/rill or local relative paths
      const importLines = source
        .split('\n')
        .filter(
          (line) => line.trim().startsWith('import') && line.includes(' from ')
        );

      for (const line of importLines) {
        const isRillImport = line.includes('@rcrsr/rill');
        const isLocalImport = line.includes("'./") || line.includes('"./');
        expect(isRillImport || isLocalImport).toBe(true);
      }
    });
  });
});
