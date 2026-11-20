# rill CLI Tools

*Four command-line tools for running, evaluating, checking, and config-driven execution*

| Tool | Purpose |
|------|---------|
| [`rill-exec`](#rill-exec) | Execute a rill script file with positional arguments |
| [`rill-eval`](#rill-eval) | Evaluate a single rill expression (no file context) |
| [`rill-check`](#rill-check) | Static analysis and lint validation |
| [`rill-run`](#rill-run) | Config-driven execution with extensions and modules |

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

### Module Loading

`rill-exec` does not support the `module` scheme. Scripts that use `use<module:name>` require `rill-run` with a `rill-config.json` that declares module paths.

See [rill-run](#rill-run) for config-driven execution and [Modules](integration-modules.md) for the module system.

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

rill-eval '[1, 2, 3] -> fan(fn(x) { $x * 2 })'
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
| `STREAM_PRE_ITERATION` | anti-patterns | warning | Stream method called before iteration starts |
| `USE_DYNAMIC_IDENTIFIER` | anti-patterns | warning | Dynamic identifier in `use` expression |
| `USE_EMPTY_METHOD` | strings | warning | Use `.empty` instead of `.len == 0` |
| `UNNECESSARY_ASSERTION` | types | info | Type assertion on a string, number, bool, list, tuple, or dict literal that already has the asserted type |
| `USE_UNTYPED_HOST_REF` | types | warning | Untyped host reference in `use` expression |
| `VALIDATE_EXTERNAL` | types | info | External data lacks type validation |
| `TUPLE_ONE_POSITION` | types | info | `tuple(T)` names exactly one position |
| `TEMPORAL_LITERAL` | types | warning | `duration("...")` or `datetime("...")` with a string literal that cannot parse, so the call halts `#INVALID_INPUT` |
| `EQUALITY_NO_OVERLAP` | types | warning | `==`, `!=`, `.eq`, or `.ne` (operator or pipe form), or `.has`, `.has_any`, or `.has_all` on a list literal of scalar literals, between operands whose types never overlap, so the comparison halts `#TYPE_MISMATCH` |
| `PIPE_CONVERTS_INNER` | types | info | Pipe into `list(T)`, `dict(...)`, or `tuple(...)` of a statically known source with elements of another scalar kind, so `->` converts them; write `-> :T` to check without converting |
| `PIPE_ZERO_PARAM_TARGET` | closures | warning | Pipe target function with no parameters, so the call halts `RILL-R045` |
| `BLOCK_CAPTURE` | closures | warning | Bare block captured into a variable, `{ ... } => $x`, or a call on that variable when the block provably yields no function; write `fn { ... }` to store a function, or drop the braces to bind the result |
| `MIXED_ELEMENT_TYPE_READ` | types | info | `.^type` or `.^effective` read from a list literal of distinct compound shapes, or from the result of iterating a dict literal of distinct value shapes, where the read reports a union element type |
| `TYPE_EXTRA_KEY` | types | warning | Typed check, capture, or parameter on a statically known dict or ordered literal with a key the type does not name, so it halts `#TYPE_MISMATCH` or `RILL-R001` |
| `SIGNATURE_BARE_KEY` | types | warning | `.signature` compared with a string literal that spells a non-identifier key bare, so the comparison is always false (true for `!=`) |
| `ENTRIES_PAIR_AS_LIST` | types | warning | An `.entries` pair checked against `list(list)` or used with a list-only method, field read, or `-> dict`, so it halts `#TYPE_MISMATCH`, `RILL-R003`, or `RILL-R036` |
| `DISPATCH_SELECTOR_NOT_STRING` | types | warning | Dispatch table piped a number, bool, or atom selector, so it halts `#TYPE_MISMATCH` before any lookup |
| `DICT_KEY_SPELLING` | types | info | Number or bool key in a dict, ordered, or dispatch literal, stored as the string of its spelling |
| `ATOM_CASE_MISMATCH` | errors | warning | Atom differs from a builtin only by case |
| `ATOM_NOT_ERROR_CODE` | errors | warning | `.!code` compared with `==`, `!=`, `.eq`, or `.ne` (operator, method, or pipe form) to an atom that is not `#ok` or a core error code, so the comparison halts `#TYPE_MISMATCH` |
| `ATOM_DISCARDED` | anti-patterns | warning | Bare atom as a discarded statement; a comment needs a space after `#` |
| `ON_LIST_SINGLE` | errors | info | `on: list[#X]` holds one code; write `on: #X` |
| `GUARD_BARE` | errors | info | Bare `guard` catches every error |
| `GUARD_OVER_TRY_CATCH` | errors | info | Branching on `.!` is manual try/catch |
| `PRESENCE_OVER_NULL_GUARD` | errors | info | Nil-checking conditional instead of `??` |
| `RETRY_TRIVIAL` | errors | warning | `retry<limit: N>` with N <= 1 has no effect |
| `TIMEOUT_TRIVIAL` | errors | warning | `timeout<>` with no `total:` or `idle:` limit has no effect |
| `STATUS_PROBE_NO_FIELD` | errors | info | Bare `.!` only yields a boolean invalid-test, not the status record |
| `CAPTURE_INLINE_CHAIN` | flow | info | Capture breaks a pipe chain |
| `CAPTURE_BEFORE_BRANCH` | flow | info | Capture value before branching |
| `LOOP_ACCUMULATOR` | loops | info | Use accumulator `$@` pattern |
| `PREFER_DO_WHILE` | loops | info | Consider do-while for init-then-loop |
| `USE_EACH` | loops | info | Use `each` instead of while loop |
| `BREAK_IN_PARALLEL` | collections | error | `break` inside `map` or `filter` |
| `COLLECTION_ARITY` | collections | error | `seq`, `fan`, `filter`, `sort`, `start_when`, `stop_when`, `iterate`, or `chain` function that does not take exactly one argument, or `fold` or `acc` function that does not take exactly two, so the call halts `RILL-R045` (too few) or `RILL-R044` (too many required) |
| `BARE_CALLABLE_BODY` | collections | warning | Bare builtin or host name as a collection-op body is a zero-arg call, not a callable |
| `PREFER_MAP` | collections | info | Use `map` when body has no side effects |
| `FOLD_INTERMEDIATES` | collections | info | `acc` used only for its final value |
| `FILTER_NEGATION` | collections | warning | Negated filter condition |
| `METHOD_SHORTHAND` | collections | info | Use method reference shorthand |
| `USE_DEFAULT_OPERATOR` | conditionals | info | Use `??` instead of conditional |
| `CONDITION_TYPE` | conditionals | warning | Condition is a non-boolean literal |
| `DISPATCH_MISSING_MEMBER` | conditionals | warning | Dispatch table with no default piped a union of string literals, where a member has no key, so that member halts `RILL-R009` |
| `DISPATCH_FN_ENTRY` | conditionals | warning | Dispatch selects an `fn` literal entry by string, which dispatch returns uncalled; write a bare block to run it, or call the result |
| `CLOSURE_LATE_BINDING` | closures | warning | Function captures late-bound variable |
| `SPACING_OPERATOR` | formatting | info | Operators need surrounding spaces |
| `SPACING_BRACES` | formatting | info | Braces need inner spacing |
| `SPACING_BRACKETS` | formatting | info | Brackets need consistent spacing |
| `SPACING_CLOSURE` | formatting | info | Space between an opening bracket and an `fn` literal |
| `SPACING_MEMBER` | formatting | info | Member access dot must touch the field name |
| `INDENT_CONTINUATION` | formatting | info | Continuation line indentation |
| `IMPLICIT_DOLLAR_METHOD` | formatting | info | Prefer implicit `$` for methods |
| `IMPLICIT_DOLLAR_FUNCTION` | formatting | info | Prefer implicit `$` for functions |
| `IMPLICIT_DOLLAR_CLOSURE` | formatting | info | Prefer implicit `$` for function calls |
| `THROWAWAY_CAPTURE` | formatting | info | Capture unused or used once, far away |

## rill-run

Config-driven execution. Loads extensions and settings from `rill-config.json`, then runs a script or named handler.

```text
rill-run [--config <path>] [args...]
rill-run --help
rill-run --version
```

### Config Discovery

`rill-run` locates config automatically or via an explicit flag:

| Method | Behavior |
|--------|----------|
| No `--config` flag | Walks upward from the current directory looking for `rill-config.json` |
| `--config <path>` | Uses the specified file; stops directory walk |

See [Config Reference](ref-config.md) for the full `rill-config.json` format.

### Options

| Flag | Description |
|------|-------------|
| `--config <path>` | Explicit path to `rill-config.json` |
| `--help` | Show help or, when main is a handler, print parameter list with types and descriptions |
| `--version` | Show version |

### Module Mode

When the `main` field of `rill-config.json` points to a script file (e.g., `"main": "script.rill"`), `rill-run` executes that script. Positional arguments forward to the script as the pipe value `$`.

```bash
rill-run alice bob
# Inside script: $ == ["alice", "bob"]
```

### Handler Mode

When `main` names a specific handler (e.g., `"main": "script.rill:processOrder"`), `rill-run` switches to handler mode. Handler parameters come from `--param_name value` flags, not positional args.

```bash
rill-run --order_id "ORD-42" --region "us-east"
```

The handler must be annotated with parameter metadata for `rill-run` to match flags to arguments. Run `rill-run --help` to print the parameter list:

```text
Handler: processOrder (script.rill)

Parameters:
  --order_id  string   Order identifier (required)
  --region    string   Deployment region (required)
```

See [Closure Annotations](topic-closure-annotations.md) for how to annotate handler parameters.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Script or handler completed successfully |
| 1 | Script error or config error |

## See Also

| Document | Description |
|----------|-------------|
| [Config Reference](ref-config.md) | rill-config.json format and extension mounts |
| [Host Integration](integration-host.md) | Embedding API |
| [Modules](integration-modules.md) | Module convention |
| [Conventions](guide-conventions.md) | Coding style and best practices |
