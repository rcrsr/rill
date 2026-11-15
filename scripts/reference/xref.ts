/**
 * Cross-references between rules, and the per-rule hash lock built on them.
 *
 * A cross-reference is a backticked `concept.rule` outside Notes and fences.
 * Its owner is the rule whose body holds it, or the concept itself when it
 * sits in prose outside any rule body. The lock records a hash of every
 * owner's text and of every rule it cites, so a change to a rule flags each
 * owner that cites it until someone reviews that owner.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import {
  getString,
  type Corpus,
  type ParsedFile,
  type RuleMarker,
} from './parse.js';

interface Xref {
  file: ParsedFile;
  line: number;
  /** Cited rule id. */
  ref: string;
  /** Rule id that holds the citation, or the concept id for concept prose. */
  owner: string;
  /** The holding rule; undefined for concept prose. */
  ownerRule: RuleMarker | undefined;
}

interface UnknownRef {
  file: ParsedFile;
  line: number;
  ref: string;
  concept: string;
}

export interface XrefScan {
  concepts: Set<string>;
  rules: Map<string, RuleMarker>;
  xrefs: Xref[];
  unknown: UnknownRef[];
}

const TOKEN = /`([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+)`/g;

/** End line (exclusive) of the scanned part of a file: the Notes heading. */
function scanEnd(file: ParsedFile): number {
  const notes = file.headings.find((h) => h.level === 2 && h.text === 'Notes');
  return notes ? notes.line : file.lines.length + 1;
}

/** The rule whose body holds `line`, or undefined for prose outside rules. */
export function ownerRule(
  file: ParsedFile,
  line: number
): RuleMarker | undefined {
  let best: RuleMarker | undefined;
  for (const r of file.rules) {
    if (r.line <= line && (!best || r.line > best.line)) best = r;
  }
  if (!best) return undefined;
  const ruleLine = best.line;
  const heading = file.headings.some(
    (h) => h.line > ruleLine && h.line <= line
  );
  return heading ? undefined : best;
}

export function scanXrefs(corpus: Corpus): XrefScan {
  const concepts = new Set<string>();
  const rules = new Map<string, RuleMarker>();
  for (const f of corpus.files) {
    const id = getString(f.frontmatter, 'id');
    if (id) concepts.add(id);
    for (const r of f.rules) rules.set(r.id, r);
  }
  const xrefs: Xref[] = [];
  const unknown: UnknownRef[] = [];

  for (const f of corpus.files) {
    const conceptId = getString(f.frontmatter, 'id');
    if (!conceptId) continue;
    const markerLines = new Set(f.rules.map((r) => r.line));
    const end = scanEnd(f);
    for (let line = 1; line < end; line++) {
      if (markerLines.has(line) || f.inFence[line - 1]) continue;
      const text = f.lines[line - 1] ?? '';
      for (const m of text.matchAll(TOKEN)) {
        const ref = m[1]!;
        const concept = ref.slice(0, ref.lastIndexOf('.'));
        if (!concepts.has(concept) || concepts.has(ref)) continue;
        if (!rules.has(ref)) {
          unknown.push({ file: f, line, ref, concept });
          continue;
        }
        const holder = ownerRule(f, line);
        xrefs.push({
          file: f,
          line,
          ref,
          owner: holder ? holder.id : conceptId,
          ownerRule: holder,
        });
      }
    }
  }
  return { concepts, rules, xrefs, unknown };
}

// ---------------------------------------------------------------------------
// Dependents
// ---------------------------------------------------------------------------

export interface Dependent {
  owner: string;
  file: string;
  line: number;
  ref: string;
  /** 'cite' for a backticked reference, 'depends' for a frontmatter entry. */
  via: 'cite' | 'depends';
}

/**
 * Everything that cites `id`. A rule id lists the citations of that rule; a
 * concept id lists citations of any of its rules and the concepts that name
 * it in `depends`. Returns undefined when `id` names nothing.
 */
