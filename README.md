<p align="center">
  <img src="docs/assets/logo.png" alt="rill logo" width="280">
</p>

*Embeddable workflow language for LLM orchestration*

> [!WARNING]
> **This language is experimental.** While usable, there may be significant bugs. Breaking changes will occur until v1.0.

## Why rill?

rill enables platform builders to make their apps scriptable without exposing arbitrary code execution.

rill solves for AI platforms what Lua solves for game engines and Liquid solves for e-commerce: safe, user-authored logic.

- **Embeddable.** Zero dependencies. Runs in browser or backend. [Integration](docs/14_host-integration.md) only requires a few lines of code.
- **Sandboxed.** Users can only call functions you explicitly provide. No filesystem, no network, no `eval()` disasters.
- **Bounded execution.** Retry limits prevent exhausting LLM usage limits because of runaway loops.
- **Consistent, clean syntax.** Ships with [EBNF grammar](docs/15_grammar.ebnf). LLMs can write rill scripts for your users.
- **Built-in LLM output parsing.** [Auto-detect](docs/10_parsing.md) JSON, XML, YAML, checklists.

## Who is this for?

**Platform builders** who want power users to define custom LLM workflows without hand-coding each one.

rill is not a general-purpose language and it's intentionally constrained. For general application development, you'll want TypeScript, Python, or Go.

## Quick Start

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const script = `
  prompt("Analyze this code for issues")
    -> .contains("ERROR") ? error($) ! "Analysis complete"
`;

const ctx = createRuntimeContext({
  functions: {
    prompt: async (args) => await callYourLLM(args[0]),
    error: (args) => { throw new Error(String(args[0])); },
  },
});

const result = await execute(parse(script), ctx);
```

## Language Overview

### Pipes

Data flows forward through pipes (`app::*` denotes an application-specific host function call).

```rill
app::prompt("analyze this code") -> .trim -> log
```

### Pattern-Driven Conditionals

Branch based on content patterns. Ideal for parsing LLM output.

```rill
app::prompt("analyze code")
  -> .contains("ERROR") ? app::error() ! app::process()
```

### Bounded Loops

Retry with limits. Prevents runaway execution.

```rill
# While loop: condition @ body
0 -> ($ < 3) @ { $ + 1 }  # Result: 3
```

```rill
# Iteration with each
["a.txt", "b.txt"] -> each { "Processing: {$}" -> log }
```

### Closures

First-class functions with captured environment.

```rill
|x| ($x * 2) :> $double
[1, 2, 3] -> map $double  # [2, 4, 6]
5 -> $double              # 10
```

### Parallel Execution

Fan out work concurrently. Results preserve order.

```rill
# Parallel map with closure
["security", "performance", "style"] -> map |aspect| {
  app::prompt("Review for {$aspect} issues")
}
```

```rill
# Parallel filter with method
["critical bug", "minor note", "critical fix"] -> filter .contains("critical")
```

### LLM Output Parsing

Built-in functions for extracting structured data from LLM responses.

```rill
# Auto-detect format (JSON, XML, YAML, checklist)
"[1, 2, 3]" -> parse_auto -> .data  # [1, 2, 3]
```

```rill
# Extract fenced code blocks
"```json\n[1,2]\n```" -> parse_fence("json") -> parse_json
```

```rill
# Extract XML tags
"<answer>42</answer>" -> parse_xml("answer")  # "42"
```

### String Interpolation

Embed expressions in strings. Heredoc for multi-line.

```rill
"world" -> "Hello, {$}!" -> log  # Hello, world!
```

```rill
"x + 1" :> $code
<<EOF
Analyze: {$code}
Return: PASS or FAIL
EOF
```

## Core Syntax

| Syntax | Description |
|--------|-------------|
| `->` | Pipe data forward |
| `:>` | Capture and continue |
| `$` | Current pipe value |
| `.field` | Property access on `$` |
| `cond ? a ! b` | Conditional |
| `cond @ { }` | While loop |
| `each`, `map`, `filter` | Collection operators |
| `fold(init)` | Reduction |
| `parse_auto` | LLM output parsing |

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

See [docs/00_INDEX.md](docs/00_INDEX.md) for full navigation.

| Document | Description |
|----------|-------------|
| [Guide](docs/01_guide.md) | Beginner introduction |
| [Reference](docs/11_reference.md) | Language specification |
| [Examples](docs/12_examples.md) | Workflow patterns |
| [Host Integration](docs/14_host-integration.md) | Embedding API |

## License

MIT
