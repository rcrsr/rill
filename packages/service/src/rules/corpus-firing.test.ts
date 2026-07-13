/**
 * Corpus-wide firing-set tests for the rules engine.
 *
 * Runs `runRules` against every statically-extractable snippet in the
 * protected core language test corpus (via `corpus-loader.ts`) to assert
 * structural invariants: no snippet throws, the full 40-rule registry
 * executes, and emitted diagnostics stay sorted by line then column. It
 * also asserts the stub rules' empty firing set and reproduces a purpose
 * built per-rule firing scenario and severity-resolution behavior.
 *
 * This module does not build a byte-exact parity baseline against an
 * external tool; it only asserts invariants that hold regardless of any
 * upstream AST/span drift.
 */

import { beforeAll, describe, expect, it } from 'vitest';
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

/** Rule codes ported as stubs; each must fire on zero corpus positions. */
const STUB_RULE_CODES = new Set([
  'CONDITION_TYPE',
  'FOLD_INTERMEDIATES',
  'THROWAWAY_CAPTURE',
]);

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

  it('produces zero diagnostics for the stub rule codes across the full corpus', () => {
    const stubHits = results
      .flatMap((result) => result.diagnostics)
      .filter((diagnostic) => STUB_RULE_CODES.has(diagnostic.code));

    expect(stubHits).toEqual([]);
  });
});

describe('per-rule firing set', () => {
  it('fires AVOID_REASSIGNMENT and LOOP_OUTER_CAPTURE on a violating script without over-firing unrelated rules', () => {
    const source =
      '1 => $x\n' +
      '2 => $x\n' +
      '0 => $count\n' +
      '[1, 2, 3] -> seq({ $count + $ => $count })\n';
    const parsed = parseWithRecovery(source);

    const result = runRules(parsed, source, createDefaultConfig(), RULES);
    const codes = result.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('AVOID_REASSIGNMENT');
    expect(codes).toContain('LOOP_OUTER_CAPTURE');

    // Rules with no matching construct in this script must not fire.
    expect(codes).not.toContain('USE_DYNAMIC_IDENTIFIER');
    expect(codes).not.toContain('USE_UNTYPED_HOST_REF');
    expect(codes).not.toContain('NAMING_SNAKE_CASE');
    expect(codes).not.toContain('CONDITION_TYPE');
    expect(codes).not.toContain('FOLD_INTERMEDIATES');
    expect(codes).not.toContain('THROWAWAY_CAPTURE');
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
