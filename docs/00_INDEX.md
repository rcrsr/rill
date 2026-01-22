# rill Documentation

*Pipe-based scripting for workflow orchestration*

> **Experimental (v0.0.4).** Active development. Breaking changes until v1.0.

rill is dynamically typed and type-safe. Types are checked at runtime, but type errors are always caught—no implicit conversions or coercions.

## Quick Links

| Document | Description |
|----------|-------------|
| [Guide](01_guide.md) | Beginner-friendly introduction to rill |
| [Reference](11_reference.md) | Core language specification |
| [Examples](12_examples.md) | Workflow patterns and use cases |

## Language Topics

| Topic | Description |
|-------|-------------|
| [Types](02_types.md) | Primitives, tuples, dicts, type assertions |
| [Variables](03_variables.md) | Declaration, scope rules, `$` binding |
| [Control Flow](05_control-flow.md) | Conditionals, loops, break/return |
| [Operators](04_operators.md) | Arithmetic, comparison, spread, extraction |
| [Closures](06_closures.md) | Late binding, dict-bound closures |

## Data & Collections

| Topic | Description |
|-------|-------------|
| [Collections](07_collections.md) | `each`, `map`, `filter`, `fold` operators |
| [Iterators](08_iterators.md) | Lazy sequences with `range`, `repeat`, `.first()` |
| [Strings](09_strings.md) | String methods for text manipulation |
| [Parsing](10_parsing.md) | Extract structured data from text and LLM output |

## Integration

| Topic | Description |
|-------|-------------|
| [Host Integration](14_host-integration.md) | Embedding rill in applications |
| [Modules](13_modules.md) | Convention for host-provided module systems |

## Grammar

The formal EBNF grammar is in [grammar.ebnf](15_grammar.ebnf).

## Learning Path

1. **New to rill?** Start with the [Guide](01_guide.md) for core concepts
2. **Building workflows?** See [Examples](12_examples.md) for patterns
3. **Need specifics?** Check the [Reference](11_reference.md) for syntax details
4. **Embedding rill?** Read [Host Integration](14_host-integration.md)

## Design Principles

1. **Pipes over assignment** — Data flows via `->`. No `=` operator.
2. **Type-safe** — No implicit coercion. `"5" + 1` errors, not `"51"` or `6`.
3. **No null/undefined** — Empty values are valid, but "no value" cannot be represented.
4. **Value-based** — All copies are deep, all comparisons are by value.
5. **Singular control flow** — No exceptions. Errors halt execution.
6. **Vanilla language** — Host provides all domain functions.
