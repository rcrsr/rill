/**
 * Reads a reference markdown file into frontmatter, headings, rule markers,
 * and fences. Shared by lint, check, and query. Pure: no filesystem access
 * except loadReference().
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type Severity = 'error' | 'warn' | 'info';

export interface Diagnostic {
  file: string;
  line: number;
  severity: Severity;
  code: string;
  message: string;
}

type FrontmatterValue = string | string[];

export interface Frontmatter {
  /** Key to value; absent when the file has no frontmatter block. */
  data: Map<string, FrontmatterValue>;
  /** Key to 1-based line of the key. */
  lines: Map<string, number>;
  /** 1-based line of the closing `---`; 0 when there is no block. */
  endLine: number;
  /** Lines that are neither `key: value` nor list items. */
  malformed: number[];
  /** Keys written more than once, at the line of the repeat. */
  duplicates: Array<{ key: string; line: number }>;
  /** True when the file opens with `---` that is never closed. */
  unclosed: boolean;
}

interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface RuleMarker {
  /** Full symbolic id, e.g. `union.reduce`. */
  id: string;
  /** Id up to the last dot. */
  concept: string;
  /** Id after the last dot. */
  slug: string;
  /** Text after the id, with any pending tag removed. */
  fullForm: string;
  /** Issue number from `{pending #N}`, or null for a built rule. */
  pending: number | null;
  /** True when the marker mentions `{pending` in a form that does not parse. */
  badPendingTag: boolean;
  line: number;
  body: string;
  bodyLines: Array<{ line: number; text: string }>;
}

interface Fence {
  info: string;
  line: number;
  /** 1-based line of the closing fence; 0 while unclosed. */
  endLine: number;
  closed: boolean;
  /** Issue number from a `rill pending=N` info string, or null. */
  pending: number | null;
}

/** One row of the Errors table: the ids its Error cell names, without `#`. */
interface ErrorRow {
  line: number;
  ids: string[];
}

export interface ParsedFile {
  /** Path relative to the repository root, forward slashes. */
  path: string;
  abs: string;
  /** First directory under `reference/`, or '' for a file directly in it. */
  chapter: string;
  lines: string[];
  frontmatter: Frontmatter;
  headings: Heading[];
  rules: RuleMarker[];
  fences: Fence[];
  /** Column-0 `r[` lines that are not a valid marker. */
  badMarkerLines: number[];
  /** Rows of the Errors table; empty when there is none. */
  errorRows: ErrorRow[];
  /** Per line (index = line - 1): true when inside a fence, fence lines included. */
  inFence: boolean[];
}

const KEY_RE = /^([A-Za-z_][\w-]*):(?:\s+(.*)|\s*)$/;
const MARKER_RE = /^r\[([^\]\s]*)\](?:\s+(.*))?$/;
const PENDING_RE = /\s*\{pending #(\d+)\}\s*$/;
const PENDING_FENCE_RE = /^rill pending=(\d+)$/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const ERROR_ID_RE = /#[A-Z][A-Z0-9_]*|RILL-[A-Z]\d+/g;

/** Issue number from a trimmed `rill pending=N` info string, else null. */
export function parsePendingFence(info: string): number | null {
  const m = info.match(PENDING_FENCE_RE);
  return m ? Number(m[1]) : null;
}

/** Drops a trailing ` # comment`; a `#` inside quotes is kept. */
function stripComment(value: string): string {
  let quote = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charAt(i);
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(value.charAt(i - 1)))) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

