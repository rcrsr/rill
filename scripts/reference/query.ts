/**
 * Lookup and progress reporting over the parsed reference. Every function
 * returns plain data; cli.ts decides between text and JSON.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getString, type Corpus, type ParsedFile } from './parse.js';

export interface RuleRecord {
  id: string;
  concept: string;
  file: string;
  line: number;
  state: 'built' | 'pending';
  issue: number | null;
  fullForm: string;
  body: string;
}

export interface ConceptRecord {
  id: string;
  title: string;
  file: string;
  chapter: string;
  status: string;
  definition: string;
  rules: RuleRecord[];
}

interface ChapterCount {
  chapter: string;
  built: number;
  pending: number;
}

export interface Report {
  total: { built: number; pending: number };
  chapters: ChapterCount[];
  issues: Array<{ issue: number; pending: number }>;
  openDecisions: number;
}

function listRules(corpus: Corpus): RuleRecord[] {
  return corpus.files.flatMap((f) =>
    f.rules.map((r) => ({
      id: r.id,
      concept: r.concept,
      file: f.path,
      line: r.line,
      state: r.pending === null ? ('built' as const) : ('pending' as const),
      issue: r.pending,
      fullForm: r.fullForm,
      body: r.body,
    }))
  );
}

function definitionOf(file: ParsedFile): string {
  const h1 = file.headings.find((h) => h.level === 1);
  if (!h1) return '';
  const next = file.headings.find((h) => h.line > h1.line);
  const end = next ? next.line - 1 : file.lines.length;
  return (
    file.lines
      .slice(h1.line, end)
      .find((l) => l.trim() !== '' && !l.startsWith('r['))
      ?.trim() ?? ''
  );
}

export function findConcept(
  corpus: Corpus,
  id: string
): ConceptRecord | undefined {
  const file = corpus.files.find((f) => getString(f.frontmatter, 'id') === id);
  if (!file) return undefined;
  return {
    id,
    title: getString(file.frontmatter, 'title') ?? '',
    file: file.path,
    chapter: file.chapter,
    status: getString(file.frontmatter, 'status') ?? '',
    definition: definitionOf(file),
    rules: listRules(corpus).filter((r) => r.file === file.path),
  };
}

export function findRule(corpus: Corpus, id: string): RuleRecord | undefined {
  return listRules(corpus).find((r) => r.id === id);
}

export function searchRules(corpus: Corpus, text: string): RuleRecord[] {
  const needle = text.toLowerCase();
  return listRules(corpus).filter(
    (r) =>
      r.fullForm.toLowerCase().includes(needle) ||
      r.body.toLowerCase().includes(needle)
  );
}

export function pendingRules(corpus: Corpus, issue?: number): RuleRecord[] {
  return listRules(corpus).filter(
    (r) => r.state === 'pending' && (issue === undefined || r.issue === issue)
  );
}

/** Counts rows of the README Open decisions table. */
function countOpenDecisions(referenceDir: string): number {
  const readme = path.join(referenceDir, 'README.md');
  if (!fs.existsSync(readme)) return 0;
  const lines = fs.readFileSync(readme, 'utf-8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Open decisions\s*$/.test(l));
  if (start < 0) return 0;
  let count = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s/.test(line)) break;
    if (/^\|\s*\[?#\d+/.test(line)) count++;
  }
  return count;
}

export function buildReport(corpus: Corpus): Report {
  const rules = listRules(corpus);
  const chapterOf = new Map(corpus.files.map((f) => [f.path, f.chapter]));
  const names = [
    ...corpus.chapters,
    ...new Set(
      [...chapterOf.values()].filter((c) => !corpus.chapters.includes(c))
    ),
  ];
  const chapters: ChapterCount[] = names.map((chapter) => {
    const inChapter = rules.filter((r) => chapterOf.get(r.file) === chapter);
    return {
      chapter,
      built: inChapter.filter((r) => r.state === 'built').length,
      pending: inChapter.filter((r) => r.state === 'pending').length,
    };
  });
  const byIssue = new Map<number, number>();
  for (const r of rules) {
    if (r.issue !== null) byIssue.set(r.issue, (byIssue.get(r.issue) ?? 0) + 1);
  }
  return {
    total: {
      built: rules.filter((r) => r.state === 'built').length,
      pending: rules.filter((r) => r.state === 'pending').length,
    },
    chapters: chapters.filter((c) => c.built + c.pending > 0),
    issues: [...byIssue]
      .map(([issue, pending]) => ({ issue, pending }))
      .sort((a, b) => a.issue - b.issue),
    openDecisions: countOpenDecisions(corpus.referenceDir),
  };
}

export function formatRule(r: RuleRecord): string {
  const state = r.issue === null ? 'built' : `pending #${r.issue}`;
  return [
    `${r.id}`,
    `  file:   ${r.file}:${r.line}`,
    `  status: ${state}`,
    `  form:   ${r.fullForm}`,
    ...(r.body ? ['', ...r.body.split('\n').map((l) => `  ${l}`)] : []),
  ].join('\n');
}

export function formatRuleLine(r: RuleRecord): string {
  const state = r.issue === null ? 'built' : `pending #${r.issue}`;
  return `${r.id}  [${state}]  ${r.fullForm}`;
}

export function formatConcept(c: ConceptRecord): string {
  return [
    `${c.id}: ${c.title}`,
    `  file:       ${c.file}`,
    `  status:     ${c.status}`,
    `  definition: ${c.definition}`,
    '',
    ...c.rules.map((r) => `  ${formatRuleLine(r)}`),
  ].join('\n');
}

export function formatReport(r: Report): string {
  const width = Math.max(7, ...r.chapters.map((c) => c.chapter.length));
  const row = (name: string, b: number, p: number): string =>
    `${name.padEnd(width)}  ${String(b).padStart(5)}  ${String(p).padStart(7)}`;
  return [
    `${'chapter'.padEnd(width)}  built  pending`,
    ...r.chapters.map((c) => row(c.chapter, c.built, c.pending)),
    row('total', r.total.built, r.total.pending),
    '',
    'pending by issue:',
    ...(r.issues.length === 0
      ? ['  none']
      : r.issues.map((i) => `  #${i.issue}: ${i.pending}`)),
    '',
    `open decisions: ${r.openDecisions}`,
  ].join('\n');
}
