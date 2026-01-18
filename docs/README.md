# rill Documentation

*Pipe-based scripting for workflow orchestration*

> **Experimental (v0.0.1).** Active development. Breaking changes until v1.0.

## Quick Links

| Document | Description |
|----------|-------------|
| [Guide](guide.md) | Beginner-friendly introduction to rill |
| [Reference](reference.md) | Core language specification |
| [Examples](examples.md) | Workflow patterns and use cases |

## Topic Guides

| Topic | Description |
|-------|-------------|
| [Collections](collections.md) | `each`, `map`, `filter`, `fold` operators |
| [Iterators](iterators.md) | Lazy sequences with `range`, `repeat`, `.first()` |
| [Strings](strings.md) | String methods for text manipulation |
| [Host Integration](host-integration.md) | Embedding rill in applications |
| [Modules](modules.md) | Convention for host-provided module systems |

## Grammar

The formal EBNF grammar is in [grammar.ebnf](grammar.ebnf).

## Learning Path

1. **New to rill?** Start with the [Guide](guide.md) for core concepts
2. **Building workflows?** See [Examples](examples.md) for patterns
3. **Need specifics?** Check the [Reference](reference.md) for syntax details
4. **Embedding rill?** Read [Host Integration](host-integration.md)

## Design Principles

1. **Pipes over assignment** — Data flows via `->`. No `=` operator.
2. **No null/undefined** — Empty values are valid, but "no value" cannot be represented.
3. **Value-based** — All copies are deep, all comparisons are by value.
4. **Singular control flow** — No exceptions. Errors halt execution.
5. **Vanilla language** — Host provides all domain functions.
