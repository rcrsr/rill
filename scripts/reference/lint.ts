/**
 * Per-file checks derived from reference/FORMAT.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkBlockLayout } from './layout.js';
import {
  getList,
  getString,
  type Diagnostic,
  type ParsedFile,
  type RuleMarker,
  type Severity,
} from './parse.js';

const ALLOWED_KEYS: readonly string[] = [
  'id',
  'title',
  'status',
  'since',
  'issues',
  'grammar',
  'errors',
  'depends',
  'tests',
];
const REQUIRED_KEYS: readonly string[] = ['id', 'title', 'status', 'since'];
const STATUSES: readonly string[] = ['normative', 'removed'];

const SECTION_ORDER: readonly string[] = [
  'Syntax',
  'Static rules',
  'Evaluation',
  'Interactions',
  'Errors',
  'Examples',
  'Notes',
];
const INFORMATIVE_SECTIONS: readonly string[] = ['Examples', 'Notes'];
const FENCE_INFOS = /^(rill|rill pending=\d+|text|ebnf|yaml|markdown|ts)$/;
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const BUILTIN_METHOD = /^[a-z][a-z0-9_]*$/;
const ERRORS_HEADER = /^\|\s*Condition\s*\|\s*Error\s*\|\s*Catchable\s*\|/;
const WARN_LINES = 150;
const ERROR_LINES = 200;
const MAX_FULL_FORM = 80;

/**
 * The workflow-id regex lives in the no-spec-id-reference lint rule. Read its
 * prefix list from the source so the two never drift.
 */
export function loadSpecIdPattern(repoRoot: string): RegExp {
  const rulePath = path.join(
    repoRoot,
    'packages/dev/lint-rules/no-spec-id-reference.cjs'
  );
  const source = fs.readFileSync(rulePath, 'utf-8');
  const m = source.match(/const PREFIX =\s*'([^']+)'/);
  if (!m) throw new Error(`Cannot read PREFIX from ${rulePath}`);
  return new RegExp(`\\b${m[1]}-[A-Z0-9][A-Z0-9-]*\\b`, 'g');
}

export interface LintContext {
  specIdPattern: RegExp;
}

function isValidConceptId(id: string, file: ParsedFile): boolean {
  const inBuiltins = file.chapter === 'builtins';
  const dot = id.indexOf('.');
  if (dot < 0) return KEBAB.test(id);
  if (!inBuiltins || id.split('.').length !== 2) return false;
  return KEBAB.test(id.slice(0, dot)) && BUILTIN_METHOD.test(id.slice(dot + 1));
}

function stripInlineCode(text: string): string {
  return text.replace(/`[^`]*`/g, '');
}

export function lintFile(file: ParsedFile, ctx: LintContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (
    line: number,
    severity: Severity,
    code: string,
    message: string
  ): void => {
    out.push({ file: file.path, line, severity, code, message });
  };
  lintFrontmatter(file, add);
  lintHeadings(file, add);
  lintRules(file, add);
  lintFences(file, add);
  lintProse(file, ctx, add);

  if (file.lines.length > ERROR_LINES) {
    add(
      1,
      'error',
      'length',
      `File has ${file.lines.length} lines; split past ${ERROR_LINES}`
    );
  } else if (file.lines.length > WARN_LINES) {
    add(
      1,
      'warn',
      'length',
      `File has ${file.lines.length} lines; target is ${WARN_LINES} or fewer`
    );
  }
  return out;
}

type Add = (
  line: number,
  severity: Severity,
  code: string,
  message: string
) => void;

function lintFrontmatter(file: ParsedFile, add: Add): void {
  const fm = file.frontmatter;
  if (fm.unclosed) {
    add(1, 'error', 'frontmatter-unclosed', 'Frontmatter has no closing ---');
    return;
  }
  if (fm.endLine === 0) {
    add(1, 'error', 'frontmatter-missing', 'File has no frontmatter block');
    return;
  }
  for (const d of fm.duplicates) {
    add(d.line, 'error', 'frontmatter-duplicate', `Key '${d.key}' repeats`);
  }
  for (const line of fm.malformed) {
    add(line, 'error', 'frontmatter-syntax', 'Unparseable frontmatter line');
  }
  for (const [key, line] of fm.lines) {
    if (!ALLOWED_KEYS.includes(key)) {
      add(line, 'error', 'frontmatter-key', `Unknown frontmatter key '${key}'`);
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (getString(fm, key) === undefined || getString(fm, key) === '') {
      add(1, 'error', 'frontmatter-required', `Missing frontmatter '${key}'`);
    }
  }
  const id = getString(fm, 'id');
  const idLine = fm.lines.get('id') ?? 1;
  if (id) {
    if (!isValidConceptId(id, file)) {
      add(
        idLine,
        'error',
        'concept-id',
        `Concept id '${id}' must be kebab-case; a dot is allowed only for <receiver>.<method> under builtins/`
      );
    }
    const base = path.basename(file.abs, '.md');
    if (base !== id) {
      add(
        idLine,
        'error',
        'filename',
        `Filename '${base}.md' must equal the concept id '${id}'`
      );
    }
  }
  const status = getString(fm, 'status');
  if (status && !STATUSES.includes(status)) {
    add(
      fm.lines.get('status') ?? 1,
      'error',
      'status',
      `Status '${status}' must be normative or removed`
    );
  }
  for (const key of ['issues'] as const) {
    for (const v of getList(fm, key)) {
      if (!/^\d+$/.test(v)) {
        add(
          fm.lines.get(key) ?? 1,
          'error',
          'issues',
          `Issue '${v}' is not a number`
        );
      }
    }
  }
  for (const key of [
    'issues',
    'grammar',
    'errors',
    'depends',
    'tests',
  ] as const) {
    if (fm.data.has(key) && !Array.isArray(fm.data.get(key))) {
      const v = fm.data.get(key);
      if (v !== '') {
        add(
          fm.lines.get(key) ?? 1,
          'error',
          'frontmatter-list',
          `'${key}' must be a list`
        );
      }
    }
  }

  // Pending issues named in rules and fences must appear in `issues`.
  const listed = new Set(getList(fm, 'issues'));
  const used = new Set<string>();
  for (const r of file.rules) {
    if (r.pending !== null) used.add(String(r.pending));
  }
  for (const f of file.fences) {
    const m = f.info.match(/^rill pending=(\d+)$/);
    if (m) used.add(m[1]!);
  }
  for (const n of used) {
    if (!listed.has(n)) {
      add(
        1,
        'error',
        'issues-missing',
        `Pending #${n} is not listed in 'issues'`
      );
    }
  }
  for (const n of listed) {
    if (!used.has(n)) {
      add(
        fm.lines.get('issues') ?? 1,
        'warn',
        'issues-stale',
        `Issue #${n} is listed but no rule or fence is pending on it`
      );
    }
  }
}

