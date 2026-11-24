---
id: call-depth
title: Call depth
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R010]
depends: [halt, invocation, fan]
tests: [limits.test.ts, code-block.test.ts]
---

# Call depth

Call depth is the number of function calls in progress on one chain of calls; calls in flight is
the number in progress across every concurrent branch of a run.

## Evaluation

r[call-depth.nesting] A call nested past the depth limit halts
A call that would put more than 1,000 calls in progress on one chain MUST halt with RILL-R010. A
function that recurses 999 times, 1,000 calls in all, MUST complete.

r[call-depth.host-setting] The host sets the depth limit
The host MAY set a different depth limit when it creates the runtime. That limit MUST replace
1,000 in `call-depth.nesting` and in `call-depth.in-flight`.

r[call-depth.in-flight] Calls in flight are capped at the depth limit plus 10,000
A call that would put more than the depth limit plus 10,000 calls in flight across a run MUST
halt with RILL-R010. With the default limit, the ceiling is 11,000.

## Interactions

A block head adds no call depth (`code-block.head`). `fan`, `filter`, and `sort` call their
function concurrently (`fan.concurrency`), so each call they start counts toward
`call-depth.in-flight`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A call nests past the depth limit (`call-depth.nesting`) | RILL-R010 | No |
| Calls in flight pass the depth limit plus 10,000 (`call-depth.in-flight`) | RILL-R010 | No |

## Examples

```rill
fn(n: number) { ($n == 0) ? 0 ! ($f($n - 1) + 1) } => $f
999 -> $f
# Result: 999
```

```rill
# Error: Call depth exceeded 1000
fn(n: number) { ($n == 0) ? 0 ! ($f($n - 1) + 1) } => $f
1000 -> $f
```

## Notes

Near the in-flight ceiling, whether a run halts depends on how its concurrent calls interleave:
`range(0, 5500) -> fan({ $g($) })` with `fn { $ } => $g` sometimes halts and sometimes completes.
Over 10,000 `fan` elements whose block calls a function, 20,000 calls, it always halts.

The host option `maxCallStackDepth`, default 100, bounds the call frames a host error report
keeps. It never halts a script and does not shorten the trace a script reads: a `guard` around a
300-deep recursion yields a 303-frame `.!trace` with the option at 5.
