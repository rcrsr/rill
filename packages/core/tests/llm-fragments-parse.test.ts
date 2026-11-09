/**
 * docs/llm fragment snippet test
 *
 * `pnpm test:examples` runs only fenced rill blocks in docs/*.md and
 * README.md. The LLM fragments under docs/llm/ use 4-space indented
 * Wrong/Right pairs instead of fences, so their snippets were never checked.
 * This test parses every `Right:` snippet and fails on a parse error, which
 * catches removed or invalid syntax such as the namespaced host-call form.
 *
 * It parses only. A snippet that parses but halts at runtime (for example a
 * string `+`) is not caught here; the hand-written assertions in
 * language/ref-llms-full-assertions.test.ts cover runtime claims.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const fragmentDir = path.join(projectRoot, 'docs', 'llm');

interface Snippet {
  readonly file: string;
  readonly line: number;
  readonly code: string;
}

// A `Right:` snippet ends at a trailing `# comment` or at a column of
// 3+ spaces that starts a prose label (cheatsheet side-by-side layout).
function extractRightSnippets(file: string): Snippet[] {
  const lines = fs
    .readFileSync(path.join(fragmentDir, file), 'utf-8')
    .split('\n');
  const snippets: Snippet[] = [];
  lines.forEach((text, index) => {
    const match = /Right:\s+(.*)$/.exec(text);
    if (match?.[1] === undefined) return;
    const code = match[1]
      .replace(/\s{2,}#.*$/, '')
      .replace(/\s{3,}\S+:.*$/, '')
      .trim();
    // `{ ... }` marks an elided body, not parseable rill.
    if (code === '' || code.includes('...')) return;
    snippets.push({ file, line: index + 1, code });
  });
  return snippets;
}

const fragments = fs
  .readdirSync(fragmentDir)
  .filter((name) => name.endsWith('.txt'))
  .sort();
const snippets = fragments.flatMap(extractRightSnippets);

describe('docs/llm fragments', () => {
  it('contains Right: snippets to check', () => {
    expect(snippets.length).toBeGreaterThan(40);
  });

  it.each(snippets.map((s) => [`${s.file}:${s.line}`, s.code] as const))(
    '%s parses: %s',
    (_location, code) => {
      expect(() => parse(code)).not.toThrow();
    }
  );
});
