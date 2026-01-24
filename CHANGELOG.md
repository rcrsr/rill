# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/rcrsr/rill/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rcrsr/rill/compare/v0.0.5...v0.1.0
[0.0.5]: https://github.com/rcrsr/rill/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/rcrsr/rill/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/rcrsr/rill/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/rcrsr/rill/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/rcrsr/rill/releases/tag/v0.0.1
