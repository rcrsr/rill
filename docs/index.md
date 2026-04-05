# rill Documentation

*Scripting designed for machine-generated code*

## Quick Links

| Document | Description |
|----------|-------------|
| [Introduction](guide-intro.md) | What rill is, who it's for, and why it works this way |
| [Guide](guide-getting-started.md) | Beginner-friendly introduction to rill |
| [Examples](guide-examples.md) | Language features demonstrated with working code |
| [Troubleshooting](guide-troubleshooting.md) | Common mistakes and how to fix them |
| [Reference](ref-language.md) | Core language specification |

## Language Topics

| Topic | Description |
|-------|-------------|
| [Architecture](topic-architecture.md) | How source text becomes a result |
| [Types](topic-types.md) | Primitives, tuples, dicts, collections |
| [Type System](topic-type-system.md) | Structural types, type assertions, unions, type-locked variables |
| [Variables](topic-variables.md) | Declaration, scope rules, `$` binding |
| [Control Flow](topic-control-flow.md) | Conditionals, loops, break/return |
| [Operators](topic-operators.md) | Arithmetic, comparison, spread, extraction |
| [Closures](topic-closures.md) | Late binding, dict-bound closures |
| [Closure Annotations](topic-closure-annotations.md) | Parameter metadata, annotations, and reflection |

## Data & Collections

| Topic | Description |
|-------|-------------|
| [Collections](topic-collections.md) | `each`, `map`, `filter`, `fold` operators and stream iteration |
| [Iterators](topic-iterators.md) | Lazy sequences with `range`, `repeat`, `.first()`; iterator vs stream comparison |

## Reference

| Document | Description |
|----------|-------------|
| [Language Specification](ref-language.md) | Complete syntax and semantics |
| [String Methods](topic-strings.md) | String methods for text manipulation |
| [Error Reference](ref-errors.md) | All error codes with causes and resolutions |
| [Host API](ref-host-api.md) | Complete TypeScript API exports |
| [Host API Types](ref-host-api-types.md) | TypeStructure, TypeDefinition, TypeProtocol exports |
| [Config Reference](ref-config.md) | rill.config.ts options (now in [rill-config](https://github.com/rcrsr/rill-config)) |
| [Config API Reference](ref-config-api.md) | Config TypeScript API (now in [rill-config](https://github.com/rcrsr/rill-config)) |
| [Grammar](ref-grammar.ebnf) | Formal EBNF grammar |

## Integration

| Topic | Description |
|-------|-------------|
| [Host Integration](integration-host.md) | Embedding rill in applications |
| [Resolver Registration](integration-resolvers.md) | `use<scheme:resource>` imports and built-in resolvers |
| [Developing Extensions](integration-extensions.md) | Writing reusable host function packages |
| [Backend Selection](integration-backends.md) | Choosing and swapping storage backends |
| [Modules](integration-modules.md) | Convention for host-provided module systems |
| [CLI Tools](integration-cli.md) | rill-exec, rill-eval, rill-check (now in [rill-cli](https://github.com/rcrsr/rill-cli)) |
| [Creating Rill Apps](guide-make.md) | Bootstrap new rill projects |

## Extensions

| Topic | Description |
|-------|-------------|
| [Extensions](bundled-extensions.md) | Extension repositories and packages |

## Style

| Topic | Description |
|-------|-------------|
| [Conventions](guide-conventions.md) | Naming, idioms, best practices |
| [Design Principles](topic-design-principles.md) | What "rillistic" means and mainstream habits to unlearn |
| [Cookbook](cookbook.md) | Reusable design patterns for agent scripting |

## Learning Path

1. **What is rill?** Read the [Introduction](guide-intro.md)
2. **Ready to code?** Start with the [Guide](guide-getting-started.md)
3. **See it in action:** Browse [Examples](guide-examples.md) for working code
4. **Something not working?** Check [Troubleshooting](guide-troubleshooting.md)
5. **Learn the language:** Read [Types](topic-types.md), [Control Flow](topic-control-flow.md), [Closures](topic-closures.md)
6. **Go deeper:** Explore [Operators](topic-operators.md), [Collections](topic-collections.md), [Type System](topic-type-system.md)
7. **Design patterns:** Study the [Cookbook](cookbook.md)
8. **Look up syntax:** Use the [Reference](ref-language.md) and [Error Reference](ref-errors.md)
9. **Embed rill:** Read [Host Integration](integration-host.md) and [CLI Tools](integration-cli.md)
10. **Configure a project:** See [Config Reference](ref-config.md) and [Config API Reference](ref-config-api.md)
11. **Extend rill:** See [Extensions](integration-extensions.md) and [Extension Packages](bundled-extensions.md)
12. **Agent framework:** See [rill-agent](https://github.com/rcrsr/rill-agent)
13. **Extensions:** See [rill-ext](https://github.com/rcrsr/rill-ext)

## Changelog

See [CHANGELOG.md](../CHANGELOG.md) for release history and breaking changes.
