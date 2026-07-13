/**
 * Six-dimension diagnostic parity test.
 *
 * This is the first golden/snapshot-style test in this repository: there is
 * no prior `toMatchSnapshot`/`.snap` precedent anywhere in the codebase.
 * Instead of vitest's built-in snapshot mechanism, this module compares
 * against a hand-committed JSON fixture (`fixtures/corpus-parity.golden.json`)
 * so the comparison, the six locked dimensions, and the regeneration path
 * are all explicit and reviewable in a diff.
 *
 * Baseline-source decision: the true upstream baseline is rill-cli's own
 * checker, which this package cannot import at test time (cross-repo, and
 * the service package's dependency rules forbid non-`@rcrsr/rill`
 * dependencies). The committed golden fixture is instead generated from
 * this package's own `runRules(parsed, source, createDefaultConfig())`
 * output over the full corpus loaded via `corpus-loader.ts`, and is
 * regenerated deliberately (see `UPDATE_GOLDEN` below) whenever a rule
 * change intentionally shifts output. To keep the golden a genuine parity
 * baseline rather than a bare change-detector, the dedicated assertions
 * below independently re-verify, directly against each ported rule's known
 * shape (not merely against the bulk snapshot), that:
 *   - the two rules that ever emit a non-null fix (NAMING_SNAKE_CASE,
 *     UNNECESSARY_ASSERTION) produce a well-formed DiagnosticFix at every
 *     firing position across the corpus;
 *   - INDENT_CONTINUATION firings carry the synthetic
 *     `{ column: 1, offset: 0 }` location and a trimmed continuation-line
 *     context, never routed through `extractContextLine`;
 *   - ATOM_UNREGISTERED only fires for atom names outside the 15-name
 *     `BUILTIN_ATOMS` snapshot, and never for a name inside it.
 *
 * To regenerate the golden fixture after an intentional rule change, run:
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @rcrsr/rill-language-service test -- src/rules/corpus-parity.test.ts
 *
 * then review the resulting diff to `fixtures/corpus-parity.golden.json`
 * before committing it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';
import { loadCorpusSnippets } from './corpus-loader.js';
import { runRules } from './run-rules.js';
import { createDefaultConfig } from './config.js';
import { atomUnregistered } from './atom-unregistered.js';
import type { Diagnostic } from './types.js';

// ============================================================
// GOLDEN FIXTURE LOCATION
// ============================================================

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(here, 'fixtures', 'corpus-parity.golden.json');

/** One corpus snippet's full diagnostic output, keyed by its position in
 * `loadCorpusSnippets()`'s deterministic (sorted-file, in-file-order)
 * output, so the golden's ordering never depends on iteration order. */
