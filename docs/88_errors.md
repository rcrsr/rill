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
- [Parse Errors (RILL-P001 - RILL-P005)](#parse-errors)
- [Runtime Errors (RILL-R001 - RILL-R016)](#runtime-errors)
- [Check Errors (RILL-C001 - RILL-C004)](#check-errors)

---

## Lexer Errors

Lexer errors occur during tokenization when the source text contains invalid character sequences or malformed literals.

### rill-l001

**Description:** Unterminated string literal

**Cause:** String literal missing closing quote before end of line.

**Resolution:** Add closing quote or use triple-quote syntax for multiline strings.

**Example:**

```rill
# Error: Missing closing quote
"hello world

# Fixed: Close the string
"hello world"

# Fixed: Use triple-quotes for multiline
"""hello
world"""
```

---

### rill-l002

**Description:** Invalid character

**Cause:** Character outside allowed syntax (control characters, invalid Unicode, unsupported symbols).

**Resolution:** Remove invalid character or use valid escape sequence.

**Example:**

```rill
# Error: Invalid control character (shown as �)
"hello�world"

# Fixed: Use valid characters
"hello world"

# Fixed: Use escape sequence if needed
"hello\nworld"
```

---

### rill-l003

**Description:** Invalid number format

**Cause:** Malformed numeric literal (multiple decimals, invalid digits, trailing characters).

**Resolution:** Correct number format to valid integer or decimal.

**Example:**

```rill
# Error: Multiple decimal points
3.14.159

# Error: Invalid digits
42x

# Fixed: Valid number formats
3.14159
42
-7
0.5
```

---

### rill-l004

**Description:** Unterminated multiline string

**Cause:** Triple-quoted string missing closing `"""` before end of file.

**Resolution:** Add closing triple-quotes.

**Example:**

```rill
# Error: Missing closing triple-quotes
"""This is a
multiline string

# Fixed: Close with triple-quotes
"""This is a
multiline string"""
```

---

### rill-l005

**Description:** Invalid escape sequence

**Cause:** Backslash followed by unsupported escape character in string.

**Resolution:** Use valid escape sequences (`\n`, `\t`, `\"`, `\\`) or remove backslash.

**Example:**

```rill
# Error: Invalid escape sequence \x
"hello\xworld"

# Fixed: Valid escape sequences
"hello\nworld"   # newline
"hello\\world"   # literal backslash
"hello\"world"   # escaped quote

# Fixed: Remove backslash if not escaping
"hello world"
```

---

## Parse Errors

Parse errors occur when token sequences violate rill syntax rules during AST construction.

### rill-p001

**Description:** Unexpected token

**Cause:** Token appears where different token type expected (wrong keyword, operator, delimiter).

**Resolution:** Replace token with expected syntax element or fix surrounding context.

**Example:**

```rill
# Error: Expected ), found identifier
(1 + 2 x

# Fixed: Complete expression
(1 + 2) -> $x

# Error: Expected closing brace
{ "test"

# Fixed: Close the block
{ "test" }
```

---

### rill-p002

**Description:** Unexpected end of input

**Cause:** Source ends before completing syntactic construct (unclosed block, missing operand).

**Resolution:** Complete the unfinished construct.

**Example:**

```rill
# Error: Expected expression after ->
"hello" ->

# Fixed: Provide target for pipe
"hello" -> .upper

# Error: Incomplete conditional
true ?

# Fixed: Complete the conditional
true ? "yes" ! "no"
```

---

### rill-p003

**Description:** Invalid type annotation

**Cause:** Type annotation references undefined or misspelled type.

**Resolution:** Use valid type name from `string`, `number`, `bool`, `list`, `dict`.

**Example:**

```rill
# Error: Invalid type 'integer'
|x: integer|($x + 1)

# Fixed: Use 'number' type
|x: number|($x + 1)

# Error: Misspelled type 'boolen'
|flag: boolen|($flag ? "yes" ! "no")

# Fixed: Correct spelling
|flag: bool|($flag ? "yes" ! "no")
```

---

### rill-p004

**Description:** Invalid expression

**Cause:** Expression violates syntax rules (malformed operator usage, invalid nesting, type operator misuse).

**Resolution:** Restructure expression to match valid syntax patterns.

**Example:**

```rill
# Error: Invalid operator sequence
5 + * 3

# Fixed: Complete expression
5 + 2 * 3

# Error: Invalid type assertion context
$x:string + 1

# Fixed: Use type assertion in proper context
($x:string) -> .len
```

---

### rill-p005

**Description:** Missing delimiter

**Cause:** Expected closing delimiter not found (missing `}`, `)`, `]`, or `>` in extraction).

**Resolution:** Add missing delimiter to close construct.

**Example:**

```rill
# Error: Missing closing bracket
[1, 2, 3

# Fixed: Close the list
[1, 2, 3]

# Error: Missing closing brace in dict
[name: "alice", age: 30

# Fixed: Close the dict
[name: "alice", age: 30]

# Error: Missing > in destructure
*<$a, $b

# Fixed: Close the destructure
*<$a, $b>
```

---

## Runtime Errors

Runtime errors occur during script execution when operations fail due to type mismatches, undefined references, or violated constraints.

### rill-r001

**Description:** Parameter type mismatch

**Cause:** Argument passed to function does not match declared parameter type.

**Resolution:** Pass value matching parameter type or update type annotation.

**Example:**

```rill
# Error: Function expects string, got number
|name: string|("Hello, {$name}") :> $greet
42 -> $greet()

# Fixed: Pass string argument
"Alice" -> $greet()

# Error: Host function parameter type mismatch
# Given: repeat(42, 3)
# Expected: repeat(string, number)

# Fixed: Use string as first argument
repeat("hi", 3)
```

---

### rill-r002

**Description:** Operator type mismatch

**Cause:** Operator applied to incompatible value types (e.g., adding string to number).

**Resolution:** Convert values to compatible types or use correct operator.

**Example:**

```rill
# Error: Cannot add string and number
"5" + 1

# Fixed: Convert string to number
"5" -> .num + 1

# Error: Cannot multiply strings
"hello" * "world"

# Fixed: Use repeat for string multiplication
repeat("hello", 3)
```

---

### rill-r003

**Description:** Method receiver type mismatch

**Cause:** Method called on value type that doesn't support it.

**Resolution:** Call method on compatible value type or convert value first.

**Example:**

```rill
# Error: Cannot call .split on number
42 -> .split(" ")

# Fixed: Convert to string first
42 -> .str -> .split("")

# Error: Cannot call .trim on list
[1, 2, 3] -> .trim

# Fixed: Call .trim on string elements
[" hello ", " world "] -> map { $ -> .trim }
```

---

### rill-r004

**Description:** Type conversion failure

**Cause:** Value cannot be converted to target type (e.g., non-numeric string to number).

**Resolution:** Provide convertible value or handle conversion failure.

**Example:**

```rill
# Error: Cannot convert "hello" to number
"hello" -> .num

# Fixed: Use numeric string
"42" -> .num

# Fixed: Validate before conversion
"hello" -> .is_match("^[0-9]+$") ? (.num) ! 0
```

---

### rill-r005

**Description:** Undefined variable

**Cause:** Variable referenced before assignment or misspelled variable name.

**Resolution:** Assign variable before use or fix spelling.

**Example:**

```rill
# Error: Variable $user not defined
$user.name

# Fixed: Assign before use
[name: "Alice"] :> $user
$user.name

# Error: Misspelled variable
"test" :> $value
$valu  # typo

# Fixed: Correct spelling
$value
```

---

### rill-r006

**Description:** Undefined function

**Cause:** Function called that is not registered in runtime context.

**Resolution:** Register host function or fix function name spelling.

**Example:**

```rill
# Error: Function 'fetch' not defined
fetch("https://example.com")

# Fixed: Register host function in RuntimeContext
# functions: { fetch: { params: [...], fn: ... } }

# Error: Misspelled function
range(1, 5)  # correct
rang(1, 5)   # Error

# Fixed: Correct spelling
range(1, 5)
```

---

### rill-r007

**Description:** Undefined method

**Cause:** Built-in method called that doesn't exist or misspelled method name.

**Resolution:** Use valid method from built-in set or fix spelling.

**Example:**

```rill
# Error: Method .uppercase not defined
"hello" -> .uppercase

# Fixed: Use correct method name
"hello" -> .upper

# Error: Method .size not defined on string
"hello" -> .size

# Fixed: Use .len for length
"hello" -> .len
```

---

### rill-r008

**Description:** Undefined annotation

**Cause:** Accessing annotation key not present on closure.

**Resolution:** Define annotation or use default value operator.

**Example:**

```rill
# Error: Annotation 'timeout' not defined
|x|($x) :> $fn
$fn.^timeout

# Fixed: Define annotation on closure
^(timeout: 30) |x|($x) :> $fn
$fn.^timeout

# Fixed: Use default for optional annotation
|x|($x) :> $fn
$fn.^timeout ?? 30
```

---

### rill-r009

**Description:** Property not found

**Cause:** Dict field or list index accessed that doesn't exist.

**Resolution:** Use valid field/index or provide default value.

**Example:**

```rill
# Error: Property 'email' not found
[name: "Alice", age: 30] :> $user
$user.email

# Fixed: Use default value operator
$user.email ?? "no-email@example.com"

# Fixed: Check existence first
$user.?email ? $user.email ! "no-email"

# Error: Index 5 out of bounds
[1, 2, 3][5]

# Fixed: Use valid index
[1, 2, 3][2]  # Last element
[1, 2, 3][-1] # Last element (negative index)
```

---

### rill-r010

**Description:** Iteration limit exceeded

**Cause:** Loop exceeds maximum iteration count (default 10,000).

**Resolution:** Increase limit with annotation or fix infinite loop condition.

**Example:**

```rill
# Error: Default 10,000 iteration limit exceeded
0 -> ($ < 20000) @ { $ + 1 }

# Fixed: Increase limit with annotation
^(limit: 25000) 0 -> ($ < 20000) @ { $ + 1 }

# Fixed: Fix condition to prevent excessive iterations
0 -> ($ < 100) @ { $ + 1 }
```

---

### rill-r011

**Description:** Invalid regex pattern

**Cause:** Malformed regular expression in `.match()` or `.is_match()` call.

**Resolution:** Correct regex syntax or escape special characters.

**Example:**

```rill
# Error: Unclosed bracket in pattern
"test" -> .is_match("[a-z")

# Fixed: Close bracket
"test" -> .is_match("[a-z]+")

# Error: Invalid escape sequence
"test" -> .match("\d+")

# Fixed: Escape backslash or use raw pattern
"test" -> .match("\\d+")
```

---

### rill-r012

**Description:** Operation timeout

**Cause:** Async operation exceeded configured timeout duration.

**Resolution:** Increase timeout in `RuntimeOptions` or optimize slow operation.

**Example:**

```rill
# Error: Operation timed out after 5000ms
slow_function()

# Fixed: Increase timeout in RuntimeContext
# const ctx = createRuntimeContext({ timeout: 30000 })

# Fixed: Optimize function or add progress tracking
```

---

### rill-r013

**Description:** Execution aborted

**Cause:** Script execution cancelled via `AbortSignal`.

**Resolution:** Remove abort signal or allow execution to complete.

**Example:**

```typescript
// Error: Execution aborted by signal
const controller = new AbortController();
const ctx = createRuntimeContext({ signal: controller.signal });
setTimeout(() => controller.abort(), 1000);
await execute(ast, ctx); // Throws AbortError after 1s

// Fixed: Don't abort or increase delay
const controller = new AbortController();
const ctx = createRuntimeContext({ signal: controller.signal });
// Allow execution to complete without abort
await execute(ast, ctx);
```

---

### rill-r014

**Description:** Auto-exception triggered

**Cause:** Function output matched pattern in `autoExceptions` list.

**Resolution:** Handle error output in script or remove pattern from `autoExceptions`.

**Example:**

```rill
# Given: autoExceptions = ["error:.*", "FATAL"]

# Error: Output "error: invalid input" matches pattern
process_data("bad-input")  # Returns "error: invalid input"

# Fixed: Handle error output in script
process_data("bad-input") ->
  .starts_with("error:") ? "fallback value" ! $

# Fixed: Remove pattern from autoExceptions
# const ctx = createRuntimeContext({ autoExceptions: [] })
```

---

### rill-r015

**Description:** Assertion failed

**Cause:** `assert` statement condition evaluated to false.

**Resolution:** Fix condition or input data to satisfy assertion.

**Example:**

```rill
# Error: Assertion failed
5 :> $x
assert ($x > 10)

# Fixed: Satisfy assertion condition
15 :> $x
assert ($x > 10)

# Error: Assertion with message
assert ($x > 10) "Value must be greater than 10"

# Fixed: Provide valid value
20 :> $x
assert ($x > 10) "Value must be greater than 10"
```

---

### rill-r016

**Description:** Error statement executed

**Cause:** Script explicitly called `error` statement or piped to `error`.

**Resolution:** Remove error statement or handle error condition before reaching it.

**Example:**

```rill
# Error: Explicit error raised
error "Something went wrong"

# Error: Piped value as error message
"Invalid configuration" -> error

# Fixed: Use conditional to avoid error
$valid ? process_data() ! error "Invalid data"

# Fixed: Handle condition before error
$valid ? process_data() ! "fallback value"
```

---

## Check Errors

Check errors occur in the `rill-check` CLI tool during file validation and configuration processing.

### rill-c001

**Description:** File not found

**Cause:** Specified file path does not exist on filesystem.

**Resolution:** Verify file path spelling and existence.

**Example:**

```bash
# Error: File not found
rill-check scripts/missing.rill

# Fixed: Use correct path
rill-check scripts/example.rill

# Fixed: Create file before checking
touch scripts/example.rill
rill-check scripts/example.rill
```

---

### rill-c002

**Description:** File unreadable

**Cause:** File exists but lacks read permissions or contains invalid encoding.

**Resolution:** Grant read permissions or fix file encoding.

**Example:**

```bash
# Error: File unreadable (permissions)
rill-check /root/script.rill

# Fixed: Grant read permissions
chmod +r /root/script.rill
rill-check /root/script.rill

# Error: Invalid UTF-8 encoding
# Fixed: Convert file to UTF-8
iconv -f ISO-8859-1 -t UTF-8 script.rill > script_utf8.rill
rill-check script_utf8.rill
```

---

### rill-c003

**Description:** Invalid configuration

**Cause:** Configuration file contains invalid syntax or unsupported options.

**Resolution:** Fix configuration format or remove invalid options.

**Example:**

```bash
# Error: Invalid JSON in config file
# rill.config.json: { "timeout": "invalid" }

# Fixed: Use valid configuration
# rill.config.json:
{
  "timeout": 30000,
  "autoExceptions": ["error:.*"]
}

# Error: Unknown configuration option
# Fixed: Use supported options only
```

---

### rill-c004

**Description:** Fix collision detected

**Cause:** Multiple auto-fix suggestions attempt to modify same location.

**Resolution:** Apply fixes manually or resolve one error at a time.

**Example:**

```bash
# Error: Two fixes target same line
# Line 5: Both "add semicolon" and "remove token" suggested

# Fixed: Apply fixes manually
# Review conflicting suggestions and edit file directly

# Fixed: Use --no-fix to see errors without auto-fixing
rill-check --no-fix script.rill
```

---

## Error Handling Patterns

### Defensive Checks

Prevent runtime errors with existence and type checks:

```rill
# Check variable existence before use
[apiKey: "secret123"] :> $config
$config.?apiKey ? $config.apiKey ! "default-key"

# Check type before method call
"test" :> $value
$value :? string ? ($value -> .upper) ! $value

# Validate before conversion
"42" :> $input
$input -> .is_match("^[0-9]+$") ? (.num) ! 0
```

### Default Values

Provide fallbacks for missing properties:

```rill
# Field with default
[name: "Alice", age: 30] :> $user
$user.email ?? "no-email@example.com"

# Annotation with default
|x|($x) :> $fn
$fn.^timeout ?? 30

# Dict dispatch with default
[a: 1, b: 2, c: 3] :> $lookup
"b" -> $lookup ?? "not found"
```

### Type Assertions

Explicitly verify and convert types:

```rill
# Assert type before operation
"  hello  " :> $input
$input:string -> .trim

# Check type before calling method
[1, 2, 3] :> $items
$items :? list ? ($items -> .len) ! 0

# Convert with validation
"42" :> $value
$value -> .str -> .is_match("^[0-9]+$") ? (.num:number) ! 0
```

---

## Getting Help

Each error message includes a help URL linking to this documentation:

```
Error: Variable foo is not defined
Help: https://github.com/rcrsr/rill/blob/v0.4.5/docs/88_errors.md#rill-r005
```

The URL format is:

```
https://github.com/rcrsr/rill/blob/v{version}/docs/88_errors.md#{error-id}
```

Where:
- `{version}` is the rill package version (e.g., `v0.4.5`)
- `{error-id}` is the lowercase error ID (e.g., `rill-r005`)

---

## Contributing

Found an error not documented here? [Submit an issue](https://github.com/rcrsr/rill/issues/new) with:

1. Error ID and message
2. Code that triggers the error
3. Expected vs actual behavior
4. rill version

We maintain this documentation to help users resolve issues quickly and understand error conditions.
