# rill — Brand Messaging

Canonical reference for all rill positioning, taglines, and copy.
Every public-facing surface (docs, landing page, npm, GitHub, brand guide) derives from this document.

---

## Core Insight

> If you know the code will be machine-generated, you can design a language that makes entire categories of failure structurally impossible.

Every message derives from this.

---

## Value Flow

All rill messaging follows this sequence. Never lead with deployment. Never lead with mechanism. Always establish the problem first.

| Step | Message | Role |
|------|---------|------|
| 1. **Problem** | General-purpose languages weren't designed for machine authorship | Why rill exists |
| 2. **Mechanism** | Safety guarantees that are structural, not conventions | How rill solves it |
| 3. **Deployment** | Embeddable, zero dependencies, runs everywhere | How you ship it |

Short-form copy (tagline, micro) may only reach step 1. That's fine — the problem is the hook. Medium copy should reach step 2. Long copy covers all three.

---

## Tagline

> Scripting designed for machine-generated code

Step 1 only. The tagline names the problem space. It doesn't need to sell the solution.

---

## Headline (landing hero, display type)

```
scripting designed
for machine-generated code
```

The second line uses the gradient accent treatment.

## Subtitle (landing hero, body type)

> If the code will be machine-generated, the language should make entire categories of failure structurally impossible. No null. No exceptions. No side effects unless the host allows them.

Steps 1 → 2. The subtitle bridges problem to mechanism.

---

## Category

**Developer Tools — Embeddable Scripting Runtime**

rill targets developers building AI agents who need a safe, embeddable runtime purpose-built for LLM-generated code.

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
They value structural guarantees over language flexibility.

### Positioning — Designed for machine authorship

General-purpose languages weren't designed with LLM generation in mind. They allow null, exceptions, side effects, and ambiguous syntax — and there's no way to structurally prevent those in generated output. rill eliminates these failure categories at the language level, not through tooling or conventions.

---

## Feature Cards (landing page)

Order follows the value flow: problem → mechanism → deployment.

1. **Built for machine authorship** — General-purpose languages leave guarantees on the table. rill was designed as a target for LLM code generation.
2. **Structurally safe** — No null, no exceptions, no implicit coercion. Entire categories of failure don't exist here.
3. **Sandboxed by design** — No filesystem, no network, no side effects unless the host allows them.
4. **Embeddable runtime** — Zero dependencies. Runs in Node, Bun, Deno, or the browser.

Card 1 is the problem. Card 2 is the mechanism. Cards 3–4 are deployment. Syntax ("natural dataflow") can appear in docs and longer content but doesn't need a feature card — it's a property of the solution, not a reason to adopt.

---

## Description (canonical, by length)

**Micro (under 10 words)** — Problem only.
> Scripting designed for machine-generated code.

**Short (under 30 words)** — Problem → mechanism.
> rill is a scripting language designed as a target for LLM code generation. No null, no exceptions, no side effects — entire categories of failure are structurally impossible.

**Medium (under 50 words)** — Problem → mechanism → deployment.
> General-purpose languages weren't designed for machine authorship — they allow null, exceptions, and side effects that no amount of prompting can structurally prevent. rill eliminates these failure categories at the language level. The host application controls what capabilities are available. Zero dependencies. Runs in Node, Bun, Deno, or the browser.

**Long (under 100 words)** — Problem → mechanism → deployment, with proof.
> General-purpose languages weren't built for machine authorship. They allow null, exceptions, implicit coercion, and ambiguous syntax — and no amount of prompting can structurally prevent an LLM from generating them. rill is a scripting language designed to make these failure categories impossible at the language level. The `$` prefix enables single-pass parsing without a symbol table. Variables lock to their first type. The host application controls exactly what capabilities are available — no filesystem, no network, no side effects unless explicitly provided. Dataflow syntax makes generated code readable and auditable. Zero dependencies. Embeds in Node, Bun, Deno, or the browser.

---

## Proof Points

Why the design claims are credible — use these to substantiate the core insight in blog posts, talks, and longer-form content.

| Claim | Mechanism |
|-------|-----------|
| LLMs generate correct code without a symbol table | `$` prefix disambiguates variables, functions, closures, and dict keys syntactically |
| Null-related failures are impossible | No null/undefined in the type system. Empty values exist; absent values don't |
| Exception-related failures are impossible | No try/catch. Errors halt. Control flow is singular and explicit |
| Side effects require host consent | No built-in I/O. All capabilities are host functions mapped into the runtime |
| Generated code is auditable | Pipe chains show data flow left-to-right. No hidden state, no implicit coercion |
| Type errors are caught at assignment | Variables lock to first assigned type. No coercion, no gradual typing surprises |
| Runaway execution is impossible | Loops are bounded by default (10,000 iterations). Override requires explicit `^(limit: N)` |

---

## Voice Rules

- Always lowercase "rill" in running text.
- **Follow the value flow: problem → mechanism → deployment.** Never lead with embedding or sandbox. Always establish why general-purpose languages are insufficient first.
- The pipe operator `->` is a visual identity element and feature, not the headline message.
- "Sandboxed" means: no capabilities unless the host grants them. It supports the mechanism but is not the problem statement.
- Audience is the developer building the host app, not the end user writing rill.
- Avoid "workflow orchestration" as a primary descriptor. Use "AI agents" or "agentic apps."
- Avoid "pipe-based" as a descriptor. Pipes are a syntax detail, not a benefit. Use "dataflow syntax" if referencing the paradigm.
- Don't disparage LLM code quality. The framing is: general-purpose languages leave guarantees on the table, not that LLMs are bad at coding.
- "Structurally impossible" is the key phrase. Safety isn't a best practice or a linter rule — it's a property of the language.