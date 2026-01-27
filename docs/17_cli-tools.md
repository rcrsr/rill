# CLI Tools

rill ships three command-line tools for running and validating scripts.

## rill-exec

Execute a rill script file with arguments.

```text
rill-exec <script.rill> [args...]
rill-exec -                         # Read from stdin
rill-exec --help
rill-exec --version
```

### Arguments

Positional arguments pass to the script as a string list in `$` (pipe value).

```bash
rill-exec greet.rill alice bob
# Inside script: $ == ["alice", "bob"]
```

### Stdin

Use `-` to read a script from standard input:

```bash
echo 'log("hello")' | rill-exec -
```

### Frontmatter Modules

Scripts with `use:` frontmatter load modules before execution:

```text
---
use:
  - utils: ./lib/utils.rill
---

$utils.helper("input")
```

### Exit Codes

| Return Value | Exit Code |
|-------------|-----------|
| `true` or non-empty string | 0 |
| `false` or empty string | 1 |
| `[0, "message"]` | 0 (prints message) |
| `[1, "message"]` | 1 (prints message) |

## rill-eval

Evaluate a single rill expression. No file context or module loading.

```text
rill-eval <expression>
rill-eval --help
rill-eval --version
```

### Examples

```bash
rill-eval '"hello".len'
# 5

rill-eval '5 + 3'
# 8

rill-eval '[1, 2, 3] -> map |x|($x * 2)'
# [2, 4, 6]
```

## rill-check

Static analysis tool that validates rill scripts against lint rules.

```text
rill-check [options] <file>
```

### Options

| Flag | Description |
|------|-------------|
| `--fix` | Apply automatic fixes to the source file |
| `--format text` | Human-readable output (default) |
| `--format json` | Machine-readable JSON output |
| `--verbose` | Include rule category in JSON output |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No issues found |
| 1 | Diagnostics reported (or argument error) |
| 2 | File not found or unreadable |
| 3 | Parse error in source file |

### Output Formats

**Text** (default): one line per diagnostic.

```text
script.rill:5:3: warning: message (RULE_CODE)
```

**JSON**: structured output with summary.

```json
{
  "file": "script.rill",
  "errors": [
    {
      "location": { "line": 5, "column": 3, "offset": 42 },
      "severity": "warning",
      "code": "RULE_CODE",
      "message": "description"
    }
  ],
  "summary": { "total": 1, "errors": 0, "warnings": 1, "info": 0 }
}
```

### Configuration

Place a `.rill-check.json` file in the project root to configure rules:

```json
{
  "rules": {
    "NAMING_SNAKE_CASE": "on",
    "SPACING_OPERATOR": "off",
    "COMPLEX_CONDITION": "warn"
  },
  "severity": {
    "AVOID_REASSIGNMENT": "error"
  }
}
```

Rule states: `"on"` (enabled), `"off"` (disabled), `"warn"` (downgrade to warning).

### Lint Rules

| Code | Category | Default | Description |
|------|----------|---------|-------------|
| `NAMING_SNAKE_CASE` | naming | error | Variable names must use snake_case |
| `AVOID_REASSIGNMENT` | anti-patterns | warning | Avoid reassigning captured variables |
| `COMPLEX_CONDITION` | anti-patterns | info | Condition expression is complex |
| `LOOP_OUTER_CAPTURE` | anti-patterns | warning | Loop body captures to outer variable |
| `USE_EMPTY_METHOD` | strings | warning | Use `.empty` instead of `.len == 0` |
| `UNNECESSARY_ASSERTION` | types | info | Type assertion on a literal value |
| `VALIDATE_EXTERNAL` | types | info | External data lacks type validation |
| `CAPTURE_INLINE_CHAIN` | flow | info | Capture breaks a pipe chain |
| `CAPTURE_BEFORE_BRANCH` | flow | info | Capture value before branching |
| `LOOP_ACCUMULATOR` | loops | info | Use accumulator `$@` pattern |
| `PREFER_DO_WHILE` | loops | info | Consider do-while for init-then-loop |
| `USE_EACH` | loops | info | Use `each` instead of while loop |
| `BREAK_IN_PARALLEL` | collections | error | `break` inside `map` or `filter` |
| `PREFER_MAP` | collections | info | Use `map` when body has no side effects |
| `FOLD_INTERMEDIATES` | collections | info | `fold` discards intermediate results |
| `FILTER_NEGATION` | collections | warning | Negated filter condition |
| `METHOD_SHORTHAND` | collections | info | Use method reference shorthand |
| `USE_DEFAULT_OPERATOR` | conditionals | info | Use `??` instead of conditional |
| `CONDITION_TYPE` | conditionals | warning | Condition not boolean |
| `CLOSURE_BARE_DOLLAR` | closures | warning | Stored closure uses bare `$` |
| `CLOSURE_BRACES` | closures | info | Multi-statement closure needs braces |
| `CLOSURE_LATE_BINDING` | closures | warning | Closure captures late-bound variable |
| `SPACING_OPERATOR` | formatting | info | Operators need surrounding spaces |
| `SPACING_BRACES` | formatting | info | Braces need inner spacing |
| `SPACING_BRACKETS` | formatting | info | Brackets need consistent spacing |
| `SPACING_CLOSURE` | formatting | info | Closure params need spacing |
| `INDENT_CONTINUATION` | formatting | info | Continuation line indentation |
| `IMPLICIT_DOLLAR_METHOD` | formatting | info | Prefer implicit `$` for methods |
| `IMPLICIT_DOLLAR_FUNCTION` | formatting | info | Prefer implicit `$` for functions |
| `IMPLICIT_DOLLAR_CLOSURE` | formatting | info | Prefer implicit `$` for closures |
| `THROWAWAY_CAPTURE` | formatting | info | Captured variable never used |
