# rill Error Reference

*Comprehensive error documentation for troubleshooting and debugging*

This document catalogs all error conditions in rill with descriptions, common causes, and resolution strategies. Each error has a unique ID formatted as `RILL-{category}{number}` (e.g., `RILL-R001`).

**Error Categories:**

- **L**: Lexer errors (tokenization failures)
- **P**: Parse errors (syntax violations)
- **R**: Runtime errors (execution failures)
- **C**: Check errors (CLI tool validation)
- **CFG**: Config errors (rill-config load-time failures and handler param errors)

**Navigation:**

- [Lexer Errors (RILL-L001 - RILL-L005)](#lexer-errors)
- [Parse Errors (RILL-P001 - RILL-P005, RILL-P007 - RILL-P010)](#parse-errors)
- [Runtime Errors (RILL-R001 - RILL-R016, RILL-R036 - RILL-R044, RILL-R050 - RILL-R061)](#runtime-errors)
- [Check Errors (RILL-C001 - RILL-C004)](#check-errors)
- [Config Errors (RILL-CFG001 - RILL-CFG018)](#config-errors)

---

## Lexer Errors

Lexer errors occur during tokenization when the source text contains invalid character sequences or malformed literals.

### rill-l001

**Description:** Unterminated string literal

**Cause:** String opened with quote but never closed before end of line or file.

**Resolution:** Add closing quote to complete the string, or use multiline strings with triple quotes (""") for multi-line content.

**Example:**

```text
# Missing closing quote on single line
"hello

# Newline inside single-quoted string
"hello
world"
```

---

### rill-l002

**Description:** Invalid character

**Cause:** Character not recognized by the lexer (not part of rill syntax).

**Resolution:** Remove or replace the invalid character. Common causes: unicode characters in identifiers, unsupported operators, or copy-paste artifacts.

**Example:**

```text
# Unicode character in code
$x → "value"  # → is not valid, use ->

# Backtick instead of quote
`hello`  # Use "hello" instead
```

---

### rill-l003

**Description:** Invalid number format

**Cause:** Number contains invalid characters, multiple decimal points, or unsupported notation.

**Resolution:** Use valid number format: integers (123), decimals (1.5), or scientific notation (1e5). No underscores, trailing dots, or multiple decimals allowed.

**Example:**

```text
# Multiple decimal points
1.2.3

# Trailing decimal point
123.

# Leading zeros (octal notation not supported)
0123
```

---

### rill-l004

**Description:** Unterminated multiline string

**Cause:** Multiline string opened with triple quotes (""") but never closed.

**Resolution:** Add closing triple quotes (""") to complete the multiline string.

**Example:**

```text
# Missing closing triple quotes
"""hello
world

# Only two closing quotes instead of three
"""content""
```

---

### rill-l005

**Description:** Invalid escape sequence

**Cause:** Backslash followed by unsupported character in string literal.

**Resolution:** Use valid escape sequences: \n (newline), \t (tab), \\ (backslash), \" (quote), \{ (brace). For literal backslash, use \\.

**Example:**

```text
# Invalid escape character
"hello\xworld"  # \x not supported

# Incomplete escape at end
"path\
```

---

## Parse Errors

Parse errors occur when token sequences violate rill syntax rules during AST construction.

### rill-p001

**Description:** Unexpected token

**Cause:** Token appears in invalid position according to grammar rules.

**Resolution:** Check syntax at the indicated position. Common causes: missing operators, mismatched delimiters, or keywords in wrong context.

**Example:**

```text
# Missing pipe operator between expressions
"hello" "world"  # Missing -> between

# Statement starting with operator
-> "value"  # Missing left side

# Unexpected closing brace
{ "value" }}  # Extra closing brace
```

---

### rill-p002

**Description:** Unexpected end of input

**Cause:** File or block ended while parser expected more tokens (incomplete expression or statement).

**Resolution:** Complete the incomplete construct. Common causes: unclosed blocks, incomplete pipe chains, or missing expression after operator.

**Example:**

```text
# Unclosed block
{ "value"

# Pipe with no target
"hello" ->

# Incomplete conditional
?($x > 0) "yes"  # Missing else branch
```

---

### rill-p003

**Description:** Invalid type annotation

**Cause:** Type name not recognized. rill supports: string, number, bool, closure, list, dict, tuple.

**Resolution:** Use valid type name from supported set. Check spelling and casing (types are lowercase).

**Example:**

```text
# Uppercase type name
$x => String  # Use "string" not "String"

# Invalid type name
$x => int  # Use "number" for all numeric types

# Generic type syntax not supported
$x => list<string>  # Use "list" only
```

---

### rill-p004

**Description:** Invalid expression

**Cause:** Expression structure violates grammar rules or contains unsupported constructs.

**Resolution:** Check expression syntax. Common causes: invalid operator combinations, malformed literals, or unsupported language features.

**Example:**

```text
# Double operators
$x + + $y

# Assignment operator (not supported)
$x = 5  # Use "5 => $x" instead
```

---

### rill-p005

**Description:** Missing delimiter

**Cause:** Expected closing delimiter (parenthesis, bracket, brace) not found.

**Resolution:** Add the missing delimiter. Check for proper nesting and matching pairs.

**Example:**

```text
# Missing closing parenthesis
func($a, $b

# Missing closing bracket in tuple
[1, 2, 3

# Mismatched delimiters
{ "value"]  # Opened with { but closed with ]
```

---

### rill-p007

**Description:** Whitespace between keyword and bracket in literal

**Cause:** A space appears between a collection keyword (`list`, `dict`, `tuple`, `ordered`) and its opening bracket. This is a parse error.

**Resolution:** Remove the space between the keyword and `[`. Write `list[1, 2]` not `list [1, 2]`.

**Example:**

```text
# Space between keyword and bracket
list [1, 2, 3]    # RILL-P007: use list[1, 2, 3]
dict [a: 1]       # RILL-P007: use dict[a: 1]
tuple [1, 2]      # RILL-P007: use tuple[1, 2]
ordered [a: 1]    # RILL-P007: use ordered[a: 1]
```

---

### rill-p008

**Description:** Bare bracket literal (deprecated)

**Cause:** This error was removed. Bare `[...]` syntax is valid for list and dict literals. Both `[1, 2]` and `list[1, 2]` are accepted.

---

### rill-p009

**Description:** Old sigil syntax for collection literals or extraction operators

**Cause:** Code uses removed sigil-based syntax: `*[...]` for tuples/ordered, `*<...>` for destructure, or `/<...>` for slice.

**Resolution:** Replace old sigil forms with keyword forms.

| Old syntax | New syntax |
|------------|------------|
| `*[1, 2]` | `tuple[1, 2]` |
| `*[a: 1]` | `ordered[a: 1]` |
| `*<$a, $b>` | `destruct<$a, $b>` |
| `/<1:3>` | `slice<1:3>` |

**Example:**

```text
# Old tuple sigil
*[1, 2, 3] -> $fn()   # RILL-P009: use tuple[1, 2, 3] -> $fn(...)

# Old destruct sigil
[1, 2] -> *<$a, $b>   # RILL-P009: use [1, 2] -> destruct<$a, $b>

# Old slice sigil
[0,1,2] -> /<1:3>     # RILL-P009: use [0,1,2] -> slice<1:3>
```

---

### rill-p010

**Description:** Old chain sigil syntax

**Cause:** Code uses the removed `@[...]` or `@$fn` chain sigil syntax.

**Resolution:** Replace chain sigil with the `chain()` built-in function.

| Old syntax | New syntax |
|------------|------------|
| `5 -> @[$inc, $double]` | `5 -> chain([$inc, $double])` |
| `5 -> @$fn` | `5 -> chain($fn)` |

**Example:**

```text
# Old chain sigil
5 -> @[$inc, $double]      # RILL-P010: use 5 -> chain([$inc, $double])
5 -> @$fn                  # RILL-P010: use 5 -> chain($fn)
```

---

## Runtime Errors

Runtime errors occur during script execution when operations fail due to type mismatches, undefined references, or violated constraints.

### rill-r001

**Description:** Parameter type mismatch

**Cause:** Argument passed to function does not match declared parameter type. Also raised when a piped value does not match the declared anonymous parameter type in an anonymous typed closure (`|type|{ body }`).

**Resolution:** Pass value of correct type, or convert the value before passing. Check function signature for expected types.

**Example:**

```text
# String passed to number parameter
|x: number| $x * 2
"5" -> $()

# Number passed to string method
123 -> .split(",")  # split expects string

# Anonymous typed closure: piped value type does not match declared parameter type
"hello" -> |number|{ $ * 2 }
# Error: RILL-R001: Parameter type mismatch: $ expects number, got string
```

---

### rill-r002

**Description:** Operator type mismatch

**Cause:** Binary operator applied to incompatible types. rill does not perform implicit type coercion.

**Resolution:** Ensure both operands are compatible types. Convert values explicitly if needed using type-specific methods.

**Example:**

```text
# Adding string and number
"5" + 1  # Error: no implicit coercion

# Comparing different types
"10" == 10  # Always false, no coercion

# Arithmetic on non-numbers
"hello" * 2
```

---

### rill-r003

**Description:** Method receiver type mismatch

**Cause:** Method called on value of wrong type. String methods require strings, list methods require lists, etc.

**Exclusion:** `RILL-R003` is not triggered by `.^description`, `.^input`, or `.^output` on any callable kind. Annotation reflection operators work on all callable kinds (script, application, runtime) without raising this error.

**Resolution:** Call method on correct type, or convert value before calling. Check method documentation for receiver type.

**Example:**

```text
# String method on number
123 -> .upper()  # upper() is string method

# List method on string
"hello" -> .first()  # first() is list method
```

---

### rill-r004

**Description:** Type conversion failure or return type assertion failure

**Cause:** Two distinct causes raise RILL-R004:

1. **Type conversion failure** — Value cannot be converted to target type via the `:>` operator (invalid format or incompatible types).
2. **Return type assertion failure** — Closure return type annotation (`:type` after `}`) does not match the actual return value type.

**Resolution:** For type conversion: ensure the value has valid format for the target type. For string-to-number, check numeric format. For parse operations, validate input structure. For return type assertions: ensure the closure body produces a value of the declared return type.

**Example:**

```text
# Invalid number string
"abc" -> to_number()  # Not a valid number

# Closure serialization
json({ "hi" })

# Return type annotation mismatch
5 -> |number|{ "hello" }:number
# Error: RILL-R004: Type assertion failed: expected number, got string
```

---

### rill-r005

**Description:** Undefined variable

**Cause:** Variable referenced before assignment, or variable name misspelled. Also raised when `$` is accessed inside a no-args closure (`||{ }`) where no piped value is bound.

**Resolution:** Assign value to variable before use (value => $var), or check spelling. Variables must be captured before reference. Do not access `$` in no-args closures — use named parameters or pipe a value to an anonymous typed closure instead.

**Example:**

```text
# Variable used before assignment
$count + 1  # $count never assigned

# Typo in variable name
"hi" => $mesage
$message  # Typo: mesage vs message

# Variable out of scope
{ "local" => $x }
$x  # $x only exists inside block

# $ accessed in no-args closure ($ is not bound)
||{ $ }
# Error: RILL-R005: Undefined variable: $
```

---

### rill-r006

**Description:** Undefined function

**Cause:** Function name not found in runtime context (not a built-in or host-provided function).

**Resolution:** Check function name spelling, ensure function is provided by host application, or verify module imports.

**Example:**

```text
# Misspelled function name
leng("hello")  # Should be length()

# Missing host function
app::fetch($url)  # Host must provide app::fetch
```

---

### rill-r007

**Description:** Undefined method

**Cause:** Method name not supported for the given type, or method name misspelled.

**Resolution:** Check method documentation for the type. Verify method name spelling and that it exists for this type.

**Example:**

```text
# Method not available on type
123 -> .trim()  # trim() only on strings

# Misspelled method name
"hello" -> .upcase()  # Should be .upper()
```

---

### rill-r008

**Description:** Undefined annotation or annotation access on type value

**Cause:** Two conditions raise RILL-R008:

1. **Missing annotation** — Annotation key accessed but not set on a statement or named parameter.
2. **Type value annotation access** — `.^key` accessed on a type value (e.g., `string`, `number`, `list`). Type values are not annotation containers and do not support annotation access.

**Resolution:** For missing annotations: set the annotation before accessing (`^(key: value)`), or check annotation key spelling. For type value access: do not use `.^` on type values — use `.^` only on dict-bound closures or annotated statements.

**Example:**

```text
# Accessing undefined annotation on a callable
$stmt.^timeout  # No ^(timeout: ...) set

# Annotation access on a type value
string.^label  # Error: RILL-R008: Annotation access not supported on type values
```

---

### rill-r009

**Description:** Property not found

**Cause:** Dict key or tuple index does not exist in the value.

**Resolution:** Check property name spelling, verify the property exists, or use null-coalescing (??) to provide default. For safe access, use .? operator.

**Example:**

```text
# Missing dict key
[name: "x"] -> .age  # age key not in dict

# Index out of bounds
[1, 2, 3] -> [5]  # Only 3 elements (0-2)

# Safe alternative
[name: "x"] -> .age ?? 0  # Returns 0 if missing
```

---

### rill-r010

**Description:** Iteration limit exceeded

**Cause:** Loop or collection operation exceeded configured iteration limit (prevents infinite loops).

**Resolution:** Reduce data size, adjust iteration limit via RuntimeOptions, or check for infinite loop conditions.

**Example:**

```text
# Infinite loop without termination
(true) @ { "looping" }  # Never terminates

# Large collection with default limit
range(0, 1000000) -> each |x| $x  # May exceed default limit
```

---

### rill-r011

**Description:** Invalid regex pattern

**Cause:** Regular expression pattern has invalid syntax or unsupported features.

**Resolution:** Fix regex syntax errors. Check for unescaped special characters, unclosed groups, or invalid quantifiers.

**Example:**

```text
# Unclosed group
"test" -> .match("(abc")  # Missing closing )

# Invalid quantifier
"test" -> .match("a{,5}")  # Empty min in range
```

---

### rill-r012

**Description:** Operation timeout

**Cause:** Function execution exceeded configured timeout duration.

**Resolution:** Increase timeout via RuntimeOptions, optimize slow operations, or add ^(timeout: ms) annotation to specific calls.

**Example:**

```text
# Slow host function
app::slow_api()  # Times out if exceeds limit

# Setting higher timeout
^(timeout: 30000) app::slow_api()  # 30 seconds
```

---

### rill-r013

**Description:** Execution aborted

**Cause:** Host application cancelled execution via AbortSignal.

**Resolution:** This is intentional cancellation, not an error. If unexpected, check host abort signal logic.

**Example:**

```text
# User cancellation in UI
# Long-running script cancelled by user
```

---

### rill-r014

**Description:** Auto-exception triggered

**Cause:** Value matched auto-exception pattern (configured to halt on specific error patterns in output).

**Resolution:** Handle error condition that produced the matched pattern, or adjust auto-exception configuration.

**Example:**

```text
# API error response
# API returned "ERROR:" prefix, auto-exception configured to catch this
```

---

### rill-r015

**Description:** Assertion failed

**Cause:** Assertion statement evaluated to false.

**Resolution:** Fix the condition causing assertion failure, or remove/adjust assertion if condition is incorrect.

**Example:**

```text
# Basic assertion
assert $count > 0  # Fails if $count <= 0

# Assertion with message
assert $age >= 18 "Must be adult"
```

---

### rill-r016

**Description:** Error statement executed

**Cause:** Error statement executed explicitly in code.

**Resolution:** This is intentional error raising. Fix the condition that triggers the error statement, or handle the error case differently.

**Example:**

```text
# Explicit error
error "Invalid configuration"

# Conditional error
($status == "failed") ? { error "Process failed" } ! "ok"
```

---

### rill-r036

**Description:** Incompatible convert source/target

**Cause:** The `:>` operator does not support conversion between the given source and target types.

**Resolution:** Check the type conversion compatibility matrix. Not all combinations are valid (e.g. `string :>list` is not allowed).

**Example:**

```text
# String to list conversion
"hello" -> :>list  # Not allowed
```

---

### rill-r037

**Description:** dict :>ordered without structural signature

**Cause:** Converting a dict to ordered with `:>ordered` requires an explicit `ordered(field: type, ...)` type signature to determine field order.

**Resolution:** Provide a structural type signature: `$dict -> :>ordered(name: string, age: number)`

**Example:**

```text
# Missing structural signature
$dict -> :>ordered  # Ambiguous field order
```

---

### rill-r038

**Description:** Non-parseable string to number

**Cause:** The string does not represent a valid number.

**Resolution:** Ensure the string contains a valid numeric format before converting with `:>number`.

**Example:**

```text
# Non-numeric string
"hello" -> :>number  # Not a number
```

---

### rill-r039

**Description:** :>$var not a type value

**Cause:** The variable used with `:>$var` does not hold a type value.

**Resolution:** Ensure the variable holds a type value (e.g. from a type name expression like `list` or `string`).

**Example:**

```text
# Variable is a string, not a type
"list" => $t
$x -> :>$t  # $t is string, not a type value
```

---

### rill-r040

**Description:** chain() non-closure argument

**Cause:** The `chain()` built-in received a value that is neither a closure nor a list of closures.

**Resolution:** Pass a single closure or a list of closures to `chain()`.

**Example:**

```text
# Passing a number to chain()
5 -> chain(42)  # 42 is not a closure
```

---

### rill-r041

**Description:** List dispatch non-integer index

**Cause:** The index piped to a `[...]` dispatch is not an integer.

**Resolution:** Ensure the index is a whole number. Use math operations to convert if needed.

**Example:**

```text
# Floating-point index
1.5 -> ["a", "b"]  # Not an integer
```

---

### rill-r042

**Description:** List dispatch index out of range

**Cause:** The index piped to a `[...]` dispatch is outside the valid range.

**Resolution:** Use an index within `[0, length-1]` or add a fallback with `??`.

**Example:**

```text
# Index beyond end
5 -> ["a", "b"]  # Only 2 elements (indices 0-1)
```

---

### rill-r043

**Description:** Non-producing body

**Cause:** A closure body or script produced no value. Two conditions trigger this error:

1. **Empty closure body** — A closure with a non-empty block that contains no pipe-producing statements (e.g., `|x| { }` invoked).
2. **Non-producing script** — A script contains only comments or no statements that produce a pipe value.

This replaces the former incorrect use of RILL-R005 for empty scripts.

**Resolution:** Ensure the closure body or script ends with a statement that produces a value. Every closure and script must yield at least one pipe value.

**Example:**

```text
# Empty closure body invoked
|x| { } -> $(1)
# Error: RILL-R043: Non-producing body

# Script with only a comment (no pipe value)
# This script produces nothing
# Error: RILL-R043: Non-producing body
```

---

### rill-r044

**Description:** Missing required field during structural conversion.

**Cause:** The `:>` operator requires all fields without defaults to be present in the source value. A field without a default was absent from the source dict.

**Resolution:** Supply the missing field in the source value, or add a default to the type annotation.

**Example:**

```text
{ name: "Alice" } :> { name: str, age: int }
# Error: RILL-R044: cannot convert {name: "Alice"} to {name: str, age: int}: missing required field 'age'
```

---

### rill-r050

**Description:** Module not found in resolver config

**Cause:** The module ID is absent from the moduleResolver config map.

**Resolution:** Add an entry for the module ID to the moduleResolver config object.

**Example:**

```text
# moduleResolver config lacks a "greetings" key
use<module:greetings>
# Error: RILL-R050: Module 'greetings' not found in resolver config
```

---

### rill-r051

**Description:** Module file read failure

**Cause:** The file path mapped to the module ID could not be read.

**Resolution:** Verify the file path exists and the process has read permission.

**Example:**

```text
# The file path mapped to "greetings" does not exist
use<module:greetings>
# Error: RILL-R051: Module 'greetings' file read failure
```

---

### rill-r052

**Description:** Extension not found in resolver config

**Cause:** The extension name is absent from the extResolver config map.

**Resolution:** Add an entry for the extension name to the extResolver config object.

**Example:**

```text
# extResolver config lacks a "qdrant" key
use<ext:qdrant>
# Error: RILL-R052: Extension 'qdrant' not found in resolver config
```

---

### rill-r053

**Description:** Member path not found in extension

**Cause:** A `use<ext:name.path>` expression references a dot-path member that does not exist in the extension value. The `{path}` in the error message reports the full attempted path including the failing segment, not just the successfully traversed portion.

**Resolution:** Verify the member path matches the structure of the extension dict. Check the dict returned by the host for the extension name. See [Host Integration](integration-host.md) for extension registration details.

**Example:**

```text
# qdrant extension is registered, but "missing" key does not exist
use<ext:qdrant.missing>
# Error: RILL-R053: Member 'qdrant.missing' not found in extension 'qdrant'
```

---

### rill-r054

**Description:** No resolver registered for scheme

**Cause:** A `use<scheme:path>` expression references a scheme that has no registered resolver in the host runtime.

**Resolution:** Register a resolver for the scheme via the host API before executing scripts that use it. See [Host Integration](integration-host.md) for resolver registration details.

**Example:**

```text
# No resolver registered for "db" scheme
use<db:users>
# Error: RILL-R054: No resolver registered for scheme 'db'
```

---

### rill-r055

**Description:** Circular resolution detected

**Cause:** A module resolution chain forms a cycle. Module A resolves to module B, which directly or indirectly resolves back to module A.

**Resolution:** Break the cycle by restructuring module dependencies. Extract shared logic into a third module that neither circular participant imports. See [Modules](integration-modules.md) for module design patterns.

**Example:**

```text
# module-a imports module-b, module-b imports module-a
use<app:module-a>
# Error: RILL-R055: Circular resolution detected: app:module-a is already being resolved
```

---

### rill-r056

**Description:** Resolver callback threw an error

**Cause:** The registered resolver function for the given scheme threw an exception.

**Resolution:** Inspect the original error message in the RILL-R056 detail and fix the resolver implementation.

**Example:**

```text
# The api resolver throws "connection refused"
use<api:users>
# Error: RILL-R056: Resolver 'api' threw an error: connection refused
```

---

### rill-r057

**Description:** use<> identifier must resolve to string

**Cause:** Variable or computed form of use<> evaluated to a non-string value.

**Resolution:** Ensure the variable or expression inside use<> evaluates to a string of the form "scheme:resource".

**Example:**

```text
# $id must be a string, not a number
42 => $id
use<$id>
# Error: RILL-R057: use<> identifier must resolve to string
```

---

### rill-r058

**Description:** use<> identifier must contain ':' scheme separator

**Cause:** The dynamic use<> string did not contain a colon separating scheme from resource.

**Resolution:** Ensure the string has the format "scheme:resource". Example: "module:greetings".

**Example:**

```text
# Missing : separator
"nocolon" => $id
use<$id>
# Error: RILL-R058: use<> identifier must contain ':' scheme separator
```

---

### rill-r059

**Description:** moduleResolver config is not a plain object

**Cause:** The config passed to moduleResolver is not a plain object.

**Resolution:** Pass a plain object as the moduleResolver config.

**Example:**

```text
# moduleResolver config was null or an array
use<module:greetings>
# Error: RILL-R059: moduleResolver config is not a plain object
```

---

### rill-r060

**Description:** Removed frontmatter key used

**Cause:** Script uses a frontmatter key that was removed (`use:` or `export:` frontmatter).

**Resolution:** Use `use<module:...>` expressions instead of `use:` frontmatter. Use last-expression result instead of `export:` frontmatter.

**Example:**

```text
---
use:
  - myMod: ./mod.rill
---
# Error: RILL-R060: use: frontmatter is removed; use use<module:...> expression instead
```

---

### rill-r061

**Description:** parseSource not configured in RuntimeContext

**Cause:** A resolver returned `{ kind: "source" }` but RuntimeOptions.parseSource was not provided.

**Resolution:** Pass parseSource in RuntimeOptions when constructing the runtime context.

**Example:**

```text
# Resolver returns { kind: "source", text: "..." } but host did not pass parseSource
use<app:module-a>
# Error: RILL-R061: parseSource not configured in RuntimeContext
```

---

## Check Errors

Check errors occur in the `rill-check` CLI tool during file validation and configuration processing.

### rill-c001

**Description:** File not found

**Cause:** Specified file path does not exist in filesystem.

**Resolution:** Verify file path is correct, check file exists, or create the file if it should exist.

**Example:**

```text
# Nonexistent file
rill-check missing.rill

# Wrong file extension
rill-check script.txt  # Should be script.rill
```

---

### rill-c002

**Description:** File unreadable

**Cause:** File exists but cannot be read (permission denied or IO error).

**Resolution:** Check file permissions, ensure read access, or verify file is not locked by another process.

**Example:**

```text
# Permission denied
rill-check protected.rill  # File exists but no read permission
```

---

### rill-c003

**Description:** Invalid configuration

**Cause:** Configuration file or options contain invalid values or structure.

**Resolution:** Fix configuration syntax, ensure all required fields are present, and values are of correct type.

**Example:**

```text
# Invalid JSON in config
# .rillrc.json contains malformed JSON

# Unknown config option
# Config contains unsupported option key
```

---

### rill-c004

**Description:** Fix collision detected

**Cause:** Multiple auto-fix rules attempt to modify the same source location.

**Resolution:** Apply fixes one at a time, or disable conflicting lint rules. Some fixes may need manual resolution.

**Example:**

```text
# Overlapping fix ranges
# Two rules try to fix same code section
```

---

## Config Errors

Config errors occur during `rill-config` load-time processing and handler parameter validation. They are thrown by the `@rcrsr/rill-config` package before the rill runtime starts.

### rill-cfg001

**Description:** Config file not found

**Cause:** `rill-config` walked the directory tree to the filesystem root without finding a `rill.config.json`, or an explicit config path was provided but the file does not exist.

**Resolution:** Create a `rill.config.json` in the project root, or verify the explicit path passed to the config loader.

**Example:**

```text
# No rill.config.json found walking from /home/user/project to /
# Error: RILL-CFG001: Config file not found
```

---

### rill-cfg002

**Description:** Config parse error

**Cause:** The `rill.config.json` file contains invalid JSON (syntax error, trailing comma, or unquoted key).

**Resolution:** Fix the JSON syntax. Use a JSON validator or `JSON.parse()` in a Node REPL to locate the error. Ensure all keys are quoted and no trailing commas exist.

**Example:**

```text
# rill.config.json with trailing comma
{ "runtime": "^0.9.0", }
# Error: RILL-CFG002: Config parse error: Unexpected token } at position 22
```

---

### rill-cfg003

**Description:** Config environment variable not set

**Cause:** The config file contains a `${VAR_NAME}` placeholder but the referenced environment variable is not set in the current process environment.

**Resolution:** Set the missing environment variable before running the CLI, or replace the placeholder with a literal value.

**Example:**

```text
# rill.config.json references ${API_KEY} but API_KEY is not set
{ "context": { "apiKey": "${API_KEY}" } }
# Error: RILL-CFG003: Config environment variable not set: API_KEY
```

---

### rill-cfg004

**Description:** Config validation error — wrong field type

**Cause:** A top-level config field has the wrong type. For example, `runtime` must be a string, `extensions` must be an object, and `context` must be an object.

**Resolution:** Fix the field value to match the expected type. See the config schema in the `@rcrsr/rill-config` package documentation.

**Example:**

```text
# "runtime" must be a string, not a number
{ "runtime": 9 }
# Error: RILL-CFG004: Config validation error: 'runtime' must be string, got number
```

---

### rill-cfg005

**Description:** Config validation error — orphaned config key

**Cause:** An `extensions.config` entry references a package that has no corresponding mount in `extensions.mounts`.

**Resolution:** Add the missing package to `extensions.mounts`, or remove the orphaned key from `extensions.config`.

**Example:**

```text
# "my-pkg" appears in config but not in mounts
{ "extensions": { "mounts": {}, "config": { "my-pkg": {} } } }
# Error: RILL-CFG005: Config validation error: 'extensions.config' key 'my-pkg' has no matching mount
```

---

### rill-cfg006

**Description:** Config validation error — empty path or handler name

**Cause:** The `main` field has an empty file path, or the handler name after the colon separator is empty (e.g., `"main": ":handler"` or `"main": "script.rill:"`).

**Resolution:** Provide both a non-empty path and a non-empty handler name in the `main` field using the format `"path/to/script.rill:handlerName"`.

**Example:**

```text
# Handler name is empty after colon
{ "main": "script.rill:" }
# Error: RILL-CFG006: Config validation error: 'main' handler name is empty
```

---

### rill-cfg007

**Description:** Runtime version constraint not satisfied

**Cause:** The installed `@rcrsr/rill` version does not satisfy the semver constraint declared in the config `runtime` field.

**Resolution:** Update `@rcrsr/rill` to a version that satisfies the constraint, or relax the constraint in `rill.config.json`.

**Example:**

```text
# Installed rill is 0.8.2, config requires "^0.9.0"
{ "runtime": "^0.9.0" }
# Error: RILL-CFG007: Runtime version error: installed 0.8.2 does not satisfy ^0.9.0
```

---

### rill-cfg008

**Description:** Mount validation error

**Cause:** Two conditions raise RILL-CFG008:

1. **Invalid path segment** — A mount path contains characters outside `[a-z0-9-_]`, starts with a digit, or is empty.
2. **Conflicting version constraints** — Two mounts reference the same package with incompatible semver constraints.

**Resolution:** Fix path segment characters to use only lowercase alphanumeric, hyphens, and underscores. Resolve conflicting version constraints so mounts agree on a compatible range.

**Example:**

```text
# Mount path contains uppercase
{ "extensions": { "mounts": { "My-Pkg": "pkg@^1.0" } } }
# Error: RILL-CFG008: Mount validation error: path 'My-Pkg' contains invalid characters

# Two mounts specify incompatible versions for same package
# Error: RILL-CFG008: Mount validation error: conflicting version constraints for 'pkg'
```

---

### rill-cfg009

**Description:** Extension load error

**Cause:** Three conditions raise RILL-CFG009:

1. **Package not found** — The npm package name in the mount could not be resolved or installed.
2. **Missing manifest** — The package does not export an `extensionManifest` named export.
3. **Factory threw** — The extension's factory function threw during initialization.

**Resolution:** Verify the package name is correct and installed. Ensure the package exports a valid `extensionManifest`. Check factory logs for initialization errors.

**Example:**

```text
# Package "@rcrsr/rill-ext-qdrant" not found
{ "extensions": { "mounts": { "db": "@rcrsr/rill-ext-qdrant@^1.0" } } }
# Error: RILL-CFG009: Extension load error: '@rcrsr/rill-ext-qdrant' not found
```

---

### rill-cfg010

**Description:** Namespace mismatch error

**Cause:** The mount path prefix does not match the namespace declared in the extension's `extensionManifest`. The extension expects to be mounted at a specific prefix, but the config uses a different one.

**Resolution:** Change the mount key in `extensions.mounts` to match the namespace declared by the extension, or update the extension to accept the desired mount prefix.

**Example:**

```text
# Extension declares namespace "vector", but mounted at "db"
{ "extensions": { "mounts": { "db": "ext-vector@^1.0" } } }
# Error: RILL-CFG010: Namespace mismatch: extension 'ext-vector' expects 'vector', mounted at 'db'
```

---

### rill-cfg011

**Description:** Namespace collision error

**Cause:** Two different extensions claim the same namespace or overlapping mount path prefixes, causing an ambiguous function resolution conflict.

**Resolution:** Change one mount path to use a unique prefix. No two extensions may share a namespace prefix in the same config.

**Example:**

```text
# Two extensions both declare namespace "data"
{ "extensions": { "mounts": { "data-a": "ext-a@^1.0", "data-b": "ext-b@^1.0" } } }
# Error: RILL-CFG011: Namespace collision: 'ext-a' and 'ext-b' both claim namespace 'data'
```

---

### rill-cfg012

**Description:** Extension version constraint not satisfied

**Cause:** The extension package's declared version does not satisfy the semver constraint in the mount entry.

**Resolution:** Update the extension package to a compatible version, or relax the version constraint in `extensions.mounts`.

**Example:**

```text
# Installed ext-qdrant is 0.3.1, mount requires "^1.0.0"
{ "extensions": { "mounts": { "db": "ext-qdrant@^1.0.0" } } }
# Error: RILL-CFG012: Extension version error: 'ext-qdrant' 0.3.1 does not satisfy ^1.0.0
```

---

### rill-cfg013

**Description:** Context validation error — missing value

**Cause:** A key declared in the context schema has no corresponding value in the provided context object. The schema defines a required key that was not supplied.

**Resolution:** Add the missing key to the context object passed at startup, or remove the key from the schema if it is optional.

**Example:**

```text
# Schema requires "userId" but context object does not include it
# Error: RILL-CFG013: Context validation error: missing context value for key 'userId'
```

---

### rill-cfg014

**Description:** Context validation error — type mismatch

**Cause:** A context value's runtime type does not match the type declared in the context schema. For example, the schema declares `userId: number` but the provided value is a string.

**Resolution:** Fix the context value to match the declared type, or update the schema to reflect the actual type.

**Example:**

```text
# Schema: { "userId": "number" }, actual value: "abc"
# Error: RILL-CFG014: Context validation error: 'userId' expects number, got string
```

---

### rill-cfg015

**Description:** Bundle restriction error

**Cause:** The config contains `extensions.config` or `context` fields, which are not permitted in bundle mode. Bundle mode is read-only and cannot load extension-specific config or runtime context values.

**Resolution:** Remove `extensions.config` and `context` from the config file when operating in bundle mode, or switch to non-bundle mode.

**Example:**

```text
# Bundle mode config with forbidden fields
{ "context": { "apiKey": "secret" }, "extensions": { "config": {} } }
# Error: RILL-CFG015: Bundle restriction: 'context' and 'extensions.config' are not allowed in bundle mode
```

---

### rill-cfg016

**Description:** Handler arg error — missing required param

**Cause:** A required handler parameter was not provided when invoking a rill handler via the CLI or host API. The handler declares the parameter as required (no default value) but no value was passed.

**Resolution:** Provide the missing parameter. Check the handler's parameter list with `rill-check --params` to see all required parameters.

**Example:**

```text
# Handler requires "--user-id" but it was not passed
rill-run script.rill:processUser
# Error: RILL-CFG016: Handler arg error: missing required param '--user-id'
```

---

### rill-cfg017

**Description:** Handler arg error — type coercion failure

**Cause:** A CLI flag value cannot be coerced to the type declared by the handler parameter. For example, passing `--count=abc` for a `number` parameter.

**Resolution:** Pass a value that matches the declared type. Numbers must be valid numeric strings. Booleans accept `true` or `false`.

**Example:**

```text
# Handler declares "--count: number" but "abc" cannot be parsed as number
rill-run script.rill:processItems --count=abc
# Error: RILL-CFG017: Handler arg error: '--count' value 'abc' cannot be coerced to number
```

---

### rill-cfg018

**Description:** Handler arg error — unknown flag

**Cause:** A CLI flag was passed that does not match any declared parameter in the handler. The handler does not accept the given flag name.

**Resolution:** Remove the unknown flag, or check the handler's parameter list. Use `rill-check --params` to list all accepted flags for the handler.

**Example:**

```text
# Handler does not declare "--verbose"
rill-run script.rill:processItems --verbose
# Error: RILL-CFG018: Handler arg error: unknown flag '--verbose'
```

---

> **File size note (AC-65):** This file is over 1000 lines after adding the Config Errors section (RILL-CFG001 through RILL-CFG018). Consider splitting config error entries into a dedicated `ref-errors-config.md` file if the section grows further.

## Error Handling Patterns

### Defensive Checks

Prevent runtime errors with existence and type checks:

```rill
# Check variable existence before use
[apiKey: "secret123"] => $config
$config.?apiKey ? $config.apiKey ! "default-key"

# Check type before method call
"test" => $value
$value :? string ? ($value -> .upper) ! $value

# Validate before conversion
"42" => $input
$input -> .is_match("^-?[0-9]+(\\.[0-9]+)?$") ? ($input -> :>number) ! 0
```

### Default Values

Provide fallbacks for missing properties:

```rill
# Field with default
[name: "Alice", age: 30] => $user
$user.email ?? "no-email@example.com"

# Annotation with default
|x|($x) => $fn
$fn.^timeout ?? 30

# Dict dispatch with default
[a: 1, b: 2, c: 3] => $lookup
"b" -> $lookup ?? "not found"
```

### Type Assertions

Explicitly verify and convert types:

```rill
# Assert type before operation
"  hello  " => $input
$input:string -> .trim

# Check type before calling method
[1, 2, 3] => $items
$items :? list ? ($items -> .len) ! 0

# Convert with validation
"42" => $value
$value -> .is_match("^-?[0-9]+(\\.[0-9]+)?$") ? ($value -> :>number) ! 0
```

---

## Getting Help

Each error message includes a help URL linking to this documentation:

```
Error: Variable foo is not defined
Help: https://rill.run/docs/reference/errors/#rill-r005
```

The URL format is:

```
https://rill.run/docs/reference/errors/#{error-id}
```

Where `{error-id}` is the lowercase error ID (e.g., `rill-r005`).

---

## Contributing

Found an error not documented here? [Submit an issue](https://github.com/rcrsr/rill/issues/new) with:

1. Error ID and message
2. Code that triggers the error
3. Expected vs actual behavior
4. rill version

We maintain this documentation to help users resolve issues quickly and understand error conditions.

---

## See Also

- [Language Reference](ref-language.md) - Core rill syntax and semantics
- [Host API Reference](ref-host-api.md) - TypeScript integration API
