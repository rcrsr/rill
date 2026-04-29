# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Stream slicing and restructuring** — Seven new collection operators (`take`, `skip`, `cycle`, `batch`, `window`, `start_when`, `stop_when`) slice, repeat, and resegment streams with declarative control
- **`pass<>` body form** — Pipe-optional side-effect blocks for logging, metrics, or notifications with optional error suppression via `pass<suppress>`

## [0.19.1] - 2026-04-28

### Added

- **Pipe operator refinement** — Pipe now places values at explicit `$` positions when present, falling back to auto-prepend for traditional left-to-right flows
- **`sort` built-in for data ordering** — Provides stable ordering for lists and dicts with optional key-extractor closure
- **Tuple lexicographic comparison** — Tuples support comparison operators for ordering tuples by element sequence
- **List `.reverse` method** — Reverses list order for descending-value patterns and collection manipulation

## [0.19.0] - 2026-04-26

### Breaking Changes

- **`retry` syntax now requires `limit:` named argument** — `retry<N>` is a parse error; use `retry<limit: N>`. Likewise `retry<N, on: list[...]>` becomes `retry<limit: N, on: list[...]>`.

- **Collection operators are callables, not keywords** — `each`, `map`, `fold`, `filter` are no longer reserved keywords. Five callable builtins replace them; scripts using the keyword forms must migrate.

  | Old keyword form | New callable form | Behaviour |
  |---|---|---|
  | `list -> each { body }` | `list -> seq({ body })` | Sequential; catches `break`; returns partial list |
  | `list -> map { body }` | `list -> fan({ body }, [concurrency: N])` | Parallel; does not catch `break`; returns all results |
  | `list -> fold(init) { body }` | `list -> fold(init, { body })` | Sequential reduction; returns final accumulator |
  | `list -> filter { body }` | `list -> filter({ body }, [concurrency: N])` | Parallel predicate filter; returns matching elements |
  | `list -> each(init) { body }` | `list -> acc(init, { body })` | Sequential scan; catches `break`; returns intermediate accumulators |

  Host integrators: `EachExprNode`, `MapExprNode`, `FoldExprNode`, `FilterExprNode` are removed from the AST union; `EACH`, `MAP`, `FOLD`, `FILTER` are removed from the token type set; `packages/core/src/parser/parser-collect.ts` is deleted.

- **Loop syntax unified under `while`/`do`** — The `@` loop operator is removed.

  | Old form | New form |
  |---|---|
  | `(cond) @ { body }` | `while (cond) do { body }` |
  | `@ { body } ? (cond)` | `do { body } while (cond)` |
  | `^(limit: N) @ { body }` | `do<limit: N> { body }` |

  RILL-R079 (`@` pre-loop), RILL-R080 (`@` post-loop), and RILL-R081 (`^(limit: N)` outside loop) report the exact source location and required replacement at parse time.

- **Two-type anonymous closure syntax** — `|type1, type2|{ body }` synthesizes `$` (bound to `type1`) and `$@` (bound to `type2`). Used by `fold` and `acc` to receive accumulator and element:

  ```rill
  list -> fold(0, |number, string|{ $ + $@->number })
  ```

- **`:code` primitive renamed to `:atom`** — Scripts using `:code` annotations must migrate to `:atom`. Host API exports renamed: `RillCode` → `RillAtom`, `RillCodeValue` → `RillAtomValue`, `isCode` → `isAtom`. Sidecar field access (`.!code`) is unchanged.

- **Type conversion uses `->`, `:>` removed** — Conversions now use the pipe form (`"42" -> number`, `dict -> ordered(name: string)`). Type values bound to variables work with pipes: `number => $t; "42" -> $t`.

- **Halt errors surface as `RuntimeHaltSignal` only** — Code catching `AbortError` or `AutoExceptionError` must migrate to `instanceof RuntimeHaltSignal` with `getStatus()` or `atomName()` for differentiation.

- **`ExtensionFactory<TConfig>` takes a context parameter** — Signature changes from `(config) => ExtensionFactoryResult` to `(config, ctx: ExtensionFactoryCtx) => ExtensionFactoryResult`. Factories that don't use `ctx` must still accept the parameter.

  ```typescript
  const factory: ExtensionFactory<MyConfig> = (config, ctx) => {
    const client = createClient(config, { signal: ctx.signal });
    return {
      value: buildValue(client),
      dispose: () => client.close(),
    };
  };
  ```

### Added

- **`:atom` literal syntax (`#NAME`)** — Uppercase-named atoms produce `:atom` values directly in source (`#NOT_FOUND`, `#TIMEOUT`). Composes with `guard`, `retry`, and `.!`.
- **`guard { body }`** — Catches operational halts inside `body`, substituting an invalid value with a `guard-caught` trace frame. Does not catch `error "..."` or `assert`.
- **`retry<limit: N> { body }`** — Executes `body` up to N times, retrying on operational halt. Returns the first success or an invalid value with N `guard-caught` frames when exhausted.
- **Status probe operator `.!`** — `.!` returns `false` for valid values and `true` for invalid values without halting. `.!code` reads the atom code from the status sidecar (e.g., `#TIMEOUT`, `#ok`). See [Error Handling](docs/topic-error-handling.md).
- **Presence check operator `.?field`** — `$x.?field` returns `true` if the field exists, `false` otherwise, without halting. Composes with `??` for fallback values.
- **Three new generic atoms pre-registered in core** — `#FORBIDDEN` (HTTP 403, OAuth scope mismatch, content-filter block; distinct from `#AUTH`), `#QUOTA_EXCEEDED` (account-level resource exhaustion; distinct from `#RATE_LIMIT`), and `#PROTOCOL` (response shape violates documented contract; distinct from `#UNAVAILABLE`). Available without explicit `ctx.registerErrorCode` registration; host scripts match via filtered guard (`guard<on: list[#FORBIDDEN]> { ... }`) or by branching on `$result.!code`.
- **Host API: error and lifecycle hooks**
  - `ctx.invalidate(error, meta)` — wraps a thrown JavaScript value as a rill invalid carrying an atom code and metadata
  - `ctx.catch<T>(thunk, detector)` — runs `thunk`, mapping any throw via `detector` to a `RillValue` invalid; unmapped throws produce `#R999` with `raw.original`
  - `ctx.registerErrorCode(name, kind)` on `ExtensionFactoryCtx` — registers atoms at factory-init time; throws on duplicate-with-different-kind or regex failure
  - `ctx.signal` — `AbortSignal | undefined` on `RuntimeContext` (threaded from `runOptions`); non-optional on `ExtensionFactoryCtx`, scoped to the extension's lifetime
  - `ExtensionFactoryCtx` type — exported from `@rcrsr/rill`, provides `registerErrorCode` and `signal`
  - `dispose()` — optional cleanup function returned in `ExtensionFactoryResult`, invoked when the runtime tears down the extension
- **`ControlSignal` base class** — Break/return/yield signals share a base distinct from halt errors, so host catches can differentiate via `instanceof`.

### Changed

- **`RuntimeContext` partitioned into six facade interfaces** — Host functions can type-narrow to the slice they need (scope, dispatch, lifecycle, control flow, resolver, metadata) instead of accepting the full context.
- **Cross-mixin evaluator dispatch is typed** — Mixins call peers through a generated `EvaluatorInterface`, eliminating `(this as any).method(...)` at hot paths.
- **`parser-expr.ts` precedence helpers extracted** — Five precedence functions share a `parseBinaryExprChain(nextParser, opTokens, opMap)` helper; collection/closure-start detection moved to dispatch tables.
- **Error registry has a single source of truth** — `ERROR_IDS` (hyphen form) and `ERROR_ATOMS` (underscore atom form) replace ~559 inline magic-string error-id literals across the runtime; `BinaryOp` characters lift to `BINARY_OPS`.
- **`error "..."` preserves interpolated content** — Wrap trace frames now carry the evaluated message string at runtime.

## [0.18.6] - 2026-04-17

### Added

- **Host context bag** — `hostContext: Record<string, unknown>` on `RuntimeOptions` and `RuntimeContext` allows hosts to pass arbitrary values (functions, objects) to extensions at call time
- **Parser primitives exposed** — `parseTypeRef`, `createParserState`, and `ParserState` re-exported from `@rcrsr/rill` top-level for host-side type-ref parsing

### Fixed

- **Datetime and duration parameter matching** — `structureMatches` now handles `{ kind: 'datetime' }` and `{ kind: 'duration' }` type descriptors. Previously both fell through to `return false`, causing host-declared datetime/duration params (e.g. in `@rcrsr/rill-ext-datetime`) to always fail with the paradoxical "expects datetime, got datetime" error

## [0.18.5] - 2026-04-06

### Added

