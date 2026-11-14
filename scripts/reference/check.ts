/**
 * Cross-file checks: id uniqueness, dependency order, and resolution of
 * grammar, error, test, and issue references against the rest of the repo.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  getList,
  getString,
  type Corpus,
  type Diagnostic,
  type ParsedFile,
  type Severity,
} from './parse.js';

export type IssueState = 'OPEN' | 'CLOSED' | 'UNKNOWN';

export interface CheckOptions {
  /** Report built rules with no citing test as errors instead of info. */
  strict: boolean;
  /** Core error code set, without the `#` sigil. */
  errorCodes: readonly string[];
  /** When set, every pending issue is looked up through it. */
  issueState?: ((issue: number) => IssueState) | undefined;
}

const RILL_ID = /^RILL-[A-Z]\d+$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

/** Replaces `(* ... *)` comments with a space, leaving quoted strings alone. */
function stripEbnfComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      const end = close < 0 ? text.length : close + 1;
      out += text.slice(i, end);
      i = end;
    } else if (c === '(' && text.charAt(i + 1) === '*') {
      const close = text.indexOf('*)', i + 2);
      i = close < 0 ? text.length : close + 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Splits a grammar into `name -> normalized production`. Comments are
 * stripped and whitespace collapsed; the production runs from its name to
 * its closing `;`.
 */
export function parseProductions(grammar: string): Map<string, string> {
  const text = stripEbnfComments(grammar);
  const productions = new Map<string, string>();
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      i = close < 0 ? text.length : close + 1;
    } else if (c === ';') {
      const stmt = normalizeWhitespace(text.slice(start, i + 1));
      const m = stmt.match(/^([A-Za-z][\w-]*) =/);
      if (m) productions.set(m[1]!, stmt);
      start = i + 1;
      i++;
    } else {
      i++;
    }
  }
  return productions;
}

// ---------------------------------------------------------------------------
// Test citations
// ---------------------------------------------------------------------------

export interface Citation {
  id: string;
  file: string;
  line: number;
}

