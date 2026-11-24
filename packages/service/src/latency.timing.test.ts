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
import { createDefaultConfig, runRules, RULES } from './rules/index.js';
import {
  measureInterleavedRatioMedian,
  measureP95,
  measureRatioP95,
} from './percentile.js';

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
// runRules is budgeted in two parts, because its cost is a fixed traversal
// plus a term that grows with the number of registered rules:
//
//   runRules(all rules) ~= base + perRule x enabledRuleCount
//
// Measured under vitest on the fixture below, with the first k registered
// rules enabled (k = 0, 16, 33, 49, 65), the ratio to parse rose linearly from
// 0.55 to 1.05. A single whole-engine ceiling therefore erodes with every
// rule added: the 1.5 ceiling this replaces was calibrated at 0.70-0.88 on
// 2026-11-03 and was breached on CI three weeks later by rule growth alone,
// with no defect in any one change.
//
// - BASE: runRules with an empty rule list, i.e. the traversal, the facts
//   pass, and scope bookkeeping every rule shares. It does not move when a
//   rule is added, so it keeps a fixed ceiling.
// - PER RULE: (all-rules ratio - base ratio) / enabled rule count, the mean
//   marginal cost of one rule. Adding rules of typical cost leaves it flat.
//   One expensive rule raises it: before it was fixed, NAMING_SNAKE_CASE
//   rescanned the whole capture and reference logs per violation, a
//   violations x script-size cost that took 23% of runRules on this fixture.
//
// Readings (local, 3 runs each, median of paired ratios):
//
//                            base         per rule
//   correct                  0.51-0.53    0.0079-0.0084
//   NAMING_SNAKE_CASE before
//   its fix                  0.48-0.52    0.0100-0.0135
//   runRules run 2x          0.91-0.93    0.0154-0.0160
//
// The ratio does not fully cancel across machines: CI read 1.16-1.63x the
// local value for the same code. Scaled by that factor, a correct CI reading
// tops out at base 0.86 and per rule 0.0137, and a doubled one starts at
// base 1.06 and per rule 0.0179. Each ceiling sits between the two, about
// 10% clear of the correct end, so CI catches a 2x regression in either
// part. Locally a doubling can read under a ceiling; CI is the gate.
//
// If either breaches, find out which of the two happened, a regression or a
// machine reading outside the envelope above. Do not raise a constant
// without new readings, and recalibrate under vitest, never plain node.
const RUN_RULES_BASE_BUDGET_X_PARSE = 0.95;
const RUN_RULES_PER_RULE_BUDGET_X_PARSE = 0.015;
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
    'fn(x) { $x * 2 + 1 } => $double',
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
    'runRules stays within its base and per-rule paired-ratio budgets',
    () => {
      // Sampled interleaved with the parse reference rather than against
      // parseRefP95: these budgets sit closest to their correct readings,
      // and a reference measured at the start of the suite let load that rose
      // during a parallel run push a correct runRules to 1.526x. Each round
      // yields one paired ratio, and the median of those absorbs a tail
      // spike that lands in only one of the two series.
      const parse = (): void => {
        parseWithRecovery(source);
      };
      const enabledRules = RULES.filter(
        (rule) => (config.rules[rule.code] ?? 'on') !== 'off'
      );
      const baseXParse = measureInterleavedRatioMedian(() => {
        runRules(parsed, source, config, []);
      }, parse);
      const allXParse = measureInterleavedRatioMedian(() => {
        runRules(parsed, source, config, enabledRules);
      }, parse);
      const perRuleXParse = (allXParse - baseXParse) / enabledRules.length;

      expect(enabledRules.length).toBeGreaterThan(0);
      expect(
        baseXParse,
        `runRules base ${baseXParse.toFixed(3)}x parse`
      ).toBeLessThanOrEqual(RUN_RULES_BASE_BUDGET_X_PARSE);
      expect(
        perRuleXParse,
        `runRules per rule ${perRuleXParse.toFixed(4)}x parse ` +
          `(all ${allXParse.toFixed(3)}x, ${enabledRules.length} rules)`
      ).toBeLessThanOrEqual(RUN_RULES_PER_RULE_BUDGET_X_PARSE);
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

  it('every provider returns values against the recovery AST', () => {
    // Anchor on a variable read after the broken line.
    const readOffset = source.lastIndexOf('$record.index') + 1;

    expect(documentSymbols(parsed).length).toBeGreaterThan(0);
    expect(semanticTokens(parsed, tokens, source).length).toBeGreaterThan(0);
    expect(resolveScopeAt(parsed, midOffset).length).toBeGreaterThan(0);

    const definition = findDefinition(parsed, readOffset);
    expect(
      source.slice(definition?.start.offset, definition?.end.offset).trimEnd()
    ).toBe('$record:dict');
    expect(getHover(parsed, readOffset)?.contents).toBe('variable `record`');

    const edits = formatDocument(parsed, source);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.newText).toContain('|||broken syntax here');

    expect(
      getCompletions(parsed, readOffset)
        .filter((item) => item.kind === 'variable')
        .map((item) => item.label)
    ).toContain('record');
    expect(() => runRules(parsed, source, config)).not.toThrow();
  });
});
