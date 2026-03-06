# rill Closures

*First-class values that capture their defining scope with late binding and dict integration*

## Expression Delimiters

rill has two expression delimiters with deterministic behavior:

| Delimiter | Semantics | Produces |
|-----------|-----------|----------|
| `{ body }` | Deferred (closure creation) | `ScriptCallable` |
| `( expr )` | Eager (immediate evaluation) | Result value |

**Key distinction:**
- **Parentheses `( )`** evaluate immediately and return the result
- **Braces `{ }`** create a closure for later invocation (deferred execution)

### Pipe Target Exception

When `{ }` appears as a pipe target, it creates a closure and **immediately invokes** it:

```rill
5 -> { $ + 1 }    # 6 (same observable result as eager evaluation)
```

This is conceptually two steps happening in sequence:

```text
5 -> { $ + 1 }
     ↓
Step 1: Create closure with implicit $ parameter
Step 2: Invoke closure with piped value (5) as argument
     ↓
Result: 6
```

The observable result matches eager evaluation, but the mechanism differs. This matters when understanding error messages or debugging—the closure exists momentarily before invocation.

**Comparison:**

| Expression | Mechanism | Result |
|------------|-----------|--------|
| `5 -> { $ + 1 }` | Create closure, invoke with 5 | 6 |
| `5 -> ($ + 1)` | Evaluate expression with $ = 5 | 6 |
| `{ $ + 1 } => $fn` | Create closure, store it | closure |
| `($ + 1) => $x` | Error: $ undefined outside pipe | — |

The last row shows the key difference: `( )` requires `$` to already be defined, while `{ }` captures `$` as a parameter for later binding.

---

## Closure Syntax

```text
# Block-closure (implicit $ parameter)
{ body }

# Zero-parameter closure (property-style, no parameters)
|| { body }
||body           # shorthand for simple expressions

# With parameters
|x| { body }
|x|body          # shorthand
|x, y| { body }  # multiple parameters
|x: string| { body }           # typed parameter
|x: number = 10| { body }      # default value (type inferred)
|x: string = "hi"| { body }    # default with explicit type
```

---

## Block-Closures

Block syntax `{ body }` creates a closure with an implicit `$` parameter. This enables deferred execution and reusable transformations.

### Basic Block-Closure

```rill
{ $ + 1 } => $increment

5 -> $increment       # 6
10 -> $increment      # 11
$increment(7)         # 8 (direct call also works)
```

The block `{ $ + 1 }` produces a closure. When invoked, `$` is bound to the argument.

### Block-Closures vs Zero-Param Closures

| Form | Params | `isProperty` | Behavior |
|------|--------|-------------|----------|
| `{ body }` (block-closure) | `[{ name: "$" }]` | `false` | Requires argument |
| `\|\|{ body }` (zero-param) | `[]` | `true` | Auto-invokes on dict access |

```rill
{ $ * 2 } => $double
|| { 42 } => $constant

5 -> $double          # 10 (requires argument)
$constant()           # 42 (no argument needed)

# In dicts
dict[
  double: { $ * 2 },
  constant: || { 42 }
] => $obj

$obj.double(5)        # 10 (explicit call required)
$obj.constant         # 42 (auto-invoked on access)
```

Block-closures require an argument; zero-param closures do not.

### Type Checking

Block-closures check type at runtime:

```rill
{ $ + 1 } => $fn

$fn.^type == closure  # true
$fn(5)                # 6
$fn("text")           # Error: Cannot add string and number
```

### Multi-Statement Block-Closures

Block-closures can contain multiple statements:

```rill
{
  ($ * 2) => $doubled
  "{$}: doubled is {$doubled}"
} => $describe

5 -> $describe        # "5: doubled is 10"
```

### Collection Operations

Block-closures integrate with collection operators:

```rill
list[1, 2, 3] -> map { $ * 2 }                    # list[2, 4, 6]
list[1, 2, 3] -> filter { $ > 1 }                 # list[2, 3]
list[1, 2, 3] -> fold(0) { $@ + $ }               # 6 ($@ is accumulator)
```

### Eager vs Deferred Evaluation

The choice between `( )` and `{ }` determines when code executes:

