# Plan: Externalize rill-cli and rill-config

Moves `@rcrsr/rill-cli` and `@rcrsr/rill-config` from the monorepo to standalone repositories. Removes extension contract types from core.

## Motivation

The monorepo contains packages with unidirectional dependencies on core:

```
@rcrsr/rill-cli  -->  @rcrsr/rill-config  -->  @rcrsr/rill (peer)
                  -->  @rcrsr/rill (direct)
```

Core has zero reverse dependencies on CLI or config. Both packages consume the public API exclusively (no relative imports into core internals). Externalizing reduces monorepo scope to core + fiddle + web.

## Current State

### Monorepo packages (post ext-removal)

| Package | NPM Name | Dependencies on core |
|---------|----------|---------------------|
| `packages/core` | `@rcrsr/rill` | None (root) |
| `packages/cli` | `@rcrsr/rill-cli` | `@rcrsr/rill` (direct), `@rcrsr/rill-config` (direct) |
| `packages/rill-config` | `@rcrsr/rill-config` | `@rcrsr/rill` (peer) |
| `packages/fiddle` | `@rcrsr/rill-fiddle` | `@rcrsr/rill` (direct) |
| `packages/web` | `@rcrsr/rill-web` | None (static site) |

### CLI imports from core (public API only)

| Category | Symbols |
|----------|---------|
| Runtime | `parse`, `execute`, `createRuntimeContext`, `toNative`, `invokeCallable` |
| Types | `ExecutionResult`, `RuntimeOptions`, `RillValue`, `RillTuple`, `SchemeResolver` |
| Error handling | `ParseError`, `RuntimeError`, `LexerError`, `RillError`, `formatRillError` |
| AST nodes | `ASTNode`, `ConditionalNode`, `UseExprNode`, `StringLiteralNode`, etc. |
| Resolvers | `extResolver`, `moduleResolver` |
| Utilities | `isTuple`, `isScriptCallable`, `parseWithRecovery`, `ERROR_REGISTRY`, `VERSION` |

### CLI external dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| `@rcrsr/rill` | workspace:^ | Core runtime |
| `@rcrsr/rill-config` | workspace:^ | Config loading, extension mounting |
| `dotenv` | ^16.0.0 | Environment variable loading |
| `yaml` | ^2.8.2 | YAML config parsing |

### Config imports from core (peer dependency)

`@rcrsr/rill-config` uses `@rcrsr/rill` as a peer dependency. Its 12 source modules handle config parsing, validation, extension mounting, binding generation, and handler resolution. Single external dependency: `semver` (^7.7.0).

## Refactoring Steps

### Phase 1: Remove extension contracts from core

Move `KvExtensionContract` and `FsExtensionContract` from core to rill-ext. These types exist only for extension implementations, which all live in rill-ext.

**Source:** `packages/core/src/runtime/ext/extensions.ts` (lines 82-127)

**Changes in core:**
- Remove `KvExtensionContract` type (11 `ApplicationCallable` fields)
- Remove `FsExtensionContract` type (12 `ApplicationCallable` fields)
- Remove from barrel exports in `runtime/index.ts` and `src/index.ts`
- Update `docs/ref-host-api.md` to remove contract documentation

**Changes in rill-ext:**
- Define both contracts importing `ApplicationCallable` from `@rcrsr/rill`
- Dependency direction stays correct: rill-ext depends on core

**What stays in core (`extensions.ts`):**
- `ExtensionFactoryResult` -- lifecycle hooks interface
- `ExtensionFactory<TConfig>` -- factory function type
- `ConfigFieldDescriptor` -- config field metadata
- `ExtensionConfigSchema` -- config schema type
- `ExtensionManifest` -- manifest descriptor
- `emitExtensionEvent()` -- event emission utility

**What stays in core (`test-context.ts`):**
- `createTestContext()` -- used by core's own tests and consumers
- `ExtensionBindingError` -- error class

**Breaking change:** Consumers importing `KvExtensionContract` or `FsExtensionContract` from `@rcrsr/rill` must import from rill-ext instead.

