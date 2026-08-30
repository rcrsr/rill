/**
 * Dedicated coverage for `buildFix` in types-assertion.ts: the fix range
 * for UNNECESSARY_ASSERTION must locate the `:type` region itself, not a
 * colon inside the asserted operand, and must carry a non-zero-width
 * line/column range so `spanToRange` deletes it correctly.
 */

import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import { createDefaultConfig } from './config.js';
import { unnecessaryAssertion } from './types-assertion.js';
import { spanToRange } from '../span-to-range.js';

function parse(source: string): ParseResult {
  return parseWithRecovery(source);
}

function applyFix(source: string, start: number, end: number): string {
  return source.slice(0, start) + source.slice(end);
}

describe('UNNECESSARY_ASSERTION fix: colon search skips colons inside the operand', () => {
  it('deletes only the trailing :string, leaving the "a:b" literal intact', () => {
    const source = '"a:b":string\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      unnecessaryAssertion,
    ]);

    expect(result).toHaveLength(1);
    const fix = result[0]?.fix;
    expect(fix).not.toBeNull();

    const fixed = applyFix(
      source,
      fix!.range.start.offset,
      fix!.range.end.offset
    );
    expect(fixed).toBe('"a:b"\n');
  });
});

describe('UNNECESSARY_ASSERTION fix: simple literal assertion', () => {
  it('removes :number from 5:number', () => {
    const source = '5:number\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      unnecessaryAssertion,
    ]);

    expect(result).toHaveLength(1);
    const fix = result[0]?.fix;
    expect(fix).not.toBeNull();

    const fixed = applyFix(
      source,
      fix!.range.start.offset,
      fix!.range.end.offset
    );
    expect(fixed).toBe('5\n');
  });
});

describe('UNNECESSARY_ASSERTION: no diagnostic for a non-literal operand', () => {
  it('does not flag parseJson($x):dict(...)', () => {
    const source = 'parseJson($x):dict(name: string)\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      unnecessaryAssertion,
    ]);

    expect(result).toHaveLength(0);
  });
});

describe('UNNECESSARY_ASSERTION fix: non-zero-width range', () => {
  it('produces a fix range whose spanToRange start and end differ, deleting exactly [typeStart, typeEnd)', () => {
    const source = '"a:b":string\n';
    const parsed = parse(source);

    const result = runRules(parsed, source, createDefaultConfig(), [
      unnecessaryAssertion,
    ]);

    const fix = result[0]?.fix;
    expect(fix).not.toBeNull();

    const range = spanToRange(fix!.range);
    expect(range.start).not.toEqual(range.end);

    const typeStart = source.indexOf(':string');
    const typeEnd = typeStart + ':string'.length;
    expect(fix!.range.start.offset).toBe(typeStart);
    expect(fix!.range.end.offset).toBe(typeEnd);
  });
});
