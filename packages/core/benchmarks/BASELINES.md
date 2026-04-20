# Benchmark Baselines

Captured on branch `feat/error-handling` at commit `e6e36ad` (Phase 2 mid-initiative).
These numbers are recorded for Phase 5 task 5.2 regression comparison.

Hardware: WSL2 on Linux 6.6.87.2, Node.js >=22.

## Hot-path timings (`pnpm bench` — vitest bench)

| Benchmark | hz (ops/s) | mean (ms) | p99 (ms) | rme |
|---|---:|---:|---:|---:|
| AC-N1: fold 500-element arithmetic sum | 1,510.5 | 0.662 | 0.972 | ±1.28% |
| AC-N2: map over 1000-element list | 346.1 | 2.889 | 11.44 | ±5.49% |
| AC-N3: `.!code` on valid (timing) | 65,305.8 | 0.0153 | 0.0389 | ±3.79% |
| AC-N4: append 100 trace frames | 6,978.0 | 0.1433 | 0.1990 | ±0.37% |
| AC-N4: append 1000 trace frames | 98.5 | 10.151 | 11.07 | ±0.76% |
| AC-B5: `isInvalid` on valid | 29,459,047 | ~0.00003 | — | ±0.15% |
| AC-B5: `isInvalid` on 10k-frame invalid | 21,082,087 | ~0.00005 | — | ±0.22% |
| AC-B5: `getStatus().code` on valid | 26,898,437 | ~0.00004 | — | ±0.26% |
| AC-B5: `getStatus().code` on 10k-frame invalid | 21,147,502 | ~0.00005 | — | ±0.16% |

## AC-N3 allocation deltas (`node --expose-gc benchmarks/allocations.ts`)

10,000 iterations after 100-iteration warm-up, forced GC between phases.
Threshold: 4 bytes/iter (any per-iter status-object allocation would exceed this).

| Probe | bytes/iter | Status |
|---|---:|---|
| `isInvalid(validString)` | 0.82 | PASS |
| `getStatus(validString).code` | 0.20 | PASS |
| `isInvalid(validDict)` | 0.72 | PASS |
| `getStatus(validDict).code` | 0.00 | PASS |

The sub-4 B/iter figures confirm DEC-4: valid values reference the frozen
empty-status singleton; no per-probe allocation of sidecar objects.
Residual bytes are ambient Node/V8 accounting, not probe-attributable.

## Observations for Phase 5

- AC-B5 confirms `isInvalid` / `getStatus` cost is constant-ish across
  valid vs. 10k-frame invalid: ~29M vs. ~21M ops/s (1.4x gap from the
  non-enumerable property-descriptor read, not from trace iteration).
- AC-N4: per-append cost scales roughly 7x from 100 to 1000 appends
  (expected 10x linear). `appendFrame` does `.slice()` + `Object.freeze`,
  so per-append cost includes O(N) array copy on growth; the statement
  in the spec ("N frames with zero prior-frame copies") refers to
  absence of trace-frame DEEP copy, not array-backing copy. Documented
  as `[DEBT]` for Phase 5 optimisation (persistent list or shared tail).