### Phase 2: Create rcrsr/rill-config repository

**Repository:** `github.com/rcrsr/rill-config`

**Contents (from `packages/rill-config/src/`):**

| Module | Purpose |
|--------|---------|
| `index.ts` | Barrel exports |
| `types.ts` | Config schema types |
| `parse.ts` | Config file parsing |
| `validate.ts` | Schema validation |
| `loader.ts` | File discovery and loading |
| `project.ts` | Project resolution |
| `resolve.ts` | Path resolution |
| `resolvers.ts` | Scheme resolver wiring |
| `mounts.ts` | Extension mount configuration |
| `bindings.ts` | Extension binding generation |
| `handler.ts` | Handler mode resolution |
| `errors.ts` | Config-specific errors |

**package.json changes:**
- Change `@rcrsr/rill` from `workspace:^` to `^0.18.0` (peer + dev)
- Update repository URL to `rcrsr/rill-config`

**Monorepo changes:**
- Remove `packages/rill-config/` directory
- Remove from `pnpm-workspace.yaml`
- Update CLI dependency from `workspace:^` to published version

### Phase 3: Create rcrsr/rill-cli repository

**Repository:** `github.com/rcrsr/rill-cli`

**Contents (from `packages/cli/src/`):**

| Module | Purpose |
|--------|---------|
| `cli-exec.ts` | Script execution entry point |
| `cli-eval.ts` | Expression evaluation entry point |
| `cli-check.ts` | Lint/validation entry point |
| `cli-run.ts` | Config-driven execution entry point |
| `cli-shared.ts` | Shared CLI utilities |
| `cli-explain.ts` | Error explanation |
| `cli-error-enrichment.ts` | Error context enrichment |
| `cli-error-formatter.ts` | Error formatting |
| `cli-module-loader.ts` | Module loading |
| `cli-lsp-diagnostic.ts` | LSP diagnostic conversion |
| `check/` | Lint rule engine (34 rules, visitor, fixer) |
| `run/` | Runner infrastructure for rill-run |

**package.json changes:**
- Change `@rcrsr/rill` from `workspace:^` to `^0.18.0`
- Change `@rcrsr/rill-config` from `workspace:^` to `^0.18.0`
- Update repository URL to `rcrsr/rill-cli`

**Monorepo changes:**
- Remove `packages/cli/` directory
- Remove from `pnpm-workspace.yaml`
- Update `scripts/rill-exec.sh`, `scripts/rill-eval.sh`, `scripts/rill-check.sh` (remove or archive)

### Phase 4: Monorepo cleanup

**Remaining packages:**

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/core` | `@rcrsr/rill` | Core language runtime and parser |
| `packages/fiddle` | `@rcrsr/rill-fiddle` | Browser-based playground |
| `packages/web` | `@rcrsr/rill-web` | Documentation website |

**Documentation updates:**
- `CLAUDE.md` -- remove CLI package from table, remove wrapper script references
- `docs/index.md` -- update CLI tools link
- `docs/integration-cli.md` -- move to rill-cli repo or keep as reference
- `README.md` (root) -- update package list

**Versioning:**
- Core tracks its own semver independently
- CLI and config pin to compatible core ranges (`^0.18.0`)
- Minor version alignment rule no longer applies across repos

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking change for contract imports | Document in CHANGELOG, provide migration note |
| Cross-repo breaking changes in core API | CLI and config pin to `^major.minor`, test against core CI |
| Documentation drift | Keep `docs/integration-cli.md` in core as reference; CLI repo owns README |
| Wrapper scripts in `scripts/` stop working | Remove and document `npx @rcrsr/rill-cli` as replacement |

## Execution Order

1. Phase 1 (contracts) -- PR against rill monorepo
2. Phase 2 (rill-config) -- create repo, publish, then PR to remove from monorepo
3. Phase 3 (rill-cli) -- create repo, publish, then PR to remove from monorepo
4. Phase 4 (cleanup) -- final monorepo PR
