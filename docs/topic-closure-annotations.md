# rill Closure Annotations

*Parameter metadata, annotations, reflection, and return type assertions*

## Parameter Metadata

Closures expose parameter metadata via the `.params` property. This enables runtime introspection of function signatures.

### Basic Usage

```rill
|x, y| { $x + $y } => $add
$add.params
# [
#   x: [type: ""],
#   y: [type: ""]
# ]
```

### Typed Parameters

```rill
|name: string, age: number| { "{$name}: {$age}" } => $format
$format.params
# [
#   name: [type: "string"],
#   age: [type: "number"]
# ]
```

### Union Type Parameters

Parameters accept union types using `T1|T2` syntax. The `|` within `string|number` is a union separator, not a closure delimiter. Wrap the body in braces so the parser can locate the closing `|` of the parameter list:

```rill
|x:string|number| { $x } => $fn
$fn("hello")
# Result: "hello"
```

### Block-Closures

Block-closures have an implicit `$` parameter:

```rill
{ $ * 2 } => $double
$double.params
# [
#   $: [type: ""]
# ]
```

### Zero-Parameter Closures

```rill
|| { 42 } => $constant
$constant.params
# []
```

### Practical Use Cases

**Generic Function Wrapper:**

```rill
|fn| {
  $fn.params -> .keys -> .len => $count
  "Function has {$count} parameter(s)"
} => $describe

|x, y| { $x + $y } => $add
$describe($add)    # "Function has 2 parameter(s)"
```

**Validation:**

```text
|fn| {
  $fn.params -> .entries -> seq({
    $[1].type -> .empty ? "Missing type annotation: {$[0]}" ! ""
  }) -> filter({ !$ -> .empty })
} => $checkTypes

|x, y: number| { $x + $y } => $partial
$checkTypes($partial)    # ["Missing type annotation: x"]
```

---

## Parameter Annotations

Parameters can have their own annotations using `^(key: value)` syntax after the parameter name. These attach metadata to individual parameters for validation, configuration, or documentation purposes.

### Syntax and Ordering

Parameter annotations appear in a specific order:

```text
|^(annotations) paramName: type = default| body
```

**Ordering rules:**
1. Parameter annotations with `^()` (optional)
2. Parameter name (required)
3. Type annotation with `:` (optional)
4. Default value with `= literal` (optional)

