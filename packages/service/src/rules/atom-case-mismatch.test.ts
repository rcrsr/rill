import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { atomCaseMismatch } from './atoms.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(source: string): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, makeConfig(), [
    atomCaseMismatch,
  ]);
}

describe('ATOM_CASE_MISMATCH', () => {
  it.each([
    ['timeout', 'TIMEOUT'],
    ['Ok', 'ok'],
    ['OK', 'ok'],
  ])('fires on #%s', (name, builtin) => {
    const result = run(`#${name}\n1\n`);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'ATOM_CASE_MISMATCH',
      severity: 'warning',
      message: `Atom #${name} differs from builtin #${builtin} only by case; atom names are case-sensitive.`,
      fix: null,
    });
  });

  it.each(['TIMEOUT', 'ok', 'wired'])('does not fire on #%s', (name) => {
    expect(run(`#${name}\n1\n`)).toEqual([]);
  });
});
