/**
 * Dedicated coverage for `buildFix` in naming.ts: the rename-fix and
 * withhold paths for NAMING_SNAKE_CASE. Hand-written source only - the
 * protected corpus under packages/core/tests/language/ is never edited.
 */

import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import { createDefaultConfig } from './config.js';
import { namingSnakeCase } from './naming.js';

function parse(source: string): ParseResult {
  return parseWithRecovery(source);
}

describe('NAMING_SNAKE_CASE fix: reference-aware capture rename', () => {
  it('rewrites every reference alongside the declaration', () => {
    const source = '5 => $userName\n$userName -> .len\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      namingSnakeCase,
    ]);

    expect(result).toHaveLength(1);
    const fix = result[0]?.fix;
    expect(fix).not.toBeNull();
    expect(fix?.additionalEdits?.length).toBeGreaterThanOrEqual(1);

    for (const edit of fix?.additionalEdits ?? []) {
      expect(edit.replacement).toBe('$user_name');
    }

    // Primary edit rewrites the declaration site, not a reference.
    expect(fix?.replacement).toContain('$user_name');
    expect(fix?.range).toEqual({
      start: { line: 1, column: 6, offset: 5 },
      end: { line: 2, column: 1, offset: 15 },
    });
  });
});

describe('NAMING_SNAKE_CASE fix: withheld on snake_case collision', () => {
  it('withholds the fix when the snake_case target already names a capture', () => {
    const source = '"alpha" => $user_name\n"b" => $userName\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      namingSnakeCase,
    ]);

    const userNameDiagnostic = result.find((d) =>
      d.message.includes("'userName'")
    );
    expect(userNameDiagnostic).toBeDefined();
    expect(userNameDiagnostic?.fix).toBeNull();
  });

  it('withholds the fix regardless of collision order (colliding decl first)', () => {
    const source = '"b" => $userName\n"alpha" => $user_name\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      namingSnakeCase,
    ]);

    const userNameDiagnostic = result.find((d) =>
      d.message.includes("'userName'")
    );
    expect(userNameDiagnostic).toBeDefined();
    expect(userNameDiagnostic?.fix).toBeNull();
  });
});

describe('NAMING_SNAKE_CASE fix: withheld on ambiguous binding identity', () => {
  it('withholds the fix when the same name is captured in two different scopes', () => {
    const source = '|| (5 => $userName) => $f1\n|| (10 => $userName) => $f2\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      namingSnakeCase,
    ]);

    const userNameDiagnostics = result.filter((d) =>
      d.message.includes("'userName'")
    );
    expect(userNameDiagnostics).toHaveLength(2);
    for (const diagnostic of userNameDiagnostics) {
      expect(diagnostic.fix).toBeNull();
    }
  });
});

describe('NAMING_SNAKE_CASE fix: dict key withheld on dynamic field access', () => {
  it('withholds the fix when the script has computed field access anywhere', () => {
    const source = 'dict[camelKey: 1] => $c\n"camelKey" => $k\n$c.($k)\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      namingSnakeCase,
    ]);

    const dictKeyDiagnostic = result.find((d) =>
      d.message.includes('Dict key')
    );
    expect(dictKeyDiagnostic).toBeDefined();
    expect(dictKeyDiagnostic?.fix).toBeNull();
  });

  it('(control) still applies a single-edit fix when field access is only literal', () => {
    const source = 'dict[camelKey: 1] => $c\n$c.camelKey\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      namingSnakeCase,
    ]);

    const dictKeyDiagnostic = result.find((d) =>
      d.message.includes('Dict key')
    );
    expect(dictKeyDiagnostic).toBeDefined();
    expect(dictKeyDiagnostic?.fix).toMatchObject({
      description: "Rename 'camelKey' to 'camel_key'",
      applicable: true,
    });
    expect(dictKeyDiagnostic?.fix?.additionalEdits).toBeUndefined();
  });
});

describe('NAMING_SNAKE_CASE fix: reference-free capture rename', () => {
  it('produces a fix with no additionalEdits when the capture is never referenced', () => {
    const source = '5 => $userName\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      namingSnakeCase,
    ]);

    expect(result).toHaveLength(1);
    const fix = result[0]?.fix;
    expect(fix).not.toBeNull();
    expect(fix?.additionalEdits).toBeUndefined();
    expect(fix).toEqual({
      description: "Rename 'userName' to 'user_name'",
      applicable: true,
      range: {
        start: { line: 1, column: 6, offset: 5 },
        end: { line: 2, column: 1, offset: 15 },
      },
      replacement: '$user_name\n',
    });
  });
});
