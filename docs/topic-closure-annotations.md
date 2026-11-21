# rill Closure Annotations

*Parameter metadata, annotations, reflection, and return type assertions*

## Parameter Metadata

A function's parameters are read from its type. `.^type.inner` lists each parameter and its type as an `ordered` value; `.^type.annotations` lists each parameter's annotations. The `.params` property was removed; reading it on a function halts `RILL-R008` and names `.^type.annotations` and `.^type.inner`.

### Basic Usage

```rill
fn(x, y) { $x + $y } => $add
$add.^type.inner
# Result: ordered[x: any, y: any]
```

### Typed Parameters

```rill
fn(name: string, age: number) { "{$name}: {$age}" } => $format
$format.^type.inner
# Result: ordered[name: string, age: number]
```

### Union Type Parameters

Parameters accept union types written `union(T1, T2)`:

```rill
fn(x: union(string, number)) { $x } => $fn
$fn("hello")
# Result: "hello"
```

### Block Functions

A function written as `fn { ... }` has an implicit `$` parameter:

```rill
fn { $ * 2 } => $double
$double.^type.inner
# Result: tuple[any]
```

### Zero-Parameter Functions

```rill
fn() { 42 } => $constant
$constant.^type.inner
# Result: ordered[]
```

### Practical Use Cases

**Generic Function Wrapper:**

```rill
fn(f) {
  $f.^type.inner -> .keys -> .len => $count
  "Function has {$count} parameter(s)"
} => $describe

fn(x, y) { $x + $y } => $add
$describe($add)
# Result: "Function has 2 parameter(s)"
```

---

## Parameter Annotations

Parameters can have their own annotations using `^(key: value)` syntax after the parameter name. These attach metadata to individual parameters for validation, configuration, or documentation purposes.

### Syntax and Ordering

Parameter annotations appear in a specific order:

```text
fn(^(annotations) paramName: type = default) { body }
```

**Ordering rules:**
1. Parameter annotations with `^()` (optional)
2. Parameter name (required)
3. Type annotation with `:` (optional)
4. Default value with `= literal` (optional)