```rill
# Eager: parentheses evaluate immediately
5 -> ($ + 1) => $result
$result                # 6 (number, already computed)

# Deferred: braces create closure
{ $ + 1 } => $addOne
$addOne.^type == closure  # true

# Practical difference
(5 + 1) => $six        # 6 (immediate)
{ $ + 1 } => $fn       # closure (deferred)

$six                   # 6
10 -> $fn              # 11

# Same closure, reused with different inputs
5 -> $addOne           # 6
10 -> $addOne          # 11
```

Use `( )` when you want the result now. Use `{ }` when you want reusable logic.

---

## Late Binding

Closures resolve captured variables at **call time**, not definition time. This enables recursive patterns and forward references.

### Basic Example

```rill
10 => $x
||($x + 5) => $fn
20 => $x
$fn()    # 25 (sees current $x=20, not $x=10 at definition)
```

### Recursive Closures

```rill
|n| { ($n < 1) ? 1 ! ($n * $factorial($n - 1)) } => $factorial
$factorial(5)    # 120
```

The closure references `$factorial` before it exists. Late binding resolves `$factorial` when the closure executes.

### Mutual Recursion

```rill
|n| { ($n == 0) ? true ! $odd($n - 1) } => $even
|n| { ($n == 0) ? false ! $even($n - 1) } => $odd
$even(4)    # true
```

### Forward References

```rill
list[
  || { $helper(1) },
  || { $helper(2) }
] => $handlers

|n| { $n * 10 } => $helper    # defined after closures

$handlers[0]()    # 10
$handlers[1]()    # 20
```

### Variable Mutation Visibility

Closures see the current value of captured variables:

```rill
0 => $counter
|| { $counter } => $get
|| { $counter + 1 } => $getPlus1

5 => $counter

list[$get(), $getPlus1()]    # list[5, 6]
```

---

## Dict-Bound Closures

Closures stored in dicts have `$` late-bound to the containing dict at invocation (like `this` in other languages).

### Zero-Arg Closures Auto-Invoke

```rill
dict[
  name: "toolkit",
  count: 3,
  summary: || { "{$.name}: {$.count} items" }
] => $obj

$obj.summary    # "toolkit: 3 items" (auto-invoked on access)
```

### Accessing Sibling Fields

```rill
dict[
  width: 10,
  height: 5,
  area: || { $.width * $.height }
] => $rect

$rect.area    # 50
```

### Parameterized Dict Closures

```rill
dict[
  name: "tools",
  greet: |x| { "{$.name} says: {$x}" }
] => $obj

$obj.greet("hello")    # "tools says: hello"
```

### Reusable Closures Across Dicts

```rill
|| { "{$.name}: {$.count} items" } => $describer

dict[name: "tools", count: 3, str: $describer] => $obj1
dict[name: "actions", count: 5, str: $describer] => $obj2

$obj1.str    # "tools: 3 items"
$obj2.str    # "actions: 5 items"
```

### Calling Sibling Methods

```rill
dict[
  double: |n| { $n * 2 },
  quad: |n| { $.double($.double($n)) }
] => $math

$math.quad(3)    # 12
```

---

## List-Stored Closures

Closures in lists maintain their defining scope. Invoke via bracket access:

```rill
list[
  |x| { $x + 1 },
  |x| { $x * 2 },
  |x| { $x * $x }
] => $transforms

$transforms[0](5)    # 6
$transforms[1](5)    # 10
$transforms[2](5)    # 25
```

### Chaining List Closures

```rill
|n| { $n + 1 } => $inc
|n| { $n * 2 } => $double

5 -> chain(list[$inc, $double, $inc])    # 13: (5+1)*2+1
```

---

## Inline Closures

Closures can appear inline in expressions:

```rill
list[1, 2, 3] -> map |x| { $x * 2 }    # list[2, 4, 6]

list[1, 2, 3] -> filter |x| { $x > 1 }    # list[2, 3]

list[1, 2, 3] -> fold(0) |acc, x| { $acc + $x }    # 6
```

### Inline with Block Bodies

```rill
list[1, 2, 3] -> map |x| {
  ($x * 10) => $scaled
  "{$x} -> {$scaled}"
}
# list["1 -> 10", "2 -> 20", "3 -> 30"]
```

---

## Nested Closures

Closures can contain closures. Each captures its defining scope:

```rill
|n| { || { $n } } => $makeGetter
$makeGetter(42)()    # 42
```

### Closure Factory Pattern

```rill
|multiplier| {
  |x| { $x * $multiplier }
} => $makeMultiplier

$makeMultiplier(3) => $triple
$makeMultiplier(10) => $tenX

$triple(5)    # 15
$tenX(5)      # 50
```

