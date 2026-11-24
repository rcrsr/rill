---
id: atom
title: Atoms
status: normative
since: 0.24.0
issues: []
grammar: [atom-literal]
errors: [RILL-P024, RILL-R002, RILL-R036, INVALID_INPUT, TYPE_MISMATCH]
depends: [notation, halt, type-value]
tests: [atoms.test.ts, atom-comment-spelling.test.ts, typed-atom-migration.test.ts, type-assertions.test.ts, equality-gate.test.ts]
---

# Atoms

An atom is an immutable symbol that is identified and compared by its name alone.

## Syntax

```ebnf
atom-literal  = "#" , identifier ;
```

## Static rules

r[atom.spelling] A hash directly followed by a letter or underscore starts an atom
`#` immediately followed by a letter or `_` MUST start an atom. The name MUST follow the
identifier rule that variables use: a letter or underscore, then letters, digits, and
underscores. No whitespace MAY separate `#` from the name.

r[atom.comment] Any other hash starts a comment
A `#` followed by a space, a digit, punctuation, or the end of the line MUST start a line
comment.

r[atom.same-line] An atom that reads like a misspelled comment is rejected
An atom that follows a complete expression on the same line MUST raise RILL-P024.

r[atom.trailing-word] An atom followed by a bare word is rejected
An atom followed on its line by a bare word, as in `#TODO fix this`, MUST raise RILL-P024.

r[atom.free] Any well-formed name is an atom
Nothing is registered. A name MUST NOT resolve to a different atom. `#wired`, `#Wired`, and
`#WIRED` MUST be three distinct atoms.

## Evaluation

r[atom.value] An atom literal yields an atom of its name
`#name` MUST yield the atom named `name`. `#ok` is an ordinary atom.

r[atom.print] An atom prints with its hash
An atom MUST print as `#` followed by its name. Interpolating an atom inserts that text.

## Interactions

Two atoms compare by name per `equality.atom`, and a narrowed atom per `equality.closed-set`.
Equality against a non-atom value follows `equality.no-overlap`.

r[atom.from-string] A string converts to the atom of its name
`"wired" -> atom` MUST yield `#wired`.

r[atom.invalid-name] A string that is not an atom name halts
`"a-b" -> atom` MUST halt with `#INVALID_INPUT` when the string does not follow the identifier
rule of `atom.spelling`.

r[atom.to-string] An atom converts to its name
`#wired -> string` MUST yield `"wired"`, the name without the hash.

r[atom.from-other] Any other source has no route
A value that is neither an atom nor a string, piped into `atom`, MUST halt with RILL-R036.
`5 -> atom` halts.

r[atom.unordered] Atoms have no order
`<`, `>`, `<=`, and `>=` with an atom operand MUST halt with RILL-R002.

r[atom.no-arithmetic] An atom is not a number
An arithmetic operator with an atom operand MUST halt with RILL-R002.

r[atom.membership] Only an atom satisfies atom
An atom MUST satisfy `:atom`. A value of any other type MUST halt `:atom` with
`#TYPE_MISMATCH`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| An atom follows an expression or a bare word on its line | RILL-P024 | No |
| A string that is not an atom name is converted to atom | `#INVALID_INPUT` | Yes |
| An atom is ordered or used in arithmetic | RILL-R002 | Yes |
| A value that is neither atom nor string is converted to atom | RILL-R036 | Yes |
| A non-atom is asserted as `:atom` | `#TYPE_MISMATCH` | Yes |
| A closed-set atom is compared outside its set (`equality.closed-set`) | `#TYPE_MISMATCH` | Yes |

## Examples

```rill
"wired" -> atom -> "link is {$}"
# Result: "link is #wired"
```

```rill
#wired == #Wired
# Result: false
```

```rill
#ok -> string
# Result: "ok"
```

```rill
# Error: #wirless is outside the asserted set
#wired => $kind:union(#wired, #wireless)
$kind == #wirless
```

## Notes

On 0.23.0 `==` between an atom and a value outside its asserted set yields false.

Superseded: `atom.equality`, now `equality.atom`; `atom.closed-set`, now `equality.closed-set`.
