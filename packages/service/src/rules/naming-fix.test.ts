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

describe('NAMING_SNAKE_CASE fix: closure-call callee and argument in the same call', () => {
  it('rewrites the callee and the argument as disjoint $name-width edits', () => {
    const source = '|x|($x) => $userName\n$userName($userName)\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      namingSnakeCase,
    ]);

    const diagnostic = result.find((d) => d.message.includes("'userName'"));
    expect(diagnostic).toBeDefined();
    const fix = diagnostic?.fix;
    expect(fix).not.toBeNull();
    expect(fix?.additionalEdits?.length).toBe(2);

    const allEdits = [
      { range: fix!.range, replacement: fix!.replacement },
      ...(fix?.additionalEdits ?? []),
    ];

    // Every reference edit (the two additionalEdits, callee and argument)
    // rewrites exactly the `$name` text.
    for (const edit of fix?.additionalEdits ?? []) {
      expect(edit.replacement).toBe('$user_name');
      expect(edit.range.end.offset - edit.range.start.offset).toBe(
        '$userName'.length
      );
    }

    // Pairwise disjoint: no edit's range overlaps another's.
    const sorted = [...allEdits].sort(
      (a, b) => a.range.start.offset - b.range.start.offset
    );
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.range.start.offset).toBeGreaterThanOrEqual(
        sorted[i - 1]!.range.end.offset
      );
    }
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

  it('withholds the fix when field access is only literal, since the fix does not rewrite it', () => {
    const source = 'dict[camelKey: 1] => $c\n$c.camelKey\n';
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
