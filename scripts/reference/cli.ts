#!/usr/bin/env tsx
/**
 * Reference tooling.
 *
 *   pnpm ref lint [paths...]
 *   pnpm ref check [--strict] [--issues]
 *   pnpm ref query <rule-id | concept-id>
 *   pnpm ref query --search <text> | --pending [--issue N]
 *   pnpm ref query --dependents <rule-id | concept-id>
 *   pnpm ref report            (also: query --report)
 *   pnpm ref lock [--reviewed <id>...] [--all]
 *
 * Diagnostics print as `path:line: error|warn|info [code] message`; any
 * error exits 1. `--json` switches query and report output to JSON.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ERROR_CODES } from '@rcrsr/rill';
import { checkCorpus, fetchIssueStateWithGh } from './check.js';
import {
  currentOwners,
  findDependents,
  findDrift,
  formatDependent,
  formatLock,
  LOCK_FILE,
  readLock,
  updateLock,
} from './xref.js';
import { lintFile, loadSpecIdPattern } from './lint.js';
import {
  formatDiagnostic,
  hasErrors,
  loadCorpus,
  sortDiagnostics,
  type Diagnostic,
} from './parse.js';
import {
  buildReport,
  findConcept,
  findRule,
  formatConcept,
  formatReport,
  formatRule,
  formatRuleLine,
  pendingRules,
  searchRules,
} from './query.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const referenceDir = path.join(repoRoot, 'reference');
const lockPath = path.join(referenceDir, LOCK_FILE);

const USAGE = `Usage: pnpm ref <command>

  lint [paths...]                  per-file format checks
  check [--strict] [--issues]      cross-file checks
  query <rule-id | concept-id>     show a rule or a concept
  query --search <text>            search full forms and bodies
  query --pending [--issue N]      list pending rules
  query --dependents <id>          list what cites a rule or concept
  report                           built vs pending progress
  lock [--reviewed <id>...]        rewrite reference/reference.lock;
       [--all]                     --reviewed accepts drift for rules or
                                   concepts, --all for every owner
  --json                           machine-readable query and report output`;

function printDiagnostics(diagnostics: Diagnostic[]): number {
  const sorted = sortDiagnostics(diagnostics);
  for (const d of sorted) console.log(formatDiagnostic(d));
  const count = (s: string): number =>
    sorted.filter((d) => d.severity === s).length;
  console.log(
    `${count('error')} error(s), ${count('warn')} warning(s), ${count('info')} info`
  );
  return hasErrors(sorted) ? 1 : 0;
}

function runLint(args: string[]): number {
  const corpus = loadCorpus(
    repoRoot,
    referenceDir,
    args.length > 0 ? args : undefined
  );
  const ctx = { specIdPattern: loadSpecIdPattern(repoRoot) };
  return printDiagnostics([
    ...corpus.pathProblems,
    ...corpus.files.flatMap((f) => lintFile(f, ctx)),
  ]);
}

function runCheck(args: string[]): number {
  const corpus = loadCorpus(repoRoot, referenceDir);
  return printDiagnostics(
    checkCorpus(corpus, {
      strict: args.includes('--strict'),
      errorCodes: ERROR_CODES,
      issueState: args.includes('--issues') ? fetchIssueStateWithGh : undefined,
      lock: { path: lockPath, entries: readLock(lockPath) },
    })
  );
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function emit(json: boolean, data: unknown, text: string): void {
  console.log(json ? JSON.stringify(data, null, 2) : text);
}

function runReport(json: boolean): number {
  const report = buildReport(loadCorpus(repoRoot, referenceDir));
  emit(json, report, formatReport(report));
  return 0;
}

function runQuery(args: string[], json: boolean): number {
  const corpus = loadCorpus(repoRoot, referenceDir);
  if (args.includes('--report')) return runReport(json);

  if (args.includes('--search')) {
    const text = flagValue(args, '--search');
    if (!text) {
      console.error('--search needs a text argument');
      return 2;
    }
    const hits = searchRules(corpus, text);
    emit(json, hits, hits.map(formatRuleLine).join('\n') || 'no matches');
    return 0;
  }

  if (args.includes('--dependents')) {
    const id = flagValue(args, '--dependents');
    if (!id) {
      console.error('--dependents needs a rule or concept id');
      return 2;
    }
    const hits = findDependents(corpus, id);
    if (!hits) {
      console.error(`No rule or concept '${id}'`);
      return 1;
    }
    emit(json, hits, hits.map(formatDependent).join('\n') || 'no dependents');
    return 0;
  }

  if (args.includes('--pending')) {
    const issueArg = flagValue(args, '--issue');
    const issue = issueArg === undefined ? undefined : Number(issueArg);
    if (
      args.includes('--issue') &&
      (issueArg === undefined || !Number.isInteger(issue))
    ) {
      console.error('--issue needs a number');
      return 2;
    }
    const hits = pendingRules(corpus, issue);
    emit(json, hits, hits.map(formatRuleLine).join('\n') || 'no pending rules');
    return 0;
  }

  const id = args.find((a) => !a.startsWith('--'));
  if (!id) {
    console.error(USAGE);
    return 2;
  }
  const rule = findRule(corpus, id);
  if (rule) {
    emit(json, rule, formatRule(rule));
    return 0;
  }
  const concept = findConcept(corpus, id);
  if (concept) {
    emit(json, concept, formatConcept(concept));
    return 0;
  }
  console.error(`No rule or concept '${id}'`);
  return 1;
}

function runLock(args: string[]): number {
  const corpus = loadCorpus(repoRoot, referenceDir);
  const owners = currentOwners(corpus);
  const all = args.includes('--all');
  const i = args.indexOf('--reviewed');
  const reviewed =
    i >= 0 ? args.slice(i + 1).filter((a) => !a.startsWith('--')) : [];
  if (i >= 0 && reviewed.length === 0) {
    console.error('--reviewed needs at least one rule or concept id');
    return 2;
  }
  const conceptOf = (owner: string): string =>
    owner.includes('.') ? owner.slice(0, owner.lastIndexOf('.')) : owner;
  const unknown = reviewed.filter(
    (id) => ![...owners.keys()].some((o) => o === id || conceptOf(o) === id)
  );
  if (unknown.length > 0) {
    console.error(`No lock owner for: ${unknown.join(', ')}`);
    return 2;
  }
  const accept = (owner: string): boolean =>
    all || reviewed.includes(owner) || reviewed.includes(conceptOf(owner));
  const next = updateLock(owners, readLock(lockPath) ?? new Map(), accept);
  fs.writeFileSync(lockPath, formatLock(next));
  const drift = findDrift(owners, next);
  console.log(
    `Wrote ${path.relative(repoRoot, lockPath)}: ${next.size} owner(s)`
  );
  if (drift.length > 0) {
    console.log(`${drift.length} citation(s) still need review:`);
    for (const d of drift) {
      console.log(`  ${d.file.path}:${d.line}  ${d.owner} cites ${d.ref}`);
    }
  }
  return 0;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const json = rest.includes('--json');
  const args = rest.filter((a) => a !== '--json');
  switch (command) {
    case 'lint':
      return runLint(args);
    case 'check':
      return runCheck(args);
    case 'query':
      return runQuery(args, json);
    case 'report':
      return runReport(json);
    case 'lock':
      return runLock(args);
    default:
      console.error(USAGE);
      return 2;
  }
}

process.exit(main(process.argv.slice(2)));
