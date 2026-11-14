/**
 * Coverage for the reference parser, lint, and cross-file checks, run
 * against small reference trees written to a temp directory.
 */

import { checkBlockLayout } from './layout.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkCorpus,
  findCitations,
  parseProductions,
  type CheckOptions,
} from './check.js';
import { lintFile, loadSpecIdPattern } from './lint.js';
import {
  loadCorpus,
  parseFile,
  parseFrontmatter,
  type Corpus,
} from './parse.js';
import {
  buildReport,
  findConcept,
  pendingRules,
  searchRules,
} from './query.js';

const realRoot = path.resolve(import.meta.dirname, '../..');
const specIdPattern = loadSpecIdPattern(realRoot);
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true });
});

/** Writes `files` (repo-relative path to content) into a fresh temp repo. */
function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-test-'));
  tmpDirs.push(root);
  const defaults: Record<string, string> = {
    'reference/README.md':
      '---\nchapters:\n  - one\n  - two\n---\n\n# Readme\n',
    'docs/ref-grammar.ebnf':
      'item = "a" , { "b" } ;\n(* note *)\nother = item ;\n',
    'packages/core/src/error-registry.ts': "  RILL_R001: 'RILL-R001',\n",
  };
  const all = new Map(Object.entries({ ...defaults, ...files }));
  for (const [rel, content] of all) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function concept(
  id: string,
  extra: string,
  body: string,
  title = 'Thing'
): string {
  return `---\nid: ${id}\ntitle: ${title}\nstatus: normative\nsince: 0.24.0\n${extra}---\n\n# ${title}\n\nA thing.\n\n${body}`;
}

function lintText(text: string, chapter = 'one', file = 'thing'): string[] {
  const parsed = parseFile(
    text,
    `reference/${chapter}/${file}.md`,
    `/x/reference/${chapter}/${file}.md`,
    chapter
  );
  return lintFile(parsed, { specIdPattern }).map(
    (d) => `${d.severity}:${d.code}`
  );
}

const baseOptions: CheckOptions = {
  strict: false,
  errorCodes: ['TYPE_MISMATCH'],
};

function checkRepo(
  files: Record<string, string>,
  options: Partial<CheckOptions> = {}
): string[] {
  const root = makeRepo(files);
  const corpus = loadCorpus(root, path.join(root, 'reference'));
  return checkCorpus(corpus, { ...baseOptions, ...options })
    .filter((d) => d.severity !== 'info')
    .map((d) => `${d.code}`);
}

describe('parseFrontmatter', () => {
  it('reads scalars, inline lists, block lists, and drops comments', () => {
    const fm = parseFrontmatter([
      '---',
      'id: union   # the concept',
      'issues: [574, 595]',
      'depends:',
      '  - a',
      '  - b',
      'tests: []',
      '---',
    ]);
    expect(fm.data.get('id')).toBe('union');
    expect(fm.data.get('issues')).toEqual(['574', '595']);
    expect(fm.data.get('depends')).toEqual(['a', 'b']);
    expect(fm.data.get('tests')).toEqual([]);
    expect(fm.endLine).toBe(8);
  });
});

describe('parseFile', () => {
  it('splits markers, pending tags, and bodies, and ignores markers in fences', () => {
    const f = parseFile(
      concept(
        'thing',
        '',
        'r[thing.one] First rule\nA MUST here.\nMore.\n\nr[thing.two] Second rule {pending #7}\nBody.\n\n```markdown\nr[thing.fake] Not a rule\n```\n'
      ),
      'p.md',
      '/p.md',
      'one'
    );
    expect(f.rules.map((r) => r.id)).toEqual(['thing.one', 'thing.two']);
    expect(f.rules[0]?.body).toBe('A MUST here.\nMore.');
    expect(f.rules[1]?.pending).toBe(7);
    expect(f.rules[1]?.fullForm).toBe('Second rule');
  });
});

