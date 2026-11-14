---
id: strict-mode
title: Strict mode
status: normative
since: 0.24.0
issues: [629]
grammar: []
errors: []
depends: [type-value, declaration, assertion, inference, any, list, dict, fn]
tests: []
---

# Strict mode

Strict mode is an opt-in checker rule set that rejects any literal whose whole type is not written.

## Static rules

r[strict-mode.whole-type] A literal passes when its whole type is written {pending #629}
A literal MUST pass when its whole type is written in front of it, or by the literal that contains
it. A literal that fails MUST be reported as a checker finding.

r[strict-mode.leaf] A leaf type name is the whole type {pending #629}
A literal of a leaf type, such as `number 1` or `string "a"`, MUST pass. A leaf has no inner type,
so its name is complete.

r[strict-mode.bare] A bare literal fails {pending #629}
`1`, `"a"`, `true`, and `#a` MUST fail where no enclosing literal covers them. A statement-level
`1` is covered by nothing.

r[strict-mode.contents] A written type covers the contents {pending #629}
The elements, fields, and positions of a literal MUST need no type of their own when the literal's
type is written in full. `list(number)[1, 2]` and `dict(a: number)[a: 1]` MUST pass.

r[strict-mode.kind] A kind spelling fails {pending #629}
`list[1, 2]` and `list()[1, 2]` MUST fail, because the inner type is left to inference.

r[strict-mode.unwritten] A literal with no type fails {pending #629}
`[1, 2]` MUST fail, because no type is written.

r[strict-mode.any] An explicit any counts as written {pending #629}
`list(any)[1]` MUST pass. The mode judges spelling and MUST NOT require a type narrower than
`any`.

r[strict-mode.fn] A function writes its parameter and outer types {pending #629}
`fn(x: number):string { ... }` and `fn(x: any):any { ... }` MUST pass.

r[strict-mode.fn-unwritten] A function with an unwritten type fails {pending #629}
`fn(x) { ... }` and a bare block `{ ... }` MUST fail.

## Interactions

r[strict-mode.default-mode] Default mode accepts every spelling {pending #629}
Outside strict mode, a literal MUST be accepted in the complete, kind, and bare spellings, and
strict mode MUST add no runtime or parser behavior.

## Examples

```text
list(number)[1, 2]      # passes: the whole type is written
list(any)[1]            # passes: any is written
list[1, 2]              # fails: the inner type is left to inference
[1, 2]                  # fails: no type is written
number 1                # passes: a leaf name is the whole type
fn(x: any):any { $x }   # passes
fn(x) { $x }            # fails: the parameter type is not written
```

```rill pending=629
list(number)[1, 2] == [1, 2]
# Result: true
```

## Notes

Strict mode is not built. #629 tracks it, deferred past 0.24.0. The language service already has
a `checkerMode` setting named `strict`, which raises the severity of two `use` rules.

Open decision: #629, how the two meanings of `strict` take one name each, or merge.

Open decision: #629, whether a code block passed to a control construct or a collection operator
counts as a bare `{ ... }` function.
