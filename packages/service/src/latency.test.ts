/**
 * Latency benchmark for every syntactic/scope provider plus the rules
 * engine, run against a ~2,000-line generated script.
 *
 * Each provider is measured over 100 timed samples (after a short warmup)
 * and must stay at or under a 50ms p95. A separate suite asserts that
 * every provider terminates against a recovery/partial AST built from a
 * mid-document syntax error, guarding against infinite loops on
 * cyclic/partial ASTs.
 */
import { describe, expect, it } from 'vitest';
import { parseWithRecovery, tokenize } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';

import { documentSymbols } from './document-symbols.js';
import { semanticTokens } from './semantic-tokens.js';
import { formatDocument } from './format-document.js';
import { spanToRange } from './span-to-range.js';
import {
  findDefinition,
  getCompletions,
  getHover,
  resolveScopeAt,
} from './scope/index.js';
import { createDefaultConfig, runRules } from './rules/index.js';

const P95_BUDGET_MS = 50;
// runRules aggregates every bundled rule (~40 passes) over the script, so it
// does proportionately more work than the single-pass providers and gets a
// wider ceiling. The margin also absorbs CPU contention when this suite runs
// alongside other packages' suites (e.g. the recursive pre-push hook); a
// genuine algorithmic regression on a 2,000-line script is seconds, not ms,
// so the guard still fires.
const RUN_RULES_P95_BUDGET_MS = 150;
const SAMPLE_COUNT = 100;
const WARMUP_COUNT = 5;
const TARGET_LINE_COUNT = 2000;

/**
 * Generates a rill script of roughly `targetLines` lines, repeating a block
 * that exercises captures, closures, dict keys, type assertions, string
 * interpolation, and patterns several bundled rules flag (magic numbers,
 * unused captures) so `runRules` performs representative work.
 */
function generateFixtureScript(targetLines: number): string {
  const blockLines = [
    'dict[name: "item-{$i}", index: $i, score: 42] => $record:dict',
    '|x| ($x * 2 + 1) => $double',
    '$record.index -> $double => $doubled',
    '"prefix-{$record.name}-{$doubled}" => $label:string',
    '$record -> .name -> .upper => $upperName',
    '$doubled > 0 ? "positive" ! "non-positive" => $sign',
    'list[1, 2, 3, $doubled] -> filter({ $ > 1 }) => $filtered',
    '$filtered -> fold(0, { $@ + $ }) => $total',
    '99999 => $unusedMagic',
    '$total == 0 ? { "zero" } ! { "nonzero" } => $classification',
  ];
  const linesPerBlock = blockLines.length;
  const blockCount = Math.ceil(targetLines / linesPerBlock);

  const lines: string[] = [];
  for (let i = 0; i < blockCount; i++) {
    for (const line of blockLines) {
      lines.push(line.replace(/\$i\b/g, String(i)));
    }
  }
  return lines.join('\n') + '\n';
}

/** Sorts `samples` ascending and returns the p95 value (index 94 of 100). */
function computeP95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1
  );
  return sorted[index]!;
}

/** Runs `fn` for warmup iterations, then measures `SAMPLE_COUNT` timed samples and returns the p95 in ms. */
function measureP95(fn: () => void): number {
  for (let i = 0; i < WARMUP_COUNT; i++) {
    fn();
  }

  const samples: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return computeP95(samples);
}

describe('provider latency on a 2,000-line script', () => {
  const source = generateFixtureScript(TARGET_LINE_COUNT);
  const lineCount = source.split('\n').length;
  expect(lineCount).toBeGreaterThanOrEqual(TARGET_LINE_COUNT);

  const parsed: ParseResult = parseWithRecovery(source);
  expect(parsed.success).toBe(true);
  const tokens = tokenize(source);
  const midOffset = Math.floor(source.length / 2);
  const config = createDefaultConfig();
  const sampleSpan = parsed.ast.statements[0]!.span;

  it('documentSymbols stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      documentSymbols(parsed);
    });
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('semanticTokens stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      semanticTokens(parsed, tokens, source);
    });
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('formatDocument stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      formatDocument(parsed, source);
    });
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('spanToRange stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      spanToRange(sampleSpan);
    });
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('resolveScopeAt stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      resolveScopeAt(parsed, midOffset);
    });
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('findDefinition stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      findDefinition(parsed, midOffset);
    });
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('getHover stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      getHover(parsed, midOffset);
    });
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('getCompletions stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      getCompletions(parsed, midOffset);
    });
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('runRules stays at or under the p95 budget', () => {
    const p95 = measureP95(() => {
      runRules(parsed, source, config);
    });
    expect(p95).toBeLessThanOrEqual(RUN_RULES_P95_BUDGET_MS);
  });
});

describe('provider termination on a recovery/partial AST', () => {
  // A mid-document syntax error forces `parseWithRecovery` to emit a
  // RecoveryError node surrounded by well-formed statements, exercising
  // the partial-AST path every provider must handle without hanging.
  function buildRecoverySource(targetLines: number): string {
    const base = generateFixtureScript(targetLines);
    const lines = base.split('\n');
    const midIndex = Math.floor(lines.length / 2);
    lines.splice(midIndex, 0, '|||broken syntax here');
    return lines.join('\n') + '\n';
  }

  const source = buildRecoverySource(TARGET_LINE_COUNT);
  const parsed: ParseResult = parseWithRecovery(source);
  const tokens = tokenize(source);
  const midOffset = Math.floor(source.length / 2);
  const config = createDefaultConfig();

  it('parseWithRecovery reports failure with a RecoveryError statement present', () => {
    expect(parsed.success).toBe(false);
    expect(parsed.ast.statements.map((statement) => statement.type)).toContain(
      'RecoveryError'
    );
  });

  it('every provider terminates without throwing against the recovery AST', () => {
    expect(() => documentSymbols(parsed)).not.toThrow();
    expect(() => semanticTokens(parsed, tokens, source)).not.toThrow();
    expect(() => formatDocument(parsed, source)).not.toThrow();
    expect(() => resolveScopeAt(parsed, midOffset)).not.toThrow();
    expect(() => findDefinition(parsed, midOffset)).not.toThrow();
    expect(() => getHover(parsed, midOffset)).not.toThrow();
    expect(() => getCompletions(parsed, midOffset)).not.toThrow();
    expect(() => runRules(parsed, source, config)).not.toThrow();
  });
});