The `= literal` default also appears in type expressions used with `:?` and `:`. A closure whose params carry defaults satisfies a type annotation that omits those defaults. The reverse does not hold. See [Type System: Defaults in Type Expressions](topic-type-system.md#defaults-in-type-expressions) for the matching rules.

```rill
|^(min: 0, max: 100) x: number|($x) => $validate
|^(required: true) name: string = "guest"|($name) => $greet
|^(cache: true) count = 0|($count) => $process
true
```

### Access Pattern

Parameter annotations are accessed via `.params.paramName.__annotations.key`:

```rill
|^(min: 0, max: 100) x: number, y: string|($x + $y) => $fn

$fn.params
# Returns:
# [
#   x: [type: "number", __annotations: [min: 0, max: 100]],
#   y: [type: "string"]
# ]

$fn.params.x.__annotations.min  # 0
$fn.params.x.__annotations.max  # 100
$fn.params.y.?__annotations     # false (no annotations on y)
```

### Validation Metadata

Use parameter annotations to specify constraints:

```rill
|^(min: 0, max: 100) value: number|($value) => $bounded

$bounded.params.value.__annotations.min  # 0
$bounded.params.value.__annotations.max  # 100
```

**Generic validator pattern:**

```text
|fn, arg| {
  $fn.params -> .entries -> .head -> destruct<$name, $meta>
  $meta.?__annotations ? {
    ($arg < $meta.__annotations.min) ? "Value {$arg} below min {$meta.__annotations.min}" !
    ($arg > $meta.__annotations.max) ? "Value {$arg} above max {$meta.__annotations.max}" !
    ""
  } ! ""
} => $validate

|^(min: 0, max: 10) x: number|($x) => $ranged
$validate($ranged, 15)  # "Value 15 above max 10"
```

### Caching Hints

Mark parameters that should trigger caching behavior:

```rill
|^(cache: true) key: string|($key) => $fetch

$fetch.params.key.__annotations.cache  # true
```

### Format Specifications

Attach formatting metadata to parameters:

```rill
|^(format: "ISO8601") timestamp: string|($timestamp) => $formatDate

$formatDate.params.timestamp.__annotations.format  # "ISO8601"
```

### Multiple Annotations

Parameters can have multiple annotations:

```rill
|^(required: true, pattern: ".*@.*", maxLength: 100) email: string|($email) => $validateEmail

$validateEmail.params.email.__annotations.required    # true
$validateEmail.params.email.__annotations.pattern     # ".*@.*"
$validateEmail.params.email.__annotations.maxLength   # 100
```

### Annotation-Driven Logic

Use parameter annotations to drive runtime behavior:

```text
|processor| {
  $processor.params -> .entries -> seq({
    $[1].?__annotations ? {
      $[1].__annotations.?required ? "Parameter {$[0]} is required" ! ""
    } ! ""
  }) -> filter({ !$ -> .empty })
} => $getRequiredParams

|x, ^(required: true) y: string, z|($x) => $fn
$getRequiredParams($fn)  # ["Parameter y is required"]
```

### Checking for Annotations

Use existence check `.?__annotations` to determine if a parameter has annotations:

```rill
|^(min: 0) x: number, y: string|($x + $y) => $fn

$fn.params.x.?__annotations  # true
$fn.params.y.?__annotations  # false
```

---

## Description Shorthand

A bare string in `^(...)` expands to `description: <string>`. This shorthand works in all three annotation positions.

```rill
^("Get current weather for a city")
|city: string|($city) => $weather
$weather.^description    # "Get current weather for a city"
```

The shorthand is equivalent to the explicit key form:

```rill
^(description: "Get current weather for a city")
|city: string|($city) => $weather
$weather.^description    # "Get current weather for a city"
```

Mix explicit keys with the shorthand in the same annotation:

```rill
^("Fetch user profile", cache: true)
|id: string|($id) => $get_user
$get_user.^description    # "Fetch user profile"
$get_user.^cache          # true
```

---

## Return Type Assertions

The `:type-target` postfix after the closing `}` declares and enforces the closure's return type. The runtime validates the return value on every call — a mismatch halts with `RILL-R004`.

```rill
|x: number| { "{$x}" }:string => $fn
$fn(42)    # "42" (string from interpolation)
```

Valid return type targets: any type name (`string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`, `ordered`, `vector`, `any`, `type`), or a parameterized type constructor (`list(string)`, `dict(a: number, b: string)`).

```rill
|items: list(number)| { $items -> seq({ $ * 2 }) }:list(number) => $double_all
$double_all(list[1, 2, 3])
# Result: list[2, 4, 6]
```

```text
# Mismatch: string list cannot satisfy list(number)
|items| { $items }:list(number) => $fn
list["a", "b"] -> $fn
# Error: RILL-R004: Type assertion failed: expected list(number), got list(string)
```

Mismatched return type halts with `RILL-R004`:

```text
|x: number| { $x * 2 }:string => $double
$double(5)    # RILL-R004: Type assertion failed: expected string, got number
```

Declared return type is accessible via `$fn.^output`. Whitespace and newlines are allowed between `}` and `:`:

```rill
|a: number, b: number| { $a + $b }:number => $add
$add(3, 4)    # 7
```

---

## Annotation Reflection

Closures support annotation reflection via `.^key` syntax. Annotations attach metadata to closures for runtime introspection.

**Type Restriction:** Only closures support annotation reflection. Accessing `.^key` on primitives throws `RUNTIME_TYPE_ERROR`.

### Basic Annotation Access

```rill
^(min: 0, max: 100) |x|($x) => $fn

$fn.^min     # 0
$fn.^max     # 100
```

### Complex Annotation Values

Annotations can hold any value type:

```rill
^(config: [timeout: 30, endpoints: ["a", "b"]]) |x|($x) => $fn

$fn.^config.timeout      # 30
$fn.^config.endpoints[0] # "a"
```

### Default Value Coalescing

Use the default value operator for optional annotations:

```rill
|x|($x) => $fn
$fn.^timeout ?? 30  # 30 (uses default when annotation missing)

^(timeout: 60) |x|($x) => $withTimeout
$withTimeout.^timeout ?? 30  # 60 (uses annotated value)
```

### Annotation-Driven Logic

```rill
^(enabled: true) |x|($x) => $processor

$processor.^enabled ? "processing" ! "disabled"  # "processing"
```

### Dynamic Annotations

Annotation values are evaluated at closure creation:

```rill
10 => $base
^(limit: $base * 10) |x|($x) => $fn
$fn.^limit  # 100
```

### Scope Rule: Direct Annotation Only

Annotations apply only to the closure directly targeted by `^(...)`. Closures nested inside an annotated statement do not inherit the annotation.

```rill
# Direct annotation: works
^("doubles input") { $ * 2 } => $fn
$fn.^description    # "doubles input"
```

```text
# Nested closure does NOT inherit outer annotation
^(version: 2)
"" -> {
  |x|($x) => $fn
}
$fn.^version    # Error: RUNTIME_UNDEFINED_ANNOTATION
```

Only the closure immediately following `^(...)` carries the annotation.

### Error Cases

**Undefined Annotation Key:**

```rill
|x|($x) => $fn
$fn.^missing   # Error: RUNTIME_UNDEFINED_ANNOTATION
```

**Non-Closure Type:**

```text
"hello" => $str
$str.^key      # Error: RUNTIME_TYPE_ERROR
```

All primitive types (string, number, boolean, list, dict) throw `RUNTIME_TYPE_ERROR` when accessing `.^key`.

---

## Dict, Ordered, and Tuple Field Annotations

The `^()` syntax works on fields inside `dict`, `ordered`, and `tuple` type constructors. It attaches metadata to individual fields, using the same rules as closure parameter annotations.

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

The bare string shorthand expands to `description: value`. Access annotations from the host via `TypeStructure`:

```rill
dict(^(description: "status", enum: "active,inactive") status: string) => $t
$t
```

### Ordered Field Annotations

```rill
ordered(^("First") a: string, ^("Second") b: number) => $t
$t
```

`ordered` fields carry annotations at each index in `structure.fields[index].annotations`.

### Tuple Field Annotations

Tuple fields are positional. Annotations attach at indices 0, 1, 2, and so on:

```rill
tuple(^("x") number, ^("y") number) => $t
$t
```

The host reads annotations via `structure.elements[index].annotations`.

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
$t
```

In TypeScript, `fields.flagged.annotations` equals `{}` while `fields.age.annotations` is `undefined`.

### Restriction: `list` Does Not Support Field Annotations

`list` takes a single element type, not a named field. Using `^()` inside `list` is a parse error:

```text
list(^("label") string)   # Error: RILL-P001
```

### Contrast with Closure Parameter Annotations

| Context | Syntax | Host API path |
|---------|--------|---------------|
| Closure parameter | `\|^("label") x: string\|` | `TypeStructure.params[index].annotations` |
| `dict` field | `dict(^("label") x: string)` | `TypeStructure.fields["x"].annotations` |
| `ordered` field | `ordered(^("label") x: string)` | `TypeStructure.fields[index].annotations` |
| `tuple` element | `tuple(^("x") number)` | `TypeStructure.elements[index].annotations` |

All four positions use the same `^()` syntax and the same description shorthand. Annotation values follow the same rules in all positions: bare strings expand to `description`, multiple blocks merge, and values are full expressions.

### Closure `.^input` Forwards Annotations

When a closure carries parameter annotations, `.^input` reflects those annotations in its `ordered` structure. Each field in `.^input.structure.fields` carries the same `annotations` record as the original parameter:

```rill
|^("label") x: string|{ $x } => $fn
$fn.^input
```

The returned `ordered` type has `structure.fields[0].annotations` equal to `{ description: "label" }`.

---

## See Also

| Document | Description |
|----------|-------------|
| [Closures](topic-closures.md) | Closure syntax, scoping, and invocation |
| [Reference](ref-language.md) | Language specification |
| [Guide](guide-getting-started.md) | Getting started tutorial |
