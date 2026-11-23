---
id: frontmatter
title: Frontmatter
status: normative
since: 0.24.0
issues: []
grammar: [frontmatter]
errors: [RILL-P001, RILL-P005, RILL-P023, RILL-R060]
depends: [notation, halt, source-text, whitespace, statement]
tests: [frontmatter.test.ts]
---

# Frontmatter

Frontmatter is a block of text between two `---` lines at the start of a script, read by the
host and ignored by evaluation.

## Syntax

```ebnf
frontmatter   = "---" , newline , { yaml-line } , "---" , newline ;
```

## Static rules

r[frontmatter.position] Frontmatter opens the script
Frontmatter MAY appear before the first statement, after only blank lines and comments. A
`---` line after a statement MUST be rejected with RILL-P001.

r[frontmatter.close] Frontmatter ends at the next --- line
The block MUST end at the first later line that begins with `---`. The lines between the two
delimiters MUST NOT be read as statements.

r[frontmatter.unclosed] Frontmatter with no closing line is rejected
Frontmatter with no closing `---` line MUST be rejected with RILL-P005.

r[frontmatter.extra-dash] A closing line with more dashes is rejected
A closing line that begins with four or more dashes MUST be rejected with RILL-P023.

## Evaluation

r[frontmatter.inert] Frontmatter does not change evaluation
A script with frontmatter MUST evaluate as it would without it. Any key MAY appear, except
the removed keys of `frontmatter.removed-key`.

r[frontmatter.removed-key] The use and export keys halt
A frontmatter line whose first word is `use:` or `export:`, after optional indentation, MUST
halt with RILL-R060 before any statement runs.

## Interactions

A script of only frontmatter holds no statement (`statement.empty`). A leading BOM is skipped
before frontmatter as before any source (`source-text.bom`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A `---` line after a statement (`frontmatter.position`) | RILL-P001 | No |
| No closing `---` line (`frontmatter.unclosed`) | RILL-P005 | No |
| A closing line of four or more dashes (`frontmatter.extra-dash`) | RILL-P023 | No |
| A removed `use:` or `export:` key (`frontmatter.removed-key`) | RILL-R060 | No |

## Examples

```rill
---
model: opus
description: Capture test
---
"a" => $x
$x
# Result: "a"
```

```rill
# Error: RILL-R060
---
use: app
---
1
```

## Notes

The `use:` key is replaced by `use<module:...>`, and the `export:` key by the script's last
value. No guard can enclose frontmatter, so RILL-R060 is never caught. Which characters a
frontmatter line may hold, and what text after a delimiter on its own line means, are unstated:
see INCONSISTENCIES.md.
