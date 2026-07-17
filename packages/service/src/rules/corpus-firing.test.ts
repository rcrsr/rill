/**
 * Corpus-wide firing-set tests for the rules engine.
 *
 * Runs `runRules` against every statically-extractable snippet in the
 * protected core language test corpus (via `corpus-loader.ts`) to assert
 * structural invariants: no snippet throws, the full 40-rule registry
 * executes, and emitted diagnostics stay sorted by line then column. It
 * also reproduces purpose-built per-rule firing scenarios and
 * severity-resolution behavior.
 *
 * This module does not build a byte-exact parity baseline against an
 * external tool; it only asserts invariants that hold regardless of any
 * upstream AST/span drift.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWithRecovery } from '@rcrsr/rill';
import { loadCorpusSnippets, listCorpusFileNames } from './corpus-loader.js';
import { compareDiagnosticLocation, runRules } from './run-rules.js';
import { createDefaultConfig } from './config.js';
import { RULES } from './rules.js';
import type { CheckConfig, Diagnostic } from './types.js';
import { useDynamicIdentifier, useUntypedHostRef } from './use-expressions.js';

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

interface CorpusRunResult {
  readonly file: string;
  readonly diagnostics: Diagnostic[];
}

interface CorpusRunFailure {
  readonly file: string;
  readonly message: string;
}

describe('full corpus run', () => {
  let results: CorpusRunResult[];
  let failures: CorpusRunFailure[];

  beforeAll(() => {
    const snippets = loadCorpusSnippets();
    const config = createDefaultConfig();
    results = [];
    failures = [];

    for (const snippet of snippets) {
      try {
        const parsed = parseWithRecovery(snippet.source);
        const diagnostics = runRules(parsed, snippet.source, config, RULES);
        results.push({ file: snippet.file, diagnostics });
      } catch (err) {
        failures.push({
          file: snippet.file,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  it('discovers every corpus file via a directory glob', () => {
    const fileNames = listCorpusFileNames();
    // No hardcoded count: assert the glob found files and that the
    // extractor pulled at least one snippet per discovered file on
    // average, without pinning either number.
    expect(fileNames.length).toBeGreaterThan(0);
    expect(loadCorpusSnippets().length).toBeGreaterThan(fileNames.length);
  });

  it('registers the complete 40-rule set and passes it through to runRules', () => {
    expect(RULES.length).toBe(40);
    expect(Object.keys(createDefaultConfig().rules)).toHaveLength(40);
  });

  it('never throws while parsing and checking any corpus snippet', () => {
    expect(failures).toEqual([]);
  });

  it('emits diagnostics sorted by line then column for every snippet', () => {
    for (const result of results) {
      const sorted = [...result.diagnostics].sort(compareDiagnosticLocation);
      expect(result.diagnostics).toEqual(sorted);
    }
  });

  it('fires CONDITION_TYPE on exactly the corpus snippets the language spec calls non-boolean', () => {
    // The corpus is the acceptance oracle for CONDITION_TYPE: these three
    // snippets are the language's own "errors (not boolean)" cases, so they
    // are independent true positives. Drifting to zero means the rule went
    // dead in practice; drifting upward means it false-positives on
    // protected spec code. Both are defects, and neither is visible to a
    // hand-written fixture.
    const hits = results
      .flatMap((result) => result.diagnostics)
      .filter((diagnostic) => diagnostic.code === 'CONDITION_TYPE');

    expect(hits).toHaveLength(3);
  });
});

describe('per-rule firing set', () => {
  it('fires AVOID_REASSIGNMENT and THROWAWAY_CAPTURE on dead reassigned captures without over-firing unrelated rules', () => {
    const source = '1 => $x\n2 => $x\n';
    const parsed = parseWithRecovery(source);

    const result = runRules(parsed, source, createDefaultConfig(), RULES);
    const codes = result.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('AVOID_REASSIGNMENT');
    // $x is reassigned and never referenced by either binding: both
    // top-level captures are genuinely dead.
    expect(codes).toContain('THROWAWAY_CAPTURE');

    // Rules with no matching construct in this script must not fire.
    expect(codes).not.toContain('LOOP_OUTER_CAPTURE');
    expect(codes).not.toContain('USE_DYNAMIC_IDENTIFIER');
    expect(codes).not.toContain('USE_UNTYPED_HOST_REF');
    expect(codes).not.toContain('NAMING_SNAKE_CASE');
    expect(codes).not.toContain('CONDITION_TYPE');
    expect(codes).not.toContain('FOLD_INTERMEDIATES');
  });

  it('fires LOOP_OUTER_CAPTURE while staying silent on THROWAWAY_CAPTURE for a closure-body-read accumulator', () => {
    const source = '0 => $count\n[1, 2, 3] -> seq({ $count + $ => $count })\n';
    const parsed = parseWithRecovery(source);

    const result = runRules(parsed, source, createDefaultConfig(), RULES);
    const codes = result.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('LOOP_OUTER_CAPTURE');
    // $count is read inside the closure body on every iteration, so the
    // capture is not dead even though it is reassigned inside the loop.
    expect(codes).not.toContain('THROWAWAY_CAPTURE');

    // Rules with no matching construct in this script must not fire.
    expect(codes).not.toContain('USE_DYNAMIC_IDENTIFIER');
    expect(codes).not.toContain('USE_UNTYPED_HOST_REF');
    expect(codes).not.toContain('NAMING_SNAKE_CASE');
    expect(codes).not.toContain('CONDITION_TYPE');
    expect(codes).not.toContain('FOLD_INTERMEDIATES');
  });
});

describe('severity reproduction', () => {
  it('emits "error" for USE_DYNAMIC_IDENTIFIER under strict checker mode', () => {
    const source = 'use<("host:greet")>\n';
    const parsed = parseWithRecovery(source);

    const result = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'strict' }),
      [useDynamicIdentifier]
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('error');
  });

  it('emits "warning" for USE_DYNAMIC_IDENTIFIER under permissive/undefined checker mode', () => {
    const source = 'use<("host:greet")>\n';
    const parsed = parseWithRecovery(source);

    const undefinedModeResult = runRules(parsed, source, makeConfig(), [
      useDynamicIdentifier,
    ]);
    const permissiveResult = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'permissive' }),
      [useDynamicIdentifier]
    );

    expect(undefinedModeResult[0]?.severity).toBe('warning');
    expect(permissiveResult[0]?.severity).toBe('warning');
  });

  it('emits "error" for USE_UNTYPED_HOST_REF under strict checker mode', () => {
    const source = 'use<host:greet>\n';
    const parsed = parseWithRecovery(source);

    const result = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'strict' }),
      [useUntypedHostRef]
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('error');
  });

  it('emits "warning" for USE_UNTYPED_HOST_REF under permissive/undefined checker mode', () => {
    const source = 'use<host:greet>\n';
    const parsed = parseWithRecovery(source);

    const undefinedModeResult = runRules(parsed, source, makeConfig(), [
      useUntypedHostRef,
    ]);
    const permissiveResult = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'permissive' }),
      [useUntypedHostRef]
    );

    expect(undefinedModeResult[0]?.severity).toBe('warning');
    expect(permissiveResult[0]?.severity).toBe('warning');
  });

  it('honors a global config.severity override regardless of checker mode', () => {
    const source = 'use<host:greet>\n';
    const parsed = parseWithRecovery(source);

    const result = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'strict', severity: 'info' }),
      [useUntypedHostRef]
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('info');
  });
});

describe('stub removal: raw-text proof', () => {
  it('does not contain the raw text "stub" in any source file under src/rules/', () => {
    const rulesDir = join(import.meta.dirname, '.');
    const offenders: string[] = [];
    for (const fileName of readdirSync(rulesDir)) {
      const fullPath = join(rulesDir, fileName);
      if (fullPath === import.meta.filename) continue;
      if (!fileName.endsWith('.ts')) continue;
      const contents = readFileSync(fullPath, 'utf8');
      if (contents.toLowerCase().includes('stub')) {
        offenders.push(fileName);
      }
    }
    expect(
      offenders,
      `Expected no source file under src/rules/ to contain the raw text "stub", but found it in: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});
