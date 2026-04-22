# rill Error Reference

*Comprehensive error documentation for troubleshooting and debugging*

This document catalogs all error conditions in rill with descriptions, common causes, and resolution strategies. Each error has a unique ID formatted as `RILL-{category}{number}` (e.g., `RILL-R001`).

**Error Categories:**

- **L**: Lexer errors (tokenization failures)
- **P**: Parse errors (syntax violations)
- **R**: Runtime errors (execution failures)
- **C**: Check errors (CLI tool validation)

**Navigation:**

- [Lexer Errors (RILL-L001 - RILL-L005)](#lexer-errors)
- [Parse Errors (RILL-P001 - RILL-R078)](#parse-errors)
- [Runtime Errors (RILL-R001 - RILL-R077)](#runtime-errors)
- [Check Errors (RILL-C001 - RILL-C004)](#check-errors)

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

**Cause:** Character not recognized by the lexer (not part of Rill syntax).

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

**Cause:** Type name not recognized. Rill supports: string, number, bool, closure, list, dict, tuple.

**Resolution:** Use valid type name from supported set. Check spelling and casing (types are lowercase).

**Example:**

```text
# Uppercase type name
$x => String  # Use "string" not "String"

# Invalid type name
$x => int  # Use "number" for all numeric types

# Angle-bracket generic syntax not supported
$x => list<string>  # Use list(string) for typed lists
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

**Description:** Invalid syntax in context

**Cause:** A syntactic construct was used in a context where it is not allowed.

**Resolution:** Check that the construct is used in the correct context.

**Example:**

```text
# Spread in unsupported position
$x.method(...$args)  # spread not supported in method calls

# yield outside stream closure
|x| yield  # yield requires :stream() return type
```

---

### rill-p007

**Description:** Keyword and bracket not adjacent

**Cause:** Collection keyword (list, ordered, destruct, slice) must be written with its bracket immediately following, no whitespace allowed.

**Resolution:** Remove the whitespace between the keyword and its bracket. Write 'list[...]' not 'list [...]'.

**Example:**

```text
# list with whitespace before [
list [1, 2]  # Error: use list[1, 2]

# ordered with whitespace before [
ordered [a: 1]  # Error: use ordered[a: 1]
```

---

### rill-p008

**Description:** Bare bracket at expression start

**Cause:** A bare [ token at expression start is ambiguous. Rill requires an explicit keyword prefix to distinguish list and dict literals.

**Resolution:** Use list[...] for a list literal or dict[key: val, ...] for a dict literal.

**Example:**

```text
# Bare list literal
[1, 2, 3]  # Error: use list[1, 2, 3]

# Bare dict literal
[a: 1, b: 2]  # Error: use dict[a: 1, b: 2]
```

---

### rill-p009

**Description:** Removed sigil syntax

**Cause:** Code uses a removed sigil-prefixed collection or extraction form that was replaced by keyword-prefixed syntax.

**Resolution:** Replace the sigil form with the keyword-prefixed equivalent. See examples for specific replacements.

**Example:**

```text
# Old tuple sigil *[
*[1, 2]  # Error: use tuple[1, 2] or ordered[a: 1]

# Old destruct sigil *<
$ -> *<$a, $b>  # Error: use destruct<$a, $b>

# Old slice sigil /<
$ -> /<1:3>  # Error: use slice<1:3>
```

---

### rill-p010

**Description:** Invalid AT expression syntax

**Cause:** The '@' token at expression start is only valid as a do-while loop terminator inside a loop body. '@[...]' and '@$fn' are not supported expression forms.

**Resolution:** Use chain(...) to chain collection operations, or restructure the expression to use a valid operator.

**Example:**

```text
# Invalid @[ at expression start
@[1, 2, 3]  # Error: use chain(...) instead

# Invalid @$fn at expression start
@$transform  # Error: use chain(...) instead
```

---

### rill-p011

**Description:** Expected type name after pipe

**Cause:** A '|' in a type annotation position was not followed by a valid type name or '$' variable reference.

**Resolution:** Provide a valid type name or '$variable' after '|'. Example: 'string|number' or '$T|string'.

**Example:**

```text
# Trailing pipe with no type
$x: string|  # Error: missing type after |
```

---

### rill-p012

**Description:** Removed syntax used

**Cause:** Code uses a syntax form that was removed in a previous version.

**Resolution:** Migrate to the replacement syntax shown in the error message.

**Example:**

```text
# app:: direct-call syntax removed
app::fn()  # Error: use use<host:fn> instead

# -> export pipe syntax removed
"value" -> export  # Error: use last-expression result instead
```

---

### rill-p014

**Description:** Malformed type argument list

**Cause:** A type argument list has a syntax error: missing comma, closing paren, or invalid argument.

**Resolution:** Check the type argument list for missing commas or closing parentheses.

**Example:**

```text
# Missing comma between type arguments
list(string number)  # Error: expected , or )

# Missing closing paren
dict(key: string  # Error: expected )
```

---

### rill-p020

**Description:** Missing ':' in use<> static form

**Cause:** The static form of use<> requires a ':' separating the scheme from the resource path (e.g., use<scheme:path>).

**Resolution:** Add ':' after the scheme identifier. Example: use<module:path.to.resource>

**Example:**

```text
# Missing colon in use<>
use<module>  # Error: expected scheme:resource
```

---

### rill-p021

**Description:** Empty resource after colon in use<>

**Cause:** The static form of use<> requires at least one resource segment after ':'.

**Resolution:** Provide a resource path after ':'. Example: use<module:resource>

**Example:**

```text
# Empty resource in use<>
use<module:>  # Error: missing resource after colon
```

---

### rill-p022

**Description:** Missing '>' to close use<>

**Cause:** The use<> expression was not closed with a matching '>'.

**Resolution:** Add '>' to close the use<> expression.

**Example:**

```text
# Unclosed use<>
use<module:resource  # Error: missing >
```

---

### rill-r078

**Description:** Legacy :> conversion syntax

**Cause:** The parser encountered the legacy ':>type' conversion operator. The '->' pipe operator is now the unified syntax for both closure dispatch and type conversion dispatch.

**Resolution:** Replace ':>type' with '-> type'. The target type keyword follows the pipe directly: '-> :>string' becomes '-> string', '-> :>ordered(...)' becomes '-> ordered(...)'.

**Example:**

```text
# Before (legacy syntax triggers RILL-R078)
42 -> :>string
"3.14" -> :>number
list[1, 2] -> :>tuple

# After (current syntax)
42 -> string
"3.14" -> number
list[1, 2] -> tuple
```

---

## Runtime Errors

Runtime errors occur during script execution when operations fail due to type mismatches, undefined references, or violated constraints.

### rill-r001

**Description:** Parameter type mismatch

**Cause:** Argument passed to function does not match declared parameter type.

**Resolution:** Pass value of correct type, or convert the value before passing. Check function signature for expected types.

**Example:**

```text
# String passed to number parameter
|x: number| $x * 2
"5" -> $()

# Number passed to string method
123 -> .split(",")  # split expects string
```

---

### rill-r002

**Description:** Operator type mismatch

**Cause:** Binary operator applied to incompatible types. Rill does not perform implicit type coercion.

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

**Resolution:** Call method on correct type, or convert value before calling. Check method documentation for receiver type.

**Example:**

```text
# String method on number
123 -> .upper()  # upper() is string method

# List method on string
"hello" -> .first()  # first() is list method
```

---

### rill-r005

**Description:** Undefined variable

**Cause:** Variable referenced before assignment, or variable name misspelled.

**Resolution:** Assign value to variable before use (value => $var), or check spelling. Variables must be captured before reference.

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

**Description:** Undefined annotation

**Cause:** Annotation key accessed but not set on statement or parameter.

**Resolution:** Set annotation before accessing (^(key: value)), or check annotation key spelling.

**Example:**

```text
# Accessing undefined annotation
$stmt.^timeout  # No ^(timeout: ...) set
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
while (true) do { "looping" }  # Never terminates

# Large collection with default limit
range(0, 1000000) -> seq(|x| $x)  # May exceed default limit
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

### rill-r017

**Description:** fs extension: unknown mount

**Cause:** Script references mount name that does not exist in fs extension configuration, or mount path is invalid.

**Resolution:** Verify mount name is correct, ensure mount is configured in createFsExtension() call, and check mount path exists.

**Example:**

```text
# Unknown mount
fs::read("unknown", "file.txt")  # Mount "unknown" not in config

# Invalid mount path
# createFsExtension({ mounts: { data: { path: "/nonexistent", mode: "read" } } })
```

---

### rill-r018

**Description:** fs extension: path escapes mount boundary

**Cause:** Path traversal attempt (using .. or symlinks) escapes configured mount boundary.

**Resolution:** Remove path traversal attempts, use paths relative to mount root, or reconfigure mount boundaries.

**Example:**

```text
# Path traversal with ..
fs::read("data", "../../etc/passwd")  # Attempts escape

# Symlink escape
fs::read("data", "symlink_to_root")  # Symlink points outside mount
```

---

### rill-r019

**Description:** fs extension: file type not permitted in mount

**Cause:** Filename does not match mount glob pattern (e.g., trying to read .exe when only *.csv allowed).

**Resolution:** Use file with allowed extension, or reconfigure mount glob pattern to permit file type.

**Example:**

```text
# Glob mismatch
fs::read("csv_only", "data.json")  # Mount configured with glob: "*.csv"

# Multiple extensions
fs::read("configs", "app.ini")  # Mount glob: "*.{json,yaml}"
```

---

### rill-r020

**Description:** fs extension: mount does not permit operation

**Cause:** Operation (read or write) not permitted by mount mode (e.g., write to read-only mount).

**Resolution:** Use mount with appropriate mode, or reconfigure mount to allow operation.

**Example:**

```text
# Write to read-only mount
fs::write("readonly", "file.txt", "data")  # Mount mode: "read"

# Read from write-only mount
fs::read("writeonly", "file.txt")  # Mount mode: "write"
```

---

### rill-r021

**Description:** fs extension: permission denied or file not found

**Cause:** Operating system denied access to file (EACCES/EPERM), or file does not exist (ENOENT).

**Resolution:** Check file permissions, verify file exists, ensure user has appropriate access rights.

**Example:**

```text
# Permission denied
fs::read("data", "protected.txt")  # File exists but no read permission

# File not found
fs::read("data", "missing.txt")  # File does not exist
```

---

### rill-r022

**Description:** fetch extension: HTTP 4xx client error

**Cause:** HTTP request returned a 4xx client error status code.

**Resolution:** Check request parameters, verify authentication, or adjust request payload.

**Example:**

```text
# HTTP 404 Not Found
fetch::get("api", "/nonexistent")  # Returns 404

# HTTP 400 Bad Request
fetch::post("api", "/users", [invalid: "data"])  # Returns 400
```

---

### rill-r023

**Description:** fetch extension: HTTP 5xx after retries

**Cause:** HTTP request returned a 5xx server error after all retry attempts.

**Resolution:** Check server status, reduce request frequency, or increase retry limit.

**Example:**

```text
# HTTP 503 Service Unavailable
fetch::get("api", "/resource")  # Server returns 503
```

---

### rill-r024

**Description:** fetch extension: request timeout

**Cause:** HTTP request exceeded configured timeout duration.

**Resolution:** Increase timeout via extension configuration, or optimize server response time.

**Example:**

```text
# Slow API endpoint
fetch::get("api", "/slow")  # Times out if exceeds limit
```

---

### rill-r025

**Description:** fetch extension: network error

**Cause:** Network request failed (DNS resolution, connection refused, or other network issue).

**Resolution:** Check network connectivity, verify server is reachable, or check firewall settings.

**Example:**

```text
# Connection refused
fetch::get("api", "/endpoint")  # Server not running
```

---

### rill-r026

**Description:** fetch extension: invalid JSON response

**Cause:** Response body could not be parsed as JSON.

**Resolution:** Check response Content-Type header, verify server returns valid JSON, or use raw response parsing.

**Example:**

```text
# HTML error page returned as JSON
fetch::get("api", "/endpoint")  # Server returns HTML instead of JSON
```

---

### rill-r027

**Description:** ahi extension: validation failed (HTTP 400)

**Cause:** Downstream agent rejected the request with HTTP 400.

**Resolution:** Check request parameters match the downstream agent schema.

**Example:**

```text
# Missing required parameter
ahi::parser([])  # Agent expects a non-empty params dict
```

---

### rill-r028

**Description:** ahi extension: agent unreachable (HTTP 404)

**Cause:** Downstream agent endpoint returned HTTP 404.

**Resolution:** Verify the agent URL is correct and the agent is deployed.

**Example:**

```text
# Wrong agent path
# Agent configured with stale URL pointing to removed route
```

---

### rill-r029

**Description:** ahi extension: downstream exec failed

**Cause:** Downstream agent returned HTTP 500.

**Resolution:** Check downstream agent logs for the root cause.

**Example:**

```text
# Unhandled error in downstream agent
ahi::parser([input: $text])  # Downstream agent crashes
```

---

### rill-r030

**Description:** ahi extension: timeout exceeded

**Cause:** HTTP request to downstream agent exceeded configured timeout.

**Resolution:** Increase the AHI extension timeout or reduce downstream latency.

**Example:**

```text
# Slow downstream agent
# createAhiExtension({ agents: { slow: { url: "..." } }, timeout: 5000 })
```

---

### rill-r031

**Description:** ahi extension: connection refused

**Cause:** Network error contacting downstream agent (DNS failure, connection refused).

**Resolution:** Verify the agent URL, ensure the agent is running, and check network access.

**Example:**

```text
# Agent not running
# Agent configured with http://localhost:4001 but service is down
```

---

### rill-r032

**Description:** ahi extension: rate limited (HTTP 429)

**Cause:** Downstream agent returned HTTP 429 (rate limited).

**Resolution:** Reduce request frequency or increase rate limits on the downstream agent.

**Example:**

```text
# Too many concurrent requests
ahi::parser([input: $text])  # Agent enforces per-second request quota
```

---

### rill-r033

**Description:** ahi extension: extension disposed

**Cause:** AHI extension has been disposed; no further calls are permitted.

**Resolution:** Do not call AHI functions after the extension has been disposed.

**Example:**

```text
# Call after dispose
# Host called extension.dispose() then continued running script
```

---

### rill-r034

**Description:** ahi extension: downstream HTTP error

**Cause:** Downstream agent returned an unexpected HTTP error status code.

**Resolution:** Check the downstream agent for details about the error status.

**Example:**

```text
# HTTP 503 Service Unavailable
ahi::parser([input: $text])  # Downstream returns 503
```

---

### rill-r035

**Description:** ahi extension: agent unresolvable

**Cause:** Registry could not resolve the symbolic agent name at boot or on first call.

**Resolution:** Verify the agent is registered in the registry and the registry URL is correct.

**Example:**

```text
# Agent not registered
# createAhiExtension({ agents: ["parser"], registry: "http://registry:8080" })
# Registry has no entry for "parser"
```

---

### rill-r036

**Description:** Incompatible convert source/target

**Cause:** The `-> type` form does not support conversion between the given source and target types. -> string accepts any source type. -> number accepts only string (must be numeric) and bool (produces 0 or 1). Other targets (-> boolean, -> list, -> dict, -> tuple, -> ordered) have their own accepted sources.

**Resolution:** Check the target type. Use -> string to convert any value to its string representation. For -> number, only string and bool sources are accepted. Verify the source type matches the accepted sources for the target type.

**Example:**

```text
# String to list conversion
"hello" -> list  # Not allowed
```

---

### rill-r037

**Description:** dict -> ordered without structural signature

**Cause:** Converting a dict to ordered with -> ordered requires an explicit ordered(field: type, ...) type signature to determine field order.

**Resolution:** Provide a structural type signature: $dict -> ordered(name: string, age: number)

**Example:**

```text
# Missing structural signature
$dict -> ordered  # Ambiguous field order
```

---

### rill-r038

**Description:** Non-parseable string to number

**Cause:** The string does not represent a valid number.

**Resolution:** Ensure the string contains a valid numeric format before converting with -> number.

**Example:**

```text
# Non-numeric string
"hello" -> number  # Not a number
```

---

### rill-r039

**Description:** Retired: type-value variable dispatch (`:>` form)

**Cause:** This error was raised by the legacy `:>$var` conversion form when the variable did not hold a type value. The `:>` operator has been removed; variable dispatch now falls through to RILL-R002 when the target variable does not hold a dispatchable value.

**Resolution:** This error code is no longer thrown. If a variable pipe target produces an unexpected dispatch error, see RILL-R002.

**Example:**

```text
# Legacy: `:>$var` where $var held a string (no longer thrown; produces RILL-R002)
# "list" => $t
# "hello" :> $t  # was: expected type value, got string
```

---

### rill-r040

**Description:** chain() non-closure argument

**Cause:** The chain() built-in received a value that is neither a closure nor a list of closures.

**Resolution:** Pass a single closure or a list of closures to chain().

**Example:**

```text
# Passing a number to chain()
5 -> chain(42)  # 42 is not a closure
```

---

### rill-r041

**Description:** List dispatch non-integer index

**Cause:** The index piped to a list[...] dispatch is not an integer.

**Resolution:** Ensure the index is a whole number. Use math operations to convert if needed.

**Example:**

```text
# Floating-point index
1.5 -> list["a", "b"]  # Not an integer
```

---

### rill-r042

**Description:** List dispatch index out of range

**Cause:** The index piped to a list[...] dispatch is outside the valid range.

**Resolution:** Use an index within [0, length-1] or add a fallback with ??.

**Example:**

```text
# Index beyond end
5 -> list["a", "b"]  # Only 2 elements (indices 0-1)
```

---

### rill-r043

**Description:** Non-producing closure body or script

**Cause:** A closure body or script contains no statements that produce a value.

**Resolution:** Ensure the closure body or script ends with an expression that produces a value.

**Example:**

```text
# Empty closure body
|x: number| { }  # No value produced

# Script with only comments
# just a comment  # No value produced
```

---

### rill-r044

**Description:** Missing required member in conversion

**Cause:** The `-> type` form requires all fields/elements without defaults to be present in the source value.

**Resolution:** Supply the missing field or element in the source value, or add a default to the type annotation.

**Example:**

```text
# Dict missing a required field
[name: "Alice"] -> dict(name: string, age: number)  # age is missing

# Tuple missing a required element
tuple["a"] -> tuple(string, number)  # element at position 1 is missing
```

---

### rill-r045

**Description:** Too many arguments passed to callable

**Cause:** The number of arguments passed to a callable exceeds the number of declared parameters.

**Resolution:** Remove the excess arguments or add more parameters to the callable definition.

**Example:**

```text
# Too many arguments to a two-param closure
|x: number, y: number| { x + y } -> app::call(1, 2, 3)  # 3 args, 2 params
```

---

### rill-r050

**Description:** Module not found in resolver config

**Cause:** The module ID is absent from the moduleResolver config map.

**Resolution:** Add an entry for the module ID to the moduleResolver config object.

**Example:**

```text
# Missing module entry
# moduleResolver config lacks key for the requested module
```

---

### rill-r051

**Description:** Module file read failure

**Cause:** The file path mapped to the module ID could not be read.

**Resolution:** Verify the file path exists and the process has read permission.

**Example:**

```text
# File does not exist
# Path in moduleResolver config points to a missing file
```

---

### rill-r052

**Description:** Extension not found in resolver config

**Cause:** The extension name is absent from the extResolver config map.

**Resolution:** Add an entry for the extension name to the extResolver config object.

**Example:**

```text
# Missing extension entry
# extResolver config lacks key for the requested extension
```

---

### rill-r053

**Description:** Member path not found in extension

**Cause:** The dot-path member does not exist in the extension value.

**Resolution:** Verify the member path matches the structure of the extension dict.

**Example:**

```text
# Nonexistent member
# ext::qdrant.missing — "missing" key not in qdrant extension
```

---

### rill-r054

**Description:** No resolver registered for scheme

**Cause:** A use<> expression referenced a scheme with no registered resolver.

**Resolution:** Register a resolver for the scheme via RuntimeOptions.resolvers. Example: resolvers: { myScheme: myResolver }.

**Example:**

```text
# Unregistered scheme
use<db:users>  # no resolver registered for "db"
```

---

### rill-r055

**Description:** Circular resolution detected

**Cause:** A use<> resolver returned source that re-entered the same scheme:resource key.

**Resolution:** Remove the circular dependency from module sources. Ensure module A does not directly or indirectly use<module:A>.

**Example:**

```text
# Self-referencing module
# module:a source contains use<module:a>
```

---

### rill-r056

**Description:** Resolver callback threw an error

**Cause:** The registered resolver function for the given scheme threw an exception.

**Resolution:** Inspect the original error message in the RILL-R056 detail and fix the resolver implementation.

**Example:**

```text
# Network error in resolver
# resolver throws "connection refused"
```

---

### rill-r057

**Description:** use<> identifier must resolve to string

**Cause:** Variable or computed form of use<> evaluated to a non-string value.

**Resolution:** Ensure the variable or expression inside use<> evaluates to a string of the form "scheme:resource".

**Example:**

```text
# Variable holds a number
42 => $id
use<$id>  # $id must be a string
```

---

### rill-r058

**Description:** use<> identifier must contain ':' scheme separator

**Cause:** The dynamic use<> string did not contain a colon separating scheme from resource.

**Resolution:** Ensure the string has the format "scheme:resource". Example: "module:greetings".

**Example:**

```text
# Missing colon
"nocolon" => $id
use<$id>  # missing : separator
```

---

### rill-r059

**Description:** moduleResolver config is not a plain object

**Cause:** The config passed to moduleResolver is not a plain object.

**Resolution:** Pass a plain object as the moduleResolver config (e.g., { myModule: "/app/mod.rill" }). Paths must be absolute; resolve them before passing in.

**Example:**

```text
# Non-object config
# moduleResolver config was null or an array
```

---

### rill-r060

**Description:** Removed frontmatter key used

**Cause:** Script uses a frontmatter key that was removed in a previous version.

**Resolution:** Migrate to the replacement shown in the error message.

**Example:**

```text
# use: frontmatter key removed
---
use:
  - myMod: ./mod.rill
---
# Error: use use<module:...> expression instead

# export: frontmatter key removed
---
export:
  - $result
---
# Error: use last-expression result instead
```

---

### rill-r061

**Description:** parseSource not configured in RuntimeContext

**Cause:** A resolver returned { kind: "source" } but RuntimeOptions.parseSource was not provided.

**Resolution:** Pass parseSource in RuntimeOptions when constructing the runtime context. parseSource is required for resolvers that return source text.

**Example:**

```text
# Missing parseSource option
# resolver returns { kind: "source", text: "..." } but host did not pass parseSource
```

---

### rill-r062

**Description:** Context key not found

**Cause:** The requested dot-path key does not exist in the context config.

**Resolution:** Ensure the key is present in the context configuration passed to contextResolver.

**Example:**

```text
# Missing top-level key
# use<context:timeout> but "timeout" is not in context config
```

---

### rill-r063

**Description:** Context path segment is not a dict

**Cause:** A dot-path segment resolves to a non-dict value, so traversal cannot continue.

**Resolution:** Ensure each intermediate segment in the dot-path is a nested dict in the context config.

**Example:**

```text
# Non-dict intermediate segment
# use<context:limits.max_tokens> but "limits" is a string, not a dict
```

---

### rill-r064

**Description:** Cannot convert string to number

**Cause:** The string value is not a valid numeric representation or is empty/whitespace.

**Resolution:** Ensure the string contains a valid number before converting. Use as(number) only on numeric strings.

**Example:**

```text
# Non-numeric string conversion
"hello" -> as(number)  # Error: not a valid number
```

---

### rill-r065

**Description:** Cannot convert string to bool

**Cause:** Only the strings "true" and "false" can convert to bool.

**Resolution:** Use the exact strings "true" or "false" for bool conversion.

**Example:**

```text
# Invalid bool string
"yes" -> as(bool)  # Error: only "true"/"false" allowed
```

---

### rill-r066

**Description:** Cannot convert number to bool

**Cause:** Only the numbers 0 and 1 can convert to bool. Other numeric values have no bool equivalent.

**Resolution:** Use 0 (false) or 1 (true) for number-to-bool conversion.

**Example:**

```text
# Non-binary number conversion
42 -> as(bool)  # Error: only 0 and 1 allowed
```

---

### rill-r067

**Description:** Value is not JSON-serializable

**Cause:** The value type cannot be represented in JSON. Only strings, numbers, bools, lists, and dicts serialize.

**Resolution:** Convert the value to a serializable type before JSON operations. Extract data from closures or iterators first.

**Example:**

```text
# Closure in JSON context
|x| $x + 1 -> as(string)  # Error: closures not serializable
```

---

### rill-r068

**Description:** Type registration is frozen

**Cause:** The type registration object was deep-frozen, preventing method assignment.

**Resolution:** Ensure type registrations are not deep-frozen before calling populateBuiltinMethods.

**Example:**

```text
# Frozen registration object
# Object.freeze(registration) prevents method population
```

---

### rill-r069

**Description:** Function missing required description

**Cause:** The requireDescriptions option is enabled but the function has no description.

**Resolution:** Add a description field to the function definition, or disable requireDescriptions.

**Example:**

```text
# Missing function description
# registerFunction("greet", { fn: ... }) with requireDescriptions: true
```

---

### rill-r070

**Description:** Parameter missing required description

**Cause:** The requireDescriptions option is enabled but a parameter has no description annotation.

**Resolution:** Add a description annotation to each parameter, or disable requireDescriptions.

**Example:**

```text
# Missing parameter description
# param { name: "x", annotations: {} } with requireDescriptions: true
```

---

### rill-r071

**Description:** Duplicate type registration

**Cause:** Two type registrations share the same name. Each type name must be unique.

**Resolution:** Remove or rename the duplicate type registration.

**Example:**

```text
# Duplicate type name
# Two registrations both named "string"
```

---

### rill-r072

**Description:** Type missing format protocol

**Cause:** Every type registration must include a format function in its protocol.

**Resolution:** Add a format function to the type registration protocol.

**Example:**

```text
# Missing format in protocol
# TypeRegistration { name: "custom", protocol: {} } missing format
```

---

### rill-r073

**Description:** Duplicate method on type

**Cause:** A method with the same name is registered twice on the same type.

**Resolution:** Remove the duplicate method registration or rename one of them.

**Example:**

```text
# Method registered twice
# Type "string" has two methods both named "split"
```

---

### rill-r074

**Description:** Vector requires at least one dimension

**Cause:** An empty Float32Array was passed to createVector. Vectors must have at least one element.

**Resolution:** Provide a non-empty Float32Array when creating vectors.

**Example:**

```text
# Zero-dimension vector
# createVector(new Float32Array([]), "model") fails
```

---

### rill-r075

**Description:** Event missing event field

**Cause:** The event object passed to emitExtensionEvent has no event field or the field is empty.

**Resolution:** Include a non-empty string event field in the event object.

**Example:**

```text
# Empty event field
# emitExtensionEvent(ctx, { event: "" }) fails
```

---

### rill-r076

**Description:** Unknown module resource

**Cause:** The module resolver received a resource identifier it does not recognize.

**Resolution:** Use a valid module resource. The ext module resolver only handles the "ext" resource.

**Example:**

```text
# Invalid module resource
use<module:unknown>  # Error: unknown module
```

---

### rill-r077

**Description:** Invalid parameter default value

**Cause:** The default value type does not match the declared parameter type.

**Resolution:** Ensure the defaultValue matches the parameter type in the function definition.

**Example:**

```text
# Type mismatch in default
# param { name: "x", type: "number", defaultValue: "hello" }
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
$input -> .is_match("^-?[0-9]+(\\.[0-9]+)?$") ? ($input -> number) ! 0
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
$value -> .is_match("^-?[0-9]+(\\.[0-9]+)?$") ? ($value -> number) ! 0
```

---

## Getting Help

Each error message includes a help URL linking to this documentation:

```
Error: Variable foo is not defined
Help: https://github.com/rcrsr/rill/blob/v0.5.0/docs/ref-errors.md#rill-r005
```

The URL format is:

```
https://github.com/rcrsr/rill/blob/v{version}/docs/ref-errors.md#{error-id}
```

Where:
- `{version}` is the rill package version (e.g., `v0.5.0`)
- `{error-id}` is the lowercase error ID (e.g., `rill-r005`)

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
