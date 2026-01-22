# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/rcrsr/rill/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/rcrsr/rill/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/rcrsr/rill/releases/tag/v0.0.1