describe('lintFile', () => {
  const ok = concept(
    'thing',
    '',
    '## Syntax\n\nr[thing.one] First rule\nIt MUST hold.\n\n## Examples\n\n```rill\n1\n# Result: 1\n```\n'
  );

  it('accepts a conforming file', () => {
    expect(lintText(ok)).toEqual([]);
  });

  it('rejects a missing frontmatter block and an unknown key', () => {
    expect(lintText('# T\n\nDef.\n')).toContain('error:frontmatter-missing');
    expect(lintText(ok.replace('since:', 'bogus: 1\nsince:'))).toContain(
      'error:frontmatter-key'
    );
  });

  it('rejects a concept id that is not kebab-case, and a dot outside builtins', () => {
    expect(lintText(ok.replace('id: thing', 'id: Thing'))).toContain(
      'error:concept-id'
    );
    expect(lintText(ok.replace('id: thing', 'id: a.b'))).toContain(
      'error:concept-id'
    );
    const builtin = ok.replaceAll('thing', 'string.trim');
    expect(lintText(builtin, 'builtins', 'string.trim')).toEqual([]);
  });

  it('rejects headings outside the allowed set or order and multiple H1s', () => {
    expect(lintText(ok.replace('## Syntax', '## Grammar'))).toContain(
      'error:section-name'
    );
    expect(lintText(ok + '\n## Static rules\n')).toContain(
      'error:section-order'
    );
    expect(lintText(ok + '\n# Another\n')).toContain('error:h1-count');
  });

  it('checks marker concept, slug, full form, and pending tag', () => {
    const rule = (marker: string): string =>
      ok.replace('r[thing.one] First rule', marker);
    expect(lintText(rule('r[other.one] First rule'))).toContain(
      'error:rule-concept'
    );
    expect(lintText(rule('r[thing.a-b-c-d] First rule'))).toContain(
      'error:rule-slug'
    );
    expect(lintText(rule('r[thing.one] First rule.'))).toContain(
      'error:full-form-period'
    );
    expect(lintText(rule('r[thing.one] ' + 'x'.repeat(81)))).toContain(
      'error:full-form-length'
    );
    expect(lintText(rule('r[thing.one]'))).toContain('error:full-form-missing');
    expect(lintText(rule('r[thing.one] First rule {pending 7}'))).toContain(
      'error:pending-tag'
    );
  });

  it('rejects duplicate rule ids and full forms in a file', () => {
    const dup = ok + '\nr[thing.one] First rule\nIt MUST hold.\n';
    const codes = lintText(dup);
    expect(codes).toContain('error:rule-id-duplicate');
    expect(codes).toContain('error:full-form-duplicate');
  });

  it('requires the issue of a pending rule in frontmatter', () => {
    const pending = ok.replace('First rule', 'First rule {pending #9}');
    expect(lintText(pending)).toContain('error:issues-missing');
    expect(
      lintText(pending.replace('---\n\n#', 'issues: [9]\n---\n\n#'))
    ).toEqual([]);
  });

  it('warns on a body without a keyword and on tutorial voice outside Notes', () => {
    expect(lintText(ok.replace('It MUST hold.', 'It holds.'))).toContain(
      'warn:rule-keyword'
    );
    expect(
      lintText(ok.replace('It MUST hold.', 'It MUST hold. You see.'))
    ).toContain('warn:tutorial-voice');
    expect(lintText(ok + '\n## Notes\n\nYou see.\n')).toEqual([]);
  });

  it('rejects forbidden citations, even in Notes', () => {
    // Built at runtime so this file carries no literal workflow identifier.
    const id = (prefix: string, n: number): string => `${prefix}-${n}`;
    const notes = (t: string): string => ok + `\n## Notes\n\n${t}\n`;
    expect(lintText(notes(`See ${id('ADR', 12)}.`))).toContain(
      'error:citation'
    );
    expect(lintText(notes(`See ${'conduct'}/initiatives/x.`))).toContain(
      'error:citation'
    );
    expect(lintText(notes(`Covers ${id('AC', 3)}.`))).toContain(
      'error:citation'
    );
    expect(lintText(notes('Raises RILL-R010.'))).toEqual([]);
  });

  it('limits fence info strings', () => {
    expect(lintText(ok + '\n```python\nx\n```\n')).toContain(
      'error:fence-info'
    );
    expect(lintText(ok + '\n```\nx\n```\n')).toContain('error:fence-info');
    expect(lintText(ok.replace('```rill', '```rill pending=3'))).not.toContain(
      'error:fence-info'
    );
  });

  it('warns past 150 lines and errors past 200', () => {
    const pad = (n: number): string => ok + '\n' + 'x\n'.repeat(n);
    expect(lintText(pad(150))).toContain('warn:length');
    expect(lintText(pad(200))).toContain('error:length');
  });
});

