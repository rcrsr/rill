/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Proves the rules in reference/conventions/ that govern how reference files
 * are written. A language test cannot prove them, so the checker accepts
 * citations of conventions/ rules from this file and from no other tooling
 * test.
 */

import { describe, expect } from 'vitest';
import { checkRepo, concept, lintText, rule } from './test-helpers.js';

const ok = concept(
  'thing',
  '',
  '## Syntax\n\nr[thing.one] First rule\nIt MUST hold.\n\n## Examples\n\n```rill\n1\n# Result: 1\n```\n'
);

describe('grammar notation', () => {
  const file = (
    frontmatter: string,
    syntax: string
  ): Record<string, string> => ({
    'reference/one/alpha.md': concept(
      'alpha',
      frontmatter,
      `## Syntax\n\n\`\`\`ebnf\n${syntax}\n\`\`\`\n`
    ),
  });

  rule('notation.ebnf').it(
    'reads a listed production only from an ISO EBNF definition',
    () => {
      expect(
        checkRepo(file('grammar: [item]\n', 'item = "a" , { "b" } ;'))
      ).toEqual([]);
      expect(
        checkRepo(file('grammar: [item]\n', 'item ::= "a" ( "b" )*'))
      ).toContain('grammar-syntax');
    }
  );

  rule('notation.excerpt').it(
    'fails an excerpt that differs from the grammar file',
    () => {
      expect(
        checkRepo(file('grammar: [item]\n', 'item = "a" , { "c" } ;'))
      ).toContain('grammar-excerpt');
    }
  );
});

describe('normative force', () => {
  rule('notation.keywords').it(
    'warns on a rule body without an uppercase keyword, and on lowercase must',
    () => {
      expect(lintText(ok)).toEqual([]);
      expect(lintText(ok.replace('It MUST hold.', 'It holds.'))).toContain(
        'warn:rule-keyword'
      );
      expect(
        lintText(ok.replace('It MUST hold.', 'It MUST hold and must stay.'))
      ).toContain('warn:rule-lowercase-must');
    }
  );

  rule('notation.informative').it(
    'rejects an uppercase keyword in Examples or Notes prose',
    () => {
      expect(lintText(ok + '\n## Notes\n\nThe value MUST be 1.\n')).toContain(
        'error:informative-normative'
      );
      expect(
        lintText(
          ok.replace('## Examples\n', '## Examples\n\nA value MAY be 1.\n')
        )
      ).toContain('error:informative-normative');
      expect(
        lintText(ok + '\n## Notes\n\nThe value must be 1. `MUST`\n')
      ).toEqual([]);
    }
  );
});

describe('rule markers', () => {
  const marker = (m: string): string =>
    ok.replace('r[thing.one] First rule', m);

  rule('notation.marker').it(
    'rejects a marker line that is not r[<id>] <full form>',
    () => {
      expect(lintText(marker('r[thing.one]First rule'))).toContain(
        'error:marker-syntax'
      );
      expect(lintText(marker('r[thing.one] First rule'))).toEqual([]);
    }
  );

  rule('notation.pending').it(
    'requires a pending tag to read {pending #N} and name its issue',
    () => {
      expect(lintText(marker('r[thing.one] First rule {pending 7}'))).toContain(
        'error:pending-tag'
      );
      const pending = marker('r[thing.one] First rule {pending #7}');
      expect(lintText(pending)).toContain('error:issues-missing');
      expect(
        lintText(pending.replace('---\n\n#', 'issues: [7]\n---\n\n#'))
      ).toEqual([]);
    }
  );
});

describe('Errors tables', () => {
  rule('halt.table').it(
    'requires the Condition, Error, and Catchable columns',
    () => {
      const table =
        '\n## Errors\n\n| Condition | Error | Catchable |\n|-----------|-------|-----------|\n| A | `#TYPE_MISMATCH` | Yes |\n';
      expect(
        lintText(
          ok.replace('---\n\n#', 'errors: [TYPE_MISMATCH]\n---\n\n#') + table
        )
      ).not.toContain('error:errors-table');
      expect(
        lintText(ok + '\n## Errors\n\n| Condition | Error |\n|---|---|\n')
      ).toContain('error:errors-table');
    }
  );
});
