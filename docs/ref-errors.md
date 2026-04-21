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
- [Parse Errors (RILL-P001 - RILL-P010, RILL-P014)](#parse-errors)
- [Runtime Errors (RILL-R001 - RILL-R016, RILL-R036 - RILL-R045, RILL-R050 - RILL-R077)](#runtime-errors)
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

### rill-p006

**Description:** `yield` outside stream closure

**Cause:** A `yield` expression appears outside a stream closure body. `yield` is only valid as a statement inside the body of a stream closure.

**Resolution:** Move the `yield` expression inside a stream closure, or replace it with a regular pipe expression if streaming is not intended.

**Example:**

```text
# yield used at top level (outside any closure)
yield 42
# Error: RILL-P006: yield is only valid inside a stream closure

# yield used inside a regular closure (not a stream closure)
|x| { yield $x }
# Error: RILL-P006: yield is only valid inside a stream closure
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

### rill-p014

**Description:** Malformed type argument list in collection type constructor

**Cause:** The token after a type argument is not `,` or `)`, or the closing `)` is missing.

**Resolution:** Check the argument list for missing commas between arguments and a matching closing parenthesis.

**Example:**

```text
list(string number)    # RILL-P014: missing comma — use list(string, number) or list(string)
dict(key: string       # RILL-P014: missing closing paren — use dict(key: string)
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

**Description:** Operator type mismatch, list element type mismatch, stream already consumed, or stale step access

**Cause:** Four conditions raise RILL-R002:

1. **Operator type mismatch**: Binary operator applied to incompatible types. rill does not perform implicit type coercion.
2. **List element type mismatch**: List elements have incompatible top-level types. Elements with the same compound type but different sub-structure (e.g., `list[list[1,2], list["a","b"]]`) do not trigger RILL-R002. These infer the bare compound type instead (e.g., `list(list)`).
3. **Stream already consumed**: A stream value is iterated a second time after all chunks have been yielded. Streams are single-pass; iteration cannot restart.
4. **Stale step access**: `.next()` is called on a stream step that is no longer current. Each call to `.next()` on a stream produces a new step; holding a reference to an old step and calling `.next()` on it raises this error.

**Resolution:** For type mismatches: ensure both operands are compatible types and convert values explicitly if needed. For lists: ensure all elements share the same top-level type. For streams: iterate a stream only once; do not store and re-use intermediate step references.

**Example:**

```text
# Adding string and number
"5" + 1  # Error: no implicit coercion

# Comparing different types
"10" == 10  # Always false, no coercion

# Arithmetic on non-numbers
"hello" * 2

# List with incompatible element types
# Error: RILL-R002
list[1, "hello"]

# Error: RILL-R002 (list vs string top-level mismatch)
list[list[1], "hello"]

# Error: RILL-R002 (bool vs number mismatch)
list[true, 1]

# Re-iterating a consumed stream
# Error: RILL-R002: Stream already consumed; cannot re-iterate

# Calling .next() on a stale step reference
# Error: RILL-R002: Stale step; this step is no longer current
```

Elements that share the same compound type infer the bare type without error:

```text
# No error — infers list(list)
list[list[1,2], list["a","b"]]
```

---

### rill-r003

**Description:** Method receiver type mismatch or type conversion not supported for stream

**Cause:** Two conditions raise RILL-R003:

1. **Method receiver type mismatch**: Method called on value of wrong type. String methods require strings, list methods require lists, etc.
2. **`:>stream` conversion not supported**: The `:>` type conversion operator does not support converting any value to the `stream` type. Streams are created only by stream closures; they cannot be produced by conversion.

**Exclusion:** `RILL-R003` is not triggered by `.^description`, `.^input`, or `.^output` on any callable kind. Annotation reflection operators work on all callable kinds (script, application, runtime) without raising this error.

**Resolution:** For method receiver errors: call method on correct type, or convert value before calling. For stream conversion: use a stream closure with `yield` to produce a stream instead of `:>stream`.

**Example:**

```text
# String method on number
123 -> .upper()  # upper() is string method

# List method on string
"hello" -> .first()  # first() is list method

# Type conversion to stream (not supported)
[1, 2, 3] -> :>stream
# Error: RILL-R003: Type conversion not supported: cannot convert list to stream
```

---

### rill-r004

**Description:** Type conversion failure, return type assertion failure, uniform type assertion failure, stream chunk type mismatch, or stream resolution type mismatch

**Cause:** Five distinct causes raise RILL-R004:

1. **Type conversion failure**: Value cannot be converted to target type via the `:>` operator (invalid format or incompatible types).
2. **Return type assertion failure**: Closure return type annotation (`:type` after `}`) does not match the actual return value type.
3. **Uniform type assertion failure**: Value does not match the uniform value type constraint in `dict(T)`, `ordered(T)`, or `tuple(T)`.
4. **Stream chunk type mismatch**: A `yield` expression produces a chunk whose type does not match the declared chunk type of the stream closure (e.g., `stream(number)` closure yields a string).
5. **Stream resolution type mismatch**: The final resolved value of a stream closure does not match the declared resolution type.

**Resolution:** For type conversion: ensure the value has valid format for the target type. For string-to-number, check numeric format. For parse operations, validate input structure. For return type assertions: ensure the closure body produces a value of the declared return type. For uniform type assertions: ensure all values in the collection match the declared uniform type T. For stream chunk type mismatch: ensure every `yield` expression produces a value of the declared chunk type. For stream resolution type mismatch: ensure the final expression in the stream closure matches the declared resolution type.

**Example:**

```text
# Invalid number string
"abc" -> to_number()  # Not a valid number

# Closure serialization
json({ "hi" })

# Return type annotation mismatch
5 -> |number|{ "hello" }:number
# Error: RILL-R004: Type assertion failed: expected number, got string

# Uniform type assertion failure
{name: "a", run: "b"} -> :>dict(closure)
# Error: RILL-R004: Type assertion failed: expected dict(closure), got dict(name: string, run: string)

# Stream chunk type mismatch (declared number, yielded string)
# Error: RILL-R004: Stream chunk type mismatch: expected number, got string

# Stream resolution type mismatch
# Error: RILL-R004: Stream resolution type mismatch: expected string, got number
```

---

### rill-r005

**Description:** Undefined variable

**Cause:** Variable referenced before assignment, or variable name misspelled. Also raised when `$` is accessed inside a no-args closure (`||{ }`) where no piped value is bound.

**Resolution:** Assign value to variable before use (value => $var), or check spelling. Variables must be captured before reference. Do not access `$` in no-args closures; use named parameters or pipe a value to an anonymous typed closure instead.

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

1. **Missing annotation**: Annotation key accessed but not set on a statement or named parameter.
2. **Type value annotation access**: `.^key` accessed on a type value (e.g., `string`, `number`, `list`). Type values are not annotation containers and do not support annotation access.

**Resolution:** For missing annotations: set the annotation before accessing (`^(key: value)`), or check annotation key spelling. For type value access: do not use `.^` on type values; use `.^` only on dict-bound closures or annotated statements.

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

**Description:** Iteration limit exceeded or stream expansion limit exceeded

**Cause:** Two conditions raise RILL-R010:

1. **Iteration limit exceeded**: A loop or collection operation exceeded the configured iteration limit (prevents infinite loops).
2. **Stream expansion limit exceeded**: A stream closure yielded more chunks than the configured stream iteration ceiling. This prevents unbounded streaming.

**Resolution:** Reduce data size, adjust the iteration limit via RuntimeOptions, or check for infinite loop and infinite yield conditions. For streams: ensure the stream closure yields a bounded number of chunks, or increase the stream iteration limit in RuntimeOptions.

**Example:**

```text
# Infinite loop without termination
(true) @ { "looping" }  # Never terminates

# Large collection with default limit
range(0, 1000000) -> each |x| $x  # May exceed default limit

# Stream that yields without bound
# Error: RILL-R010: Stream expansion exceeded {limit} iterations
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

1. **Empty closure body**: A closure with a non-empty block that contains no pipe-producing statements (e.g., `|x| { }` invoked).
2. **Non-producing script**: A script contains only comments or no statements that produce a pipe value.

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

**Description:** Missing required field or element during structural conversion.

**Cause:** The `:>` operator requires all fields and elements without defaults to be present in the source value. A field or element without a default was absent from the source.

**Resolution:** Supply the missing field or element in the source value, or add a default to the type annotation.

**Examples:**

```text
[name: "Alice"] :> dict(name: string, age: number)
# Error: RILL-R044: cannot convert dict to dict: missing required field 'age'
```

```text
tuple["a"] :> tuple(string, number)
# Error: RILL-R044: cannot convert tuple to tuple: missing required element at position 1
```

---

### rill-r045

**Description:** Too many arguments passed to closure

**Cause:** The number of arguments supplied exceeds the number of declared parameters. This error is raised at the pre-ordered marshaling stage (stage 1), before type checking.

**Resolution:** Remove the extra arguments, or add additional parameters to the closure signature.

**Example:**

```text
|x, y| $x + $y
$(1, 2, 3)
# Error: RILL-R045: Expected 2 args, got 3
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

### rill-r064

**Description:** Cannot convert string to number

**Cause:** The string value is not a valid numeric representation or is empty/whitespace.

**Resolution:** Ensure the string contains a valid number before converting. Use `as(number)` only on numeric strings.

**Example:**

```text
# Non-numeric string conversion
"hello" -> as(number)
# Error: Cannot convert string "hello" to number
```

---

### rill-r065

**Description:** Cannot convert string to bool

**Cause:** Only the strings "true" and "false" can convert to bool.

**Resolution:** Use the exact strings "true" or "false" for bool conversion.

**Example:**

```text
# Invalid bool string
"yes" -> as(bool)
# Error: Cannot convert string "yes" to bool
```

---

### rill-r066

**Description:** Cannot convert number to bool

**Cause:** Only the numbers 0 and 1 can convert to bool. Other numeric values have no bool equivalent.

**Resolution:** Use 0 (false) or 1 (true) for number-to-bool conversion.

**Example:**

```text
# Non-binary number conversion
42 -> as(bool)
# Error: Cannot convert number 42 to bool
```

---

### rill-r067

**Description:** Value is not JSON-serializable

**Cause:** The value type cannot be represented in JSON. Only strings, numbers, bools, lists, and dicts serialize.

**Resolution:** Convert the value to a serializable type before JSON operations. Extract data from closures or iterators first.

**Example:**

```text
# Closure in JSON context
|x| $x + 1 -> as(string)
# Error: Closures are not JSON-serializable
```

---

### rill-r068

**Description:** Type registration is frozen

**Cause:** The type registration object was deep-frozen, preventing method assignment.

**Resolution:** Ensure type registrations are not deep-frozen before calling `populateBuiltinMethods`.

**Example:**

```text
# Object.freeze(registration) prevents method population
# Error: Cannot populate methods on type 'string': registration is frozen
```

---

### rill-r069

**Description:** Function missing required description

**Cause:** The `requireDescriptions` option is enabled but the function has no description.

**Resolution:** Add a `description` field to the function definition, or disable `requireDescriptions`.

**Example:**

```text
# registerFunction("greet", { fn: ... }) with requireDescriptions: true
# Error: Function 'greet' requires description (requireDescriptions enabled)
```

---

### rill-r070

**Description:** Parameter missing required description

**Cause:** The `requireDescriptions` option is enabled but a parameter has no description annotation.

**Resolution:** Add a `description` annotation to each parameter, or disable `requireDescriptions`.

**Example:**

```text
# param { name: "x", annotations: {} } with requireDescriptions: true
# Error: Parameter 'x' of function 'greet' requires description (requireDescriptions enabled)
```

---

### rill-r071

**Description:** Duplicate type registration

**Cause:** Two type registrations share the same name. Each type name must be unique.

**Resolution:** Remove or rename the duplicate type registration.

**Example:**

```text
# Two registrations both named "string"
# Error: Duplicate type registration 'string'
```

---

### rill-r072

**Description:** Type missing format protocol

**Cause:** Every type registration must include a `format` function in its protocol.

**Resolution:** Add a `format` function to the type registration protocol.

**Example:**

```text
# TypeRegistration { name: "custom", protocol: {} } missing format
# Error: Type 'custom' missing required format protocol
```

---

### rill-r073

**Description:** Duplicate method on type

**Cause:** A method with the same name is registered twice on the same type.

**Resolution:** Remove the duplicate method registration or rename one of them.

**Example:**

```text
# Type "string" has two methods both named "split"
# Error: Duplicate method 'split' on type 'string'
```

---

### rill-r074

**Description:** Vector requires at least one dimension

**Cause:** An empty `Float32Array` was passed to `createVector`. Vectors must have at least one element.

**Resolution:** Provide a non-empty `Float32Array` when creating vectors.

**Example:**

```text
# createVector(new Float32Array([]), "model") fails
# Error: Vector data must have at least one dimension
```

---

### rill-r075

**Description:** Event missing event field

**Cause:** The event object passed to `emitExtensionEvent` has no `event` field or the field is empty.

**Resolution:** Include a non-empty string `event` field in the event object.

**Example:**

```text
# emitExtensionEvent(ctx, { event: "" }) fails
# Error: Event must include non-empty event field
```

---

### rill-r076

**Description:** Unknown module resource

**Cause:** The module resolver received a resource identifier it does not recognize. The ext module resolver only handles the "ext" resource.

**Resolution:** Use a valid module resource identifier.

**Example:**

```text
use<module:unknown>
# Error: Unknown module 'unknown'
```

---

### rill-r077

**Description:** Invalid parameter default value

**Cause:** The default value type does not match the declared parameter type.

**Resolution:** Ensure the `defaultValue` matches the parameter type in the function definition.

**Example:**

```text
# param { name: "x", type: "number", defaultValue: "hello" }
# Error: Invalid defaultValue for parameter 'x': expected number, got string
```

---

### rill-r004: datetime construction: no arguments

**Description:** Invalid datetime construction, no arguments

**Cause:** `datetime()` was called with no arguments. The constructor requires at least one argument: either an ISO 8601 string, a unix millisecond timestamp, or named date/time components.

**Resolution:** Pass an ISO 8601 string, a unix ms number, or named keyword arguments (`year`, `month`, `day`, `hour`, `minute`, `second`, `ms`).

**Example:**

```text
datetime()
# Error: RILL-R004: datetime() requires arguments
```

---

### rill-r004: datetime construction: out-of-range component

**Description:** Invalid datetime construction, out-of-range component

**Cause:** A named date or time component falls outside its valid range (e.g., month 13, hour 25, second 60).

**Resolution:** Use values within valid ranges: `month` 1-12, `day` 1-28..31, `hour` 0-23, `minute` 0-59, `second` 0-59, `ms` 0-999.

**Example:**

```text
datetime(...dict[year: 2024, month: 13, day: 1])
# Error: RILL-R004: Invalid datetime component month: 13
```

---

### rill-r004: datetime construction: non-ISO 8601 string

**Description:** Invalid datetime construction, non-ISO 8601 string

**Cause:** The string passed to `datetime()` does not conform to ISO 8601 format.

**Resolution:** Use a valid ISO 8601 string such as `"2024-06-15"`, `"2024-06-15T10:30:00Z"`, or `"2024-06-15T10:30:00+02:00"`.

**Example:**

```text
datetime("June 15, 2024")
# Error: RILL-R004: Invalid ISO 8601 string: June 15, 2024
```

---

### rill-r004: duration construction: negative unit value

**Description:** Invalid duration construction, negative unit value

**Cause:** A duration unit was given a negative value. Duration units must be non-negative integers.

**Resolution:** Use only non-negative values for duration units (`years`, `months`, `days`, `hours`, `minutes`, `seconds`, `ms`).

**Example:**

```text
duration(...dict[hours: -3])
# Error: RILL-R004: duration hours must be non-negative: -3
```

---

### rill-r003: datetime arithmetic: `.add()` requires a duration

**Description:** Type mismatch in datetime arithmetic; `.add()` requires a duration

**Cause:** `.add()` was called on a `datetime` value with an argument that is not a `duration`.

**Resolution:** Pass a `duration` value to `.add()`. Construct durations with the `duration()` constructor.

**Example:**

```text
datetime("2024-06-15") -> .add(7)
# Error: RILL-R003: datetime.add() requires a duration argument
```

---

### rill-r002: duration ordering: different calendar components

**Description:** Incomparable duration ordering, different calendar components

**Cause:** The `<`, `>`, `<=`, or `>=` operators were applied to two `duration` values where one or both have a non-zero `months` field. Calendar durations (those with months) have variable length and cannot be ordered against fixed-time durations.

**Resolution:** Compare durations only when both have `months: 0`. Use `.total_ms` for fixed-time duration comparisons.

**Example:**

```text
duration(...dict[months: 1]) < duration(...dict[days: 31])
# Error: RILL-R002: Cannot order durations with different calendar components
```

---

### rill-r003: duration arithmetic: negative result from `.subtract()`

**Description:** Negative duration result from `.subtract()`

**Cause:** `.subtract()` was called on a `duration` and the result would be negative. Durations cannot be negative.

**Resolution:** Ensure the subtracted duration is less than or equal to the base duration before calling `.subtract()`. Check `.total_ms` for fixed-time durations.

**Example:**

```text
duration(...dict[hours: 1]) -> .subtract(duration(...dict[hours: 2]))
# Error: RILL-R003: duration.subtract() would produce negative result
```

---

### rill-r003: duration property: `.total_ms` on calendar durations

**Description:** `.total_ms` not defined for calendar durations

**Cause:** `.total_ms` was accessed on a `duration` that has a non-zero `months` field. Calendar months have variable length in milliseconds and cannot be converted to a fixed millisecond count.

**Resolution:** Use `.total_ms` only on fixed-time durations (those with `months: 0`). For calendar durations, access `.months` and `.ms` fields separately.

**Example:**

```text
duration(...dict[months: 2]) -> .total_ms
# Error: RILL-R003: total_ms is not defined for calendar durations
```

---

### rill-r002: collection operator: scalar datetime or duration

**Description:** Collection operator on scalar datetime or duration

**Cause:** `each`, `map`, `filter`, or `fold` was applied to a `datetime` or `duration` value. These are scalar types and do not implement the iterator protocol.

**Resolution:** Collection operators require a list, iterator, or stream. Extract components from datetime/duration using their methods before applying collection operators.

**Example:**

```text
datetime("2024-06-15") -> each |d| $d
# Error: RILL-R002: each requires an iterable value
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

**Description:** Config validation error, wrong field type

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

**Description:** Config validation error, orphaned config key

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

**Description:** Config validation error, empty path or handler name

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

1. **Invalid path segment**: A mount path contains characters outside `[a-z0-9-_]`, starts with a digit, or is empty.
2. **Conflicting version constraints**: Two mounts reference the same package with incompatible semver constraints.

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

1. **Package not found**: The npm package name in the mount could not be resolved or installed.
2. **Missing manifest**: The package does not export an `extensionManifest` named export.
3. **Factory threw**: The extension's factory function threw during initialization.

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

**Description:** Context validation error, missing value

**Cause:** A key declared in the context schema has no corresponding value in the provided context object. The schema defines a required key that was not supplied.

**Resolution:** Add the missing key to the context object passed at startup, or remove the key from the schema if it is optional.

**Example:**

```text
# Schema requires "userId" but context object does not include it
# Error: RILL-CFG013: Context validation error: missing context value for key 'userId'
```

---

### rill-cfg014

**Description:** Context validation error, type mismatch

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

**Description:** Handler arg error, missing required param

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

**Description:** Handler arg error, type coercion failure

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

**Description:** Handler arg error, unknown flag

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

---

## Pre-Registered Error Atoms

These atoms are registered by the rill runtime before script execution. Scripts reference them as `#NAME` literals. Extensions may use them via `resolveAtom('NAME')`.

`#ok` is a reserved internal sentinel. It is not user-reachable and is not listed here.

---

### #TIMEOUT

**Description:** Operation exceeded its deadline.

**Cause:** A host function call or extension operation did not complete within its configured timeout.

**Resolution:** Increase the timeout in `RuntimeOptions`, use `guard` to catch the atom, or implement retry with `retry<N>`.

**Example:**

```text
guard { app::fetch("https://slow.api.example.com/data") } => $result
$result.! -> ($ == #TIMEOUT) ? error "Request timed out" ! $result
```

---

### #AUTH

**Description:** Authentication or authorization failure.

**Cause:** The host function received a 401 or 403 response, or the supplied credentials were rejected.

**Resolution:** Check API keys or tokens in the extension config. Refresh credentials if expired.

**Example:**

```text
guard { app.query("SELECT 1") } => $result
$result.! -> ($ == #AUTH) ? error "Database credentials invalid" ! $result
```

---

### #RATE_LIMIT

**Description:** Rate limit exceeded on the external service.

**Cause:** Too many requests within a time window. The host extension received a 429 response.

**Resolution:** Add delay between calls, reduce concurrency, or use `retry<N>` with backoff.

**Example:**

```text
retry<3> { guard { app.search($query) } } => $result
$result.! -> ($ == #RATE_LIMIT) ? error "Rate limit hit after retries" ! $result
```

---

### #UNAVAILABLE

**Description:** Dependency unavailable.

**Cause:** A downstream service returned 503, a connection was refused, or a required resource is offline.

**Resolution:** Check the dependency's health status. Use `guard` and `retry<N>` for transient unavailability.

**Example:**

```text
guard { app.db_query($sql) } => $result
$result.! -> ($ == #UNAVAILABLE) ? error "Database offline" ! $result
```

---

### #NOT_FOUND

**Description:** Resource not found.

**Cause:** The requested resource does not exist. Equivalent to HTTP 404.

**Resolution:** Verify the resource identifier. Use `.?` to test before accessing.

**Example:**

```text
guard { app.get_user($user_id) } => $result
$result.! -> ($ == #NOT_FOUND) ? "User not found" ! $result.name
```

---

### #CONFLICT

**Description:** Resource-state conflict.

**Cause:** The operation cannot complete because of a conflicting state (e.g., duplicate key, optimistic lock failure, HTTP 409).

**Resolution:** Reload the resource and retry the operation with fresh state.

**Example:**

```text
guard { app.create_record($data) } => $result
$result.! -> ($ == #CONFLICT) ? error "Record already exists" ! $result
```

---

### #INVALID_INPUT

**Description:** Caller supplied bad input.

**Cause:** The extension received input that fails domain validation (e.g., malformed email, out-of-range number). Distinct from rill type errors, which halt immediately.

**Resolution:** Validate input before calling the extension. Use `:type` assertions or `assert` to enforce shape.

**Example:**

```text
guard { app.send_email(dict[to: $address, body: $body]) } => $result
$result.! -> ($ == #INVALID_INPUT) ? error "Invalid email address" ! $result
```

---

### #DISPOSED

**Description:** Runtime disposed; extension call after dispose.

**Cause:** A script or host code called an extension function after `dispose()` completed.

**Resolution:** Do not call extension functions after `dispose()`. Check the lifecycle order in host code.

**Example:**

```text
# Host code: ensure scripts run before dispose()
await execute(parse(script), ctx);
await dispose();
```

---

### #R001

**Description:** Unknown atom name at parse or link time.

**Cause:** A `#NAME` literal references an atom that was not registered before the script was parsed or linked. The runtime cannot resolve the atom identity.

**Resolution:** Ensure `ctx.registerErrorCode('NAME', kind)` runs in the factory before scripts execute. Pre-registered atoms (`#TIMEOUT`, `#AUTH`, etc.) do not require registration.

**Example:**

```text
# Error: #MY_CUSTOM_CODE is not registered
guard { app.call() } => $r
$r.! -> ($ == #MY_CUSTOM_CODE) ? "custom error" ! $r
```

---

### #R999

**Description:** Unhandled extension exception reshaped at extension boundary.

**Cause:** An extension function threw an error that was not caught by `ctx.catch` or `ctx.invalidate`. The runtime caught the raw exception and wrapped it as an invalid value with this atom.

**Resolution:** Instrument the extension with `ctx.catch` or try/catch to map known errors to specific atoms. Reserve `#R999` detection for unexpected failures.

**Example:**

```text
guard { app.call() } => $result
$result.! -> ($ == #R999) ? error "Unexpected extension error" ! $result
```