describe('checkCorpus', () => {
  const one = concept(
    'alpha',
    'grammar: [item]\nerrors: [RILL-R001, TYPE_MISMATCH]\n',
    '## Syntax\n\n```ebnf\nitem = "a" , { "b" } ;\n```\n\nr[alpha.one] A rule\nIt MUST hold.\n\n## Errors\n\n| Condition | Error | Catchable |\n|-----------|-------|-----------|\n| A | `#TYPE_MISMATCH` | Yes |\n| B | RILL-R001 | No |\n'
  );

  it('accepts a consistent tree', () => {
    expect(checkRepo({ 'reference/one/alpha.md': one })).toEqual([]);
  });

  it('rejects duplicate concept ids and rule ids across files', () => {
    const codes = checkRepo({
      'reference/one/alpha.md': one,
      'reference/two/beta.md': one,
    });
    expect(codes).toContain('concept-duplicate');
    expect(codes).toContain('rule-id-duplicate');
  });

  it('rejects a rule id equal to a concept id and an id starting with a chapter', () => {
    const clash = concept('beta', '', 'r[beta.x] Rule\nIt MUST.\n').replace(
      'r[beta.x]',
      'r[alpha]'
    );
    expect(
      checkRepo({
        'reference/one/alpha.md': one,
        'reference/two/beta.md': clash,
      })
    ).toContain('rule-concept-clash');
    expect(
      checkRepo({ 'reference/one/one.md': concept('one', '', '') })
    ).toContain('id-chapter');
  });

  it('resolves depends against same and earlier chapters only', () => {
    const later = concept('beta', '', '');
    const dep = (target: string): string =>
      concept('alpha', `depends: [${target}]\n`, '');
    expect(
      checkRepo({
        'reference/one/alpha.md': dep('beta'),
        'reference/two/beta.md': later,
      })
    ).toContain('depends-order');
    expect(checkRepo({ 'reference/one/alpha.md': dep('gone') })).toContain(
      'depends-missing'
    );
    expect(
      checkRepo({
        'reference/two/beta.md': concept('beta', 'depends: [alpha]\n', ''),
        'reference/one/alpha.md': concept('alpha', '', ''),
      })
    ).toEqual([]);
  });

  it('compares grammar excerpts after normalizing whitespace and comments', () => {
    const reflowed = one.replace(
      'item = "a" , { "b" } ;',
      'item   = "a" ,\n  { "b" }   ;'
    );
    expect(checkRepo({ 'reference/one/alpha.md': reflowed })).toEqual([]);
    expect(
      checkRepo({ 'reference/one/alpha.md': one.replace('{ "b" }', '{ "c" }') })
    ).toContain('grammar-excerpt');
    expect(
      checkRepo({ 'reference/one/alpha.md': one.replace('[item]', '[nope]') })
    ).toContain('grammar-missing');
  });

  it('resolves error ids and codes', () => {
    expect(
      checkRepo({
        'reference/one/alpha.md': one.replace('RILL-R001', 'RILL-R999'),
      })
    ).toContain('error-id');
    expect(
      checkRepo({
        'reference/one/alpha.md': one.replace('TYPE_MISMATCH', 'NOPE'),
      })
    ).toContain('error-code');
  });

  it('requires listed test files to exist', () => {
    const withTest = one.replace('errors:', 'tests: [a.test.ts]\nerrors:');
    expect(checkRepo({ 'reference/one/alpha.md': withTest })).toContain(
      'test-missing'
    );
    expect(
      checkRepo({
        'reference/one/alpha.md': withTest,
        'packages/core/tests/language/a.test.ts': '',
      })
    ).toEqual([]);
  });

  it('validates rule() citations: unknown, pending, and valid', () => {
    const pendingRule = one.replace('A rule', 'A rule {pending #5}');
    const test = (call: string): Record<string, string> => ({
      'reference/one/alpha.md': one,
      'packages/core/tests/language/x.test.ts': `rule(${call}, () => {});`,
    });
    expect(checkRepo(test("'alpha.one'"))).toEqual([]);
    expect(checkRepo(test("'alpha.one', 'alpha.zzz'"))).toContain(
      'citation-unknown'
    );
    expect(
      checkRepo({
        ...test("'alpha.one'"),
        'reference/one/alpha.md': pendingRule,
      })
    ).toContain('citation-pending');
  });

  it('reports uncited built rules as info, and as errors under strict', () => {
    const root = makeRepo({ 'reference/one/alpha.md': one });
    const corpus = loadCorpus(root, path.join(root, 'reference'));
    const loose = checkCorpus(corpus, baseOptions);
    expect(loose.map((d) => `${d.severity}:${d.code}`)).toEqual([
      'info:uncited-rule',
    ]);
    const strict = checkCorpus(corpus, { ...baseOptions, strict: true });
    expect(strict.map((d) => `${d.severity}:${d.code}`)).toEqual([
      'error:uncited-rule',
    ]);
  });

  it('flags pending tags on closed issues only when issue lookup is on', () => {
    const pendingRule = one
      .replace('A rule', 'A rule {pending #5}')
      .replace('grammar:', 'issues: [5]\ngrammar:');
    const files = { 'reference/one/alpha.md': pendingRule };
    expect(checkRepo(files)).toEqual([]);
    expect(checkRepo(files, { issueState: () => 'CLOSED' })).toContain(
      'issue-closed'
    );
    expect(checkRepo(files, { issueState: () => 'OPEN' })).toEqual([]);
  });
});

