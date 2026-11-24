---
id: host-timeout
title: Host timeout
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-R012]
depends: [halt, invocation, guard]
tests: [limits.test.ts]
---

# Host timeout

The host timeout is a time bound, in milliseconds, that the host sets on each host function call
when it creates the runtime.

## Evaluation

r[host-timeout.expiry] A host call past the host timeout halts RILL-R012
With a host timeout of N milliseconds, a host function call that has not returned after N
milliseconds MUST halt with RILL-R012. The halt MUST NOT wait for the host function to return.

r[host-timeout.within] A host call that returns in time is unaffected
A host function call that returns before the host timeout elapses MUST yield its result.

r[host-timeout.unset] With no host timeout, a host call runs until it returns
When the host sets no timeout, a host function call MUST NOT halt for its duration.

r[host-timeout.script-function] A script function is not bounded by the host timeout
A call to a function the script defines MUST NOT halt for its duration, even when it runs longer
than the host timeout.

## Interactions

A `timeout` block bounds its body, host calls included, with its own limits
(`construct-options.timeout-total-expiry`). `guard` and `retry` recover RILL-R012 as they recover
any catchable halt (`guard.catch`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A host function call outlasts the host timeout (`host-timeout.expiry`) | RILL-R012 | Yes |

## Notes

The host option is `timeout` on the runtime options. Probed at 93e55c14, a value above
2147483647, a zero, or a negative value makes every host call halt RILL-R012 within 1 ms.

The host timeout also bounds built-in functions such as `seq`, `fold`, and `take`, but not
loops, methods, or script functions. Which calls it bounds is undecided: see INCONSISTENCIES.md.

An annotation `^(timeout: N)` on a call does not change the host timeout.

`dispose()` waits up to 5000 ms for host calls in flight, then completes. A call made after it
halts `#DISPOSED`.
