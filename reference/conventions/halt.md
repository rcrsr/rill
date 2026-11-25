---
id: halt
title: Halts
status: normative
since: 0.24.0
issues: [681]
depends: [notation]
tests: [error.test.ts, guard-retry.test.ts, access-halt.test.ts, halt-catchability.test.ts]
---

# Halts

A halt stops evaluation and reports one error. This file fixes the vocabulary every Errors table uses.

## Terms

r[halt.definition] A halt ends evaluation of the script
A halt MUST stop evaluation at the point it is raised. No later statement of the script runs
unless a recovery construct catches the halt.

r[halt.no-exceptions] A halt is not an exception
rill MUST NOT offer a construct that catches a halt and resumes inside the halted expression.
Recovery turns a caught halt into an invalid value at the boundary of the recovery construct.

r[halt.error-id] Every diagnostic carries a permanent error id
Every halt and every parse error MUST carry an error id of the form `RILL-` followed by a stage
letter and a number: `L` lexer, `P` parser, `R` runtime, `C` check. An error id never changes
meaning once released.

r[halt.error-code] A runtime halt carries an error code
A runtime halt MUST carry an error code, an atom from the closed core error set, such as
`#TYPE_MISMATCH` or `#INVALID_INPUT`. Scripts select halts by error code, not by error id.

## Catchable and non-catchable

r[halt.catchable] Recovery catches only catchable halts
A halt is catchable or non-catchable. Recovery constructs MUST catch catchable halts and MUST
let non-catchable halts propagate unchanged.

r[halt.non-catchable] Some halts are never caught
These halts MUST be non-catchable: a halt raised by `error`, a failed `assert`, a parameter type
mismatch at a call, a call whose argument count does not match (RILL-R044 for a missing
argument, RILL-R045 for an excess one), a call made after the runtime is disposed, and a fatal
limit halt.

r[halt.probe-rule] A halt a probe could have ruled out is not catchable {pending #681}
A halt MUST be non-catchable when a probe, a comparison, or the source text could have ruled it
out before the operation ran. This covers a type error, an undefined name, a method the receiver's
kind lacks, a binding or arity error, a broken type lock, a missing field or index, and a
malformed type form.

r[halt.limit-fatal] A step, depth, or in-flight limit halt is not catchable {pending #681}
A RILL-R010 halt MUST be non-catchable under every operator, function, and construct.

r[halt.host-contract] A host contract violation is not catchable {pending #681}
A halt that reports a host breaking its contract MUST be non-catchable: RILL-R074, RILL-R084, and
RILL-R085.

r[halt.world-failure] Recovery catches what no probe rules out {pending #681}
Every other halt MUST be catchable: an invalid value a host function returns, a resolver that is
missing or fails, a time bound, a value past its range, and a content failure that no probe can
test.

r[halt.parse] Parse errors precede evaluation
A lexer or parser error MUST be reported before any statement of the script evaluates. It is
never caught, because no recovery construct is running yet.

r[halt.signals] Control signals are not halts
`break` and `return` MUST NOT be treated as halts. Recovery never catches them.

## Reading an Errors table

r[halt.table] An Errors table states the error and its catchability
Each row of an Errors table MUST name the condition, the error code, the error id, or both, and
whether the halt is catchable. "Halts with `#X`" in a rule body means a halt carrying error code
`#X`. "Raises RILL-P003" means a halt or parse error carrying that error id.

## Notes

The generated [Error Reference](../../docs/ref-errors.md) lists every error id with its cause and
resolution. It is the lookup table for error ids; this file and the Errors tables are the rules.
