# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Backend-swappable kv and fs extensions** — kv extension transformed to mount-based architecture matching fs pattern with 3 new functions (`merge`, `get_or`, `mounts`) and access mode enforcement. Three new packages (`@rcrsr/rill-ext-storage-sqlite`, `@rcrsr/rill-ext-storage-redis`, `@rcrsr/rill-ext-storage-s3`) provide SQLite (single-server), Redis (distributed), and S3 (cloud storage) backends. Contract types (`KvExtensionContract`, `FsExtensionContract`) exported from core barrel for compile-time verification. SQLite uses better-sqlite3 with WAL mode for concurrent safety; Redis uses ioredis with atomic merge via WATCH/MULTI; S3 supports AWS S3 and S3-compatible services. Backend selection strategy documented: dev uses JSON, single-server uses SQLite, multi-server uses Redis, cloud uses S3. All backends implement identical API contracts (11 kv, 12 fs functions) validated via cross-backend integration tests. Performance validated: SQLite p95 read under 10ms for 100K keys, concurrent writes verified across all backends

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

[Unreleased]: https://github.com/rcrsr/rill/compare/v0.8.0...HEAD
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