### Nested Late Binding

```rill
1 => $x
|| { || { $x } } => $outer
5 => $x
$outer()()    # 5 (inner closure sees updated $x)
```

---

## Parameter Shadowing

Closure parameters shadow captured variables of the same name:

```rill
100 => $x
|x| { $x * 2 } => $double
$double(5)    # 10 (parameter $x=5 shadows captured $x=100)
```

---

## Scope Isolation

### Loop Closures

Each loop iteration creates a new child scope. Capture variables explicitly to preserve per-iteration values:

```rill
# Capture $ into named variable for each iteration
list[1, 2, 3] -> each {
  $ => $item
  || { $item }
} => $closures

list[$closures[0](), $closures[1](), $closures[2]()]    # list[1, 2, 3]
```

**Note:** `$` (pipeValue) is a context property, not a variable. Use explicit capture for closure access.

### Conditional Branch Closures

```rill
10 => $x
true ? { || { $x } } ! { || { 0 } } => $fn
20 => $x
$fn()    # 20 (late binding sees updated $x)
```

---

## Invocation Patterns

### Direct Call

```rill
|x| { $x + 1 } => $inc
$inc(5)    # 6

{ $ + 1 } => $inc
$inc(5)    # 6 (block-closure)
```

### Pipe Call

```rill
|x| { $x + 1 } => $inc
5 -> $inc()    # 6

{ $ + 1 } => $inc
5 -> $inc      # 6 (block-closure, no parens needed)
```

Block-closures work seamlessly with pipe syntax since `$` receives the piped value.

### Postfix Invocation

Call closures from bracket access or expressions:

```rill
list[|x| { $x * 2 }] => $fns
$fns[0](5)    # 10

list[{ $ * 2 }] => $fns
$fns[0](5)    # 10 (block-closure)

|| { |n| { $n * 2 } } => $factory
$factory()(5)    # 10 (chained invocation)
```

### Method Access After Bracket (Requires Grouping)

```rill
list["hello", "world"] => $list

# Use grouping to call method on bracket result
($list[0]).upper    # "HELLO"

# Or use pipe syntax
$list[0] -> .upper    # "HELLO"
```

Note: `$list[0].upper` parses `.upper` as field access on `$list`, not as a method call on the element. This throws an error since lists don't have an `upper` field.

---

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
  $fn.params -> .entries -> each {
    $[1].type -> .empty ? "Missing type annotation: {$[0]}" ! ""
  } -> filter { !$ -> .empty }
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
4. Default value with `=` (optional)

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
  $processor.params -> .entries -> each {
    $[1].?__annotations ? {
      $[1].__annotations.?required ? "Parameter {$[0]} is required" ! ""
    } ! ""
  } -> filter { !$ -> .empty }
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

Valid return type targets: `string`, `number`, `bool`, `list`, `dict`, `any`, `vector`, `shape(...)`, `$shapeVar`.

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
^(config: dict[timeout: 30, endpoints: list["a", "b"]]) |x|($x) => $fn

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

## Error Behavior

### Undefined Variables

Undefined variables throw an error at call time (rill has no null):

```text
|| { $undefined } => $fn
$fn()    # Error: Undefined variable: $undefined
```

### Invoking Non-Callable

```rill
list[1, 2, 3] => $list
$list[0]()    # Error: Cannot invoke non-callable value (got number)
```

### Type Errors

```rill
|x: string| { $x } => $fn
$fn(42)    # Error: Parameter type mismatch: x expects string, got number
```

---

## Implementation Notes

### Scope Chain

Closures store a reference to their defining scope (`definingScope`). At invocation:
1. A child context is created with `definingScope` as parent
2. Parameters are bound in the child context
3. Variable lookups traverse: local → definingScope → parent chain

### Memory Considerations

- Closures hold references to their defining scope
- Scopes form a tree structure (no circular references)
- Scopes remain live while referenced by closures

### Performance

- Variable lookup traverses the scope chain at each access
- No caching (ensures mutation visibility)
- Closure creation is lightweight (stores reference, not copy)

---

## See Also

- [Reference](ref-language.md) — Language specification
- [Collections](topic-collections.md) — `each`, `map`, `filter`, `fold` with closures
- [Guide](guide-getting-started.md) — Getting started tutorial
