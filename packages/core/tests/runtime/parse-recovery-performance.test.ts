/**
 * Rill Parser Tests: parseWithRecovery Performance Regression
 *
 * Measures parseWithRecovery() wall-clock time across the full rill source
 * corpus embedded in tests/language/*.test.ts, following the same
 * baseline+threshold+warmup pattern as performance.test.ts.
 *
 * The corpus mixes complete scripts with deliberately malformed fragments
 * used elsewhere to test error handling; a handful of those fragments hit
 * a fatal (non-recoverable) parse path rather than returning a ParseResult.
 * Correctness of individual parses is out of scope here — only wall-clock
 * time is asserted — so each call is isolated in a try/catch.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANGUAGE_TESTS_DIR = join(__dirname, '..', 'language');

// Matches rill source strings passed as the first argument to the test
// helpers used throughout tests/language/*.test.ts (single, double, or
// template-quoted). The raw text between the delimiters is used as-is;
// it does not need to be JS-unescaped to remain valid rill source.
const SOURCE_CALL_PATTERN =
  /\b(?:run|runFull|runWithContext)\(\s*(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;

// Many tests bind rill source to a local variable before passing it to
// run/runFull/runWithContext (e.g. `const script = \`...\`;`), rather than
// inlining the literal at the call site. Capturing every such declaration
// (regardless of variable name) pulls those scripts into the corpus too,
// without needing to trace each identifier back to its call site. This
// deliberately errs toward over-inclusion: extra parseable snippets only
// strengthen a parse-time benchmark.
const SOURCE_DECLARATION_PATTERN =
  /\bconst\s+[A-Za-z_$][\w$]*(?:\s*:\s*[^=]+)?\s*=\s*(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;

/**
 * Runs parseWithRecovery for its wall-clock cost only. A small number of
 * corpus entries are deliberately malformed fragments (used elsewhere to
 * exercise fatal, non-recoverable parse paths) that throw rather than
 * return a ParseResult; those throws are swallowed here since only timing
 * is under test.
 */
function parseForTiming(source: string): void {
  try {
    parseWithRecovery(source);
  } catch {
    // Timing only; parse correctness is covered by tests/language/.
  }
}

/** Extracts every embedded rill source snippet from the language test corpus. */
function loadLanguageCorpus(): string[] {
  const files = readdirSync(LANGUAGE_TESTS_DIR).filter((f) =>
    f.endsWith('.test.ts')
  );

  const sources = new Set<string>();
  for (const file of files) {
    const content = readFileSync(join(LANGUAGE_TESTS_DIR, file), 'utf8');
    for (const match of content.matchAll(SOURCE_CALL_PATTERN)) {
      const literal = match[1];
      if (literal === undefined) continue;
      sources.add(literal.slice(1, -1));
    }
    for (const match of content.matchAll(SOURCE_DECLARATION_PATTERN)) {
      const literal = match[1];
      if (literal === undefined) continue;
      sources.add(literal.slice(1, -1));
    }
  }
  return [...sources];
}

// Performance threshold: 5% regression tolerance, matching the ceiling
// specified for parse-time regression detection.
const REGRESSION_THRESHOLD = 0.05;

// Baseline execution time (ms) per full-corpus pass. Measured locally
// (isolated run) across several repetitions of the full parseWithRecovery
// sweep below (observed range: ~52ms-77ms per pass across 4 local runs).
// The constant is set at roughly 2x the highest local observation to
// absorb CI runner variance without becoming tautological.
const BASELINE_MS = 150;

describe('parseWithRecovery parse-time regression', () => {
  it('parses the full language test corpus within the performance budget', () => {
    const corpus = loadLanguageCorpus();
    // Floor set comfortably below the true extracted count but well above
    // the inline-call-only count (2894), so a regression that silently
    // drops the variable-bound declaration extraction is caught here
    // instead of only showing up as a smaller-than-expected timing shift.
    expect(corpus.length).toBeGreaterThan(3000);

    const iterations = 20;

    // Warmup: let the JIT optimize before measuring.
    for (let i = 0; i < 3; i++) {
      for (const source of corpus) {
        parseForTiming(source);
      }
    }

    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      for (const source of corpus) {
        parseForTiming(source);
      }
    }

    const duration = performance.now() - start;
    const avgMs = duration / iterations;

    const maxAllowed = BASELINE_MS * (1 + REGRESSION_THRESHOLD);
    expect(avgMs).toBeLessThanOrEqual(maxAllowed);
  }, 60000);
});
