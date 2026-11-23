/**
 * Fixture helpers shared by the reference tooling tests: a temp repo writer,
 * a concept file builder, and lint and check runners.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, it } from 'vitest';
import { checkCorpus, type CheckOptions } from './check.js';
import { lintFile, loadSpecIdPattern } from './lint.js';
import { loadCorpus, parseFile } from './parse.js';

export const realRoot = path.resolve(import.meta.dirname, '../..');
const specIdPattern = loadSpecIdPattern(realRoot);
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true });
});

/** Writes `files` (repo-relative path to content) into a fresh temp repo. */
export function makeRepo(files: Record<string, string>): string {
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

export function concept(
  id: string,
  extra: string,
  body: string,
  title = 'Thing'
): string {
  return `---\nid: ${id}\ntitle: ${title}\nstatus: normative\nsince: 0.24.0\n${extra}---\n\n# ${title}\n\nA thing.\n\n${body}`;
}

export function lintText(
  text: string,
  chapter = 'one',
  file = 'thing'
): string[] {
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

export const baseOptions: CheckOptions = {
  strict: false,
  errorCodes: ['TYPE_MISMATCH'],
};

export function checkRepo(
  files: Record<string, string>,
  options: Partial<CheckOptions> = {}
): string[] {
  const root = makeRepo(files);
  const corpus = loadCorpus(root, path.join(root, 'reference'));
  return checkCorpus(corpus, { ...baseOptions, ...options })
    .filter((d) => d.severity !== 'info')
    .map((d) => `${d.code}`);
}

/**
 * Cites reference rules from a tooling test. The checker reads string-literal
 * ids passed here only in `scripts/reference/conventions.test.ts`.
 */
export function rule(..._ids: string[]): { it: typeof it } {
  return { it };
}
