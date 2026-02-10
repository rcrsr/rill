<p align="center">
  <img src="docs/assets/rill.png" alt="rill logo" width="280">
</p>

*Scripting designed for machine-generated code*

**[rill.run](https://rill.run)**

> [!WARNING]
> **This language is experimental.** While usable, there may be significant bugs. Breaking changes will occur before stabilization.

## The Problem

General-purpose languages weren't designed for machine authorship. They allow null, exceptions, implicit coercion, and ambiguous syntax — and no amount of prompting can structurally prevent an LLM from generating them.

rill makes these failure categories impossible at the language level. No null, no exceptions, no implicit coercion. Variables lock type on first assignment. The `$` prefix enables single-pass parsing without a symbol table. Errors halt — control flow is singular and explicit.

The host application controls what capabilities are available. No filesystem, no network, no side effects unless explicitly provided. Zero dependencies. Embeds in Node, Bun, Deno, or the browser.

## Why rill?

- **Structurally safe.** No null, no exceptions, no implicit coercion. Entire categories of failure are structurally impossible.
- **LLM-optimized syntax.** Ships with [EBNF grammar](docs/ref-grammar.ebnf) and [LLM reference](docs/ref-llm.txt). `$` prefix enables single-pass parsing — zero ambiguity for codegen.
- **Bounded execution.** `^(limit: N)` annotations prevent runaway loops from exhausting LLM usage budgets.
- **Sandboxed by design.** No filesystem, no network, no `eval()`. The host controls the entire function surface, not just what's blocked.
- **Embeddable.** Zero dependencies. [Integration](docs/integration-host.md) takes a few lines of code, browser or backend.

## Who Is This For?

**Developers building AI agents, copilots, and automation tools** who need a scripting runtime that LLMs can generate code for and end users can execute without risk.

rill is not a general-purpose language — it's intentionally constrained. For general application development, use TypeScript, Python, or Go.

rill powers [Claude Code Runner](https://github.com/rcrsr/claude-code-runner), a rich automation tool for Claude Code.

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createOpenAIExtension } from '@rcrsr/rill-ext-openai';

const ext = createOpenAIExtension({
  api_key: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
});

const { dispose, ...functions } = prefixFunctions('llm', ext);

const ctx = createRuntimeContext({ functions });

const result = await execute(parse(`
  llm::message("Summarize this code for issues")
    -> .content -> .contains("ERROR") ? "Issues found" ! "All clear"
`), ctx);

await dispose();
```

Switch providers by changing one line — `createAnthropicExtension` or `createGeminiExtension`. Scripts stay identical.

## Extensions

rill ships bundled extensions for major LLM providers. Integrate the ones you want to expose as functions in scripts:

| Extension | Package | Functions |
|-----------|---------|-----------|
| Anthropic | `@rcrsr/rill-ext-anthropic` | `message`, `messages`, `embed`, `embed_batch`, `tool_loop` |
| OpenAI | `@rcrsr/rill-ext-openai` | `message`, `messages`, `embed`, `embed_batch`, `tool_loop` |
| Gemini | `@rcrsr/rill-ext-gemini` | `message`, `messages`, `embed`, `embed_batch`, `tool_loop` |
| Claude Code | `@rcrsr/rill-ext-claude-code` | `prompt`, `skill`, `command` |

All LLM provider extensions share the same function signatures. Use `prefixFunctions('llm', ext)` to write provider-agnostic scripts.

See [Bundled Extensions](docs/bundled-extensions.md) for full documentation and [Developing Extensions](docs/integration-extensions.md) to write your own.

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

We asked LLMs to review rill. They had opinions.

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
| [Bundled Extensions](docs/bundled-extensions.md) | LLM provider extensions |
| [Developing Extensions](docs/integration-extensions.md) | Writing custom extensions |
| [Design Principles](docs/topic-design-principles.md) | Why rill works the way it does |

## License

MIT