describe('lintFile: further diagnostics', () => {
  const ok = concept(
    'thing',
    '',
    '## Syntax\n\nr[thing.one] First rule\nIt MUST hold.\n'
  );

  it('rejects a malformed column-0 marker', () => {
    expect(lintText(ok + '\nr[thing.two]no space\n')).toContain(
      'error:marker-syntax'
    );
    expect(lintText(ok + '\nr[thing.two Unclosed\n')).toContain(
      'error:marker-syntax'
    );
  });

  it('lets conventions files choose their own H2 headings', () => {
    const own = ok.replace('## Syntax', '## Grammar');
    expect(lintText(own, 'conventions')).toEqual([]);
    expect(lintText(own, 'one')).toContain('error:section-name');
    // Other rules still apply there.
    expect(
      lintText(own.replace('id: thing', 'id: Thing'), 'conventions')
    ).toContain('error:concept-id');
  });

  it('rejects a filename that differs from the concept id and a missing definition', () => {
    expect(lintText(ok, 'one', 'other')).toContain('error:filename');
    expect(lintText(ok.replace('A thing.', ''))).toContain('error:definition');
  });

  it('requires the Errors table header, a status value, and a closed fence', () => {
    expect(lintText(ok + '\n## Errors\n\nnone\n')).toContain(
      'error:errors-table'
    );
    expect(lintText(ok.replace('normative', 'draft'))).toContain(
      'error:status'
    );
    expect(lintText(ok + '\n```text\nx\n')).toContain('error:fence-unclosed');
  });

  it('warns on a rill fence without a result, and on stale or lowercase text', () => {
    expect(lintText(ok + '\n## Examples\n\n```rill\n1\n```\n')).toContain(
      'warn:fence-result'
    );
    expect(
      lintText(
        ok

          .replace('---\n\n#', 'issues: [4]\n---\n\n#')
      )
    ).toContain('warn:issues-stale');
    expect(
      lintText(ok.replace('It MUST hold.', 'It MUST hold and must stay.'))
    ).toContain('warn:rule-lowercase-must');
  });

  it('reads a rule body across paragraphs and fences, and accepts an indented fence', () => {
    const f = parseFile(
      concept(
        'thing',
        '',
        'r[thing.one] First\nIt MUST hold.\n\nSecond paragraph.\n\n  ```text\n  r[thing.fake] x\n  ```\n\nr[thing.two] Next\nIt MAY.\n'
      ),
      'p.md',
      '/p.md',
      'one'
    );
    expect(f.rules.map((r) => r.id)).toEqual(['thing.one', 'thing.two']);
    expect(f.rules[0]?.body).toContain('Second paragraph.');
    expect(f.rules[0]?.body).toContain('r[thing.fake] x');
    expect(f.fences).toHaveLength(1);
    expect(f.fences[0]?.closed).toBe(true);
  });

  it('keeps a hash inside a quoted title and inside list items', () => {
    const fm = parseFrontmatter([
      '---',
      'title: "C # types"   # note',
      'depends:',
      '  - a # b',
      '---',
    ]);
    expect(fm.data.get('title')).toBe('C # types');
    expect(fm.data.get('depends')).toEqual(['a # b']);
  });
});

