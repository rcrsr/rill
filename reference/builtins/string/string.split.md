---
id: string.split
title: string.split
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method, string, defaults]
tests: [expressions.test.ts, builtin-string.test.ts]
---

# string.split

`.split` yields the pieces of a string between each occurrence of a separator.

## Syntax

```text
string.split(separator: string = "\n") -> list(string)
```

## Evaluation

r[string.split.separator] .split cuts at each occurrence of the separator text
`.split(sep)` MUST yield the list of the pieces between occurrences of `sep`, left to right,
compared as text and not as a pattern. Adjacent separators, and a separator at either end, MUST
yield `""` pieces.

r[string.split.no-match] A receiver without the separator yields one piece
When `sep` does not occur, `.split` MUST yield a list holding the receiver. `"".split(",")` MUST
yield `list[""]`.

r[string.split.empty] An empty separator splits into code points
`.split("")` MUST yield the receiver's code points, each a one-character string.

r[string.split.default] The separator defaults to a newline
`.split` with no argument MUST split at `"\n"`.

## Examples

```rill
"a,b,,c" -> .split(",")
# Result: list["a", "b", "", "c"]
```

```rill
list["a.b" -> .split("."), "😀a" -> .split(""), "a\nb" -> .split]
# Result: list[list["a", "b"], list["😀", "a"], list["a", "b"]]
```
