# rill — Brand Messaging

Canonical reference for all rill positioning, taglines, and copy.
Every public-facing surface (docs, landing page, npm, GitHub, brand guide) derives from this document.

---

## Tagline

> Embeddable, sandboxed scripting to power AI agents

Use this as the primary one-liner everywhere: package.json, npm, GitHub description, doc headers, meta tags.

---

## Headline (landing hero, display type)

```
embeddable, sandboxed scripting
to power AI agents
```

The second line uses the gradient accent treatment.

## Subtitle (landing hero, body type)

> Give your agents a language they can write in and users can run without risk.
> Type-safe, no null, no exceptions — safe by design.

---

## Category

**Developer Tools — Embeddable Scripting Runtime**

rill targets developers building AI agents who need a safe runtime for generated code.

---

## Identity Cards

### Core Metaphor — Data in motion

The rill brand embodies continuous flow.
The logo's forward-leaning parallelograms suggest momentum — data entering from the left, transforming through each stage, emerging on the right.
The neon spectrum traces this journey visually.

### Brand Personality — Precise & luminous

rill speaks with technical precision and visual clarity.
No weasel words. No ambiguity.
The neon-on-void aesthetic makes every element intentional and legible.
The brand feels like a well-lit terminal at 2 AM — focused, energized, alive.

### Audience — Agent developers

Developers building AI agents, copilots, and automation tools.
They need a scripting runtime that LLMs can generate code for and end users can execute without risk.
They value safety guarantees over language flexibility.

### Positioning — Sandboxed by design

Where other runtimes require sandboxing after the fact, rill has no filesystem access, no network access, no side effects unless the host explicitly provides them.
Safety is the default, not a configuration option.

---

## Feature Cards (landing page)

1. **Sandboxed by design** — No filesystem, no network, no side effects unless the host allows them.
2. **Built for agents** — Safe to execute LLM-generated code. Type-checked, no null, no exceptions.
3. **Embeddable runtime** — Zero dependencies. Runs in Node, Bun, Deno, or the browser.
4. **Natural dataflow syntax** — Expressions chain naturally. Code reads like the data transformation it describes.

---

## Description (canonical, by length)

**Micro (under 10 words)**
> Sandboxed scripting to power AI agents.

**Short (under 30 words)**
> rill is an embeddable, sandboxed scripting language to power AI agents. No null, no exceptions, no side effects unless the host allows them.

**Medium (under 50 words)**
> rill is an embeddable, sandboxed scripting language designed for AI agents. Host applications embed the runtime and control what capabilities are available — no filesystem, no network, no side effects by default. The language eliminates null, exceptions, and implicit coercion. Dataflow syntax makes code read like the transformation it describes.

**Long (under 100 words)**
> rill is an embeddable, sandboxed scripting language designed for AI agents. It gives LLMs a language they can generate code for and end users can execute without risk. The host application embeds the rill runtime and controls exactly what capabilities are available — no filesystem access, no network access, no side effects unless explicitly provided. The language eliminates null, exceptions, and implicit type coercion at the design level. Dataflow syntax makes code read like the transformation it describes. rill has zero dependencies and runs in Node, Bun, Deno, or the browser.

---

## Voice Rules

- Always lowercase "rill" in running text.
- Lead with safety and embedding, not syntax.
- The pipe operator `->` is a visual identity element and feature, not the headline message.
- "Sandboxed" means: no capabilities unless the host grants them.
- Audience is the developer building the host app, not the end user writing rill.
- Avoid "workflow orchestration" as a primary descriptor. Use "AI agents" or "agentic apps."
- Avoid "pipe-based" as a descriptor. Pipes are a syntax detail, not a benefit. Use "dataflow syntax" if referencing the paradigm.