- **Static handler introspection** — `introspectHandlerFromAST()` extracts handler parameter metadata (names, types, defaults, descriptions) from a parsed AST without executing the script
- **Multi-line string highlighting** — Triple-quoted `"""` strings highlight correctly across line boundaries in the fiddle editor
- **Type name highlighting** — Built-in type names (`string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`, `ordered`, `vector`, `any`, `type`, `iterator`, `stream`, `datetime`, `duration`) render as purple (#a78bfa) instead of variable blue
- **String interpolation sub-highlighting** — Expressions inside `{...}` within strings get syntax-colored tokens (variables, operators, numbers) instead of flat green
- **Method name highlighting** — Identifiers after `.` and `.?` render as purple (#a78bfa) via new `METHOD_NAME` token type and `functionName` highlight category

## [0.18.4] - 2026-04-05

### Removed

- **CLI and config packages** — `@rcrsr/rill-cli` and `@rcrsr/rill-config` moved to [rill-cli](https://github.com/rcrsr/rill-cli) and [rill-config](https://github.com/rcrsr/rill-config)
- **Extension contract types** — `KvExtensionContract` and `FsExtensionContract` removed from `@rcrsr/rill`. Import from `@rcrsr/rill-ext-kv` and `@rcrsr/rill-ext-fs` instead

### Changed

- **TypeScript 6** — Upgraded from 5.9.3 to 6.0.2. Added explicit `"types": ["node"]` to `tsconfig.base.json` (TS6 no longer auto-includes `@types/*` packages)
- **Vite 8** — Upgraded from 7.3.1 to 8.0.3. Converted `manualChunks` from object to function syntax for Rolldown compatibility
- **@vitejs/plugin-react 6** — Upgraded from 5.1.4 to 6.0.1
- **vitest 4.1** — Upgraded from 4.0.18 to 4.1.2 (with matching @vitest/coverage-v8)
- **eslint 10.2** — Upgraded from 10.0.2 to 10.2.0 (with @typescript-eslint 8.58.0)
- **CodeMirror packages** — @codemirror/state 6.6.0, @codemirror/view 6.41.0, commands 6.10.3, language 6.12.3
- **Tailwind CSS 4.2.2** — Upgraded tailwindcss and @tailwindcss/vite from 4.2.1
- **Patch updates** — @types/node 25.5.2, happy-dom 20.8.9, yaml 2.8.3

## [0.18.3] - 2026-04-04

### Added

- **Dict field annotations** — Type constructor fields in dict, ordered, and tuple declarations support inline `^()` annotations for field-level metadata without external mappings

### Removed

- **Bundled extensions** — `fs`, `fetch`, `exec`, `kv`, and `crypto` extensions removed from `@rcrsr/rill` sub-path exports. Install from [rill-ext](https://github.com/rcrsr/rill-ext) packages instead


## [0.18.2] - 2026-04-04

### Added

- **Datetime and duration types** — `datetime` and `duration` types enable time-aware programming with constructors, arithmetic, comparison operators, and properties. `now()` returns current UTC time. Set `nowMs` in context for deterministic testing, and `timezone` for local-time properties

### Fixed

- **rill-run: handler mode drops positional args** — Handler mode set args as pipeValue but passed empty positional args to `invokeCallable`. Closures with explicit params nullify pipeValue, causing RILL-R044. Args now map to positional params in order, preserving optional param defaults
- **rill-check: CLOSURE_BARE_DOLLAR false positive on nested pipe scopes** — The rule flagged `$` references inside `filter`, `map`, `each` blocks and nested closures within stored closures. Now tracks scope depth across all pipe-rebinding node types

## [0.18.1] - 2026-04-03

### Fixed

- **Config: resolve locally installed extensions** — `resolveSpecifier` now uses `createRequire` from `node:module` to resolve bare npm specifiers from the project directory. Global rill-cli installations can find extension packages in the project's `node_modules/`
- **Container string quoting** — String values nested in dict, list, tuple, and ordered containers display with quotes for unambiguous output
- **Landing page extension links** — Vendor extension chips link to the rill-ext repository
- **rill-check: SPACING_BRACES false positive on closures with return type annotations** — Closure nodes with `:type` annotations extend `span.end` past `}`. The rule now uses `body.span.end` for closures to find the actual brace position
- **rill-check: CLOSURE_LATE_BINDING false positive on named parameter each loops** — The rule counted the body closure itself as a nested closure creation. Now unwraps `|param| { ... }` to check only the inner block
- **rill-check: PREFER_MAP false positive on each loops with side effects** — The rule suggested `map` for all `each` without accumulators. Now detects host calls (`log`) and closure calls (`$fn()`) as side effects
- **rill-run: handler mode drops non-string results** — Handler mode only printed strings, silently dropping dicts, lists, and numbers. Now uses `formatOutput` for consistent output across handler and module modes

## [0.18.0] - 2026-03-17

### Added

- **Stream collection type** — Streams enable lazy, producer-based collections that yield values on demand. Supports standard collection operators (`each`, `map`, `filter`, `fold`) and full type reflection
- **Closure parameter defaults** — Closure annotation parameters can now specify literal default values, allowing callers to omit arguments

### Changed

- **fs extension: mount-prefixed paths** — All fs functions use a single `/mount/path` argument instead of separate `mount` and `path` parameters. Paths start with `/` followed by the mount name (e.g., `fs.read("/workspace/file.txt")`)
- **fs extension: typed return values** — `stat` returns `dict{name, type, size, created, modified}`, `list` returns `list[dict{name, type, size}]`, `find` returns `list[string]`
- **Standardized runtime error codes** — All runtime errors now use typed error codes (RILL-R064-R077) instead of raw exception messages

### Removed

- **`RillType`** — Use `TypeStructure` instead
- **`formatStructuralType`** — Use `formatStructure` instead
- **`inferStructuralType`** — Use `inferStructure` instead
- **`structuralTypeEquals`** — Use `structureEquals` instead
- **`structuralTypeMatches`** — Use `structureMatches` instead
- **`isRillIterator`** — Use `isIterator` instead
- **`rillTypeToTypeValue`** — Use `structureToTypeValue` instead

See the [0.18.0 migration guide](docs/ref-host-api-types.md#migration-0180-renamed-exports) for the full symbol mapping table and update instructions.

## [0.17.0] - 2026-03-16

### Breaking Changes

- **Core type API renamed** — `RillType` → `TypeStructure`, discriminator `.type` → `.kind`. 9 functions renamed: `inferStructure`, `structureToTypeValue`, `formatStructure`, `structureEquals`, `structureMatches`, `isIterator`, `serializeValue`, `copyValue`. `RillStructuralType` alias removed
- **`buildTypeMethodDicts` and `VALID_TYPE_NAMES` removed from public API** — Internal helpers no longer exported
- **`true > false` raises RILL-R002** — Boolean ordering now errors instead of coercing
- **`LlmExtensionContract` and `VectorExtensionContract` removed** — Vendor-specific contracts removed from core exports. Extensions mount arbitrary value structures
- **`bindings` field removed from config** — `ExtensionsBlock.bindings` and `ContextBlock.bindings` config fields removed
- **`module:ext` and `module:context` no longer built-in** — Module resolver uses folder aliasing with no defaults. Configure `"modules": { "bindings": "./bindings" }` and use `use<module:bindings.ext>`
- **`--create-bindings` takes optional `[dir]`** — Changed from boolean flag to optional string. Defaults to `./bindings` relative to config file directory
- **`buildResolvers` signature changed** — `extensionBindings` and `contextBindings` parameters removed
- **`runScript` and `buildModuleResolver` signatures changed** — `bindingsSrc` and `extTree` parameters removed from CLI runner functions

### Added

- **`TypeDefinition` and `TypeProtocol` type exports** — New types for host type definitions and operation registration
- **`TypeStructure` catch-all variant** — `{ kind: string; data?: unknown }` for forward compatibility
- **`deserializeValue` function** — Typed deserialization of serialized rill values
- **Module folder aliasing** — `modules` config maps aliases to directories. `module:alias.sub.path` resolves to `{dir}/sub/path.rill`

### Changed

- **Type dispatch via registration protocol** — Type operations use a registration-based protocol system
- **Extension factories mount arbitrary values** — Extensions mount dicts, scalars, and lists instead of only flat function maps

## [0.16.0] - 2026-03-14

### Added

- **Uniform value types for `dict`, `ordered`, and `tuple`** — `dict(T)`, `ordered(T)`, and `tuple(T)` constrain all values to a single type; `tuple(T)` single-arg syntax is now a breaking change from 1-element structural form
- **List literal type inference** — List literals with same-compound-type elements now infer the bare compound type instead of throwing an error
- **`commonType` function export** — New function exported from `@rcrsr/rill` for host applications to compute common types across values
- **`RillFieldDef` type export** — Unified field definition type exported from `@rcrsr/rill` for dict, tuple, ordered, and closure types. Replaces `RillFieldType`
- **`hasCollectionFields` and `emptyForType` utilities** — Internal helpers for detecting collection types with defined fields and creating empty collection seeds

### Changed (Breaking)

- **`tuple(T)` single-arg form repurposed** — `tuple(T)` with a single positional argument now defines a uniform value type (all entries match T), not a 1-element structural tuple. Use `tuple(T1, T2)` with 2+ positional arguments for structural tuples with specific element types.
- **`RillType` union members** — Dict, tuple, ordered, and closure field shapes now use `RillFieldDef` instead of positional tuples and `RillFieldType`. Extensions reading type structure must update
- **`RillFieldDescriptor.fieldType`** — Property type changed from `RillFieldType` to `RillFieldDef`
- **`paramToTypeTuple` renamed to `paramToFieldDef`** — Returns a `RillFieldDef` object instead of a positional tuple. Callers must update function name and destructuring

### Removed (Breaking)

- **`RillFieldType` type alias** — Removed from public exports. Use `RillFieldDef` instead
- **`isFieldTypeWithDefault` guard function** — Removed from public exports. Use `field.defaultValue !== undefined` instead

### Changed

- **Type constructor argument defaults** — Type constructor arguments now support default values from all parsing contexts, enabling defaults in annotation and expression positions

### Fixed

- **Nested default synthesis for collection-typed fields** — Missing fields whose type is a collection with all-defaulted children are synthesized by seeding an empty collection and hydrating. `dict[a: 1] -> :>dict(a: number, b: dict(c: number = 5))` produces `{a: 1, b: {c: 5}}`
- **Explicit collection defaults hydrated through nested type** — Default values that are themselves collections now pass through nested hydration. `dict(x: number = 42) = [:]` fills `x: 42` instead of returning an empty dict
- **`.^input` returns type token** — `$fn.^input` now returns a `RillTypeValue` with `typeName: 'ordered'` and the parameter types in `structure.fields`, matching `.^output` behavior. `log` prints `ordered(x: number, y: number)` instead of the internal `RillOrdered` representation
- **Nested hydration in `:>ordered()` conversion** — `dict :>ordered(sig)` now hydrates nested dict and ordered fields with defaults, matching existing `dict :>dict(sig)` behavior
- **Ordered input for sig'd conversions** — `ordered :>dict(sig)` and `ordered :>ordered(sig)` now accepted; RILL-R044 errors report correct source type
- **Tuple `:` assertion accepts trailing defaulted fields** — Tuple type assertion now accepts values that omit trailing fields when those fields have defaults. Previously rejected valid inputs
- **`ordered()` error message in `resolveTypeRef`** — Error message now correctly names `ordered()` instead of `dict()`
- **Tuple parameter defaults hydrated before host invocation** — Tuple parameters with default values are hydrated before the host function is called, matching dict and ordered behavior
- **Nested tuple defaults hydrated in `:>` conversion** — Nested tuple field defaults are hydrated during `:>` conversion, matching nested dict field behavior

## [0.15.0] - 2026-03-13

### Breaking Changes

- **`RillType` shape change** — Dict fields use `RillFieldType` (type + optional default). Tuple elements, ordered fields, and closure params gain optional third default element. Extensions reading these fields must update.
- **`.^input` return value** — Returns `RillOrdered` directly instead of a structural type descriptor
- **`:>` conversion errors** — Missing required fields now throw `RILL-R044` instead of `RILL-R036`

### Added

- **Structural type default values** — Dict, ordered, and tuple types support per-field defaults with `= literal` syntax. The `:>` operator auto-hydrates missing fields
- **`RillFieldType` export** — Type and `isFieldTypeWithDefault` guard exported from `@rcrsr/rill` for extension use
- **Typed CLI arg parsing** — `--create-bindings` uses handler param types for correct boolean flag handling

### Changed

- **`.^input` reflection** — Returns a `RillOrdered` value directly for all callable kinds, simplifying type introspection

## [0.14.0] - 2026-03-12

### Breaking Changes

- **`RillFunction` interface change** — `description?: string` replaced by `annotations?: Record<string, RillValue>`. `returnType` changed from optional `RillType` to required `RillTypeValue`. Extension authors must update all `RillFunction` implementations. See migration guide in `docs/integration-extensions.md`.
- **Removed types** — `RillCallableSignature`, `RillFunctionSignature`, and `RillMethodSignature` removed from public exports. Use `RillFunction` and the unified callable reflection API instead.
- **Removed `basePath` from module resolver config** — Module paths must be absolute. Callers resolve paths relative to config directory before passing them in.

### Changed

- **Unified callable representations** — Callable signatures now use a single `CallableBase` interface for all callable kinds instead of separate hierarchies. Reflection operators work consistently across closures, application callables, and runtime functions
- **Module paths resolve relative to config directory** — `moduleResolver` no longer accepts `basePath`. The CLI and `rill-config` resolve paths against `configDir` before passing absolute paths to the resolver.

### Added

- **Unified callable reflection** — `.^description`, `.^input`, and `.^output` now work on all callable kinds: script closures, application callables, and runtime functions. Reflection is consistent regardless of how a callable was created.
- **Type method dicts** — Built-in methods now stored in per-type `typeMethodDicts` on `RuntimeContext`. Host applications can inspect or override type-specific methods at runtime.
- **Cross-module error reporting** — Runtime errors from `use<module:...>` imports include `sourceId` and source text for snippet rendering. Call stack frames carry `sourceId` for cross-module tracing.
- **Error formatter exports** — `formatRillError` and `formatRillErrorJson` exported from `@rcrsr/rill`. CLI error formatting moved to core.
- **Fiddle call stack display** — Error output in the playground shows call stack frames with source snippets and caret indicators.
- **`sourceId` and `sourceText` on RuntimeContext** — Child contexts track their originating source file for cross-module error attribution.

## [0.13.3] - 2026-03-11

### Changed

- **`rill-run` uses config `main` field** — Removed `.rill` file positional argument. Script path comes from `main` in `rill-config.json`. Optional positional arg specifies a root directory containing the config.
- **Independent package versioning** — Packages share `major.minor` but increment patch independently. `sync-versions` syncs major.minor only. `check-versions` validates major.minor alignment.

## [0.13.2] - 2026-03-11

### Changed

- **Dict keys take priority over built-in methods** — Method resolution checks dict properties before built-in methods. A dict with key `model` returns the dict value instead of invoking the vector built-in.

### Fixed

- **`pretest` regenerates `version-data.ts`** — Running `pnpm test` without a prior build no longer fails version tests due to stale generated version data.

## [0.13.1] - 2026-03-11

### Changed

- **`ExtensionResult` is now an interface** — Replaces type intersection with interface and index signature for TS 5.x compatibility. Explicit properties (`dispose`, `suspend`, `restore`) can differ from the index signature type.
- **`ExtensionFactory` allows async return** — Return type widened to `ExtensionResult | Promise<ExtensionResult>` for async extension initialization (MCP transport connect).

### Fixed

- **`prefixFunctions` preserves `suspend` and `restore` hooks** — Lifecycle hooks are skipped during namespace prefixing and preserved on the result, matching existing `dispose` handling.

## [0.13.0] - 2026-03-11

### Changed

- **Remove `namespace` from `ExtensionManifest`** — Mount path in `rill-config.json` determines the namespace prefix. Extensions no longer declare a namespace constraint.
- **Widen `ExtensionManifest.factory` to `ExtensionFactory<any>`** — Typed factories no longer require casting through `unknown`.
- **Simplify `detectNamespaceCollisions`** — Accepts only `ResolvedMount[]`. Checks mount path conflicts (exact match and prefix overlap) without manifest introspection.
- **Remove `NamespaceMismatchError`** — No longer thrown. Mount path validation against manifest namespace is removed.

### Fixed

- **Include `rill-config` in CI publish workflow** — `packages/rill-config` was built and tested but not published to npm.
- **Move `@rcrsr/rill` to `peerDependencies` in `rill-config`** — All imports are type-only. Prevents duplicate copies in consumers.
- **Add `rill-config` to version sync and check scripts** — `sync-versions.sh`, `check-versions.sh`, and `release.yml` now cover all 3 publishable packages.
- **Skip empty context bindings file** — `--create-bindings` no longer writes an empty dict file when no `context` block exists in `rill-config.json`.

### Added

- **`rill-config` README** — Package README with API reference, error classes, and documentation links.

## [0.12.0] - 2026-03-11

### Added

- **`@rcrsr/rill-config` package** — Standalone package for loading and validating `rill.config.ts` files. Manages extension bindings, provides the `context:` resolver, and enables Fiddle context value support
- **`rill-run` CLI** — Config-driven script runner that loads `rill.config.ts`, mounts extensions, resolves environment variables, and executes rill scripts

### Changed

- **Extension manifest export convention** — Bundled extensions and loader now use camelCase `extensionManifest` export instead of PascalCase `ExtensionManifest`, aligning const exports with TypeScript naming conventions
- **Binding helpers consolidated** — `buildExtensionBindings` in `@rcrsr/rill-config` now accepts optional `basePath` parameter; duplicated helpers removed from CLI runner (~60 lines)

### Fixed

- **Closure signature annotations on `use<>`** — `use<scheme:fn>:|param: type, ...|` parses and records parameter signatures on the AST node (no runtime behavior change)
- **Module resolution error sourceId** — Errors thrown from `use<>` module resolution now include `sourceId` for accurate error location reporting

## [0.11.0] - 2026-03-10

### Added

- **`use<>` construct for module loading** — Load extensions and modules via `use<scheme:resource>` expressions with pluggable resolvers. Built-in resolvers include module, extension, and custom schemes
- **Union type syntax** — Union types (`string|number`) work in variable captures, destructuring patterns, existence checks, closure parameters, and type assertions. Parameterized types (`list(T)`, `dict(k: T)`) now work in the same positions

### Changed

- **Host function type system modernized** — New `RillFunction`, `RillParam`, and `RillType` APIs replace legacy `HostFunctionDefinition`, `HostFunctionParam`, and `CallableParam` across all host API, extensions, and CLI tooling
- **Function manifest export** — `generateManifest()` exports complete function metadata for host applications, extensions, and CLI help systems
- **Conversion operator expansion** — `:>` operator now covers all type routes (string, number, boolean, list, dict, tuple, ordered). Removed `.str` and `.num` methods. `:>number` throws on non-numeric strings

## [0.10.0] - 2026-03-07

### Breaking Changes

- **`NativeResult` field renames** — Three fields renamed on the object returned by `toNative()`:
  - `kind` → `rillTypeName`
  - `typeSig` → `rillTypeSignature`
  - `native` → `value`

  TypeScript consumers see compile errors at affected field accesses. JavaScript consumers receive `undefined` at runtime without compile errors. **Migration:** rename all field accesses at `toNative()` call sites.

- **`NativeResult.value` always populated** — `value` (formerly `native`) is no longer `NativeValue | null`. Non-native types that previously produced `null` now produce descriptor objects:
  - Closure: `{ signature: string }`
  - Vector: `{ model: string, dimensions: number }`
  - Type value: `{ name: string, signature: string }`
  - Iterator: `{ done: boolean }`

  **Migration:** remove null guards on `toNative()` results. Code that branches on `result.native == null` (or the renamed `result.value == null`) must be updated.

- **`.^name` on type values raises RILL-R008** — Annotation access (`.^name`) on type values is no longer supported. Previously `.^type.^name` returned the type name string. It now raises RILL-R008 ("Annotation access not supported on type values"). **Migration:** replace `.^type.^name` with `.^type.name` (dot notation).

### Added

- **Anonymous typed closure parameters** — Use `|type|{ body }` syntax for type-safe pipe stages without named parameters. Type is validated on piped input with full reflection parity
- **Parameterized type annotations** — Type assertions accept parameterized forms (`list(string)`, `dict(name: string, age: number)`, `tuple(number, string)`) in closure parameters, return assertions, type checks, and conversion operators
- **`iterator` added to `RillTypeName`** — `"iterator"` is now the 12th member of the `RillTypeName` union type exported from `@rcrsr/rill`
- **Type value dot-notation properties** — Type values support `.name` (returns the type name string) and `.signature` (returns the full type signature string) via dot notation
- **RILL-R043** — New runtime error raised when a closure body or top-level script produces no value (non-producing body)

### Changed

- **Structural type discriminator** — Type inspection returns flat `type` field for all runtime values. Direct shape access replaces previous wrapper variants

## [0.9.0] - 2026-03-06

### Restructure

- **Monorepo split** — Extensions (14 packages) extracted to [rill-ext](https://github.com/rcrsr/rill-ext). Agent framework (8 packages) extracted to [rill-agent](https://github.com/rcrsr/rill-agent). Core repo retains `@rcrsr/rill`, `@rcrsr/rill-cli`, fiddle, and website

### Language

#### Added

- **Structural type identity** — `^type` returns precise structural types for lists, dicts, tuples, ordered dicts, and closures. Type constructors `list()`, `dict()`, `tuple()`, `ordered()`, and closure signatures `|p: T| -> R` work in `:?` type checks
- **Return type assertions for closures** — `{ body }:string` asserts return values on every call. Declared return type accessible via `$fn.^output`
- **Type values** — `type` is a first-class runtime type. Variables accepted in all type positions: closure params, capture bindings, and assertions
- **Whitespace continuations** — Split long expressions across lines at operators, closures, access chains, type assertions, and spread elements

#### Changed

- **Native return values** — `ExecutionResult.result` returns host-native JS values (string, number, boolean, null, arrays, plain objects) instead of internal wrappers. `onLog` callback receives formatted strings
- **Dict-form tools for tool_loop** — Tools declared as plain dicts instead of `tool()` calls. Script tools use annotated closures; host functions use bare `ns::name` references
- **Annotation system overhaul** — Annotations precede params (`|^("desc") name: type|`), loops accept `^(limit: N)`, `vector`/`any` types added
- **Explicit literal syntax** — Keyword prefixes replace ambiguous brackets: `list[`, `dict[` replace bare `[`, `tuple[`, `ordered[` replace `*[`, `destruct<` replaces `*<`, `slice<` replaces `/<`, `chain()` replaces `@[`/`@$`. New `:>` convert operator for type conversions
- **Explicit spread call syntax** — Function calls now require opt-in spreading via `...` operator for tuples, dicts, and ordered values, replacing implicit auto-spread

#### Fixed

- **Variable method calls returned null** — `$var.len`, `$var.trim` now resolve correctly
- **LSP column numbers** — Error output uses 0-based columns for LSP compatibility
- **Multi-line function calls** — Newlines allowed after `(`, after `,`, and before `)` in all call forms

### Dependencies

- **Node 22** required (updated from Node 20)
- **eslint** 9.39.2 → 10.0.2, **tailwindcss** 4.1.18 → 4.2.1

## [0.8.6] - 2026-02-15

### Added

- **MCP Server Mapper Extension** — `@rcrsr/rill-ext-mcp` maps MCP server capabilities to rill host functions via `createMcpExtension()`. Supports stdio and HTTP transports. Tools, resources, and prompts auto-map to callable functions with introspection (`list_tools`, `list_resources`, `list_prompts`). Includes lifecycle events, capability filtering, and multi-server composition via `hoistExtension`

- **Backend-swappable kv and fs extensions** — Mount-based architecture for kv (3 new functions: `merge`, `get_or`, `mounts`) with access mode enforcement. Three new backend packages: `rill-ext-storage-sqlite` (better-sqlite3, WAL mode), `rill-ext-storage-redis` (ioredis, atomic merge), `rill-ext-storage-s3` (AWS S3-compatible). Contract types (`KvExtensionContract`, `FsExtensionContract`) exported from core for compile-time verification

- **Extension documentation** — Dedicated doc pages for mcp, kv-sqlite, kv-redis, and fs-s3 extensions (previously inline in bundled-extensions.md or undocumented)

### Changed

- **Extension package folder naming** — Added category prefixes to extension directories: `llm-` (anthropic, openai, gemini), `vectordb-` (chroma, pinecone, qdrant). Existing `kv-`, `fs-` prefixed packages unchanged. NPM package names unchanged

- **Extension doc file naming** — Renamed extension docs to match folder prefixes: `extension-llm-anthropic.md`, `extension-vectordb-chroma.md`, etc. Updated bundled-extensions.md table, sync-docs.sh mappings, and cross-references

### Fixed

- **ext-llm-shared build failure** — Added default case to `jsonSchemaType` switch in `tool-loop.ts` to fix TS2454 uninitialized variable error (BUG-1)

## [0.8.5] - 2026-02-12

### Fixed

- **Fetch extension URL path concatenation** — `buildUrl()` dropped the base URL path when endpoint paths started with `/` (e.g. `new URL('/top-headlines', 'https://newsapi.org/v2')` resolved to `https://newsapi.org/top-headlines`). Replaced `new URL(path, baseUrl)` with explicit path join that preserves the base path component

- **Scaffolder run.ts agent path** — Generated `run.ts` read `'agent.rill'` from project root but the scaffolder places the file at `src/agent.rill`. Changed to `readFile('src/agent.rill')`

### Changed

- **Agent instructions entry-point detection** — `docs/guide-make.md` adds a decision table for 4 entry scenarios (goal statement, pre-scaffolded project, credentials only, existing bug) so agents determine the correct starting phase

- **Agent instructions review gate** — `docs/guide-make.md` §4.4 requires showing the user final `agent.rill` and `host.ts` edits with explicit approval before first execution

- **Agent instructions debugging guidance** — New §4.6 with error classification table, rules against hand-editing generated files as workarounds, and file path troubleshooting

- **Agent instructions operator precedence** — Syntax Quick Reference documents that `??` consumes the full pipe chain as its default value. Shows 3 safe patterns for optional dict fields and a precedence table for `??`, `=>`, `?`/`!`, `.?`

- **Agent instructions extension return types** — Extension Function Reference expanded with return types, data shapes, and usage examples for all 7 extensions (LLM, vector DB, fs, fetch, exec, kv, crypto). Agents no longer need to search source code for response shapes

## [0.8.4] - 2026-02-12

### Changed

- **Extension bundle generation** — 6 extension packages (anthropic, chroma, gemini, openai, pinecone, qdrant) now use tsup + dts-bundle-generator instead of plain `tsc --build`. Shared libraries (`rill-ext-llm-shared`, `rill-ext-vector-shared`) inlined into output, reducing consumer dependency count

- **Extension build config strictness** — `tsconfig.build.json` for all 6 bundled extensions includes `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`, matching `tsconfig.base.json`

## [0.8.3] - 2026-02-11

### Fixed

- **create-agent npx symlink resolution** — `npx @rcrsr/rill-create-agent` produced zero output because the entry point guard compared symlink path against real path. Uses `realpathSync` on both paths before comparison

### Removed

- **create-agent interactive mode** — Removed `@inquirer/prompts` dependency and interactive prompt flow. All inputs must be provided via CLI flags (`--extensions` or `--preset` required). LLM callers gather and provide all values

### Changed

- **Agent instructions data gathering** — `docs/guide-make.md` Phase 2.3 restructured from passive "determine configuration" to explicit per-extension interview checklist. Phase 3.3 collects project name, package manager, and description before scaffold command

## [0.8.2] - 2026-02-11

### Fixed

- **create-agent CLI entry point** — `npx @rcrsr/rill-create-agent` exited silently without scaffolding. The `import.meta.url` guard used string concatenation instead of `fileURLToPath()`, causing path mismatch when invoked via npx symlinks

- **create-agent package name** — Published as `@rcrsr/rill-create-agent`; scaffold docs and tests referenced the unscoped `rill-create-agent`

- **Agent instructions cwd guidance** — `docs/guide-make.md` scaffold command now uses scoped package name and instructs agents to run from the project parent directory

- **Flaky retry backoff test** — Added 2ms timer jitter tolerance to exponential backoff assertions in `fetch-request.test.ts`

## [0.8.1] - 2026-02-11

### Added

- **Core bundled extensions** — `fs`, `fetch`, `exec`, `kv`, and `crypto` shipped as sub-path exports of `@rcrsr/rill` (e.g. `@rcrsr/rill/ext/fs`). Zero third-party dependencies; Node built-ins only. Each extension provides introspection and proper disposal. Sub-path isolation preserves browser compatibility of the main entry point

- **rill-create-agent scaffolding CLI** — `npx rill-create-agent` generates production-ready rill agent projects with extension hoisting, starter patterns (minimal, RAG, chatbot), and TypeScript toolchain. Also available as `/rill-create-agent` skill in Claude Code

### Changed

- **Release uses pnpm publish** — Workflow and `release.sh` use `pnpm publish` instead of `npm publish`, resolving `workspace:` protocol references at publish time

- **pnpm updated to 10.29.2** — `packageManager` field bumped from 10.10.0

- **rill-create-agent added to release pipeline** — `packages/create-agent` included in publish loop and git tag creation

## [0.8.0] - 2026-02-10

### Added

- **Extension hoisting API** — `hoistExtension(namespace, extension)` separates dispose handlers from functions for safe `createRuntimeContext` usage. Returns `{ functions, dispose }` structure eliminating manual dispose stripping across 4 test hosts. Added error contracts for namespace validation (regex `/^[a-zA-Z0-9_-]+$/`), null checks, and object validation. Includes 17 test cases covering success, error, and boundary conditions

- **Widened `emitExtensionEvent` type signature** — Now accepts `RuntimeContextLike` instead of `RuntimeContext`, eliminating 92 unsafe type casts across 7 extension packages. Non-breaking change preserving all existing extension code

- **Native vector type** — New primitive type for semantic operations. Methods: `.similarity()`, `.dot()`, `.distance()`, `.norm()`, `.normalize()`

- **Vector database extensions** — `@rcrsr/rill-ext-qdrant`, `@rcrsr/rill-ext-pinecone`, `@rcrsr/rill-ext-chroma`. Each provides 11 functions (`upsert`, `search`, `get`, `delete`, `count`, `create_collection`, etc.) with identical signatures. Swap providers by changing the namespace prefix (`qdrant::search` vs `chroma::search`)

- **LLM provider extensions** — `@rcrsr/rill-ext-anthropic`, `@rcrsr/rill-ext-openai`, `@rcrsr/rill-ext-gemini`. Each provides `message()`, `messages()`, `embed()`, `embed_batch()`, and `tool_loop()` with telemetry events

- **Tool descriptor builder** — `tool()` built-in creates tool definitions from closures or host functions for LLM consumption

- **Version sync tooling** — `scripts/sync-versions.sh` propagates root version to all workspace packages. `scripts/check-versions.sh` validates consistency. Release workflow and `release.sh` discover publishable packages dynamically

### Changed

- **Core types module split** — `types.ts` split into 7 focused modules. Public API unchanged; `types.ts` re-exports all symbols for backward compatibility

- **RuntimeError message cleanup** — Removed duplicate error ID prefixes from runtime error messages. Added ESLint rule `rill/no-duplicate-error-id` to prevent regression

- **Release infrastructure** — Workflow and `release.sh` use dynamic package discovery instead of hardcoded lists. Adding a new extension requires zero release config changes

## [0.7.2] - 2026-02-08

### Fixed

- **Conditional block postfix parsing** — `(cond) ? { block }` followed by `(expr)` on the next line no longer parses `(expr)` as a postfix invocation of the conditional result. Broadens the v0.7.0 terminator guard to all block then-branches.

## [0.7.1] - 2026-02-08

### Fixed

- **Zero-param closure pipe injection** — `$c()` with explicit empty parens inside loop bodies no longer receives the loop accumulator as an implicit argument. Mirrors the existing guard for host functions.

## [0.7.0] - 2026-02-08

### Removed

- **BREAKING: Built-in parsing functions** — `parse_json`, `parse_auto`, `parse_xml`, `parse_fence`, `parse_fences`, `parse_frontmatter`, `parse_checklist` removed from core. Scripts using these functions will receive `RUNTIME_UNDEFINED_FUNCTION`. Parsing will return as a dedicated extension package.
- **CLI `parse_` prefix detection** — `VALIDATE_EXTERNAL` lint rule no longer flags `parse_*` functions as external data sources

### Fixed

- **Conditional terminator parsing** — `break`/`return` inside `? ` conditionals no longer consumes the next line's parenthesized expression as an invocation

### Added

- **Share button (fiddle)** — Encodes editor source into a `?code=` URL query param via gzip + base64url; copies shareable link to clipboard with feedback states
- **Auto-indent (fiddle)** — New lines match previous line indentation via CodeMirror `defaultKeymap`
- **Multi-line conditionals** — `?` and `!` now work as line-continuation tokens, matching `->` and `=>`

### Changed (ext/claude-code)

- **Live CLI support** — prompt delivered via `-p` flag; stream parser skips non-JSON terminal output
- **Config** — `settingSources` controls plugin/MCP loading; `dangerouslySkipPermissions` flag exposed
- **Defaults** — timeout 30min (was 30s), `--no-session-persistence` and `--setting-sources ''` always on
- **Test host** — `examples/test-host.ts` for manual testing against live Claude CLI

### Changed (web)

- **Fully generated `content/docs/`** — `sync-docs.sh` now generates all files including section `_index.md` and docs hub; no committed files remain in `content/docs/`

### Fixed (web)

- **Mobile navbar** — removed empty hamburger menu; nav links (Docs, Fiddle, Search, GitHub) always visible
- **Mobile code blocks** — added `overflow-x: auto` to prevent code from overflowing the viewport

## [0.6.2] - 2026-02-07

### Fixed

- **Package metadata** — Added missing `"license": "MIT"` field to core, cli, and claude-code package.json

## [0.6.1] - 2026-02-07

### Changed

- **Release workflow** — OIDC trusted publishing replaces `NPM_TOKEN` secret; provenance generated automatically
- **Release workflow** — Node 20 → 24 (required for npm CLI >= 11.5.1)
- **Release pipeline** — `@rcrsr/rill-ext-claude-code` replaces `@rcrsr/rill-ext-example` in publish and tag steps
- **Build** — Core build script auto-generates version data before `tsc`

### Fixed

- **Generated files** — Removed tracked generated files from git; fixed gitignore pattern for nested paths
- **Version lockstep test** — New test asserts `core`, `cli`, and `fiddle` share the same version
- **Tag count assertion** — Fixed pre-existing bug expecting 4 tags instead of 3

## [0.6.0] - 2026-02-07

### Breaking

- **Capture arrow `=>` replaces `:>`** — Enables ligatures in programming fonts; `:>` rejected with `RILL-P006`

### Added

- **rill fiddle** — Browser-based playground at `packages/fiddle` (private, not published)
  - Client-side execution with React 19, CodeMirror 6, and Vite 7
  - rill syntax highlighting, JetBrains Mono with ligatures, dark/light theme
  - Verbose error display with cause, resolution, and documentation links
  - 5 built-in examples, resizable split pane, Cmd/Ctrl+Enter to run
  - 414 tests across 16 test files

- **Claude Code Extension** — PTY-based Claude CLI integration at `packages/ext/claude-code`
  - Host functions: `claude-code::prompt`, `claude-code::skill`, `claude-code::command`
  - Stream JSON parser, structured results with token usage and cost
  - 221 tests covering all 50 requirements

- **Error reporting** — Rich error feedback with call stacks and source context
  - Source snippets with caret underline at error location
  - Contextual suggestions and documentation links via `getHelpUrl(code)`

- **Function metadata** — `returnType` declarations and `requireDescriptions` validation for host functions

### Changed

- **Documentation** — Semantic file naming (`guide-*`, `topic-*`, `ref-*`, `integration-*`), split host integration into two files
- **Monorepo** — pnpm workspaces with `@rcrsr/rill`, `@rcrsr/rill-cli`, `@rcrsr/rill-ext-claude-code`
- **Error system** — Unified `errorId` replaces legacy `code` field; 80% error coverage
- **Code deduplication** — 3 extractions (`isIdentifierOrKeyword`, `detectHelpVersionFlag`, `isValidSpan`)

## [0.5.0] - 2026-02-03

### Added

- **Runtime Version API** — Programmatic access to rill version information
  - `VERSION` constant: Semver string from package.json (e.g., `"0.5.0"`)
  - `VERSION_INFO` constant: Structured object with `major`, `minor`, `patch`, `prerelease` fields
  - Use for logging, diagnostics, or compatibility checks in host applications
  - Generated at build time via `packages/core/scripts/generate-version.ts`

- **Error Taxonomy** — Structured error system with documentation links
  - `ERROR_REGISTRY`: Categorized definitions for all error codes with severity and messages
  - `getHelpUrl(code)`: Returns documentation URL for any error code
  - `renderMessage(error)`: Enhanced error messages with help links and context
  - `createError(code, context)`: Structured error creation with template interpolation
  - New types: `ErrorCategory`, `ErrorSeverity`, `ErrorDefinition`
  - Error reference documentation at `docs/88_errors.md`

- **Introspection API** — Runtime functions for discovering available functions and language reference
  - `getFunctions(ctx)` returns metadata for all registered functions (name, description, params)
  - `getLanguageReference()` returns bundled language reference text for LLM prompt context
  - New types exported: `FunctionMetadata`, `ParamMetadata`
  - Host functions include parameter types and descriptions when registered with metadata

- **Default Operator on Method Calls** — `??` now works after method invocations in member access chains
  - `$dict.method() ?? "default"` returns default if method throws or returns missing
  - `$obj.transform().value ?? 0` handles missing fields after method calls
  - Applies to both dict closures and application callables

- **Pass Statement** — No-op keyword for explicit identity pass-through
  - `pass` returns `$` unchanged; useful in conditional branches
  - Pipe form: `$value -> pass` equivalent to `$value`
  - Conditional: `$cond ? do_something() ! pass` — else branch does nothing
  - Clearer intent than `$` alone in conditional contexts

- **Type-Safe Boolean Negation** — `!` operator enforces boolean operand
  - `!true` returns `false`; `!false` returns `true`
  - `!"string"` throws `RUNTIME_TYPE_ERROR` (no truthy/falsy coercion)
  - Consistent with strict boolean enforcement in conditionals and loops

- **Existence Check Validation** — Parser rejects combining `.?field` with `??`
  - `$data.?field ?? "default"` now throws clear parse error
  - Use `.?field` for boolean existence check OR `??` for default value, not both

### Fixed

- **Closure PipeValue Isolation** — Explicit-param closures no longer inherit caller's `$`
  - Before: `|a, b| { $ }` could access caller's pipe value, causing unintended leakage
  - After: Explicit-param closures see `$` as undefined; must use declared parameters
  - Zero-param closures (`|| { $ }`) still inherit pipe value for dict dispatch compatibility

### Changed

- **Generated Files Location** — Build-time generated files moved to `src/generated/`
  - `version-data.ts` and `introspection-data.ts` now in dedicated directory
  - Directory excluded from version control via `.gitignore`
  - Generator scripts updated to write to new location

## [0.4.5] - 2026-02-02

### Added

- **Variable Dict Keys** — Use variables as dict keys with `$` prefix
  - `[$keyName: value]` uses variable value as key
  - Key must evaluate to string; throws `RUNTIME_TYPE_ERROR` otherwise
  - Combines with static keys: `[name: "Alice", $dynamicKey: 42]`

- **Computed Dict Keys** — Use expressions as dict keys with parentheses
  - `[($expr): value]` evaluates expression as key
  - Full pipe chains supported: `[($prefix -> "{$}_suffix"): value]`
  - Key must evaluate to string; throws `RUNTIME_TYPE_ERROR` otherwise

- **Variable Existence Checks** — Check field existence using variable key
  - `$dict.?$keyName` checks if field exists using variable value
  - Returns boolean without accessing the value
  - Combines with type check: `$dict.?$keyName&string`

- **Computed Existence Checks** — Check field existence using expression
  - `$dict.?($expr)` evaluates expression and checks existence
  - Full pipe chains supported: `$dict.?($a -> "{$}_b")`
  - Combines with type check: `$dict.?($expr)&number`

- **Type-Qualified Existence Checks** — Verify both existence and type
  - `$dict.?field&string` returns true only if field exists AND is string type
  - Supported types: `string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`
  - Works with all existence check forms: literal, variable, and computed

### Fixed

- **Existence Check in Access Chains** — `.?field` works correctly in chained property access
  - Before: `$data.user.?name` failed when accessing through intermediate dicts
  - After: Access chain completes and returns boolean indicating field existence
  - Properly handles existence check as terminal operation in access chains

## [0.4.4] - 2026-02-02

### Added

- **Inline Closures as Pipe Targets** — Pipe values directly into closure definitions
  - `5 -> |x| { $x + 1 }` pipes value as first argument (returns 6)
  - `7 -> || { $ * 3 }` zero-param closure uses `$` for pipe value (returns 21)
  - Chaining works: `5 -> |x| { $x * 2 } -> |y| { $y + 1 }` (returns 11)
  - Supports type annotations: `42 -> |x: number| { $x * 2 }`

### Improved

- **Helpful Error for `-> !` Misuse** — Clear guidance when negation used incorrectly as pipe target
  - Error: "Negation operator requires an operand. Use prefix syntax: !expr or (!expr)"

### Changed

- **VALIDATE_EXTERNAL Rule** — Skip namespaced functions (`ns::func`) as trusted host APIs
  - Functions like `ccr::read_frontmatter` no longer trigger external input validation warnings

### Fixed

- **SPACING_BRACES Rule** — No longer triggers false positives for string interpolation
  - Fixed index math for closing brace check
  - Only checks the block's opening/closing braces, not `{$var}` inside strings

- **Scope Tracking for Lint Rules** — Rules no longer report false positives for sibling closures
  - LOOP_OUTER_CAPTURE and AVOID_REASSIGNMENT now properly track closure scope boundaries
  - Variables in sibling closures are correctly identified as independent locals

## [0.4.3] - 2026-02-01

### Fixed

- **String Literal Dict Keys** — String literals now parse correctly as dict keys
  - `["blocked": value, "error": value]` parses as dict with string keys
  - Previously misinterpreted as type assertions, causing parse errors
  - Supports all string forms: simple, escaped, multiline

### Changed

- **Documentation** — Updated grammar version to 0.4.2 and refined index links

## [0.4.2] - 2026-02-01

### Added

- **List Spread Operator** — `...` syntax for inline list expansion
  - `[...$list]` spreads list elements inline
  - `[1, ...$middle, 3]` spreads at any position
  - `[...$a, ...$b]` concatenates multiple lists
  - Validates spread target is a list; throws `RUNTIME_TYPE_ERROR` otherwise
  - Works in tuples: `*[...$args]` for argument unpacking

- **Multi-Key Dict Literals** — `[[k1, k2]: value]` syntax in dict definitions
  - `[["get", "head"]: "safe"]` creates entries for both keys with shared value
  - Value evaluated once, assigned to all keys
  - Validates keys are primitives (string, number, boolean)
  - Previously only worked in dispatch; now works in literals

### Changed

- **Documentation** — Added rill cookbook with agent scripting patterns
  - `docs/19_cookbook.md`: Advanced patterns for multi-step workflows
  - Updated README with refined LLM feedback quotes

## [0.4.1] - 2026-02-01

### Added

- **Literal Dict Keys** — Number and boolean literals as dict keys
  - Number keys: `[1: "one", 2: "two"]` parses with numeric keys
  - Boolean keys: `[true: "yes", false: "no"]` parses with boolean keys
  - Type-aware dispatch: `1 -> [1: "one", "1": "string"]` returns `"one"` (number match)
  - String input matches string key: `"1" -> [1: "one", "1": "string"]` returns `"string"`
  - Boolean dispatch: `true -> [true: "yes", false: "no"]` returns `"yes"`
  - Negative number keys: `[-1: "neg"]` parsed as MINUS + NUMBER tokens
  - Float keys: `[3.14: "pi"]` supported
  - Backward compatible: identifier keys remain strings

### Changed

- **Code Cleanup** — Removed unreachable multi-key validation code
  - Removed defensive runtime check in `literals.ts` (parser catches invalid keys)
  - Removed skipped test for unreachable code path
  - Parser test coverage already exists in `parser-syntax-errors.test.ts`

## [0.4.0] - 2026-01-31

### Added

- **Hierarchical Dispatch** — Navigate nested structures with path lists
  - Dict path: `["name", "first"] -> [name: [first: "Alice"]]` returns `"Alice"`
  - List path: `[0, 1] -> [[1, 2, 3], [4, 5, 6]]` returns `2`
  - Mixed path: `["users", 0, "name"] -> [users: [[name: "Alice"]]]` returns `"Alice"`
  - Empty path: `[] -> [a: 1]` returns target unchanged
  - Negative indices: `[0, -1] -> [[1, 2, 3]]` returns `3`
  - Default values: `["a", "missing"] -> [a: [x: 1]] ?? "default"` returns `"default"`
  - Intermediate closure auto-invoke: `["get", "name"] -> [get: ||([name: "Alice"])]` returns `"Alice"`
  - Terminal closure binding: `["req", "draft"] -> [req: [draft: { "key={$}" }]]` returns `"key=draft"`

- **Unified Dispatch** — Pipe to list literals and variable collections
  - List literal dispatch: `0 -> ["a", "b", "c"]` returns `"a"`
  - Negative indices: `-1 -> ["a", "b", "c"]` returns `"c"` (last element)
  - Variable dispatch to dict: `[x: 1, y: 2] :> $d` then `"x" -> $d` returns `1`
  - Variable dispatch to list: `["a", "b"] :> $list` then `0 -> $list` returns `"a"`
  - Default values: `99 -> ["a"] ?? "fallback"` returns `"fallback"`
  - Closure auto-invoke: `[fn: ||{ "result" }] :> $d` then `"fn" -> $d` returns `"result"`
  - Error on type mismatch: `"key" -> [1, 2]` throws `List dispatch requires number index`
  - Error on missing key/index: `5 -> ["a"]` throws `List dispatch: index '5' not found`

### Changed

- **Documentation** — Added hierarchical dispatch to all reference docs
  - `docs/04_operators.md`: Full hierarchical dispatch section with examples
  - `docs/11_reference.md`: Hierarchical dispatch in quick reference tables
  - `docs/15_grammar.ebnf`: Dispatch semantics comment after pipe-target section
  - `docs/99_llm-reference.txt`: Complete dispatch operators section (dict, list, hierarchical)

## [0.3.0] - 2026-01-30

### Breaking

- **Block Expressions Create Closures** — `{ body }` in expression position now produces `ScriptCallable`
  - Before: `{ 5 + 1 } :> $x` stored `6` (eager evaluation)
  - After: `{ 5 + 1 } :> $x` stores a closure; `$x()` returns `6`
  - Before: `[key: { $ + 1 }]` stored the result of `$ + 1`
  - After: `[key: { $ + 1 }]` stores a closure that accepts `$` as argument
  - Before: `type({ "hello" })` returned `"string"`
  - After: `type({ "hello" })` returns `"closure"`
  - Migration: Use `( expr )` for eager evaluation where `{ }` was used before
    - `{ expr } :> $x` → `( expr ) :> $x`
    - `[key: { expr }]` → `[key: ( expr )]`
  - Pipe targets unchanged: `5 -> { $ + 1 }` still returns `6` (creates closure, invokes immediately)

- **Block-Closures Have Implicit `$` Parameter** — Block-closures require exactly one argument
  - `{ $ + 1 } :> $fn` then `$fn()` throws `Missing argument for parameter '$'`
  - `{ $ + 1 } :> $fn` then `$fn(1, 2)` throws `Function expects 1 arguments, got 2`
  - Use `||{ body }` for zero-parameter closures (property-style)

- **Strict Arity Enforcement for All Closures** — Excess arguments now error
  - Before: `||{ 42 } :> $fn` then `$fn(1, 2, 3)` silently ignored extra args
  - After: Same code throws `Function expects 0 arguments, got 3`
  - Applies to all closure forms: `{ }`, `||{ }`, `|x|{ }`, `|x, y|{ }`

### Added

- **Block-Closure Syntax** — `{ body }` creates closure with implicit `$` parameter
  - `{ $ + 1 } :> $increment` then `5 -> $increment` returns `6`
  - `$increment(7)` also works (direct call)
  - Dict values: `[double: { $ * 2 }] :> $obj` then `5 -> $obj.double` returns `10`
  - Collection ops: `[1, 2, 3] -> map { $ * 2 }` returns `[2, 4, 6]`

- **Expression Delimiter Distinction** — Deterministic `{ }` vs `( )` semantics
  - `{ body }` — Deferred execution, produces `ScriptCallable`
  - `( expr )` — Eager evaluation, produces result value
  - Pipe target `-> { }` creates and invokes (same observable result as `-> ( )`)

### Changed

- **Documentation Updates** — Comprehensive closure semantics documentation
  - `docs/06_closures.md`: Added "Expression Delimiters" and "Block-Closures" sections
  - `docs/11_reference.md`: Added expression delimiters table to Quick Reference
  - `docs/15_grammar.ebnf`: Added block expression semantics comments
  - `docs/99_llm-reference.txt`: Added block-closure vs explicit closure section

## [0.2.4] - 2026-01-28

### Breaking

- **`ErrorNode` Renamed to `RecoveryErrorNode`** — Parse recovery error node type changed
  - Before: `stmt.type === 'Error'` for recovery-mode parse errors
  - After: `stmt.type === 'RecoveryError'`
  - `ErrorNode` now refers to the new `error` statement node
  - Migration: Update any code matching on `'Error'` node type to `'RecoveryError'`

- **`DictEntryNode.key` Type Widened** — Dict entry keys accept tuple nodes for multi-key dispatch
  - Before: `DictEntryNode.key` was always `string`
  - After: `DictEntryNode.key` is `string | TupleNode`
  - Affects code that reads dict entry keys directly

### Added

- **Assert Statement** — Validate conditions with `assert`
  - `assert $count > 0` halts with `RUNTIME_ASSERTION_FAILED` if false
  - `assert $valid "custom message"` includes message in error
  - Pipe form: `$value -> assert .len > 0` passes value through unchanged
  - Condition must be boolean (no truthiness)

- **Error Statement** — Halt execution with `error`
  - `error "something went wrong"` halts with `RUNTIME_ERROR_RAISED`
  - Pipe form: `$msg -> error` uses piped string as message
  - Interpolation: `error "failed at step {$step}"`
  - Conditional: `($count == 0) ? { error "empty input" }`

- **Dict Dispatch** — Pipe a value to a dict to match keys
  - `$val -> [apple: "fruit", carrot: "vegetable"]` returns matched value
  - Default: `$val -> [a: 1, b: 2] ?? "unknown"` returns default on no match
  - Multi-key: `$method -> [["GET", "HEAD"]: "safe", ["POST"]: "unsafe"]`
  - Matched closures auto-invoke
  - Throws `RUNTIME_PROPERTY_NOT_FOUND` if no match and no default

- **List Membership Methods** — 3 methods for checking list contents
  - `.has(value)` — deep equality check for single value
  - `.has_any([candidates])` — true if list contains any candidate
  - `.has_all([candidates])` — true if list contains all candidates

- **Design Principles Doc** — `docs/18_design-principles.md` covers rillistic idioms
  - 6 core principles that break mainstream habits
  - Patterns for pipes, sealed scopes, value semantics

### Fixed

- **USE_DEFAULT_OPERATOR False Positives** — Rule no longer flags negated pipe conditionals (`-> ! { }`)
  - Before: `value -> ! { error_handler() }` triggered "Use ?? for defaults" suggestion
  - After: Only flags explicit `.?field` existence checks with else branches
- **VALIDATE_EXTERNAL False Positives** — Rule no longer flags host calls already wrapped in type assertions
  - Before: `parse_json($input):dict` and `ccr::read($path):string` still triggered "validate external" warnings
  - After: Skips host calls that have an immediate `:type` assertion
- **Type Safety in Check Rules** — Replaced `as any` casts with proper AST node types across 6 files

## [0.2.3] - 2026-01-27

### Fixed

- **SPACING_BRACES False Positives** — Rule no longer flags string interpolation braces inside multi-line blocks
  - Before: `{$var}` inside strings triggered "Space required before closing brace }" diagnostics
  - After: Only inspects the actual block brace lines, ignoring interior content
- **SPACING_BRACES Error Location** — Closing brace violations now report the correct line
  - Before: Pointed at the opening `{` line
  - After: Points at the closing `}` line

## [0.2.2] - 2026-01-27

### Fixed

- **LOOP_ACCUMULATOR False Positives** — Rule no longer flags captures only used within the iteration
  - Before: Any `:>` capture inside a loop body triggered the diagnostic
  - After: Only fires when a captured variable is referenced in the loop condition
  - Applies to both `cond @ block` (while) and `@ block ? cond` (do-while) forms
  - Message now names the specific variables: `$x captured in loop body but referenced in condition`

## [0.2.1] - 2026-01-27

### Fixed

- **Frontmatter Lexing** — Lexer now scans frontmatter content as raw text between `---` delimiters
  - Before: Files with apostrophes or special characters in frontmatter caused `Unexpected character` errors
  - After: Frontmatter content is opaque to the lexer; any characters are valid

- **String Interpolation Error Locations** — Errors inside `{expr}` now report correct source positions
  - Before: Locations were relative to the interpolation fragment (e.g., line 1, column 1)
  - After: Locations are absolute within the original source file
  - Added `baseLocation` parameter to `tokenize()` for sub-parsing with correct offsets

- **`rill-check` Parse Error Recovery** — Parse errors are now reported as diagnostics instead of crashes
  - Before: `rill-check` exited with unhandled error on first parse failure
  - After: Reports first parse error as a formatted diagnostic with location
  - Uses `parseWithRecovery()` to handle both `LexerError` and `ParseError`

- **`rill-check` Entry Point** — CLI now executes when invoked via npm bin shims
  - Before: `import.meta.url` guard failed when run through `npx` or global link
  - After: Uses environment variable detection matching `rill-exec` and `rill-eval`

- **CLI Version Reading** — All three CLI tools read version from `package.json` at runtime
  - Before: `rill-check` had hardcoded `"0.1.0"`; `rill-exec` had fallback `"0.1.0"`
  - After: Shared `readVersion()` in `cli-shared.ts` used by all CLI tools

## [0.2.0] - 2026-01-26

### Breaking

- **Mandatory Host Function Type Declarations** — `params` is now required in `HostFunctionDefinition`
  - Before: `functions: { add: (args) => args[0] + args[1] }` (raw `CallableFn`)
  - After: `functions: { add: { params: [...], fn: (args) => args[0] + args[1] } }`
  - Backward compatibility for untyped functions removed
  - Migration: Wrap all host functions in `{ params: [...], fn: ... }` format

- **Triple-Quote Strings Replace Heredocs** — `<<EOF...EOF` syntax removed, use `"""..."""`
  - `"""content"""` for multiline strings with interpolation support
  - Opening newline after `"""` skipped automatically (Python-style)
  - Nested triple-quotes inside interpolation produce clear error
  - AST field renamed: `isHeredoc` → `isMultiline`
  - Using `<<` produces helpful error suggesting triple-quote alternative

### Added

- **Static Analysis Tool** — `rill-check` CLI for linting rill scripts
  - 25 validation rules across 9 categories: naming, flow, collections, loops, conditionals, closures, types, strings, formatting
  - Auto-fix support via `--fix` flag for fixable issues
  - Configuration file support (`.rillcheck.json`) for enabling/disabling rules
  - Output formats: `--format text` (default) or `--format json`
  - Rule categories:
    - **Naming**: snake_case enforcement for variables, closures, dict keys
    - **Flow**: capture patterns, branch structure
    - **Collections**: break in parallel ops, prefer map over each, fold intermediates
    - **Loops**: accumulator usage, prefer do-while, use each for iteration
    - **Conditionals**: default operator, condition type validation
    - **Closures**: bare dollar in stored closures, brace style, late binding
    - **Types**: unnecessary assertions, external validation
    - **Strings**: `.empty` over `== ""`
    - **Formatting**: spacing, indentation, implicit `$` patterns

- **CLI Commands** — Two new commands for executing rill scripts from the command line
  - `rill-exec <file> [args...]` — Execute a rill script file with arguments
    - Arguments passed as `$` list (all strings, no type conversion)
    - Stdin support: `rill-exec -` reads script from stdin
    - Module imports via `use:` frontmatter declarations
    - Exit codes: `true`/non-empty → 0, `false`/empty → 1, `[code, msg]` → custom
  - `rill-eval <expression>` — Evaluate a rill expression directly
    - `$` initialized to empty list `[]`
    - No module imports (inline evaluation only)
  - Both support `--help` and `--version` flags
  - Structured error output with line numbers and error codes

- **CLI Tools Documentation** — `docs/17_cli-tools.md` covering all three CLI commands
  - `rill-exec`: file execution, stdin, arguments, frontmatter modules, exit codes
  - `rill-eval`: expression evaluation with examples
  - `rill-check`: options, output formats, configuration, full lint rule table (29 rules)
  - Linked from `docs/00_INDEX.md` under Integration section

- **Dynamic Field Access** — Variable and computed keys for dict/list access
  - `$dict.$key` — Use variable value as dict key
  - `$dict.($i + 1)` — Computed expression as key
  - `$dict.(a || b)` — Alternative keys (fallback)
  - Type validation: keys must be string or number

- **Extension System** — API for creating reusable host function packages
  - `ExtensionFactory<TConfig>` type for configuration-based factories
  - `prefixFunctions(namespace, functions)` for namespacing extensions
  - `emitExtensionEvent(ctx, event)` for structured logging
  - `ExtensionEvent` type with severity levels and timestamps

- **Module Loader** — `loadModule()` function for frontmatter-based imports
  - Resolves modules relative to importing script
  - Caches by canonical path for efficiency
  - Circular dependency detection with clear error chain
  - Parses `use:` and `export:` frontmatter declarations

- **6 new lint rules** for `rill-check`:
  - `LOOP_OUTER_CAPTURE` — Detects outer-scope variable capture inside loops; suggests `fold`/accumulator
  - `SPACING_BRACKETS` — Validates bracket spacing (`$list[ 0 ]` → `$list[0]`); auto-fixable
  - `IMPLICIT_DOLLAR_METHOD` — Detects `$.upper()` → suggests `.upper`
  - `IMPLICIT_DOLLAR_FUNCTION` — Detects `log($)` → suggests `-> log`
  - `IMPLICIT_DOLLAR_CLOSURE` — Detects `$fn($)` → suggests `-> $fn`
  - `isBareReference()` helper for O(1) bare `$` detection in AST nodes

### Fixed

- **Frontmatter Parser Whitespace** — Parser now preserves whitespace in frontmatter content
  - Before: Token concatenation lost inter-token spaces, breaking YAML parsing
  - After: Raw source text captured between `---` delimiters
  - Fixes: `use: [{mod: ./path}]` now parses correctly as YAML

- **Zero-Parameter Function Pipe Injection** — Functions with `params: []` no longer receive automatic pipe value
  - Before: `timestamp()` with `params: []` received pipe value as first argument
  - After: `timestamp()` with `params: []` receives empty args array as declared
  - Functions without `params` field still receive pipe value (application callables)

### Changed

- **Deprecated `src/cli.ts`** — Use `rill-exec` or `rill-eval` instead; will be removed in v1.0

- **Documentation** — Added scope/loop pitfall guidance across 3 docs
  - `docs/03_variables.md`: Common mistake callout for outer-scope capture in loops
  - `docs/05_control-flow.md`: Multiple state values pattern using `$` as state dict
  - `docs/07_collections.md`: Warning about loop body scope limitations
  - All host function examples updated to typed format

- **Evaluator Mixin Documentation** — Added design rationale in `evaluator.ts`
  - Documents circular method dependencies between mixins
  - Explains shared mutable state requirements

- **Test updates** — Replaced `heredoc` references with triple-quote strings in frontmatter and content-parser tests

## [0.1.0] - 2026-01-23

### Breaking

- **`each` break returns partial results** — Break in `each` now returns collected results instead of break value
  - Before: `[1,2,3] -> each { ($ == 2) ? break ! $ }` returned `2` (break value)
  - After: Same code returns `[1]` (partial results before break)
  - Rationale: `each` now always returns `RillValue[]`, making return type predictable
  - Use `while` loop if break value semantics are needed

- **Strict Null Elimination** — All undefined/missing access now throws errors instead of returning `null`
  - `$undefined` throws `Undefined variable: $undefined` (was `null`)
  - `$` without pipe context throws `Undefined variable: $`
  - `$dict.missing` throws `Dict has no field 'missing'` (was `null`)
  - `$list[99]` throws `List index out of bounds: 99` (was `null`)
  - `.at(-1)` throws `List index out of bounds` (was `null`)
  - Empty scripts throw `Undefined variable: $` (implicit `$` evaluation)
  - Use `??` for default values or `.?` for existence checks when missing values are expected

### Added

- **Script-Level Return** — `return` now exits entire script, not just blocks
  - `"result" -> return` exits script early with value
  - Stops executing remaining statements
  - Works with conditionals: `$done ? ("early" -> return)`
  - `stop()` and `error()` removed from docs (host-provided, not built-in)

- **Typed Host Functions** — Declarative parameter types with runtime validation
  - Declare types: `{ params: [{ name: 'x', type: 'string' }], fn: (args) => ... }`
  - Supported types: `string`, `number`, `bool`, `list`, `dict`
  - Default values: `{ name: 'count', type: 'number', defaultValue: 1 }`
  - Clear error messages: `expects parameter 'x' (position 0) to be string, got number`
  - Mixed definitions: typed and untyped functions in same context
  - Exports: `HostFunctionDefinition`, `HostFunctionParam`, `validateHostFunctionArgs`

- **Style Guide** — `docs/16_conventions.md` with idiomatic patterns
  - Naming: snake_case for variables, closures, dict keys
  - Spacing: operators spaced, braces spaced inside, parentheses tight
  - Implicit `$` shorthand: `.method` not `$.method()`, `func` not `func($)`
  - No throwaway captures: use line continuation instead
  - Chain continuations: 2-space indent on continued lines

- **LLM Reference** — `docs/99_llm-reference.txt` compact plain-text reference
  - Single-file format optimized for LLM context windows
  - Covers syntax, operators, control flow, common mistakes
  - Includes style conventions summary

### Changed

- **Evaluator Decomposition** — Replaced 2980-line `evaluate.ts` monolith with mixin-based architecture
  - `src/runtime/core/eval/base.ts` — Abstract base class with shared state and utilities
  - `src/runtime/core/eval/evaluator.ts` — Composed evaluator combining all mixins
  - Mixins in `src/runtime/core/eval/mixins/`:
    - `core.ts` — Statement sequencing, blocks, pipe operations
    - `literals.ts` — Strings, numbers, booleans, lists, dicts
    - `variables.ts` — Variable declaration, capture, scope management
    - `expressions.ts` — Binary/unary operators, comparisons
    - `control-flow.ts` — Conditionals, while/do-while loops, break/return
    - `collections.ts` — `each`, `map`, `filter`, `fold` operators
    - `closures.ts` — Closure definition, invocation, method calls
    - `extraction.ts` — Destructuring, slicing, spread operations
    - `types.ts` — Type assertions and checks
    - `annotations.ts` — Statement annotations (`^(limit: N)`)
  - New test suites: `evaluator-base`, `evaluator-composition`, `*-mixin` tests
  - No user-facing changes

## [0.0.5] - 2026-01-21

### Changed

- **Parser Refactor** — Consolidated bare host call parsing into `parseBareHostCall` helper
  - Removes duplicate logic from `parsePrimary`, `parsePipeTarget`, and `parseIteratorBody`
  - No user-facing changes

- **Lexer Refactor** — Replaced keyword switch statement with `KEYWORDS` lookup table
  - Moves keyword definitions to `operators.ts` for consistency with operator tables
  - No user-facing changes

- **Runtime Refactor** — Removed duplicate `isDict` and `isCallable` from `values.ts`
  - Now imports from `callable.ts` where canonical definitions live
  - No user-facing changes

## [0.0.4] - 2026-01-21

### Added

- **Bare Function Names in Iterators** — Collection operators accept bare function names as body
  - `[1, 2, 3] -> each double` calls `double($)` for each element
  - Namespaced functions work: `[1, 2, 3] -> map math::square`
  - Equivalent to `{ func($) }` block form

- **Pipe Variable Access Chains** — `$[idx]` and `$.field` syntax without identifier
  - `$[0]` accesses first element of pipe value
  - `$.name` accesses field on pipe value
  - Works in pipe targets: `-> $[0]` or `-> $.field`

- **Accumulator in Grouped Expressions** — `$@` available in fold/each grouped bodies
  - `[1, 2, 3] -> fold(0) ($ + $@)` sums to 6
  - `[1, 2, 3] -> each(0) ($@ + $)` produces running sum `[1, 3, 6]`

- **Accumulator in Closure Bodies** — `$@` accessible in iterator closures
  - `[1, 2, 3] -> fold(0) |x| { $x + $@ }` works correctly
  - Closures receive accumulator via defining scope

### Fixed

- **Strict Boolean Enforcement** — Conditionals, loops, and filters require boolean values
  - `$val -> ? "yes" ! "no"` requires `$val` to be boolean (not truthy/falsy)
  - `(cond) @ { body }` while condition must be boolean
  - `@ { body } ? (cond)` do-while condition must be boolean
  - `-> filter { predicate }` predicate must return boolean
  - Non-boolean values throw `RuntimeError` with descriptive message
  - Migration: use comparisons (`.empty`, `.eq()`, `> 0`) instead of truthy values

- **Variable Access Chain in Iterators** — `$[1]` and `$.field` now work as iterator bodies
  - `[[1,2], [3,4]] -> each $[0]` returns `[1, 3]`
  - `[{a:1}, {a:2}] -> each $.a` returns `[1, 2]`

## [0.0.3] - 2026-01-21

### Fixed

- **Implicit Property Access** — `.field` now works as sugar for `$.field`
  - `[a: 1] -> .a` returns `1` (falls back to dict property when method not found)
  - `-> $.field` works as pipe target (property access on pipe value)
  - Chained access: `[a: [b: 1]] -> .a.b` returns `1`
- **Type Errors** — Added `PostfixExprNode` to `PipeTargetNode` union for chained method pipe targets

## [0.0.2] - 2026-01-21

### Added

- **Capture Operator (`:>`)** — Variable assignment that continues the chain
  - `"hello" :> $x -> .upper` captures "hello" into `$x`, result is "HELLO"
  - Multiple captures: `"a" :> $first -> "{$}b" :> $second -> "{$}c"`
  - Line continuation: `:>` at line start continues previous chain
  - Distinction: `-> $var` terminates chain, `:> $var` continues it

- **Method Shorthand in Iterators** — `.method` as body form for collection operators
  - `["hello", "world"] -> each .upper` returns `["HELLO", "WORLD"]`
  - `["  hi  ", " there "] -> map .trim` returns `["hi", "there"]`
  - Supports arguments: `["a", "b"] -> map .pad_start(3, "0")`
  - Equivalent to `{ $.method() }` block form

- **Namespaced Functions** — Host functions can use `::` separator for organization
  - Register: `functions: { 'math::add': (args) => ... }`
  - Call: `math::add(1, 2)` or `5 -> math::double`
  - Supports multi-level: `io::file::read("path")`

- **Pipe-style Dict Closure Invocation** — Closures in dicts can receive piped values
  - `5 -> $math.double()` passes `5` to `$math.double` closure
  - Supports nested access: `7 -> $obj.utils.transform()`
  - Enables method-like chaining: `5 -> $math.double() -> $math.triple()`

- **Documentation Example Tester** — Validates code blocks in markdown files
  - Run `npx tsx scripts/test-examples.ts docs/` to test all examples
  - Supports ` ```rill ` fenced blocks with mock host functions
  - Auto-skips error demonstrations and continuation markers

### Changed

- **Scope Isolation** — Statements are sibling scopes, not a sequence
  - `$` is immutable within a scope; flows only via explicit `->`
  - Siblings inherit parent's `$`, not previous sibling's result
  - Child scopes read parent variables but cannot reassign them
  - Variables captured via `:>` are promoted to containing block scope
  - Empty block `{}` returns inherited `$`

- **While Loop Semantics** — `@` requires boolean condition
  - `cond @ body` — while loop (cond must evaluate to boolean)
  - `@ body ? cond` — do-while (body executes first, then checks condition)
  - Non-boolean conditions throw runtime error
  - Do-while returns body result, not condition result

- **Documentation Conventions** — Standardized host function naming
  - Host functions use `app::` namespace prefix (e.g., `app::prompt`, `app::fetch`)
  - Built-in functions remain unqualified (e.g., `log`, `range`, `parse_json`)
  - Docs updated across all guides for consistency

### Removed

- **`list @ body` For-Each Syntax** — Use `each` operator instead
  - Before: `[1, 2, 3] @ { $ * 2 }`
  - After: `[1, 2, 3] -> each { $ * 2 }`
  - `@` now exclusively handles while and do-while loops


### Breaking Changes

- **Scope isolation changes `$` behavior between statements**
  - Before: `"hello"; $` returned "hello" (sibling inherited previous result)
  - After: `"hello"; $` returns parent's `$` (siblings don't affect each other)
  - Migration: Use explicit capture `"hello" :> $val; $val` or chain `"hello" -> $`

- **`list @ body` syntax removed**
  - Attempting `[1, 2, 3] @ { body }` throws error requiring boolean condition
  - Migration: Use `[1, 2, 3] -> each { body }` for iteration

## [0.0.1] - 2025-01-20

Initial release.

### Added

- **Core Language**
  - Pipe operator (`->`) for data flow
  - Variables (`$name`) with type locking on first assignment
  - Closures (`|x, y| { ... }`) with lexical scoping
  - Dicts (`[key: value]`) and lists (`[a, b, c]`)
  - Tuples for structured destructuring
  - String interpolation (`"Hello, {$name}"`)
  - Heredoc strings for multi-line content

- **Control Flow**
  - Ternary conditionals (`$x ? "yes" ! "no"`)
  - Pattern matching with regex (`/<pattern>/`)
  - `while` and `do-while` loops with pipe input
  - `for` loops over iterators
  - `break` and `return` statements
  - `each`, `map`, `filter`, `fold` collection operators

- **Runtime**
  - `parse()` and `execute()` API
  - `createRuntimeContext()` for host configuration
  - `createStepper()` for step-by-step execution
  - Host-provided functions and variables
  - `callable()` for first-class host functions
  - Observability callbacks (`onStepStart`, `onStepEnd`, `onCapture`, etc.)
  - Cancellation via `AbortSignal`
  - Timeout support for async functions
  - Auto-exceptions for pattern-matched error handling

- **Built-in Functions**
  - `type`, `identity`, `log`, `json`
  - `parse_json`, `parse_xml`, `parse_fence`, `parse_fences`
  - `parse_frontmatter`, `parse_checklist`, `parse_auto`
  - `enumerate`, `range`, `repeat`

- **Built-in Methods**
  - String: `.len`, `.trim`, `.upper`, `.lower`, `.split`, `.lines`, `.join`
  - String: `.starts_with`, `.ends_with`, `.contains`, `.replace`, `.replace_all`
  - String: `.match`, `.is_match`, `.index_of`, `.pad_start`, `.pad_end`, `.repeat`
  - Collection: `.head`, `.tail`, `.first`, `.at`, `.empty`
  - Dict: `.keys`, `.values`, `.entries`
  - Conversion: `.str`, `.num`
  - Comparison: `.eq`, `.ne`, `.lt`, `.le`, `.gt`, `.ge`

- **Error Handling**
  - `RillError` base class with source locations
  - `ParseError`, `RuntimeError`, `AbortError`, `TimeoutError`
  - `AutoExceptionError` for pattern-matched failures
  - Structured error codes (`RILL_ERROR_CODES`)

- **Documentation**
  - Language reference guide
  - Host integration guide
  - Collection operators guide
  - Iterator guide
  - String methods guide
  - Example workflows
  - Formal EBNF grammar

[Unreleased]: https://github.com/rcrsr/rill/compare/v0.8.6...HEAD
[0.8.6]: https://github.com/rcrsr/rill/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/rcrsr/rill/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/rcrsr/rill/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/rcrsr/rill/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/rcrsr/rill/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/rcrsr/rill/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/rcrsr/rill/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/rcrsr/rill/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/rcrsr/rill/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/rcrsr/rill/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/rcrsr/rill/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/rcrsr/rill/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/rcrsr/rill/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/rcrsr/rill/compare/v0.4.5...v0.5.0
[0.4.5]: https://github.com/rcrsr/rill/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/rcrsr/rill/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/rcrsr/rill/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/rcrsr/rill/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/rcrsr/rill/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/rcrsr/rill/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rcrsr/rill/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/rcrsr/rill/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/rcrsr/rill/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/rcrsr/rill/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/rcrsr/rill/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rcrsr/rill/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rcrsr/rill/compare/v0.0.5...v0.1.0
[0.0.5]: https://github.com/rcrsr/rill/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/rcrsr/rill/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/rcrsr/rill/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/rcrsr/rill/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/rcrsr/rill/releases/tag/v0.0.1
