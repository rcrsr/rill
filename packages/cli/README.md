# @rcrsr/rill-cli

Command-line tools for running and validating [rill](https://rill.run) scripts.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install -g @rcrsr/rill-cli
```

## Tools

### rill-exec

Execute a rill script file.

```bash
rill-exec script.rill [args...]
rill-exec -                        # read from stdin
```

Positional arguments pass to the script as `$` (pipe value):

```bash
rill-exec greet.rill alice bob
# Inside script: $ == ["alice", "bob"]
```

Read from stdin with `-`:

```bash
echo '"Hello" -> log' | rill-exec -
```

**Exit codes:**

| Return Value | Exit Code |
|-------------|-----------|
| `true` or non-empty string | 0 |
| `false` or empty string | 1 |
| `[0, "message"]` | 0 (prints message) |
| `[1, "message"]` | 1 (prints message) |

### rill-eval

Evaluate a single rill expression. No file context or module loading.

```bash
rill-eval '"hello".len'            # 5
rill-eval '5 + 3'                  # 8
rill-eval '[1, 2, 3] -> map |x|($x * 2)'  # [2, 4, 6]
```

### rill-check

Lint and validate rill scripts.

```bash
rill-check script.rill             # text output
rill-check --format json script.rill
rill-check --fix script.rill       # auto-fix
```

**Options:**

| Flag | Description |
|------|-------------|
| `--fix` | Apply automatic fixes |
| `--format text\|json` | Output format (default: text) |
| `--verbose` | Include rule category in JSON output |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | No issues |
| 1 | Diagnostics reported |
| 2 | File not found |
| 3 | Parse error |

**Configuration:** Place `.rill-check.json` in the project root:

```json
{
  "rules": {
    "NAMING_SNAKE_CASE": "on",
    "SPACING_OPERATOR": "off"
  }
}
```

Rule states: `"on"` (enabled), `"off"` (disabled), `"warn"` (downgrade to warning).

**Lint rules:** 34 rules across 9 categories (naming, anti-patterns, strings, types, flow, loops, collections, conditionals, formatting). Run `rill-check --help` for the full list.

### rill-run

Config-driven execution. Loads extensions and settings from `rill-config.json`, then runs a script or named handler.

```bash
rill-run [--config <path>] [args...]
```

**Module mode:** When `main` points to a script file, `rill-run` executes it. Positional arguments forward as `$`.

**Handler mode:** When `main` names a handler (e.g., `"script.rill:processOrder"`), parameters come from `--param_name value` flags. Run `rill-run --help` to print the parameter list.

See [CLI Reference](https://github.com/rcrsr/rill/blob/main/docs/integration-cli.md) and [Config Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-config.md) for details.

## Documentation

| Document | Description |
|----------|-------------|
| [CLI Reference](https://github.com/rcrsr/rill/blob/main/docs/integration-cli.md) | Full CLI documentation |
| [Language Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-language.md) | Language specification |
| [Conventions](https://github.com/rcrsr/rill/blob/main/docs/guide-conventions.md) | Coding style and lint rationale |

## License

MIT
