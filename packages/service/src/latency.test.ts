/**
 * Latency benchmark for every syntactic/scope provider plus the rules
 * engine, run against a ~2,000-line generated script.
 *
 * Each provider is measured over 100 timed samples (after a short warmup)
 * and must stay at or under its p95 budget. Budgets are multiples of the
 * cost of parsing the same fixture rather than absolute milliseconds, so
 * they measure the code instead of the runner - see the budget constants
 * below. A separate suite asserts that every provider terminates against
 * a recovery/partial AST built from a mid-document syntax error, guarding
 * against infinite loops on cyclic/partial ASTs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
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
import { measureP95, measureRatioP95 } from './percentile.js';

// Budgets are expressed as a multiple of parsing the same fixture, not in
// milliseconds. See `measureRatioP95` for why: an absolute ceiling measures
// the runner as much as the code, and the history of this file is the
// evidence - the single-pass budget went 50ms -> 60ms -> 100ms and this one
// went 250ms -> 350ms, every raise following a flake rather than a
// regression.
//
// parseWithRecovery is the reference. It is the right shape (a full walk
// over the same source, allocating the same kind of tree) and the right
// order of magnitude: it and runRules cost about the same here.
//
// Recalibrate by measuring INSIDE vitest, never with a standalone node
// script. Vitest transforms and loads these modules differently and the
// numbers are not transferable: parsing this fixture measures ~20ms under
// plain node and ~43ms under vitest, which moves runRules from 2.1x parse
// to 1.0x. A budget calibrated in the wrong environment is what lets a
// doubling through.
//
// Measured under vitest, idle and under CPU oversubscription that inflated
// the parse reference from ~43ms to ~175ms:
//
//                  idle           loaded
//   runRules       1.008-1.042    1.015-1.136
//   semanticTokens 0.153-0.195    0.176-0.217
//   all others     <=0.041        <=0.082
//
// A 4x slower machine moved runRules by 6%. That is the whole point of the
// ratio: the machine cancels, so the budget can sit close to the code.
//
// The cheap providers drift the most in relative terms, which is expected -
// documentSymbols costs ~1.5ms, so one preemption during its 100 samples
// moves its ratio further than any plausible regression would. The
// expensive providers are the ones these budgets can really speak about.
//
// semanticTokens is the binding constraint at 0.217 loaded, so 0.5 is ~2.3x
// headroom over it. Everything else sits below 0.082 and has far more.
const P95_BUDGET_X_PARSE = 0.5;
// runRules aggregates every bundled rule (~41) over the script, so it does
// proportionately more work than the single-pass providers.
//
// This fixture is FLAT (no deeply nested collection-op bodies), and on flat
// input the two-pass rules engine is measurably slower than the sub-walk
// engine it replaced. Local p95 on this fixture: 34.62ms before the
// facts-pass refactor, 41.64ms after, a ~20% regression. The cause is not a
// surprise: a shallow subtree is cheap to re-walk, so the sub-walks the
// refactor deleted were nearly free here, and collectFacts adds a second
// full traversal plus one fact record per node that flat input never
// amortizes. Deeply nested input pays the opposite way and wins 153x (see
// rules/nesting-scale.test.ts). Trading a bounded ~20% on shallow scripts
// for the removal of an unbounded quadratic on nested ones is the intended
// deal, not an accident.
//
// Calibrated against injected regressions rather than guessed. Running the
// rules engine 2x and 3x per sample measures 1.905x and 2.728x, against an
// observed correct envelope of 1.008-1.136x. 1.5 sits between the two: ~32%
// clear of the worst correct reading, and decisively under a doubling, so
// it catches anything at or above ~1.5x.
//
// That threshold is deliberately above 1.2x. The facts-pass regression
// described above was an accepted trade, and a budget that trips on a
// change the maintainers chose is a budget that gets raised again. Re-run
// that change today and it lands at ~1.22x, under the ceiling.
//
// The 350ms ceiling this replaces allowed 8.1x over the local p95 of the
// day. If this one breaches, the fix is to find out which of the two
// happened - the numbers above are here so that is answerable - not to
// raise the constant.
const RUN_RULES_P95_BUDGET_X_PARSE = 1.5;
const TARGET_LINE_COUNT = 2000;
// Each case below runs its provider SAMPLE_COUNT + WARMUP_COUNT times, so
// wall-clock is roughly 105x the provider's own latency: on the CI runner
// that is ~19s for runRules and ~5s for semanticTokens, both over vitest's
// 5s default. The p95 assertions above are the latency guard; the test
// timeout must not be, or a slow runner fails the suite for the wrong
// reason and reports it as a timeout rather than as a budget breach.
const LATENCY_TEST_TIMEOUT_MS = 120_000;

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

describe('provider latency on a 2,000-line script', () => {
  const source = generateFixtureScript(TARGET_LINE_COUNT);
  const lineCount = source.split('\n').length;
  const parsed: ParseResult = parseWithRecovery(source);
  const tokens = tokenize(source);
  const midOffset = Math.floor(source.length / 2);
  const config = createDefaultConfig();
  const sampleSpan = parsed.ast.statements[0]!.span;
  // The denominator for every budget below. Measured once in beforeAll
  // rather than per case, which would double this suite's wall-clock for
  // no accuracy worth the cost: runner contention is sustained for the
  // length of a job, not bursty within it.
  let parseRefP95 = 0;
  beforeAll(() => {
    parseRefP95 = measureP95(() => {
      parseWithRecovery(source);
    });
  }, LATENCY_TEST_TIMEOUT_MS);

  // Guards the fixture the latency budgets are measured against: every p95
  // below is meaningless if the script is short or failed to parse.
  it('generates a parseable script of at least the target length', () => {
    expect(lineCount).toBeGreaterThanOrEqual(TARGET_LINE_COUNT);
    expect(parsed.success).toBe(true);
  });

  it(
    'documentSymbols stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        documentSymbols(parsed);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );

  it(
    'semanticTokens stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        semanticTokens(parsed, tokens, source);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );

  it(
    'formatDocument stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        formatDocument(parsed, source);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );

  it(
    'spanToRange stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        spanToRange(sampleSpan);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );

  it(
    'resolveScopeAt stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        resolveScopeAt(parsed, midOffset);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );

  it(
    'findDefinition stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        findDefinition(parsed, midOffset);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );

  it(
    'getHover stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        getHover(parsed, midOffset);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );

  it(
    'getCompletions stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        getCompletions(parsed, midOffset);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );

  it(
    'runRules stays at or under the p95 budget',
    () => {
      const xParse = measureRatioP95(() => {
        runRules(parsed, source, config);
      }, parseRefP95);
      expect(xParse).toBeLessThanOrEqual(RUN_RULES_P95_BUDGET_X_PARSE);
    },
    LATENCY_TEST_TIMEOUT_MS
  );
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
