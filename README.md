<p align="center">
  <img src="docs/assets/logo.png" alt="rill logo" width="280">
</p>

*The workflow language designed for LLMs*

> [!WARNING]
> **This language is experimental.** While usable, there may be significant bugs. Breaking changes will occur until v1.0.

## The Problem

Give an LLM a general-purpose language and you get unpredictable edge cases — state drift from mutable variables, runaway loops, silent misgeneration that passes a linter but fails at runtime. The more expressive the language, the more ways generated code can go wrong. LLMs don't benefit from expressiveness the way humans do. A human might prefer Python's flexibility. An LLM just needs unambiguous rules and guardrails that make wrong code unrepresentable.

Rill treats codegen reliability as a first-class design constraint. It's a language *for LLMs* that humans can read, audit, and learn — but the primary developer is meant to be an agent.

Rill solves for AI platforms what Lua solves for game engines and Liquid solves for e-commerce: safe, user-authored logic — except the "user" is increasingly an LLM.

## Why Rill?

- **Embeddable.** Zero dependencies. [Integration](docs/integration-host.md) takes a few lines of code, browser or backend.
- **Sandboxed.** No filesystem, no network, no `eval()`. The host controls the entire function surface, not just what's blocked.
- **Bounded execution.** `^(limit: N)` annotations prevent runaway loops from exhausting LLM usage budgets.
- **LLM-optimized syntax.** Ships with [EBNF grammar](docs/ref-grammar.ebnf) and [LLM reference](docs/ref-llm.txt). No ambiguity for codegen — one way to do each thing.
- **Intentionally constrained.** No null, no truthiness, sealed scopes, locked types. Removes the degrees of freedom where LLMs misgenerate.
- **Built-in LLM output parsing.** [Auto-detect](docs/topic-parsing.md) and parse JSON, XML, YAML, checklists from model responses.

## Who Is This For?

**Agentic or Workflow Platform builders** who want safe, LLM-authored workflows inside their apps.

Rill is not a general-purpose language and it's intentionally constrained. For general application development, you'll want TypeScript, Python, or Go.

Rill powers [Claude Code Runner](https://github.com/rcrsr/claude-code-runner), a rich automation tool for Claude Code.

## Quick Start

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const script = `
  prompt("Analyze this code for issues")
    -> .contains("ERROR") ? error($) ! "Analysis complete"
`;

const ctx = createRuntimeContext({
  functions: {
    prompt: {
      params: [{ name: 'message', type: 'string' }],
      fn: async (args) => await callYourLLM(args[0]),
    },
    error: {
      params: [{ name: 'message', type: 'string' }],
      fn: (args) => { throw new Error(String(args[0])); },
    },
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

`^(limit: N)` annotations prevent runaway execution. The host stays in control.

```rill
# Retry until non-empty, bail after 5 attempts
^(limit: 5) "" -> ($ == "") @ {
  app::prompt("Generate a summary")
}
```

```rill
# Bounded iteration
^(limit: 100) $items -> each { "Processing: {$}" -> log }
```

### Closures

First-class functions with captured environment.

```rill
|x| ($x * 2) => $double
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

Embed expressions in strings. Triple-quotes for multi-line.

```rill
"world" -> "Hello, {$}!" -> log  # Hello, world!
```

```rill
"x + 1" => $code
"""
Analyze: {$code}
Return: PASS or FAIL
"""
```

## Designed for LLM Codegen

These aren't arbitrary constraints — they're guardrails for reliable codegen.

| Design choice | Codegen rationale |
|---------------|-------------------|
| **No null/undefined** | Eliminates the edge cases LLMs most frequently hallucinate |
| **No truthiness** | Forces explicit boolean checks — no silent type coercion bugs |
| **Value semantics** | Deep copy, deterministic equality. Safe for serialization, caching, replay |
| **Immutable scoping** | Parent variables are read-only in child scopes. Prevents state drift across iterations |
| **`$` prefix on variables** | Single-pass parsing, no symbol table. `name()` is a host function, `$name` is a variable — zero ambiguity |
| **Type locking** | Variables lock type on first assignment. Catches type hallucinations at the assignment site |
| **Linear error handling** | No try/catch, no unwinding. `assert` and `error` are terminal — easy for models to place correctly |
| **Loops as expressions** | `fold`, `each`, `(cond) @ {}` return state instead of mutating it. Aligns with step-by-step LLM reasoning |

## What Our Target Users Say

We asked LLMs to review Rill. They had opinions.

> "Disciplined to the point of stubbornness, but in a good way. It trades familiarity for predictability."
> — ChatGPT

> "You've basically banned the most common footguns in scripting languages."
> — Gemini

> "It's possibly the first language I've seen where humans are the secondary audience."
> — Claude

## Core Syntax

| Syntax | Description |
|--------|-------------|
| `->` | Pipe data forward |
| `=>` | Capture and continue |
| `$` | Current pipe value |
| `.field` | Property access on `$` |
| `cond ? a ! b` | Conditional |
| `cond @ { }` | While loop |
| `@ { } ? cond` | Do-while loop |
| `each`, `map`, `filter` | Collection operators |
| `fold(init)` | Reduction |
| `\|args\| { }` | Closure |

## Use Cases

- **User-defined workflows.** Let power users script automation without exposing arbitrary code execution.
- **Multi-phase pipelines.** Chain LLM calls with review gates between each step.
- **Parallel agent fan-out.** Launch specialist agents concurrently, collect structured results.
- **Edit-review loops.** Iterate until approval or `^(limit: N)` max attempts.

See [Examples](docs/guide-examples.md) for complete workflow patterns.

## Documentation

See [docs/index.md](docs/index.md) for full navigation.

| Document | Description |
|----------|-------------|
| [Guide](docs/guide-getting-started.md) | Beginner introduction |
| [Reference](docs/ref-language.md) | Language specification |
| [Examples](docs/guide-examples.md) | Workflow patterns |
| [Host Integration](docs/integration-host.md) | Embedding API |
| [Design Principles](docs/topic-design-principles.md) | Why Rill works the way it does |

## License

MIT