describe('checkCorpus: further diagnostics', () => {
  const table = (cell: string): string =>
    `## Errors\n\n| Condition | Error | Catchable |\n|---|---|---|\n| A | ${cell} | Yes |\n`;
  const file = (extra: string, body: string): Record<string, string> => ({
    'reference/one/alpha.md': concept('alpha', extra, body),
  });

  it('matches the Errors table against frontmatter in both directions', () => {
    expect(
      checkRepo(file('errors: [TYPE_MISMATCH]\n', table('`#TYPE_MISMATCH`')))
    ).toEqual([]);
    expect(checkRepo(file('', table('`#TYPE_MISMATCH`')))).toContain(
      'errors-unlisted'
    );
    expect(checkRepo(file('errors: [TYPE_MISMATCH]\n', ''))).toContain(
      'errors-unused'
    );
    expect(checkRepo(file('', table('RILL-R999')))).toContain('error-id');
  });

  it('compares productions written in Syntax, listed or not, in ebnf and text fences only', () => {
    const syntax = (fence: string, text: string): string =>
      `## Syntax\n\n\`\`\`${fence}\n${text}\n\`\`\`\n`;
    expect(
      checkRepo(file('', syntax('ebnf', 'item = "a" , { "c" } ;')))
    ).toContain('grammar-excerpt');
    expect(
      checkRepo(file('', syntax('text', 'item = "a" , { "b" } ;')))
    ).toEqual([]);
    // A new production the grammar file lacks is not compared.
    expect(checkRepo(file('', syntax('ebnf', 'fresh = "z" ;')))).toEqual([]);
    // A fence in a pending rule states unbuilt grammar and is not compared.
    const pending =
      '## Syntax\n\nr[alpha.form] The new form {pending #7}\nThe form MUST be:\n\n```text\nitem = "a" , { "c" } ;\n```\n';
    expect(checkRepo(file('issues: [7]\n', pending))).toEqual([]);
    expect(checkRepo(file('', pending.replace(' {pending #7}', '')))).toContain(
      'grammar-excerpt'
    );
    // Prose outside fences does not satisfy a listed production.
    expect(
      checkRepo(
        file('grammar: [item]\n', '## Syntax\n\nitem = "a" , { "b" } ;\n')
      )
    ).toContain('grammar-syntax');
  });

  it('reads citations past comments, quote styles, and non-literal arguments', () => {
    const text = [
      "// rule('alpha.commented')",
      '/* rule("alpha.block") */',
      'rule(`alpha.tick`, \'alpha.one\', name, "alpha.late", () => {});',
      "rule('alpha.inline' /* note */);",
    ].join('\n');
    expect(findCitations(text, 't.ts').map((c) => [c.id, c.line])).toEqual([
      ['alpha.tick', 3],
      ['alpha.one', 3],
      ['alpha.late', 3],
      ['alpha.inline', 4],
    ]);
  });

  it('counts only citations under tests/language', () => {
    expect(
      checkRepo({
        ...file('', ''),
        'packages/core/tests/runtime/x.test.ts': "rule('nope.nope', () => {});",
      })
    ).toEqual([]);
  });

  it('rejects a chapter missing from the README', () => {
    expect(
      checkRepo({ 'reference/three/alpha.md': concept('alpha', '', '') })
    ).toContain('chapter-unknown');
  });
});

