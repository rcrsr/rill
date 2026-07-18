/**
 * Guards against tests that silently disable rule checks by passing an
 * empty rules array to `runRules(...)`. A call like
 * `runRules(parsed, source, makeConfig(), [])` runs zero rules, so any
 * assertions that follow it prove nothing about the rule under test.
 *
 * This test reads every `*.test.ts` file under src/rules/ as raw text,
 * strips line comments, block comments, and string/template literals so a
 * `, []` inside a comment or a string cannot produce a false match, and
 * then flags each remaining `runRules(...)` call whose final argument is a
 * bare `[]`. One legitimate probe (an explicit "zero rules produces zero
 * diagnostics" case) is exempted by a per-file COUNT allowlist rather than
 * a whole-file skip, so a second offending call added anywhere - including
 * in the allowlisted file - still fails this test.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const RULES_DIR = join(import.meta.dirname, '.');

// This regex assumes each `runRules(...)` call is written on a single
// logical match span with no nested `[...]` or `(...)` before the final
// empty-array argument. The `[\s\S]*?` quantifier is lazy, so it matches
// up to the FIRST `, []` closing sequence; that is sufficient for every
// current single-line call site. A future call with a nested bracket or
// paren immediately before the terminal `[]` would need this revisited.
// File contents are stripped of comments and string/template literals
// before this regex runs (see `stripCommentsAndStrings`), so a `, []`
// appearing inside a comment or a string cannot produce a false match.
const EMPTY_RULES_CALL = /runRules\([\s\S]*?,\s*\[\s*\]\s*\)/g;

const ALLOWED = new Map<string, number>([['run-rules.test.ts', 1]]);

/**
 * Blank out line comments, block comments, and string/template literals so
 * the raw-text regex below can't match a `, []` sequence that only exists
 * inside a comment or a string. Replacement characters preserve line counts
 * and overall string length; only the regex's ability to see `[`, `]`, `,`,
 * and `runRules` tokens inside stripped regions is removed.
 */
function stripCommentsAndStrings(contents: string): string {
  return contents.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (match) => match.replace(/[^\n]/g, ' ')
  );
}

function listRuleTestFiles(): string[] {
  return readdirSync(RULES_DIR).filter(
    (name) =>
      name.endsWith('.test.ts') &&
      join(RULES_DIR, name) !== import.meta.filename
  );
}

interface Offender {
  file: string;
  matches: string[];
}

describe('disabled rules guard: raw-text proof', () => {
  it('does not call runRules(...) with a bare empty rules array beyond the allowlisted count', () => {
    const offenders: Offender[] = [];
    for (const fileName of listRuleTestFiles()) {
      const fullPath = join(RULES_DIR, fileName);
      const contents = readFileSync(fullPath, 'utf8');
      const strippedContents = stripCommentsAndStrings(contents);
      const matches = [...strippedContents.matchAll(EMPTY_RULES_CALL)].map(
        (match) => match[0]
      );
      const allowedCount = ALLOWED.get(basename(fullPath)) ?? 0;
      if (matches.length !== allowedCount) {
        offenders.push({ file: fileName, matches });
      }
    }
    expect(
      offenders,
      `Expected each rules test file to call runRules(..., []) only up to its allowlisted ` +
        `count, but found deviations: ${JSON.stringify(offenders, null, 2)}`
    ).toEqual([]);
  });
});
