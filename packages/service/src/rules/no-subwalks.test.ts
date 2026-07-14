/**
 * Structural proof that the rules engine performs no sub-walks.
 *
 * `traverseForRules` (traversal.ts) is a single explicit-stack walk with a
 * childrenPushed guard, so it visits each AST node exactly once. If it is
 * called exactly twice per runRules invocation (once to build facts, once
 * to run rules) and by nobody else, total node visits are bounded by a
 * constant multiple of the AST size, independent of nesting depth.
 *
 * This test reads the source files on disk and asserts on their raw text
 * and import graph, rather than exercising behavior, so that a shadow
 * helper (a per-rule walk kept as a fallback) or dead code (facts built
 * but rules still walking independently) both fail it.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RULES_DIR = join(import.meta.dirname, '.');

const EXEMPT_FILES = new Set(['traversal.ts', 'facts.ts', 'run-rules.ts']);

function listRuleSourceFiles(): string[] {
  return readdirSync(RULES_DIR).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
  );
}

function listAllTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAllTypeScriptFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      fullPath !== import.meta.filename
    ) {
      out.push(fullPath);
    }
  }
  return out;
}

describe('no sub-walks: structural proof', () => {
  it('does not reference traverseForRules outside traversal.ts, facts.ts, run-rules.ts, and tests', () => {
    const offenders: string[] = [];
    for (const fileName of listRuleSourceFiles()) {
      if (EXEMPT_FILES.has(fileName)) continue;
      const contents = readFileSync(join(RULES_DIR, fileName), 'utf8');
      if (contents.includes('traverseForRules')) {
        offenders.push(fileName);
      }
    }
    expect(
      offenders,
      `Expected no rule module (other than traversal.ts, facts.ts, run-rules.ts) to reference ` +
        `traverseForRules, but found it in: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('does not contain any of the nine deleted sub-walk helper symbols anywhere under src/', () => {
    const deletedSymbols = [
      'findCapturesInBody',
      'containsBreak',
      'containsSideEffects',
      'containsBareReference',
      'containsClosureCreation',
      'containsExplicitCapture',
      'subtreeContainsStatusProbe',
      'collectStreamVariables',
      'collectStreamUsages',
    ];

    const srcDir = join(RULES_DIR, '..');
    const offenders: string[] = [];
    for (const filePath of listAllTypeScriptFiles(srcDir)) {
      const contents = readFileSync(filePath, 'utf8');
      for (const symbol of deletedSymbols) {
        if (contents.includes(symbol)) {
          offenders.push(`${filePath} (contains "${symbol}")`);
        }
      }
    }
    expect(
      offenders,
      `Expected none of the deleted sub-walk helper symbols to appear anywhere under src/, ` +
        `but found: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('is imported by exactly two production files: run-rules.ts and facts.ts', () => {
    const importers: string[] = [];
    for (const fileName of listRuleSourceFiles()) {
      if (fileName === 'traversal.ts') continue;
      const contents = readFileSync(join(RULES_DIR, fileName), 'utf8');
      if (/from\s+['"]\.\/traversal\.js['"]/.test(contents)) {
        importers.push(fileName);
      }
    }
    expect(
      importers.sort(),
      `Expected exactly run-rules.ts and facts.ts to import traversal.ts, but found: ${importers.join(', ')}`
    ).toEqual(['facts.ts', 'run-rules.ts']);
  });
});
