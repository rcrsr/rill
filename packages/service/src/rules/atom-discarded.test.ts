import { describe, expect, it } from 'vitest';
import { RULES } from './rules.js';
import { runRules } from './run-rules.js';
import { atomDiscarded } from './atoms.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(source: string): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, makeConfig(), [atomDiscarded]);
}

describe('ATOM_DISCARDED', () => {
  it('fires on a non-final atom statement', () => {
    const result = run('#todo\n1\n');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'ATOM_DISCARDED',
      severity: 'warning',
      message:
        "Atom #todo is a discarded statement; a comment needs a space after '#'.",
      fix: null,
    });
  });

  it('does not fire on the final statement of a script', () => {
    expect(run('1\n#done\n')).toEqual([]);
  });

  it('does not fire on the final statement of a block', () => {
    expect(run('{ log(1)\n#done }\n')).toEqual([]);
  });
});

describe('atom rules provenance', () => {
  it('report no atom findings for atoms that only name list members', () => {
    const source = 'list[#wired, #wireless] => $k\n$k -> .len\n';

    const result = runRules(toParseResult(source), source, makeConfig(), [
      ...RULES,
    ]);

    expect(result.filter((d) => d.code.startsWith('ATOM_'))).toEqual([]);
  });
});
