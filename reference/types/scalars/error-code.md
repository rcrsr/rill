---
id: error-code
title: The error_code type
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [INVALID_INPUT, TYPE_MISMATCH]
depends: [notation, halt, type-value, atom, union]
tests: [error-code-type.test.ts, status-probe.test.ts, typed-atom-migration.test.ts, equality-gate.test.ts, guard-retry.test.ts]
---

# The error_code type

`error_code` is the built-in type whose members are exactly the atoms in the closed core error set.

## Static rules

r[error-code.name] error_code is a type name and a type value
`error_code` MUST be accepted in every type position and MUST evaluate to a type value whose
`.name` and `.signature` are `"error_code"`.

r[error-code.no-args] error_code takes no type arguments
`error_code` MUST take no type arguments in a type position.

## Evaluation

r[error-code.members] error_code is the union of every error code
`error_code` MUST equal the union of the atoms in the closed core error set. `error_code.inner`
MUST list those atoms.

r[error-code.no-ok] The set excludes ok
The closed core error set MUST NOT contain `#ok`.

r[error-code.reduce] Union reduction treats error_code as its members
`union(#TIMEOUT, error_code)` MUST equal `error_code`, and `union(atom, error_code)` MUST equal
`atom`.

r[error-code.print] error_code prints as one word
`error_code` MUST print as `error_code`.

r[error-code.print-union] A union with ok prints members in canonical order
A union of `#ok` and `error_code` MUST print as `union(error_code, #ok)`.

## Interactions

r[error-code.membership] A core error code satisfies error_code
An atom in the closed set MUST satisfy `:error_code`. `#ok`, a domain atom such as `#wired`,
and a value of any other type MUST halt `:error_code` with `#TYPE_MISMATCH`.

r[error-code.is-atom] An error code is an atom
Every member of `error_code` MUST satisfy `:atom`. The own type of an error code stays `atom`.

r[error-code.status] The status probe carries union(error_code, #ok)
The value of `$v.!code` MUST carry the asserted type `union(error_code, #ok)`.

r[error-code.status-value] The status probe is ok for a valid value
`$v.!code` MUST be `#ok` for a valid value and an error code for an invalid one.

r[error-code.status-lock] A capture of the status probe locks to its type
A capture of `.!code` MUST lock the variable to `union(error_code, #ok)`.

r[error-code.closed-compare] Comparing .!code outside the set halts
`==` and `!=` between a `.!code` value and an atom outside `union(error_code, #ok)` MUST halt
with `#TYPE_MISMATCH`. `$r.!code == #TIMEUOT` MUST halt, and `$r.!code == #ok` MUST yield a
bool.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `error_code` receives a type argument in a type position | `#INVALID_INPUT` | Yes |
| A value outside the closed set is asserted as `:error_code` | `#TYPE_MISMATCH` | Yes |
| `.!code` is compared with an atom outside its carried type | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
#TIMEOUT -> :?error_code
# Result: true
```

```rill
#ok -> :?error_code
# Result: false
```

```rill
guard { 1 / 0 } => $r
$r.!code -> :?error_code
# Result: true
```

```rill
guard { 1 / 0 } => $r
$r.!code.^type.signature
# Result: "union(error_code, #ok)"
```

```rill
# Error: #TIMEUOT is outside union(error_code, #ok)
guard { 1 / 0 } => $r
$r.!code == #TIMEUOT
```

## Notes

`error_code`, `.!code` typed as `union(error_code, #ok)`, and `error_code.inner` all behave as
stated above.

On 0.23.0 `$r.!code == #TIMEUOT` yields false.
