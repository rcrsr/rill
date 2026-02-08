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
- [Parse Errors (RILL-P001 - RILL-P006)](#parse-errors)
- [Runtime Errors (RILL-R001 - RILL-R016)](#runtime-errors)
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

**Description:** Deprecated capture arrow syntax

**Cause:** Code uses old capture arrow syntax (:>) instead of current syntax (=>).

**Resolution:** Replace :> with => for all variable captures. This change was made in version 0.4.0.

**Example:**

```text
# Old capture syntax
"value" :> $x  # Change to "value" => $x

# Old typed capture
5 :> $x:number  # Change to 5 => $x:number
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

**Description:** Type conversion failure

**Cause:** Value cannot be converted to target type (invalid format or incompatible types).

**Resolution:** Ensure value has valid format for target type. For string-to-number: check numeric format. For parse operations: validate input structure.

**Example:**

```text
# Invalid number string
"abc" -> to_number()  # Not a valid number

# Closure serialization
json({ "hi" })
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
$input -> .is_match("^[0-9]+$") ? (.num) ! 0
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
$value -> .str -> .is_match("^[0-9]+$") ? (.num:number) ! 0
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
