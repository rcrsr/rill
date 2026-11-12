import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { atomCaseMismatch, atomNotErrorCode } from './atoms.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(source: string): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, makeConfig(), [
    atomCaseMismatch,
    atomNotErrorCode,
  ]);
}

describe('ATOM_NOT_ERROR_CODE', () => {
  it('fires when .!code is compared with a misspelled code', () => {
    const result = run('$v.!code == #TIMEOUTT\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'ATOM_NOT_ERROR_CODE',
      severity: 'warning',
      message:
        'Atom #TIMEOUTT is not an error code; .!code is #ok or a core error code.',
      fix: null,
    });
  });

  it('fires when the atom is on the left of !=', () => {
    const result = run('#WIRED != $v.!code\n');

    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('ATOM_NOT_ERROR_CODE');
  });

  it.each(['$v.!code == #ok', '$v.!code == #TIMEOUT', '$v.!message == #WIRED'])(
    'does not fire on %s',
    (source) => {
      expect(run(`${source}\n`)).toEqual([]);
    }
  );

  it('reports a wrong-case builtin once, as ATOM_CASE_MISMATCH', () => {
    const result = run('$v.!code == #timeout\n');

    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('ATOM_CASE_MISMATCH');
  });
});
