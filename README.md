<p align="center">
  <img src="docs/assets/logo.png" alt="rill logo" width="280">
</p>

*Embeddable workflow language for LLM orchestration*

> [!WARNING]
> **This language is experimental.** While usable, there may be significant bugs. Breaking changes will occur until v1.0.

## Why rill?

rill enables platform builders to make their apps scriptable without exposing arbitrary code execution.

rill solves for AI platforms what Lua solves for game engines and Liquid solves for e-commerce: safe, user-authored logic.

- **Embeddable.** Zero dependencies. Runs in browser or backend. [Integration](docs/host-integration.md) only requires a few lines of code.
- **Sandboxed.** Users can only call functions you explicitly provide. No filesystem, no network, no `eval()` disasters.
- **Bounded execution.** Retry limits prevent exhausting LLM usage limits because of runaway loops.
- **Consistent, clean syntax.** Ships with [EBNF grammar](docs/grammar.ebnf). LLMs can write rill scripts for your users.
- **Built-in LLM output parsing.** [Auto-detect](docs/parsing.md) JSON, XML, YAML, checklists.

## Who is this for?

**Platform builders** who want power users to define custom LLM workflows without hand-coding each one.

rill is not a general-purpose language and it's intentionally constrained. For general application development, you'll want TypeScript, Python, or Go.

## Quick Start

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const script = `
  prompt("Analyze this code for issues")
  .contains("ERROR") ? error($) ! "Analysis complete"
`;

const ctx = createRuntimeContext({
  functions: {
    prompt: async (args) => await callYourLLM(args[0]),
  },
});

const result = await execute(parse(script), ctx);
```

## Language Overview

### Pipes

Data flows forward through pipes. No assignment operator.

```text
prompt("analyze this code") -> $result
$result -> .trim -> log
```

### Pattern-Driven Conditionals

Branch based on content patterns. Ideal for parsing LLM output.

```text
$response -> .contains("ERROR") ? {
  error("Analysis failed")
} ! {
  $response -> process() -> log
}
```

### Bounded Loops

Retry with limits. Prevents runaway execution.

```text
# While loop with max attempts
^(limit: 5) ($task -> .contains("RETRY")) @ {
  prompt("Retrying: {$task}") -> $task
}

# For-each over collection
$files -> each {
  "Processing: {$}" -> log
}
```

### Parallel Execution

Fan out work concurrently. Results preserve order.

```text
# Parallel map
["security", "performance", "style"] -> map |aspect| {
  prompt("Review for {$aspect} issues")
}

# Parallel filter
$items -> filter { .contains("critical") }
```

### Closures

First-class functions with captured environment.

```text
|x|($x * 2) -> $double
[1, 2, 3] -> map $double    # [2, 4, 6]

# Sequential fold
5 -> @[$increment, $double] -> $result
```

### LLM Output Parsing

Built-in functions for extracting structured data from LLM responses.

```text
# Auto-detect format (JSON, XML, YAML, checklist)
prompt("Return JSON config") -> parse_auto -> $result
$result.type == "json" ? process($result.data)

# Extract XML tags (Claude-style thinking)
$response -> parse_xml("answer") -> parse_json

# Parse fenced code blocks
$response -> parse_fence("json") -> parse_json
```

### String Interpolation

Embed expressions in strings. Heredoc for multi-line.

```text
"Hello, {$name}!" -> log

prompt(<<EOF
Analyze the following code:
{$code}
Return PASS or FAIL.
EOF
) -> $verdict
```

## Core Syntax

| Syntax | Description |
|--------|-------------|
| `->` | Pipe data forward |
| `-> $var` | Capture to variable |
| `$` | Current pipe value |
| `cond ? then ! else` | Conditional branch |
| `(cond) @ { }` | While loop |
| `-> each { }` | Sequential iteration |
| `-> map { }` | Parallel map |
| `-> filter { }` | Parallel filter |
| `-> fold(init) { }` | Reduction |
| `.method()` | Method call |
| `parse_auto`, `parse_json` | LLM output parsing |

## Language Characteristics

- **Value-based.** No references. Deep copy, value comparison.
- **No null/undefined.** Empty values valid, "no value" doesn't exist.
- **No exceptions.** Singular control flow. Explicit error handling.
- **Immutable types.** Variables lock type on first assignment.
- **Transparently async.** No async/await. Parallel execution automatic.

## Use Cases

- **User-defined workflows.** Let power users script automation in your app.
- **Multi-phase pipelines.** Chain steps with review gates.
- **Parallel agent fan-out.** Launch specialists concurrently.
- **Edit-Review loops.** Iterate until approval or max attempts.

See [Examples](docs/examples.md) for complete workflow patterns.

## Documentation

| Document | Description |
|----------|-------------|
| [Guide](docs/guide.md) | Beginner introduction |
| [Reference](docs/reference.md) | Complete language specification |
| [Examples](docs/examples.md) | Workflow patterns |
| [Collections](docs/collections.md) | `each`, `map`, `filter`, `fold` |
| [Strings](docs/strings.md) | String methods |
| [Host Integration](docs/host-integration.md) | Embedding rill in applications |
| [Grammar](docs/grammar.ebnf) | Formal EBNF grammar |

## License

MIT