function lintHeadings(file: ParsedFile, add: Add): void {
  const h1s = file.headings.filter((h) => h.level === 1);
  if (h1s.length !== 1) {
    add(
      h1s[1]?.line ?? 1,
      'error',
      'h1-count',
      `File has ${h1s.length} H1 headings; exactly one is required`
    );
  }
  let last = -1;
  const seen = new Set<string>();
  // The conventions chapter defines the vocabulary the section layout relies
  // on, so its files use their own H2 headings.
  const freeSections = file.chapter === 'conventions';
  for (const h of file.headings) {
    if (h.level !== 2 || freeSections) continue;
    const idx = SECTION_ORDER.indexOf(h.text);
    if (idx < 0) {
      add(
        h.line,
        'error',
        'section-name',
        `Section '${h.text}' is not one of: ${SECTION_ORDER.join(', ')}`
      );
      continue;
    }
    if (seen.has(h.text)) {
      add(h.line, 'error', 'section-duplicate', `Section '${h.text}' repeats`);
    } else if (idx < last) {
      add(
        h.line,
        'error',
        'section-order',
        `Section '${h.text}' is out of order`
      );
    }
    seen.add(h.text);
    last = Math.max(last, idx);
  }
  const h1 = h1s[0];
  if (h1) {
    const next = file.headings.find((h) => h.line > h1.line);
    const end = next ? next.line - 1 : file.lines.length;
    const hasDefinition = file.lines
      .slice(h1.line, end)
      .some((l) => l.trim() !== '');
    if (!hasDefinition) {
      add(h1.line, 'error', 'definition', 'H1 has no definition sentence');
    }
  }
  const errors = file.headings.find(
    (h) => h.level === 2 && h.text === 'Errors'
  );
  if (errors) {
    const next = file.headings.find(
      (h) => h.line > errors.line && h.level <= 2
    );
    const after = file.lines.slice(
      errors.line,
      next ? next.line - 1 : file.lines.length
    );
    const header = after.find((l) => l.trim().startsWith('|'));
    if (!header || !ERRORS_HEADER.test(header.trim())) {
      add(
        errors.line,
        'error',
        'errors-table',
        'Errors section needs a table with columns Condition, Error, Catchable'
      );
    }
  }
}

