---
id: notation
title: Notation
status: normative
since: 0.24.0
depends: []
tests: []
---

# Notation

The notation every reference file uses for grammar, rules, and normative force.

## Grammar

r[notation.ebnf] Grammar excerpts use ISO 14977 EBNF
Syntax sections MUST use the EBNF dialect of `docs/ref-grammar.ebnf`: `=` defines, `,`
concatenates, `|` separates alternatives, `[ ]` is optional, `{ }` repeats zero or more times,
and `;` ends a production. Terminals are double-quoted.

r[notation.excerpt] A grammar excerpt matches the grammar file
A production named in a file's `grammar` list MUST appear in its Syntax section exactly as it
appears in `docs/ref-grammar.ebnf`.

## Normative force

r[notation.keywords] Uppercase MUST, MUST NOT, and MAY are normative
MUST, MUST NOT, and MAY in uppercase carry the meanings of RFC 2119 as clarified by RFC 8174.
The same words in lowercase carry no normative force.

r[notation.informative] Examples and Notes are informative
Content under Examples and Notes MUST NOT add or change a rule. Where an example and a rule
disagree, the rule holds and the example is a defect.

## Rule markers

r[notation.marker] Each rule has a symbolic id and a full form
A rule marker MUST be written `r[<concept>.<rule>] <full form>` on its own line, followed by the
rule body. `FORMAT.md` defines both names.

r[notation.pending] A pending rule names the issue that builds it
A rule that the current runtime does not satisfy MUST end its marker with `{pending #N}`, where
`#N` is an open issue in the rill repository.

## Values in prose

r[notation.code] Code in prose is rill source
Text in backticks inside a rule body MUST be valid rill source or a fragment of it, unless it is
an error id, an error code, or a grammar production name. A rule body MAY show malformed or
non-rill text in backticks when the body names that text as rejected or as a format.

r[notation.result] An arrow in prose reads "evaluates to"
A rule body MAY write `a` ⇒ `b`. It means that evaluating `a` yields a value equal to `b`.
