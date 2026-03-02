# rill Documentation

*Scripting designed for machine-generated code*

## Quick Links

| Document | Description |
|----------|-------------|
| [Guide](guide-getting-started.md) | Beginner-friendly introduction to rill |
| [Reference](ref-language.md) | Core language specification |
| [Examples](guide-examples.md) | Workflow patterns and use cases |
| [Cookbook](cookbook.md) | Advanced agent scripting patterns |

## Language Topics

| Topic | Description |
|-------|-------------|
| [Types](topic-types.md) | Primitives, tuples, dicts, type assertions |
| [Variables](topic-variables.md) | Declaration, scope rules, `$` binding |
| [Control Flow](topic-control-flow.md) | Conditionals, loops, break/return |
| [Operators](topic-operators.md) | Arithmetic, comparison, spread, extraction |
| [Closures](topic-closures.md) | Late binding, dict-bound closures |

## Data & Collections

| Topic | Description |
|-------|-------------|
| [Collections](topic-collections.md) | `each`, `map`, `filter`, `fold` operators |
| [Iterators](topic-iterators.md) | Lazy sequences with `range`, `repeat`, `.first()` |
| [Strings](topic-strings.md) | String methods for text manipulation |

## Integration

| Topic | Description |
|-------|-------------|
| [Host Integration](integration-host.md) | Embedding rill in applications |
| [Host API Reference](ref-host-api.md) | Complete TypeScript API exports |
| [Developing Extensions](integration-extensions.md) | Writing reusable host function packages |
| [Modules](integration-modules.md) | Convention for host-provided module systems |
| [CLI Tools](integration-cli.md) | rill-exec, rill-eval, rill-check commands |
| [Creating Rill Apps](guide-make.md) | Bootstrap new rill projects |

## Agent

| Topic | Description |
|-------|-------------|
| [Harness](agent-harness.md) | Production HTTP server for rill agents |
| [Build CLI](agent-build.md) | Generate harness entry points for rill agent bundles |
| [Proxy](agent-proxy.md) | Multi-agent routing proxy for rill agent bundles |
| [Bundle CLI](agent-bundle.md) | Build agents into self-contained bundles |
| [Run CLI](agent-run.md) | Execute bundled agents from the command line |
| [Shared Types](agent-shared.md) | Shared agent types, validation, and card generation |

## Extensions

| Topic | Description |
|-------|-------------|
| [Bundled Extensions](bundled-extensions.md) | Pre-built extensions shipped with rill |

## Grammar

The formal EBNF grammar is in [grammar.ebnf](ref-grammar.ebnf).

## Style

| Topic | Description |
|-------|-------------|
| [Conventions](guide-conventions.md) | Naming, idioms, best practices |
| [Design Principles](topic-design-principles.md) | What "rillistic" means and mainstream habits to unlearn |

## Learning Path

1. **New to rill?** Start with the [Guide](guide-getting-started.md) for core concepts
2. **Building workflows?** See [Examples](guide-examples.md) for patterns
3. **Advanced patterns?** Check the [Cookbook](cookbook.md) for agent scripting patterns
4. **Need specifics?** Check the [Reference](ref-language.md) for syntax details
5. **Embedding rill?** Read [Host Integration](integration-host.md)
6. **Deploying agents?** See [Harness](agent-harness.md)
7. **Generating entry points?** See [Build CLI](agent-build.md)
8. **Routing multiple agents?** See [Proxy](agent-proxy.md)
9. **Composing from manifests?** See [Bundle CLI](agent-bundle.md)
10. **Packaging functions?** See [Extensions](integration-extensions.md)
11. **Agent-to-agent calls?** See [Developing Extensions](integration-extensions.md) for the AHI extension
12. **Using shipped extensions?** See [Extensions](bundled-extensions.md)

## Design Principles

For full design philosophy, see [Design Principles](topic-design-principles.md).