/** Blanks `//` and block comments, keeping newlines so line numbers hold. */
function stripJsComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    const two = text.slice(i, i + 2);
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text.charAt(j) !== c) {
        j += text.charAt(j) === '\\' ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (two === '//' || two === '/*') {
      const close = text.indexOf(two === '//' ? '\n' : '*/', i + 2);
      const stop = close < 0 ? text.length : close + (two === '//' ? 0 : 2);
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Reads a quoted literal at `i`; template literals with `${` do not count. */
function readStringLiteral(
  source: string,
  i: number
): { value: string; end: number } | null {
  const q = source.charAt(i);
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let value = '';
  for (let j = i + 1; j < source.length; j++) {
    const c = source.charAt(j);
    if (c === q) return { value, end: j + 1 };
    if (c === '\n' || c === '\\' || (q === '`' && c === '$')) return null;
    value += c;
  }
  return null;
}

/**
 * Finds `rule('a.b', 'c.d')` calls. Each argument is read on its own: a
 * string literal is a citation, anything else is skipped, and reading stops
 * at the callback.
 */
export function findCitations(text: string, file: string): Citation[] {
  const source = stripJsComments(text);
  const out: Citation[] = [];
  for (const call of source.matchAll(/\brule\(/g)) {
    let i = call.index + call[0].length;
    for (;;) {
      while (/\s/.test(source.charAt(i))) i++;
      const literal = readStringLiteral(source, i);
      if (literal) {
        out.push({
          id: literal.value,
          file,
          line: source.slice(0, i).split('\n').length,
        });
        i = literal.end;
      } else {
        // A non-literal argument: skip it unless it is the callback.
        const rest = source.slice(i);
        const arg = rest.match(/^[^,()]*(?:\([^()]*\)[^,()]*)*/)![0];
        if (arg === '' || /=>|\bfunction\b/.test(arg)) break;
        i += arg.length;
      }
      while (/\s/.test(source.charAt(i))) i++;
      if (source.charAt(i) !== ',') break;
      i++;
    }
  }
  return out;
}

function listTests(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') {
      out.push(...listTests(full));
    } else if (e.isFile() && e.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

function readRegistryIds(repoRoot: string): Set<string> {
  const text = fs.readFileSync(
    path.join(repoRoot, 'packages/core/src/error-registry.ts'),
    'utf-8'
  );
  return new Set(
    [...text.matchAll(/:\s*'(RILL-[A-Z]\d+)'/g)].map((m) => m[1]!)
  );
}

export function fetchIssueStateWithGh(issue: number): IssueState {
  const r = spawnSync(
    'gh',
    ['issue', 'view', String(issue), '--repo', 'rcrsr/rill', '--json', 'state'],
    { encoding: 'utf-8' }
  );
  if (r.status !== 0) return 'UNKNOWN';
  try {
    const parsed = JSON.parse(r.stdout) as { state?: string };
    return parsed.state === 'OPEN'
      ? 'OPEN'
      : parsed.state === 'CLOSED'
        ? 'CLOSED'
        : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

export function checkCorpus(
  corpus: Corpus,
  options: CheckOptions
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (
    file: ParsedFile,
    line: number,
    severity: Severity,
    code: string,
    message: string
  ): void => {
    out.push({ file: file.path, line, severity, code, message });
  };
  const { repoRoot, files } = corpus;

  checkIds(corpus, add);
  checkDepends(corpus, add);
  checkXrefs(corpus, add);

  checkGrammar(files, repoRoot, add);
  checkErrors(files, repoRoot, options.errorCodes, add);

  // tests
  const languageDir = path.join(repoRoot, 'packages/core/tests/language');
  for (const f of files) {
    const line = f.frontmatter.lines.get('tests') ?? 1;
    for (const t of getList(f.frontmatter, 'tests')) {
      if (!fs.existsSync(path.join(languageDir, t))) {
        add(
          f,
          line,
          'error',
          'test-missing',
          `Test file '${t}' is not under packages/core/tests/language/`
        );
      }
    }
  }

  checkCitations(corpus, options, add, out);

  if (options.issueState) {
    checkIssues(corpus, options.issueState, add);
  }
  return out;
}

type AddFor = (
  file: ParsedFile,
  line: number,
  severity: Severity,
  code: string,
  message: string
) => void;

/**
 * True when the fence sits in the body of a pending rule: the nearest rule
 * marker before it is pending and no heading intervenes. Such a fence states
 * grammar that is not built yet, so it is never compared with the grammar file.
 */
function inPendingRule(file: ParsedFile, fenceLine: number): boolean {
  let rule: ParsedFile['rules'][number] | undefined;
  for (const r of file.rules) {
    if (r.line < fenceLine && (!rule || r.line > rule.line)) rule = r;
  }
  if (!rule || rule.pending === null) return false;
  const ruleLine = rule.line;
  return !file.headings.some((h) => h.line > ruleLine && h.line < fenceLine);
}

/** Content of the built ebnf and text fences inside the Syntax section. */
function syntaxFenceText(file: ParsedFile): string {
  const start = file.headings.find((h) => h.level === 2 && h.text === 'Syntax');
  if (!start) return '';
  const next = file.headings.find((h) => h.line > start.line && h.level <= 2);
  const end = next ? next.line : file.lines.length + 1;
  return file.fences
    .filter(
      (f) =>
        f.closed &&
        f.line > start.line &&
        f.line < end &&
        (f.info === 'ebnf' || f.info === 'text') &&
        !inPendingRule(file, f.line)
    )
    .map((f) => file.lines.slice(f.line, f.endLine - 1).join('\n'))
    .join('\n');
}

function checkGrammar(
  files: ParsedFile[],
  repoRoot: string,
  add: AddFor
): void {
  const grammarPath = path.join(repoRoot, 'docs/ref-grammar.ebnf');
  const grammar = fs.existsSync(grammarPath)
    ? parseProductions(fs.readFileSync(grammarPath, 'utf-8'))
    : new Map<string, string>();
  for (const f of files) {
    const wanted = getList(f.frontmatter, 'grammar');
    const line = f.frontmatter.lines.get('grammar') ?? 1;
    const written = parseProductions(syntaxFenceText(f));
    for (const name of wanted) {
      if (!grammar.has(name)) {
        add(
          f,
          line,
          'error',
          'grammar-missing',
          `Production '${name}' is not in docs/ref-grammar.ebnf`
        );
      } else if (!written.has(name)) {
        add(
          f,
          line,
          'error',
          'grammar-syntax',
          `Production '${name}' is listed but no ebnf or text fence in Syntax defines it`
        );
      }
    }
    // Any production written in Syntax that the grammar file also defines
    // must match it, listed or not.
    for (const [name, text] of written) {
      const expected = grammar.get(name);
      if (expected !== undefined && expected !== text) {
        add(
          f,
          line,
          'error',
          'grammar-excerpt',
          `Syntax production '${name}' differs from docs/ref-grammar.ebnf`
        );
      }
    }
  }
}

function checkErrors(
  files: ParsedFile[],
  repoRoot: string,
  errorCodes: readonly string[],
  add: AddFor
): void {
  const registry = readRegistryIds(repoRoot);
  const codes = new Set(errorCodes);
  for (const f of files) {
    const fmLine = f.frontmatter.lines.get('errors') ?? 1;
    const listed = new Map(
      getList(f.frontmatter, 'errors').map((e) => [e.replace(/^#/, ''), fmLine])
    );
    const tabled = new Map<string, number>();
    for (const row of f.errorRows) {
      for (const id of row.ids) {
        if (!tabled.has(id)) tabled.set(id, row.line);
      }
    }
    for (const [id, line] of new Map([...listed, ...tabled])) {
      if (RILL_ID.test(id)) {
        if (!registry.has(id)) {
          add(
            f,
            line,
            'error',
            'error-id',
            `Error id '${id}' is not in packages/core/src/error-registry.ts`
          );
        }
      } else if (!ERROR_CODE.test(id) || !codes.has(id)) {
        add(
          f,
          line,
          'error',
          'error-code',
          `Error '${id}' is neither a registry id nor a core error code`
        );
      }
    }
    for (const [id, line] of tabled) {
      if (!listed.has(id)) {
        add(
          f,
          line,
          'error',
          'errors-unlisted',
          `Errors table names '${id}' but frontmatter 'errors' does not list it`
        );
      }
    }
    for (const [id, line] of listed) {
      if (!tabled.has(id)) {
        add(
          f,
          line,
          'error',
          'errors-unused',
          `Frontmatter lists '${id}' but the Errors table does not name it`
        );
      }
    }
  }
}

function checkIds(corpus: Corpus, add: AddFor): void {
  const concepts = new Map<string, ParsedFile>();
  const ruleIds = new Map<string, ParsedFile>();
  for (const f of corpus.files) {
    const id = getString(f.frontmatter, 'id');
    if (!id) continue;
    const prior = concepts.get(id);
    if (prior) {
      add(
        f,
        f.frontmatter.lines.get('id') ?? 1,
        'error',
        'concept-duplicate',
        `Concept id '${id}' is also in ${prior.path}`
      );
    } else {
      concepts.set(id, f);
    }
    const first = id.split('.')[0]!;
    if (corpus.chapters.includes(first)) {
      add(
        f,
        f.frontmatter.lines.get('id') ?? 1,
        'error',
        'id-chapter',
        `Id '${id}' starts with the chapter name '${first}'`
      );
    }
  }
  for (const f of corpus.files) {
    for (const r of f.rules) {
      const prior = ruleIds.get(r.id);
      // Duplicates inside one file are the per-file lint's finding.
      if (prior && prior !== f) {
        add(
          f,
          r.line,
          'error',
          'rule-id-duplicate',
          `Rule id '${r.id}' is also in ${prior.path}`
        );
      } else if (!prior) {
        ruleIds.set(r.id, f);
      }
      if (concepts.has(r.id)) {
        add(
          f,
          r.line,
          'error',
          'rule-concept-clash',
          `Rule id '${r.id}' equals a concept id`
        );
      }
    }
  }
}

/**
 * Cross-references. A backticked `concept.rule` outside Notes must name an
 * existing rule or concept, so a renamed or removed rule cannot leave a stale
 * link behind. Notes may name superseded ids, which by definition no longer
 * exist. A built rule that cites a pending rule describes behavior that is not
 * built yet, which is reported as a warning.
 */
function checkXrefs(corpus: Corpus, add: AddFor): void {
  const concepts = new Set<string>();
  const rules = new Map<string, ParsedFile['rules'][number]>();
  for (const f of corpus.files) {
    const id = getString(f.frontmatter, 'id');
    if (id) concepts.add(id);
    for (const r of f.rules) rules.set(r.id, r);
  }
  const token = /`([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+)`/g;

  for (const f of corpus.files) {
    if (!getString(f.frontmatter, 'id')) continue;
    const notes = f.headings.find((h) => h.level === 2 && h.text === 'Notes');
    const end = notes ? notes.line : f.lines.length + 1;
    const inFence = (line: number): boolean =>
      f.fences.some(
        (x) => line >= x.line && line <= (x.closed ? x.endLine : f.lines.length)
      );
    const markerLines = new Set(f.rules.map((r) => r.line));
    const owner = (line: number): ParsedFile['rules'][number] | undefined => {
      let best: ParsedFile['rules'][number] | undefined;
      for (const r of f.rules) {
        if (r.line <= line && (!best || r.line > best.line)) best = r;
      }
      if (!best) return undefined;
      const heading = f.headings.some(
        (h) => h.line > best!.line && h.line <= line
      );
      return heading ? undefined : best;
    };

    for (let line = 1; line < end; line++) {
      if (markerLines.has(line) || inFence(line)) continue;
      const text = f.lines[line - 1] ?? '';
      for (const m of text.matchAll(token)) {
        const ref = m[1]!;
        const concept = ref.slice(0, ref.lastIndexOf('.'));
        if (!concepts.has(concept)) continue;
        if (concepts.has(ref)) continue;
        const target = rules.get(ref);
        if (!target) {
          add(
            f,
            line,
            'error',
            'xref-unknown',
            `'${ref}' names no rule; concept '${concept}' has no rule with that slug`
          );
          continue;
        }
        const from = owner(line);
        if (from && from.pending === null && target.pending !== null) {
          add(
            f,
            line,
            'warn',
            'xref-pending',
            `Built rule '${from.id}' cites '${ref}', which is pending #${target.pending}`
          );
        }
      }
    }
  }
}

function checkDepends(corpus: Corpus, add: AddFor): void {
  const byId = new Map<string, ParsedFile>();
  for (const f of corpus.files) {
    const id = getString(f.frontmatter, 'id');
    if (id) byId.set(id, f);
  }
  for (const f of corpus.files) {
    const line = f.frontmatter.lines.get('depends') ?? 1;
    const own = corpus.chapters.indexOf(f.chapter);
    if (own < 0) {
      add(
        f,
        1,
        'error',
        'chapter-unknown',
        `Chapter '${f.chapter}' is not in the README chapters list`
      );
    }
    for (const dep of getList(f.frontmatter, 'depends')) {
      const target = byId.get(dep);
      if (!target) {
        add(
          f,
          line,
          'error',
          'depends-missing',
          `Dependency '${dep}' is not a concept id`
        );
      } else if (target === f) {
        add(f, line, 'error', 'depends-self', `Concept depends on itself`);
      } else if (own >= 0 && corpus.chapters.indexOf(target.chapter) > own) {
        add(
          f,
          line,
          'error',
          'depends-order',
          `Dependency '${dep}' is in the later chapter '${target.chapter}'`
        );
      }
    }
  }

  checkDependsCycles(corpus.files, byId, add);
}

/** Reports each dependency cycle once, at its first file in corpus order. */
function checkDependsCycles(
  files: ParsedFile[],
  byId: Map<string, ParsedFile>,
  add: AddFor
): void {
  const state = new Map<ParsedFile, 'active' | 'done'>();
  const reported = new Set<string>();
  const visit = (f: ParsedFile, stack: ParsedFile[]): void => {
    state.set(f, 'active');
    stack.push(f);
    for (const dep of getList(f.frontmatter, 'depends')) {
      const target = byId.get(dep);
      if (!target || target === f) continue;
      if (state.get(target) === 'active') {
        const cycle = stack.slice(stack.indexOf(target));
        const names = cycle.map(
          (c) => getString(c.frontmatter, 'id') ?? c.path
        );
        const key = [...names].sort().join(',');
        if (!reported.has(key)) {
          reported.add(key);
          add(
            target,
            target.frontmatter.lines.get('depends') ?? 1,
            'error',
            'depends-cycle',
            `Dependency cycle: ${[...names, names[0]].join(' -> ')}`
          );
        }
      } else if (!state.has(target)) {
        visit(target, stack);
      }
    }
    stack.pop();
    state.set(f, 'done');
  };
  for (const f of files) {
    if (!state.has(f)) visit(f, []);
  }
}

function checkCitations(
  corpus: Corpus,
  options: CheckOptions,
  add: AddFor,
  out: Diagnostic[]
): void {
  const rules = new Map<
    string,
    { file: ParsedFile; pending: number | null; line: number }
  >();
  for (const f of corpus.files) {
    for (const r of f.rules) {
      if (!rules.has(r.id))
        rules.set(r.id, { file: f, pending: r.pending, line: r.line });
    }
  }
  const cited = new Set<string>();
  const testsDir = path.join(corpus.repoRoot, 'packages/core/tests/language');
  for (const t of listTests(testsDir)) {
    const rel = path.relative(corpus.repoRoot, t).split(path.sep).join('/');
    for (const c of findCitations(fs.readFileSync(t, 'utf-8'), rel)) {
      const rule = rules.get(c.id);
      if (!rule) {
        out.push({
          file: c.file,
          line: c.line,
          severity: 'error',
          code: 'citation-unknown',
          message: `Test cites unknown rule '${c.id}'`,
        });
      } else if (rule.pending !== null) {
        out.push({
          file: c.file,
          line: c.line,
          severity: 'error',
          code: 'citation-pending',
          message: `Test cites rule '${c.id}', which is pending #${rule.pending}`,
        });
      } else {
        cited.add(c.id);
      }
    }
  }
  const severity: Severity = options.strict ? 'error' : 'info';
  for (const [id, rule] of rules) {
    if (rule.pending === null && !cited.has(id)) {
      add(
        rule.file,
        rule.line,
        severity,
        'uncited-rule',
        `Built rule '${id}' has no citing test`
      );
    }
  }
}

function checkIssues(
  corpus: Corpus,
  issueState: (issue: number) => IssueState,
  add: AddFor
): void {
  const cache = new Map<number, IssueState>();
  const state = (n: number): IssueState => {
    let s = cache.get(n);
    if (s === undefined) {
      s = issueState(n);
      cache.set(n, s);
    }
    return s;
  };
  const verify = (f: ParsedFile, line: number, n: number): void => {
    const s = state(n);
    if (s === 'CLOSED') {
      add(
        f,
        line,
        'error',
        'issue-closed',
        `Issue #${n} is closed; remove the pending tag`
      );
    } else if (s === 'UNKNOWN') {
      add(
        f,
        line,
        'error',
        'issue-unknown',
        `Issue #${n} could not be read with gh`
      );
    }
  };
  for (const f of corpus.files) {
    for (const r of f.rules) {
      if (r.pending !== null) verify(f, r.line, r.pending);
    }
    for (const fence of f.fences) {
      const m = fence.info.match(/^rill pending=(\d+)$/);
      if (m) verify(f, fence.line, Number(m[1]));
    }
  }
}
