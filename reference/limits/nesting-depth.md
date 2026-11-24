---
id: nesting-depth
title: Nesting depth
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-P015]
depends: [halt, token]
tests: [limits.test.ts, bare-bracket-literals.test.ts]
---

# Nesting depth

Nesting depth is how many parentheses, brackets, and blocks enclose a point in the source.

## Static rules

r[nesting-depth.reject] Nesting past the parser's depth is rejected
Parentheses, collection literals, and blocks nested deeper than the parser supports MUST be
rejected with RILL-P015 before any statement evaluates (`halt.parse`). The supported depth is an
implementation limit.

r[nesting-depth.shallow] Moderate nesting parses
Forty levels of parentheses, of `list[`, or of blocks MUST parse and evaluate.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| Nesting deeper than the parser supports (`nesting-depth.reject`) | RILL-P015 | No |

## Examples

```rill
((((((((((1))))))))))
# Result: 1
```

## Notes

Probed at 93e55c14, 74 nested parentheses, `list[`, `dict[a: `, or blocks parse, and 75 halt
RILL-P015. The registry example for RILL-P015 nests 151 parentheses.