interface GoldenEntry {
  readonly index: number;
  readonly file: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** Minimal CheckConfig with every rule 'on' and no global override, used
 * for targeted single-rule assertions below. */
function makeConfig(): { rules: Record<string, 'on' | 'off' | 'warn'> } {
  return { rules: {} };
}

// ============================================================
// GOLDEN GENERATION
// ============================================================

/**
 * Regenerate the full-corpus golden entry set by running `runRules` with
 * every rule enabled over every statically-extractable corpus snippet.
 * Exported so the golden can be regenerated deliberately (see
 * `UPDATE_GOLDEN` in the module header) without duplicating this logic in
 * a separate script.
 */
export function generateGolden(): GoldenEntry[] {
  const snippets = loadCorpusSnippets();
  const config = createDefaultConfig();

  return snippets.map((snippet, index) => {
    const parsed = parseWithRecovery(snippet.source);
    const diagnostics = runRules(parsed, snippet.source, config);
    return { index, file: snippet.file, diagnostics };
  });
}

function loadGolden(): GoldenEntry[] {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenEntry[];
}

// ============================================================
// FULL-CORPUS SIX-DIMENSION PARITY
// ============================================================

describe('six-dimension diagnostic parity vs committed golden', () => {
  let current: GoldenEntry[];

  beforeAll(() => {
    current = generateGolden();

    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(current, null, 2)}\n`);
    }
  });

  it('covers the full corpus (every entry, not a downscaled sample)', () => {
    expect(current.length).toBeGreaterThan(0);
    expect(loadGolden().length).toBe(current.length);
  });

  it('locks code, message, severity, location, context, and fix at every firing position', () => {
    expect(current).toEqual(loadGolden());
  });

  it('fires at least one rule code across the corpus, and more than a single code', () => {
    const codes = new Set(
      current.flatMap((entry) => entry.diagnostics.map((d) => d.code))
    );
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ============================================================
// TARGETED: NON-NULL-FIX RULES
// ============================================================

describe('non-null-fix rules emit a well-formed DiagnosticFix', () => {
  const NON_NULL_FIX_CODES = new Set([
    'NAMING_SNAKE_CASE',
    'UNNECESSARY_ASSERTION',
  ]);

  it('every NAMING_SNAKE_CASE / UNNECESSARY_ASSERTION corpus firing carries a complete fix', () => {
    const golden = loadGolden();
    const fixFirings = golden
      .flatMap((entry) => entry.diagnostics)
      .filter((d) => NON_NULL_FIX_CODES.has(d.code));

    expect(fixFirings.length).toBeGreaterThan(0);

    for (const diagnostic of fixFirings) {
      expect(diagnostic.fix).not.toBeNull();
      const fix = diagnostic.fix;
      if (fix === null) continue; // narrowed above; satisfies noUncheckedIndexedAccess-style checks
      expect(typeof fix.description).toBe('string');
      expect(fix.description.length).toBeGreaterThan(0);
      expect(fix.applicable).toBe(true);
      expect(typeof fix.replacement).toBe('string');
      expect(fix.range.start.offset).toBeTypeOf('number');
      expect(fix.range.end.offset).toBeTypeOf('number');
      expect(fix.range.end.offset).toBeGreaterThanOrEqual(
        fix.range.start.offset
      );
    }
  });

  it('every other rule code never carries a fix across the corpus', () => {
    const golden = loadGolden();
    const otherFirings = golden
      .flatMap((entry) => entry.diagnostics)
      .filter((d) => !NON_NULL_FIX_CODES.has(d.code));

    for (const diagnostic of otherFirings) {
      expect(diagnostic.fix).toBeNull();
    }
  });
});

// ============================================================
// TARGETED: INDENT_CONTINUATION SYNTHETIC LOCATION
// ============================================================

describe('INDENT_CONTINUATION synthetic location and context', () => {
  it('every corpus firing uses the synthetic column:1 / offset:0 location and a trimmed context line', () => {
    const golden = loadGolden();
    const firings = golden
      .flatMap((entry) => entry.diagnostics)
      .filter((d) => d.code === 'INDENT_CONTINUATION');

    for (const diagnostic of firings) {
      expect(diagnostic.location.column).toBe(1);
      expect(diagnostic.location.offset).toBe(0);
      expect(diagnostic.context).toBe(diagnostic.context.trim());
      expect(diagnostic.fix).toBeNull();
    }
  });

  it('fires with the synthetic location on a purpose-built under-indented continuation', () => {
    const source = '$x\n-> log\n';
    const parsed = parseWithRecovery(source);
    const result = runRules(parsed, source, createDefaultConfig());
    const firing = result.find((d) => d.code === 'INDENT_CONTINUATION');

    expect(firing).toBeDefined();
    if (firing === undefined) return;
    expect(firing.location).toEqual({
      line: firing.location.line,
      column: 1,
      offset: 0,
    });
    expect(firing.context).toBe(firing.context.trim());
  });
});

// ============================================================
// TARGETED: ATOM_UNREGISTERED 15-NAME BOUNDARY
// ============================================================

describe('ATOM_UNREGISTERED fires only outside the 15-name BUILTIN_ATOMS snapshot', () => {
  const BUILTIN_ATOM_NAMES = [
    'ok',
    'R001',
    'R999',
    'TIMEOUT',
    'AUTH',
    'FORBIDDEN',
    'RATE_LIMIT',
    'QUOTA_EXCEEDED',
    'UNAVAILABLE',
    'NOT_FOUND',
    'CONFLICT',
    'INVALID_INPUT',
    'PROTOCOL',
    'DISPOSED',
    'TYPE_MISMATCH',
  ] as const;

  it('is exactly the 15-name snapshot', () => {
    expect(BUILTIN_ATOM_NAMES).toHaveLength(15);
  });

  it.each(BUILTIN_ATOM_NAMES)('does not fire for builtin atom #%s', (name) => {
    const source = `#${name}\n`;
    const parsed = parseWithRecovery(source);
    const result = runRules(parsed, source, makeConfig(), [atomUnregistered]);
    expect(result).toEqual([]);
  });

  it('fires with a matching message for an atom outside the 15-name snapshot', () => {
    const source = '#CUSTOM_UNREGISTERED_ATOM\n';
    const parsed = parseWithRecovery(source);
    const result = runRules(parsed, source, makeConfig(), [atomUnregistered]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'ATOM_UNREGISTERED',
      severity: 'warning',
      message:
        'Atom #CUSTOM_UNREGISTERED_ATOM is not a runtime builtin; ensure the host registers it via registerErrorCode.',
      fix: null,
    });
  });

  it('every corpus ATOM_UNREGISTERED firing names an atom outside the 15-name snapshot', () => {
    const golden = loadGolden();
    const firings = golden
      .flatMap((entry) => entry.diagnostics)
      .filter((d) => d.code === 'ATOM_UNREGISTERED');

    for (const diagnostic of firings) {
      const match = /^Atom #(\S+) is not a runtime builtin/.exec(
        diagnostic.message
      );
      expect(match).not.toBeNull();
      const atomName = match?.[1] ?? '';
      expect(BUILTIN_ATOM_NAMES).not.toContain(atomName);
    }
  });
});