function unquote(value: string): string {
  const m = value.match(/^(['"])(.*)\1$/);
  return m ? m[2]! : value;
}

function parseInlineList(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((item) => unquote(item.trim()))
    .filter((item) => item !== '');
}

/**
 * Parses the restricted YAML subset: scalars, inline `[a, b]` lists, and
 * block `- item` lists. Trailing ` # comment` is dropped.
 */
export function parseFrontmatter(lines: string[]): Frontmatter {
  const fm: Frontmatter = {
    data: new Map(),
    lines: new Map(),
    endLine: 0,
    malformed: [],
    duplicates: [],
    unclosed: false,
  };
  if (lines[0]?.trim() !== '---') return fm;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) {
    fm.unclosed = true;
    return fm;
  }
  fm.endLine = end + 1;

  let listKey: string | null = null;
  for (let i = 1; i < end; i++) {
    const raw = lines[i]!;
    const text = raw.replace(/\s+$/, '');
    if (text === '' || /^\s*#/.test(text)) continue;

    const item = text.match(/^\s+-\s+(.*)$/) ?? text.match(/^-\s+(.*)$/);
    if (item && listKey !== null) {
      const list = fm.data.get(listKey);
      if (Array.isArray(list)) {
        list.push(unquote(item[1]!.trim()));
        continue;
      }
    }
    const kv = text.match(KEY_RE);
    if (!kv) {
      fm.malformed.push(i + 1);
      continue;
    }
    const key = kv[1]!;
    if (fm.lines.has(key)) {
      fm.duplicates.push({ key, line: i + 1 });
      listKey = null;
      continue;
    }
    const value = stripComment(kv[2] ?? '');
    fm.lines.set(key, i + 1);
    if (value === '') {
      // Empty value: a block list follows, or the scalar is empty.
      const next = lines[i + 1] ?? '';
      if (/^\s*-\s+/.test(next)) {
        fm.data.set(key, []);
        listKey = key;
      } else {
        fm.data.set(key, '');
        listKey = null;
      }
    } else if (value.startsWith('[') && value.endsWith(']')) {
      fm.data.set(key, parseInlineList(value));
      listKey = null;
    } else {
      fm.data.set(key, unquote(value));
      listKey = null;
    }
  }
  return fm;
}

export function getString(fm: Frontmatter, key: string): string | undefined {
  const v = fm.data.get(key);
  return typeof v === 'string' ? v : undefined;
}

export function getList(fm: Frontmatter, key: string): string[] {
  const v = fm.data.get(key);
  if (Array.isArray(v)) return v;
  return typeof v === 'string' && v !== '' ? [v] : [];
}

export function parseFile(
  text: string,
  displayPath: string,
  abs: string,
  chapter: string
): ParsedFile {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const frontmatter = parseFrontmatter(lines);

  const headings: Heading[] = [];
  const fences: Fence[] = [];
  const inFence: boolean[] = lines.map(() => false);
  const markerLines: number[] = [];
  let open: { char: string; length: number } | null = null;
  let openFence: Fence | null = null;

  for (let i = frontmatter.endLine; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(FENCE_RE);
    if (open) {
      inFence[i] = true;
      if (
        fence &&
        fence[1]!.charAt(0) === open.char &&
        fence[1]!.length >= open.length &&
        fence[2]!.trim() === ''
      ) {
        open = null;
        openFence!.closed = true;
        openFence!.endLine = i + 1;
      }
      continue;
    }
    if (fence) {
      inFence[i] = true;
      open = { char: fence[1]!.charAt(0), length: fence[1]!.length };
      const info = fence[2]!.trim();
      openFence = {
        info,
        line: i + 1,
        endLine: 0,
        closed: false,
        pending: parsePendingFence(info),
      };
      fences.push(openFence);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      headings.push({
        level: heading[1]!.length,
        text: heading[2]!,
        line: i + 1,
      });
    } else if (line.startsWith('r[')) {
      markerLines.push(i);
    }
  }

  const headingLines = new Set(headings.map((h) => h.line));
  const rules: RuleMarker[] = [];
  const markerSet = new Set<number>();
  const badMarkerLines: number[] = [];
  for (const i of markerLines) {
    if (MARKER_RE.test(lines[i]!)) markerSet.add(i);
    else badMarkerLines.push(i + 1);
  }
  for (const i of markerSet) {
    const m = lines[i]!.match(MARKER_RE)!;
    const id = m[1]!;
    let rest = (m[2] ?? '').trim();
    let pending: number | null = null;
    const p = rest.match(PENDING_RE);
    if (p) {
      pending = Number(p[1]);
      rest = rest.slice(0, p.index).trim();
    }
    const dot = id.lastIndexOf('.');
    const bodyLines: RuleMarker['bodyLines'] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (markerSet.has(j) || headingLines.has(j + 1)) break;
      bodyLines.push({ line: j + 1, text: next });
    }
    while (bodyLines.length > 0 && bodyLines.at(-1)!.text.trim() === '') {
      bodyLines.pop();
    }
    rules.push({
      id,
      concept: dot < 0 ? '' : id.slice(0, dot),
      slug: dot < 0 ? id : id.slice(dot + 1),
      fullForm: rest,
      pending,
      badPendingTag: pending === null && /\{pending/.test(rest),
      line: i + 1,
      body: bodyLines.map((b) => b.text).join('\n'),
      bodyLines,
    });
  }

  return {
    path: displayPath,
    abs,
    chapter,
    lines,
    frontmatter,
    headings,
    rules,
    fences,
    badMarkerLines,
    errorRows: parseErrorRows(lines, headings),
    inFence,
  };
}

function parseErrorRows(lines: string[], headings: Heading[]): ErrorRow[] {
  const start = headings.find((h) => h.level === 2 && h.text === 'Errors');
  if (!start) return [];
  const next = headings.find((h) => h.line > start.line && h.level <= 2);
  const end = next ? next.line - 1 : lines.length;
  const table = lines
    .slice(start.line, end)
    .map((text, i) => ({ text: text.trim(), line: start.line + i + 1 }))
    .filter((l) => l.text.startsWith('|'));
  // Skip the header and the separator row.
  return table.slice(2).map(({ text, line }) => {
    const cell = text.split('|')[2] ?? '';
    const ids = [...cell.matchAll(ERROR_ID_RE)].map((m) =>
      m[0].replace(/^#/, '')
    );
    return { line, ids };
  });
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

/** Files exempt from concept rules; they describe the reference itself. */
const EXEMPT_FILES: readonly string[] = ['README.md', 'FORMAT.md', 'CLAUDE.md'];

export interface Corpus {
  repoRoot: string;
  referenceDir: string;
  /** Chapter names in dependency order, from README frontmatter. */
  chapters: string[];
  files: ParsedFile[];
  /** Command-line paths that are missing or outside reference/. */
  pathProblems: Diagnostic[];
}

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      out.push(...listMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out.sort();
}

function readChapterOrder(referenceDir: string): string[] {
  const readme = path.join(referenceDir, 'README.md');
  if (!fs.existsSync(readme)) return [];
  const lines = fs.readFileSync(readme, 'utf-8').split(/\r?\n/);
  return getList(parseFrontmatter(lines), 'chapters');
}

function loadFile(
  repoRoot: string,
  referenceDir: string,
  abs: string
): ParsedFile {
  const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
  const inside = path.relative(referenceDir, abs).split(path.sep);
  const chapter = inside.length > 1 ? inside[0]! : '';
  return parseFile(fs.readFileSync(abs, 'utf-8'), rel, abs, chapter);
}

function isConceptFile(file: ParsedFile, referenceDir: string): boolean {
  const rel = path.relative(referenceDir, file.abs);
  return !EXEMPT_FILES.includes(rel);
}

/** Loads every concept file under `referenceDir`, or just `only` when given. */
export function loadCorpus(
  repoRoot: string,
  referenceDir: string,
  only?: string[]
): Corpus {
  const pathProblems: Diagnostic[] = [];
  const problem = (target: string, code: string, message: string): void => {
    pathProblems.push({
      file: target,
      line: 1,
      severity: 'error',
      code,
      message,
    });
  };
  const abs: string[] = [];
  for (const target of only ?? [referenceDir]) {
    const full = path.resolve(target);
    const rel = path.relative(referenceDir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      problem(target, 'path-outside', 'Path is not under reference/');
    } else if (!fs.existsSync(full)) {
      problem(target, 'path-missing', 'Path does not exist');
    } else if (fs.statSync(full).isDirectory()) {
      abs.push(...listMarkdown(full));
    } else {
      abs.push(full);
    }
  }
  const files = abs
    .map((a) => loadFile(repoRoot, referenceDir, a))
    .filter((f) => isConceptFile(f, referenceDir));
  return {
    repoRoot,
    referenceDir,
    chapters: readChapterOrder(referenceDir),
    files,
    pathProblems,
  };
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.line}: ${d.severity} [${d.code}] ${d.message}`;
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.code.localeCompare(b.code)
  );
}