export function findDependents(
  corpus: Corpus,
  id: string
): Dependent[] | undefined {
  const scan = scanXrefs(corpus);
  const isRule = scan.rules.has(id);
  const isConcept = scan.concepts.has(id);
  if (!isRule && !isConcept) return undefined;

  const out: Dependent[] = scan.xrefs
    .filter((x) =>
      isRule ? x.ref === id : x.ref.slice(0, x.ref.lastIndexOf('.')) === id
    )
    .map((x) => ({
      owner: x.owner,
      file: x.file.path,
      line: x.line,
      ref: x.ref,
      via: 'cite' as const,
    }));

  if (isConcept) {
    for (const f of corpus.files) {
      const depends = f.frontmatter.data.get('depends');
      const list = Array.isArray(depends) ? depends : [];
      if (!list.includes(id)) continue;
      out.push({
        owner: getString(f.frontmatter, 'id') ?? f.path,
        file: f.path,
        line: f.frontmatter.lines.get('depends') ?? 1,
        ref: id,
        via: 'depends',
      });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function formatDependent(d: Dependent): string {
  const what = d.via === 'depends' ? 'depends on' : 'cites';
  return `${d.owner}  ${d.file}:${d.line}  ${what} ${d.ref}`;
}

// ---------------------------------------------------------------------------
// Hash lock
// ---------------------------------------------------------------------------

export const LOCK_FILE = 'reference.lock';

const LOCK_HEADER = [
  '# Generated by `pnpm ref lock`. Do not edit.',
  '# <owner> <hash> [<cited-rule>@<hash> ...]',
];

interface LockEntry {
  hash: string;
  cites: Map<string, string>;
}

export type Lock = Map<string, LockEntry>;

function digest(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/** Hash of a rule: its full form, its build state, and its body. */
function ruleHash(rule: RuleMarker): string {
  return digest(`${rule.fullForm}\n${rule.pending ?? ''}\n${rule.body}`);
}

/** Hash of a concept's prose: unfenced lines outside every rule, before Notes. */
function proseHash(file: ParsedFile): string {
  const ruleLines = new Set<number>();
  for (const r of file.rules) {
    ruleLines.add(r.line);
    for (const b of r.bodyLines) ruleLines.add(b.line);
  }
  const kept: string[] = [];
  for (let line = file.frontmatter.endLine + 1; line < scanEnd(file); line++) {
    if (ruleLines.has(line) || file.inFence[line - 1]) continue;
    kept.push(file.lines[line - 1] ?? '');
  }
  return digest(kept.join('\n'));
}

interface OwnerState {
  hash: string;
  file: ParsedFile;
  line: number;
  /** Cited rule id to its current hash. */
  cites: Map<string, string>;
  /** Cited rule id to the first line citing it. */
  citeLines: Map<string, number>;
}

/**
 * The current state of every lock owner: every rule, and every concept whose
 * prose outside rules cites a rule.
 */
export function currentOwners(corpus: Corpus): Map<string, OwnerState> {
  const scan = scanXrefs(corpus);
  const owners = new Map<string, OwnerState>();
  for (const f of corpus.files) {
    for (const r of f.rules) {
      owners.set(r.id, {
        hash: ruleHash(r),
        file: f,
        line: r.line,
        cites: new Map(),
        citeLines: new Map(),
      });
    }
  }
  for (const x of scan.xrefs) {
    let state = owners.get(x.owner);
    if (!state) {
      state = {
        hash: proseHash(x.file),
        file: x.file,
        line: x.line,
        cites: new Map(),
        citeLines: new Map(),
      };
      owners.set(x.owner, state);
    }
    state.cites.set(x.ref, ruleHash(scan.rules.get(x.ref)!));
    if (!state.citeLines.has(x.ref)) state.citeLines.set(x.ref, x.line);
  }
  return owners;
}

export function parseLock(text: string): Lock {
  const lock: Lock = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [owner, hash, ...cites] = line.split(/\s+/);
    if (!owner || !hash) continue;
    const map = new Map<string, string>();
    for (const c of cites) {
      const at = c.lastIndexOf('@');
      if (at > 0) map.set(c.slice(0, at), c.slice(at + 1));
    }
    lock.set(owner, { hash, cites: map });
  }
  return lock;
}

export function formatLock(lock: Lock): string {
  const rows = [...lock]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owner, e]) =>
      [
        owner,
        e.hash,
        ...[...e.cites]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, h]) => `${id}@${h}`),
      ].join(' ')
    );
  return [...LOCK_HEADER, ...rows].join('\n') + '\n';
}

export function readLock(lockPath: string): Lock | undefined {
  if (!fs.existsSync(lockPath)) return undefined;
  return parseLock(fs.readFileSync(lockPath, 'utf-8'));
}

export interface Drift {
  owner: string;
  file: ParsedFile;
  line: number;
  ref: string;
}

/** Owners whose recorded hash for a cited rule no longer matches it. */
export function findDrift(
  owners: Map<string, OwnerState>,
  lock: Lock
): Drift[] {
  const out: Drift[] = [];
  for (const [owner, state] of owners) {
    const entry = lock.get(owner);
    if (!entry || entry.hash !== state.hash) continue;
    for (const [ref, hash] of state.cites) {
      const recorded = entry.cites.get(ref);
      if (recorded !== undefined && recorded !== hash) {
        out.push({
          owner,
          file: state.file,
          line: state.citeLines.get(ref) ?? state.line,
          ref,
        });
      }
    }
  }
  return out;
}

/**
 * Rebuilds the lock. Every owner takes its current hash. An owner keeps the
 * cited hashes it was reviewed against, so its drift stays reported, unless
 * it is new, its own text changed, or `reviewed` accepts it.
 */
export function updateLock(
  owners: Map<string, OwnerState>,
  previous: Lock,
  reviewed: (owner: string) => boolean
): Lock {
  const next: Lock = new Map();
  for (const [owner, state] of owners) {
    const old = previous.get(owner);
    const accept = !old || old.hash !== state.hash || reviewed(owner);
    const cites = new Map<string, string>();
    for (const [ref, hash] of state.cites) {
      cites.set(ref, accept ? hash : (old.cites.get(ref) ?? hash));
    }
    next.set(owner, { hash: state.hash, cites });
  }
  return next;
}