The `= literal` default also appears in type expressions used with `:?` and `:`. A default does not infer the parameter type: `count = 0` gives `count` the type `any`, and `count: number = 0` constrains it. Function types match exactly, defaults included, so a function with a default that a type omits does not satisfy that type. See [Type System: Defaults in Type Expressions](topic-type-system.md#defaults-in-type-expressions) for the matching rules.

```rill
fn(^(min: 0, max: 100) x: number) { $x } => $validate
fn(^(required: true) name: string = "guest") { $name } => $greet
fn(^(cache: true) count = 0) { $count } => $process
true
```

### Reading Parameter Annotations

Scripts read parameter annotations with `.^type.annotations`; host code reads them at `TypeStructure.params[index].annotations`. `.^type.inner` lists parameter types only. Declare constraints, caching hints, format specifications, and several annotations on one parameter with the same syntax:

```rill
fn(^(min: 0, max: 100) value: number) { $value } => $bounded
fn(^(cache: true) key: string) { $key } => $fetch
fn(^(format: "ISO8601") timestamp: string) { $timestamp } => $formatDate
fn(^(required: true, pattern: ".*@.*", maxLength: 100) email: string) { $email } => $validateEmail
$bounded.^type.annotations
# Result: dict[value: dict[max: 100, min: 0]]
```

A parameter with no annotations is left out of the result. Read one annotation by chaining:

```rill
fn(^("label") x: string) { $x } => $fn
$fn.^type.annotations.x.description
# Result: "label"
```

---

## Description Shorthand

A bare string in `^(...)` expands to `description: <string>`. This shorthand works in all three annotation positions.

```rill
^("Get current weather for a city")
fn(city: string) { $city } => $weather
$weather.^description    # "Get current weather for a city"
```

The shorthand is equivalent to the explicit key form:

```rill
^(description: "Get current weather for a city")
fn(city: string) { $city } => $weather
$weather.^description    # "Get current weather for a city"
```

Mix explicit keys with the shorthand in the same annotation:

```rill
^("Fetch user profile", cache: true)
fn(id: string) { $id } => $get_user
$get_user.^description    # "Fetch user profile"
$get_user.^cache          # true
```

---

## Return Type Assertions

The `:type-target` after the parameter list declares and enforces the function's return type. The runtime validates the return value on every call — a mismatch halts with `#TYPE_MISMATCH`.

```rill
fn(x: number):string { "{$x}" } => $fn
$fn(42)    # "42" (string from interpolation)
```

Valid return type targets: any type name (`string`, `number`, `bool`, `fn`, `list`, `dict`, `tuple`, `ordered`, `vector`, `any`, `type`), or a parameterized type constructor (`list(string)`, `dict(a: number, b: string)`).

```rill
fn(items: list(number)):list(number) { $items -> seq({ $ * 2 }) } => $double_all
$double_all(list[1, 2, 3])
# Result: list[2, 4, 6]
```

```text
# Mismatch: string list cannot satisfy list(number)
fn(items):list(number) { $items } => $fn
list["a", "b"] -> $fn
# Error: #TYPE_MISMATCH: Type assertion failed: expected list(number), got list(string)
```

Mismatched return type halts with `#TYPE_MISMATCH`:

```text
fn(x: number):string { $x * 2 } => $double
$double(5)    # #TYPE_MISMATCH: Type assertion failed: expected string, got number
```

Declared return type is accessible via `$fn.^type.outer`. The return type sits between the parameter list and the body:

```rill
fn(a: number, b: number):number { $a + $b } => $add
$add(3, 4)    # 7
```

---

## Annotation Reflection

Functions support annotation reflection via `.^key` syntax. Annotations attach metadata to functions for runtime introspection.

**Type Restriction:** Only functions support annotation reflection. Accessing `.^key` on a non-function value halts `RILL-R003`; `.?^key` yields `false` instead. The keys `type` and `effective` are the exception: `.^type` and `.^effective` read on any value.

### Basic Annotation Access

```rill
^(min: 0, max: 100) fn(x) { $x } => $fn

$fn.^min     # 0
$fn.^max     # 100
```

### Function Metadata

Annotations record documentation and versioning alongside the function:

```rill
^(doc: "validates user input", version: 2) fn(input) { $input } => $validate

$validate.^doc      # "validates user input"
$validate.^version  # 2
```

### Configuration Annotations

Annotations carry per-function configuration that a host reads at call time:

```rill
^(timeout: 30000, max_retries: 3) fn(url) { $url } => $fetch

$fetch.^timeout      # 30000
$fetch.^max_retries  # 3
```

### Complex Annotation Values

Annotations can hold any value type:

```rill
^(config: [timeout: 30, endpoints: ["a", "b"]]) fn(x) { $x } => $fn

$fn.^config.timeout      # 30
$fn.^config.endpoints[0] # "a"
```

### Default Value Coalescing

Use the default value operator for optional annotations:

```rill
fn(x) { $x } => $fn
$fn.^timeout ?? 30  # 30 (uses default when annotation missing)

^(timeout: 60) fn(x) { $x } => $withTimeout
$withTimeout.^timeout ?? 30  # 60 (uses annotated value)
```

### Annotation-Driven Logic

```rill
^(enabled: true) fn(x) { $x } => $processor

$processor.^enabled ? "processing" ! "disabled"  # "processing"
```

### Dynamic Annotations

Annotation values are evaluated at function creation:

```rill
10 => $base
^(budget: $base * 10) fn(x) { $x } => $fn
$fn.^budget  # 100
```

### Scope Rule: Direct Annotation Only

Annotations apply only to the function directly targeted by `^(...)`. Functions nested inside an annotated statement do not inherit the annotation.

```rill
# Direct annotation: works
^("doubles input") fn { $ * 2 } => $fn
$fn.^description    # "doubles input"
```

```text
# Nested function does NOT inherit outer annotation
^(version: 2)
"" -> {
  fn(x) { $x } => $fn
}
$fn.^version    # Error: RILL-R008
```

Nesting does not copy an annotation inward: only the function immediately following `^(...)` carries it.

### Annotations on Blocks

An annotation written on a block argument or a collection entry attaches to the function or held block. An annotation on a head block is ignored, because a head block runs where it is written and is never a value. See [Code Blocks](ref-language.md#code-blocks) for how each position treats a block.

### Stacked Annotation Blocks

Several `^(...)` blocks before one target merge into one annotation map:

```rill
^(first: 1) ^(second: 2) fn(x) { $x } => $fn
tuple[$fn.^first, $fn.^second]
# Result: tuple[1, 2]
```

### Error Cases

**Undefined Annotation Key:**

```rill
fn(x) { $x } => $fn
$fn.^missing   # Error: RILL-R008
```

**Non-Function Type:**

```text
"hello" => $str
$str.^key      # Error: RILL-R003
```

All primitive types (string, number, boolean, list, dict) halt `RILL-R003` when accessing `.^key` (other than `type` and `effective`). The presence check `.?^key` never halts on them.

### Presence Check

`.?^key` tests whether a function carries an annotation and yields a bool. It yields `false` for a missing key and for a value that is not a function:

```rill
^(timeout: 30) fn(x) { $x } => $fn
tuple[$fn.?^timeout, $fn.?^retries, "text".?^timeout]
# Result: tuple[true, false, false]
```

`.?^key` tests stored annotations only. `$f.?^type` and `$f.?^effective` are `false` unless the function stores those keys, even though `.^type` and `.^effective` read on any value.

---

## Dict, Ordered, and Tuple Field Annotations

The `^()` syntax works on fields inside `dict`, `ordered`, and `tuple` type constructors. It attaches metadata to individual fields, using the same rules as function parameter annotations.

### Syntax

Place `^(...)` before the field name inside the type constructor:

```text
dict(^(annotations) fieldName: type, ...)
ordered(^(annotations) fieldName: type, ...)
tuple(^(annotations) type, ...)
```

### Dict Field Annotations

```rill
dict(^("Full name") name: string, ^("User age") age: number) => $t
$t
```

The bare string shorthand expands to `description: value`. Scripts read them with `.annotations`:

```rill
dict(^(description: "status", enum: "active,inactive") status: string) => $t
$t.annotations
# Result: dict[status: dict[description: "status", enum: "active,inactive"]]
```

### Ordered Field Annotations

```rill
ordered(^("First") a: string, ^("Second") b: number) => $t
$t.annotations
# Result: dict[a: dict[description: "First"], b: dict[description: "Second"]]
```

`ordered` fields carry annotations at each index in `structure.fields[index].annotations`. Scripts read them with `.annotations`.

### Tuple Field Annotations

Tuple fields are positional. Annotations attach at indices 0, 1, 2, and so on:

```rill
tuple(^("x") number, ^("y") number) => $t
$t
```

The host reads annotations via `structure.elements[index].annotations`. Scripts cannot read tuple position annotations: `.annotations` on a tuple type halts `RILL-R003`.

### Multi-Key Annotations

Use explicit key-value pairs for multiple keys on one field:

```rill
dict(^(description: "score", min: 0, max: 100) score: number) => $t
$t
```

Mix the description shorthand with explicit keys in the same block:

```rill
dict(^("score", min: 0, max: 100) score: number) => $t
$t
```

### Multiple Annotation Blocks

Multiple `^()` blocks before the same field merge into one map:

```rill
dict(^("label") ^(enum: "a,b") name: string) => $t
$t
```

### Dynamic Annotation Values

Annotation values are expressions. Variables and arithmetic resolve at evaluation time:

```rill
"User score" => $label
100 => $max

dict(^(description: $label, max: $max) score: number) => $t
$t
```

### Empty Annotations

`^()` with no arguments produces an empty annotations record. This differs from an unannotated field, which has no `annotations` property at all:

```rill
dict(^() flagged: string, age: number) => $t
$t.annotations
# Result: dict[]
```

In TypeScript, `fields.flagged.annotations` equals `{}` while `fields.age.annotations` is `undefined`. In a script, `$t.annotations` leaves an empty `^()` out, so the result above is `dict[]`.

### Restriction: `list` Does Not Support Field Annotations

`list` takes a single element type, not a named field. Using `^()` inside `list` is a parse error:

```text
list(^("label") string)   # Error: RILL-P001
```

### Contrast with Function Parameter Annotations

| Context | Syntax | Host API path |
|---------|--------|---------------|
| Function parameter | `fn(^("label") x: string)` | `TypeStructure.params[index].annotations` |
| `dict` field | `dict(^("label") x: string)` | `TypeStructure.fields["x"].annotations` |
| `ordered` field | `ordered(^("label") x: string)` | `TypeStructure.fields[index].annotations` |
| `tuple` element | `tuple(^("x") number)` | `TypeStructure.elements[index].annotations` |

All four positions use the same `^()` syntax and the same description shorthand. Annotation values follow the same rules in all positions: bare strings expand to `description`, multiple blocks before a target merge, and values are full expressions.

### Function Parameter Annotations on the Type Structure

`$fn.^type.annotations` reads parameter annotations; hosts read the same data at `TypeStructure.params[i].annotations`. `.inner` lists parameter types only:

```rill
fn(^("label") x: string) { $x } => $fn
$fn.^type.annotations
# Result: dict[x: dict[description: "label"]]
```

### Annotations in Function Type Literals

A bodyless function type literal carries the same per-param annotations as a function definition:

```rill
fn(^("label") x: string):number => $t
$t
```

The result is a `fn` type value. `structure.params[0].annotations` equals `{ description: "label" }`, the same forwarding rule host code sees on `.^type` of a function value.

---

## See Also

| Document | Description |
|----------|-------------|
| [Functions and Code Blocks](topic-closures.md) | Function syntax, scoping, and invocation |
| [Reference](ref-language.md) | Language specification |
| [Guide](guide-getting-started.md) | Getting started tutorial |
