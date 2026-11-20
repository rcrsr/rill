/**
 * Repeatable evaluation benchmark.
 *
 * Times execution (parse excluded) of fixed scripts and prints one JSON line per
 * script: {script, medianMs, p25, p75, runs}. A script that throws prints
 * {script, error} instead. Nothing is asserted or gated.
 *
 * Imports only the public API so the file runs unchanged against an older
 * build of the package.
 *
 * Usage:
 *   pnpm --filter @rcrsr/rill bench
 */

import { createRuntimeContext, execute, parse } from '../src/index.js';

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 30;

// A script given as alternatives runs the first one that parses, so one file
// covers builds before and after the function literal changed form.
const SCRIPTS: Readonly<Record<string, string | readonly string[]>> = {
  fold: 'range(0, 9000) -> fold(0, { $@ + $ })',
  vars: [
    '1 => $a',
    '2 => $b',
    'range(0, 9000) -> seq({ ($a + $b + $) -> { $ * 2 } }) -> .len',
  ].join('\n'),
  methods: 'range(0, 9000) -> seq({ "x{$}" -> .upper -> .len }) -> .len',
  calls: [
    ['fn(x) { $x + 1 } => $f', 'range(0, 9000) -> seq({ $f($) }) -> .len'].join(
      '\n'
    ),
    ['|x| ($x + 1) => $f', 'range(0, 9000) -> seq({ $f($) }) -> .len'].join(
      '\n'
    ),
  ],
  declared_control: [
    '1 => $a:number',
    '2 => $b:number',
    'range(0, 9000) -> seq({ ($a + $b + $) -> { $ * 2 } }) -> .len',
  ].join('\n'),
};

async function runOnce(source: string): Promise<number> {
  const ast = parse(source);
  const ctx = createRuntimeContext();
  const start = performance.now();
  await execute(ast, ctx);
  return performance.now() - start;
}

function percentile(sorted: readonly number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (idx - lo);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function benchScript(name: string, source: string): Promise<void> {
  try {
    for (let i = 0; i < WARMUP_RUNS; i++) {
      await runOnce(source);
    }
    const samples: number[] = [];
    for (let i = 0; i < MEASURED_RUNS; i++) {
      samples.push(await runOnce(source));
    }
    samples.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        script: name,
        medianMs: round(percentile(samples, 0.5)),
        p25: round(percentile(samples, 0.25)),
        p75: round(percentile(samples, 0.75)),
        runs: samples.length,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ script: name, error: message }));
  }
}

function firstParsing(sources: string | readonly string[]): string {
  if (typeof sources === 'string') return sources;
  for (const source of sources) {
    try {
      parse(source);
      return source;
    } catch {
      // Try the next form.
    }
  }
  return sources[0] ?? '';
}

async function main(): Promise<void> {
  for (const [name, sources] of Object.entries(SCRIPTS)) {
    await benchScript(name, firstParsing(sources));
  }
}

await main();