describe('lint and parse: robustness', () => {
  const ok = concept(
    'thing',
    '',
    '## Syntax\n\nr[thing.one] First rule\nIt MUST hold.\n\n## Examples\n\n```rill\n1\n# Result: 1\n```\n'
  );

  it('reads CRLF files the same as LF files', () => {
    expect(lintText(ok.replaceAll('\n', '\r\n'))).toEqual([]);
    const f = parseFile(ok.replaceAll('\n', '\r\n'), 'p.md', '/p.md', 'one');
    expect(f.rules.map((r) => r.id)).toEqual(['thing.one']);
    expect(f.headings.filter((h) => h.level === 1)).toHaveLength(1);
  });

  it('reports an unclosed frontmatter block, not a missing one', () => {
    const codes = lintText('---\nid: thing\n\n# Thing\n');
    expect(codes).toContain('error:frontmatter-unclosed');
    expect(codes).not.toContain('error:frontmatter-missing');
  });

  it('rejects a duplicate frontmatter key', () => {
    expect(
      lintText(ok.replace('title: Thing', 'title: Thing\ntitle: Other'))
    ).toContain('error:frontmatter-duplicate');
  });

  it('treats a scalar issues value like any other list key', () => {
    expect(lintText(ok.replace('---\n\n#', 'issues: 574\n---\n\n#'))).toContain(
      'error:frontmatter-list'
    );
  });

  it('limits the Errors header check to the Errors section', () => {
    const tableLater =
      ok +
      '\n## Errors\n\nnone\n\n## Notes\n\n| Condition | Error | Catchable |\n|---|---|---|\n';
    expect(lintText(tableLater)).toContain('error:errors-table');
  });
});

describe('checkCorpus: depends and ids', () => {
  const dep = (id: string, target: string): string =>
    concept(id, `depends: [${target}]\n`, '');

  it('rejects a self dependency and a same-chapter cycle', () => {
    expect(
      checkRepo({ 'reference/one/alpha.md': dep('alpha', 'alpha') })
    ).toContain('depends-self');
    const codes = checkRepo({
      'reference/one/alpha.md': dep('alpha', 'beta'),
      'reference/one/beta.md': dep('beta', 'alpha'),
    });
    expect(codes.filter((c) => c === 'depends-cycle')).toEqual([
      'depends-cycle',
    ]);
  });

  it('does not add depends-order when the chapter is unknown', () => {
    const codes = checkRepo({
      'reference/zzz/alpha.md': dep('alpha', 'beta'),
      'reference/two/beta.md': concept('beta', '', ''),
    });
    expect(codes).toEqual(['chapter-unknown']);
  });

  it('accepts an id that merely begins with a chapter word', () => {
    expect(
      checkRepo({ 'reference/one/one-x.md': concept('one-x', '', '') })
    ).toEqual([]);
  });
});

describe('loadCorpus paths', () => {
  it('expands directories and reports paths outside reference/ or missing', () => {
    const root = makeRepo({
      'reference/one/alpha.md': concept('alpha', '', ''),
    });
    const dir = path.join(root, 'reference');
    const corpus = loadCorpus(root, dir, [
      path.join(dir, 'one'),
      path.join(root, 'docs'),
      path.join(dir, 'gone.md'),
    ]);
    expect(corpus.files.map((f) => f.path)).toEqual(['reference/one/alpha.md']);
    expect(corpus.pathProblems.map((d) => d.code)).toEqual([
      'path-outside',
      'path-missing',
    ]);
  });
});

describe('cli', () => {
  const run = (
    ...args: string[]
  ): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync(
      path.join(realRoot, 'node_modules', '.bin', 'tsx'),
      [path.join(realRoot, 'scripts/reference/cli.ts'), ...args],
      { cwd: realRoot, encoding: 'utf-8' }
    );
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  it('exits 2 on a missing command or incomplete flags', () => {
    expect(run().status).toBe(2);
    expect(run('query').status).toBe(2);
    expect(run('query', '--search').status).toBe(2);
    expect(run('query', '--pending', '--issue').status).toBe(2);
    expect(run('query', '--pending', '--issue', 'x').status).toBe(2);
  });

  it('exits 1 for an unknown rule and for a lint path outside reference/', () => {
    expect(run('query', 'no-such.rule').status).toBe(1);
    const outside = run('lint', 'scripts');
    expect(outside.status).toBe(1);
    expect(outside.stdout).toContain('[path-outside]');
  });

  it('lints a directory argument without throwing', () => {
    const r = run('lint', 'reference');
    expect(r.stderr).not.toContain('EISDIR');
    expect(r.stdout).toMatch(/\d+ error\(s\)/);
  });

  it('prints report data as JSON', () => {
    const r = run('report', '--json');
    expect(r.status).toBe(0);
    expect(Object.keys(JSON.parse(r.stdout))).toEqual([
      'total',
      'chapters',
      'issues',
      'openDecisions',
    ]);
  });
});

