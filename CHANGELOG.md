# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Namespaced Functions** — Host functions can use `::` separator for organization
  - Register: `functions: { 'math::add': (args) => ... }`
  - Call: `math::add(1, 2)` or `5 -> math::double`
  - Supports multi-level: `io::file::read("path")`

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

[Unreleased]: https://github.com/rcrsr/rill/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/rcrsr/rill/releases/tag/v0.0.1
