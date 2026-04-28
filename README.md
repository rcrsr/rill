<p align="center">
  <img src="docs/assets/rill.png" alt="rill logo" width="280">
</p>

<p align="center">
  <a href="https://github.com/rcrsr/rill/actions/workflows/ci.yml"><img src="https://github.com/rcrsr/rill/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@rcrsr/rill"><img src="https://img.shields.io/npm/v/@rcrsr/rill" alt="npm"></a>
  <a href="https://www.npmjs.com/package/@rcrsr/rill"><img src="https://img.shields.io/node/v/@rcrsr/rill" alt="Node"></a>
  <a href="https://github.com/rcrsr/rill/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@rcrsr/rill" alt="License"></a>
</p>

**[rill](https://rill.run)**: *Scripting designed for machine-generated code*

> [!WARNING]
> **This language is experimental.** While usable, there may still be some warts and bugs. Breaking changes will occur before stabilization.

## The Problem

General-purpose languages weren't designed for machine authorship. They allow null, exceptions, implicit coercion, and ambiguous syntax — and no amount of prompting can structurally prevent an LLM from generating them.

rill makes these failure categories impossible at the language level. No null, no exceptions, no implicit coercion. Variables lock type on first assignment. The `$` prefix enables single-pass parsing without a symbol table. Errors halt — control flow is singular and explicit.

The host application controls what capabilities are available. No filesystem, no network, no side effects unless explicitly provided. Zero dependencies. Embeds in Node, Bun, Deno, or the browser.

## What This Looks Like

Defensive code you write because the language allows it:

```python
async def classify_and_route(task: str) -> dict:
    # Call LLM — might throw, might return None
    try:
        response = await llm.classify(task)
    except Exception as e:
        return {"error": f"Classification failed: {e}"}

    # Response might be None, might be wrong type
    if response is None:
        return {"error": "No response from classifier"}

    if not isinstance(response.category, str):
        return {"error": f"Expected string, got {type(response.category)}"}

    # Route based on category
    handlers = {
        "billing": handle_billing,
        "technical": handle_technical,
        "general": handle_general,
    }

    handler = handlers.get(response.category, handle_general)

    try:
        result = await handler(task)
    except Exception as e:
        return {"error": f"Handler failed: {e}"}

    if result is None:
        return {"error": "Handler returned None"}

    return result
```

What's left when the failure modes are structurally impossible:

```rill
# No null. No exceptions. No wrong types. If it parses, it's safe to run.

use<ext:app> => $app

$task
  -> $app.classify
  -> .category:string
  -> [
    billing:   $app.handle_billing,
    technical: $app.handle_technical,
    general:   $app.handle_general
  ] ?? $app.handle_general
  -> $($task)
```

Every defensive check in the Python maps to a failure category rill eliminates:

| Python defensive code | Why it doesn't exist in rill |
|-----------------------|------------------------------|
| `try/except` around LLM call | No exceptions. Errors halt. |
| `if response is None` | No null. Functions always return. |
| `isinstance()` type check | `:string` asserts type inline or halts. |
| `try/except` around handler | No exceptions. Errors halt. |
| `if result is None` | No null. Functions always return. |

## Why rill?

Four tenets drive every design decision:

| Tenet | Trade-off |
|-------|-----------|
| **Structural Safety over Familiarity** | No null, no exceptions, no implicit coercion. If it parses, it's safe to run. |
| **LLM Authorship over Human Ergonomics** | `$` prefix, type locking, explicit booleans. Syntax optimizes for unambiguous codegen. |
| **Host Authority over Ambient Capability** | Scripts start with zero capabilities. The host grants exactly what it intends. |
| **Halt over Recover** | No try/catch. Scripts return a complete result or an error, never partial state. |

Ships with [EBNF grammar](docs/ref-grammar.ebnf) and [LLM reference](docs/ref-llms-full.txt) (with [index](docs/ref-llms.txt) and [progressive fragments](docs/llm/)). Zero dependencies. [Embeds](docs/integration-host.md) in Node, Bun, Deno, or the browser.

## Who Is This For?

**Developers building AI agents, copilots, and automation tools** who need a scripting runtime that LLMs can generate code for and end users can execute without risk.

rill is not a general-purpose language — it's intentionally constrained. For general application development, use TypeScript, Python, or Go.

rill powers [Claude Code Runner](https://github.com/rcrsr/claude-code-runner), a rich automation tool for Claude Code.

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, extResolver } from '@rcrsr/rill';
import { createOpenAIExtension } from '@rcrsr/rill-ext-openai';

const ext = createOpenAIExtension({
  api_key: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
});

const ctx = createRuntimeContext({
  resolvers: { ext: extResolver },
  configurations: {
    resolvers: {
      ext: { llm: ext.value },
    },
  },
});

const result = await execute(parse(`
  use<ext:llm> => $llm
  $llm.message("Summarize this code for issues")
    -> .content -> .contains("ERROR") ? "Issues found" ! "All clear"
`), ctx);

await ext.dispose?.();
```

Switch providers by changing one line — `createAnthropicExtension` or `createGeminiExtension`. Scripts stay identical.

## Extensions

Core extensions ship with `@rcrsr/rill`: fs, fetch, exec, kv, crypto. Vendor extensions (LLM providers, vector databases, storage backends, MCP) live in [rill-ext](https://github.com/rcrsr/rill-ext).

See [Bundled Extensions](docs/bundled-extensions.md) for core extension docs and [Developing Extensions](docs/integration-extensions.md) to write your own.

## Related Repositories

| Repository | Description |
|------------|-------------|
| [rill-ext](https://github.com/rcrsr/rill-ext) | Vendor extensions — LLM providers, vector databases, storage backends, MCP |
| [rill-agent](https://github.com/rcrsr/rill-agent) | Agent framework — harness, bundle, proxy, build, run CLIs |
| [rill-cli](https://github.com/rcrsr/rill-cli) | CLI tools — rill-exec, rill-eval, rill-check, rill-run |
| [rill-config](https://github.com/rcrsr/rill-config) | Config library — project resolution, extension mounting |

## Language Overview

### Pattern-Driven Conditionals

Branch based on content patterns. Ideal for parsing LLM output.

```rill
use<ext:app> => $app

$app.prompt("analyze code")
  -> .contains("ERROR") ? $app.error() ! $app.process()
```

### Bounded Loops

The `do<limit: N>` construct option caps loop iterations. `seq` and `fan` enforce a built-in 10,000-iteration ceiling. The host stays in control.

```rill
# Retry until non-empty, bail after 5 attempts
use<ext:app> => $app

"" -> do<limit: 5> {
  $app.prompt("Generate a summary")
} while ($ == "")
```

```rill
# Bounded iteration
$items -> seq({ "Processing: {$}" -> log })
```

### Parallel Execution

Fan out work concurrently. Results preserve order.

```rill
# Parallel fan-out with closure
use<ext:app> => $app

["security", "performance", "style"] -> fan(|aspect| {
  $app.prompt("Review for {$aspect} issues")
})
```

```rill
# Parallel filter with method
["critical bug", "minor note", "critical fix"] -> filter({ .contains("critical") })
```

### Closures

First-class functions with captured environment.

```rill
|x| ($x * 2) => $double
[1, 2, 3] -> fan($double)  # [2, 4, 6]
5 -> $double               # 10
```

### Dataflow Syntax

Data flows forward through pipes. Host extensions are hoisted with `use<ext:name> => $var`, then invoked via dotted access.

```rill
use<ext:app> => $app

$app.prompt("analyze this code") -> .trim -> log
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
| **Loops as expressions** | `fold`, `seq`, `while (cond) do { }` return state instead of mutating it. Aligns with step-by-step LLM reasoning |

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
| `while (cond) do { }` | While loop |
| `do { } while (cond)` | Do-while loop |
| `do<limit: N> { }` | Bounded loop construct option |
| `seq`, `fan`, `filter` | Collection operator callables |
| `fold(init, body)` | Reduction |
| `acc(init, body)` | Scan (intermediate accumulator values) |
| `\|args\| { }` | Closure |

## Use Cases

- **User-defined workflows.** Let power users script automation without exposing arbitrary code execution.
- **Multi-phase pipelines.** Chain LLM calls with review gates between each step.
- **Parallel agent fan-out.** Launch specialist agents concurrently, collect structured results.
- **Edit-review loops.** Iterate until approval or `do<limit: N>` max attempts.

See [Examples](docs/guide-examples.md) for complete workflow patterns.

## Documentation

See [docs/index.md](docs/index.md) for full navigation.

| Document | Description |
|----------|-------------|
| [Guide](docs/guide-getting-started.md) | Beginner introduction |
| [Reference](docs/ref-language.md) | Language specification |
| [Examples](docs/guide-examples.md) | Workflow patterns |
| [Host Integration](docs/integration-host.md) | Embedding API |
| [Bundled Extensions](docs/bundled-extensions.md) | Core extensions (fs, fetch, exec, kv, crypto) |
| [Developing Extensions](docs/integration-extensions.md) | Writing custom extensions |
| [Design Principles](docs/topic-design-principles.md) | Why rill works the way it does |

## License

MIT