function lintRules(file: ParsedFile, add: Add): void {
  const id = getString(file.frontmatter, 'id');
  const ids = new Map<string, number>();
  const forms = new Map<string, number>();
  for (const line of file.badMarkerLines) {
    add(
      line,
      'error',
      'marker-syntax',
      'Line starts with r[ but is not r[<id>] <full form>'
    );
  }
  for (const r of file.rules) {
    lintMarker(r, id, add);
    const dupId = ids.get(r.id);
    if (dupId !== undefined) {
      add(
        r.line,
        'error',
        'rule-id-duplicate',
        `Rule id '${r.id}' repeats line ${dupId}`
      );
    }
    ids.set(r.id, dupId ?? r.line);
    const dupForm = forms.get(r.fullForm);
    if (r.fullForm !== '' && dupForm !== undefined) {
      add(
        r.line,
        'error',
        'full-form-duplicate',
        `Full form repeats line ${dupForm}`
      );
    }
    forms.set(r.fullForm, dupForm ?? r.line);

    if (!/\b(MUST|MAY)\b/.test(r.body)) {
      add(
        r.line,
        'warn',
        'rule-keyword',
        `Rule '${r.id}' body has no MUST, MUST NOT, or MAY`
      );
    }
    for (const b of r.bodyLines) {
      if (file.inFence[b.line - 1]) continue;
      if (/\bmust\b/.test(stripInlineCode(b.text))) {
        add(
          b.line,
          'warn',
          'rule-lowercase-must',
          'Lowercase "must" carries no normative force'
        );
      }
    }
  }
}

function lintMarker(r: RuleMarker, fileId: string | undefined, add: Add): void {
  if (!r.id.includes('.')) {
    add(
      r.line,
      'error',
      'rule-id',
      `Rule id '${r.id}' must be <concept>.<rule>`
    );
    return;
  }
  if (fileId && r.concept !== fileId) {
    add(
      r.line,
      'error',
      'rule-concept',
      `Rule concept '${r.concept}' must equal the file id '${fileId}'`
    );
  }
  const words = r.slug.split('-');
  if (!KEBAB.test(r.slug) || words.length > 3) {
    add(
      r.line,
      'error',
      'rule-slug',
      `Rule slug '${r.slug}' must be 1 to 3 kebab-case words`
    );
  }
  if (r.badPendingTag) {
    add(
      r.line,
      'error',
      'pending-tag',
      'Pending tag must read {pending #N} at the end of the marker'
    );
  }
  if (r.fullForm === '') {
    add(
      r.line,
      'error',
      'full-form-missing',
      `Rule '${r.id}' has no full form`
    );
    return;
  }
  if (r.fullForm.length > MAX_FULL_FORM) {
    add(
      r.line,
      'error',
      'full-form-length',
      `Full form has ${r.fullForm.length} characters; the limit is ${MAX_FULL_FORM}`
    );
  }
  if (r.fullForm.endsWith('.')) {
    add(
      r.line,
      'error',
      'full-form-period',
      'Full form must not end with a period'
    );
  }
}

function lintFences(file: ParsedFile, add: Add): void {
  for (const f of file.fences) {
    if (!FENCE_INFOS.test(f.info)) {
      add(
        f.line,
        'error',
        'fence-info',
        `Fence info '${f.info}' must be rill, rill pending=N, text, ebnf, yaml, markdown, or ts`
      );
    }
    if (!f.closed) {
      add(f.line, 'error', 'fence-unclosed', 'Fence is never closed');
    }
    if (f.info === 'rill' || f.info.startsWith('rill pending=')) {
      const code = file.lines
        .slice(f.line, f.closed ? f.endLine - 1 : file.lines.length)
        .map((l) => l.trim())
        .filter((l) => l !== '');
      const ok =
        code.some((l) => l.startsWith('# Result:')) ||
        code.some((l) => /(^|\s)# Error:/.test(l));
      if (!ok) {
        add(
          f.line,
          'warn',
          'fence-result',
          'rill fence has neither # Result: nor # Error:'
        );
      }
      const raw = file.lines.slice(
        f.line,
        f.closed ? f.endLine - 1 : file.lines.length
      );
      for (const issue of checkBlockLayout(raw)) {
        add(f.line + 1 + issue.index, 'error', issue.code, issue.message);
      }
    }
  }
}

function lintProse(file: ParsedFile, ctx: LintContext, add: Add): void {
  let section = '';
  for (let i = file.frontmatter.endLine; i < file.lines.length; i++) {
    const text = file.lines[i]!;
    const lineNo = i + 1;
    const heading = file.headings.find((h) => h.line === lineNo);
    if (heading) {
      if (heading.level <= 2) section = heading.text;
    }

    ctx.specIdPattern.lastIndex = 0;
    for (const m of text.matchAll(ctx.specIdPattern)) {
      add(
        lineNo,
        'error',
        'citation',
        `'${m[0]}' cites an unpublished workflow artifact`
      );
    }
    for (const m of text.matchAll(/\bADR-\d+\b/g)) {
      add(lineNo, 'error', 'citation', `'${m[0]}' cites an ADR`);
    }
    if (/\bconduct\//.test(text)) {
      add(lineNo, 'error', 'citation', 'Text cites a conduct/ path');
    }

    if (file.inFence[i] || heading) continue;
    if (INFORMATIVE_SECTIONS.includes(section)) continue;
    const prose = stripInlineCode(text);
    const voice = prose.match(/\b(you|we)\b|\blet['’]s\b/i);
    if (voice) {
      add(
        lineNo,
        'warn',
        'tutorial-voice',
        `Tutorial voice '${voice[0]}' outside Examples and Notes`
      );
    }
  }
}