describe('helpers', () => {
  it('parses productions without comments and finds rule() citations', () => {
    const p = parseProductions('a = "x" ; (* c ; d *)\nb = a , ";" ;');
    expect(p.get('a')).toBe('a = "x" ;');
    expect(p.get('b')).toBe('b = a , ";" ;');
    expect(
      findCitations("rule('a.b', \"c.d\")\nrule('e.f')", 't.ts').map((c) => [
        c.id,
        c.line,
      ])
    ).toEqual([
      ['a.b', 1],
      ['c.d', 1],
      ['e.f', 2],
    ]);
  });
});

describe('query', () => {
  const text = concept(
    'alpha',
    'issues: [5]\n',
    'r[alpha.one] Built rule\nIt MUST hold.\n\nr[alpha.two] Pending rule {pending #5}\nIt MAY need Widgets.\n'
  );
  const makeCorpus = (): Corpus => {
    const root = makeRepo({
      'reference/one/alpha.md': text,
      'reference/README.md':
        '---\nchapters:\n  - one\n  - two\n---\n\n## Open decisions\n\n| Issue | Q |\n|---|---|\n| [#9](u) | x |\n',
    });
    return loadCorpus(root, path.join(root, 'reference'));
  };

  it('finds concepts, searches bodies, and lists pending rules', () => {
    const corpus = makeCorpus();
    expect(findConcept(corpus, 'alpha')?.definition).toBe('A thing.');
    expect(findConcept(corpus, 'alpha')?.rules.map((r) => r.state)).toEqual([
      'built',
      'pending',
    ]);
    expect(searchRules(corpus, 'widgets').map((r) => r.id)).toEqual([
      'alpha.two',
    ]);
    expect(pendingRules(corpus, 6)).toEqual([]);
    expect(pendingRules(corpus, 5).map((r) => r.id)).toEqual(['alpha.two']);
  });

  it('counts built and pending rules per chapter and issue, plus open decisions', () => {
    const corpus = makeCorpus();
    expect(buildReport(corpus)).toEqual({
      total: { built: 1, pending: 1 },
      chapters: [{ chapter: 'one', built: 1, pending: 1 }],
      issues: [{ issue: 5, pending: 1 }],
      openDecisions: 1,
    });
  });
});

describe('checkBlockLayout', () => {
  const codes = (src: string): string[] =>
    checkBlockLayout(src.split('\n')).map((i) => `${i.index}:${i.code}`);

  it('accepts a one-line block and a conforming multiline block', () => {
    expect(codes('3 -> { $ + 1 }')).toEqual([]);
    expect(codes('3 -> {\n  $ + 1\n  $ * 10\n} -> .str')).toEqual([]);
  });

  it('accepts nested blocks indented two spaces per level', () => {
    expect(codes('1 -> {\n  2 -> {\n    $ + 1\n  }\n}')).toEqual([]);
  });

  it('rejects content after an opening brace that stays open', () => {
    expect(codes('3 -> { $ + 1\n  $ * 10\n}')).toEqual(['0:block-open']);
  });

  it('rejects content before a closing brace on a later line', () => {
    expect(codes('3 -> {\n  $ + 1\n  $ * 10 }')).toEqual(['2:block-close']);
  });

  it('rejects a statement at the wrong indent', () => {
    expect(codes('3 -> {\n$ + 1\n}')).toEqual(['1:block-indent']);
    expect(codes('3 -> {\n    $ + 1\n}')).toEqual(['1:block-indent']);
    expect(codes('3 -> {\n  $ + 1\n  }')).toEqual(['2:block-indent']);
  });

  it('allows deeper continuation lines and lines inside a group', () => {
    expect(codes('3 -> {\n  $\n    -> { $ + 1 }\n}')).toEqual([]);
    expect(codes('1 -> {\n  list[\n      1, 2\n  ]\n}')).toEqual([]);
  });

  it('ignores braces in strings, interpolation, and comments', () => {
    expect(codes('"a { b" -> {\n  "x{$}y"\n}')).toEqual([]);
    expect(codes('1 -> {  # opens {\n  $\n}')).toEqual([]);
    expect(codes('"""\n{ not code\n""" -> .len')).toEqual([]);
  });
});
