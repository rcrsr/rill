# Extensions

*Extension packages for rill*

All extensions live in separate repositories. The core `@rcrsr/rill` package provides the extension framework (types, contracts, lifecycle hooks) but ships no extension implementations.

## Extension Repositories

| Repository | Contents |
|-----------|----------|
| [rill-ext](https://github.com/rcrsr/rill-ext) | fs, fetch, exec, kv, crypto, LLM providers, vector databases, storage backends, MCP |
| [rill-agent](https://github.com/rcrsr/rill-agent) | Agent framework extensions |

## See Also

- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
- [Backend Selection](integration-backends.md) — Choosing storage backends
