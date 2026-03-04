# rill Type System

*Value types, type assertions, and type checking*

## Overview

rill is dynamically typed and type-safe. Types are checked at runtime, but type errors are always caught—there are no implicit conversions or coercions.

| Type | Syntax | Example |
|------|--------|---------|
| String | `"text"` | `"hello"` |
| Number | `123`, `0.5` | `42`, `0.9` |
| Bool | `true`, `false` | `true` |
| List | `[a, b]` | `["file.ts", 42]` |
| Dict | `[k: v]` | `[output: "text", code: 0]` |
| Tuple | `*[...]` | `*[1, 2]`, `*[x: 1, y: 2]` |
| Vector | host-provided | `vector(voyage-3, 1024d)` |
| Closure | `\|\|{ }` | `\|x\|($x * 2)` |
| Shape | `shape(field: type)` | `shape(name: string, age: number)` |
| Field | field descriptor | `$s.fieldname` |
| Type | type name expression | `number`, `dict`, `type` |

**Key principles:**
- **Type-safe**: No implicit coercion—`"5" + 1` errors, not `"51"` or `6`
- **Type-locked variables**: A variable that holds a string always holds a string
- **Value-based**: All copies are deep, all comparisons by value
- **No null/undefined**: Empty values are valid (`""`, `[]`, `[:]`), but "no value" cannot exist
- **No truthiness**: Conditions require actual booleans, not "truthy" values

---

## Strings

Double-quoted text with variable interpolation using `{$var}`:

```text
"hello world"
"Process {$filename} for review"
"Result: {$response}"
```

Escape sequences: `\n`, `\t`, `\\`, `\"`, `{{` (literal `{`), `}}` (literal `}`)

### Interpolation

Any valid expression works inside `{...}`:

```rill
"alice" => $name
3 => $a
5 => $b
true => $ok
"Hello, {$name}!"                    # Variable
"sum: {$a + $b}"                     # Arithmetic
"valid: {$a > 0}"                    # Comparison
"status: {$ok ? \"yes\" ! \"no\"}"   # Conditional
"upper: {$name -> .upper}"           # Method chain
```

### Multiline Strings

Multiline strings use triple-quote syntax:

```rill
"World" => $name
"""
Hello, {$name}!
Line two
"""
```

Triple-quote strings support interpolation like regular strings.

See [Strings](topic-strings.md) for string methods.

---

## Numbers

Used for arithmetic, exit codes, and loop limits:

```rill
42
0
3.14159
-7
```

**Arithmetic operators:** `+`, `-`, `*`, `/`, `%` (modulo)

**Type constraint:** All arithmetic operands must be numbers. No implicit conversion:

```rill
5 + 3                      # 8
```

```text
# Error: Arithmetic requires number, got string
"5" + 1
```

---

## Booleans

Literal `true` and `false`. Conditional expressions (`?`), loop conditions (`@`), and filter predicates require boolean values. Non-boolean values cause runtime errors.

```rill
true ? "yes" ! "no"        # "yes"
false ? "yes" ! "no"       # "no"
```

**No truthiness:** rill has no automatic boolean coercion. Empty strings, zero, and empty lists are not "falsy"—you must explicitly check:

```rill
"" -> .empty ? "empty" ! "has content"     # Use .empty method
0 -> ($ == 0) ? "zero" ! "nonzero"         # Use comparison
```

### Type-Safe Negation

The negation operator (`!`) requires a boolean operand. There is no truthiness coercion:

```rill
!true                      # false
!false                     # true
"hello" -> .empty -> (!$)  # true (negates boolean from .empty)
```

```text
!"hello"                   # ERROR: Negation requires boolean, got string
!0                         # ERROR: Negation requires boolean, got number
```

Use explicit boolean checks when needed:

```rill
"" -> .empty -> (!$) ? "has content" ! "empty"    # Negate boolean result
[1,2,3] -> .empty -> (!$) ? "has items" ! "none"  # Check non-empty
```

---

## Lists

Ordered sequences of values:

```rill
[1, 2, 3] => $nums
$nums[0]                   # 1
$nums[-1]                  # 3 (last element)
$nums -> .len              # 3
```

### List Spread

Inline elements from another list using `...` spread syntax:

```rill
[1, 2] => $a
[...$a, 3]                 # [1, 2, 3]
[...$a, ...$a]             # [1, 2, 1, 2] (concatenation)
[...[], 1]                 # [1] (empty spread contributes nothing)
```

Spread expressions evaluate before inlining:

```rill
[1, 2, 3] => $nums
[...($nums -> map {$ * 2})]  # [2, 4, 6]
```

Spreading a non-list throws an error:

```text
"hello" => $str
[...$str]                  # Error: Spread in list literal requires list, got string
```

**Access methods:**
- `[0]`, `[1]` — Index access (0-based)
- `[-1]`, `[-2]` — Negative index (from end)
- `.head` — First element (errors on empty)
- `.tail` — Last element (errors on empty)
- `.at(n)` — Element at index

**Out-of-bounds access** throws an error:

```text
[] -> .at(0)               # Error: List index out of bounds
["a"] -> .at(5)            # Error: List index out of bounds
```

Use `??` for safe access with default:

```rill
["a"] => $list
$list[0] ?? "default"  # "a"
```

See [Collections](topic-collections.md) for iteration operators.

---

## Dicts

Key-value mappings with identifier, number, boolean, variable, or computed keys:

```rill
# Identifier keys
[name: "alice", age: 30] => $person
$person.name               # "alice"
$person.age                # 30
```

```text
# Number keys (including negative)
[1: "one", 2: "two", -1: "minus one"] => $numbers
1 -> $numbers              # "one"
(-1) -> $numbers           # "minus one"

# Boolean keys
[true: "yes", false: "no"] => $yesno
true -> $yesno             # "yes"

# Variable keys (key value from variable, must be string)
"status" => $key
[$key: "active"]           # [status: "active"]

# Computed keys (key from expression, must be string)
"user" => $prefix
[($prefix -> "{$}_name"): "alice"]  # [user_name: "alice"]

# Multi-key syntax (same value for multiple keys)
[["a", "b"]: 1]            # [a: 1, b: 1]
[[1, "1"]: "x"]            # [1: "x", "1": "x"] (mixed types)
[a: 0, ["b", "c"]: 1]      # [a: 0, b: 1, c: 1] (mixed entries)
[a: 0, ["a", "b"]: 1]      # [a: 1, b: 1] (last-write-wins)

# Multi-key dispatch
[["GET", "HEAD"]: "safe", ["POST", "PUT"]: "unsafe"] => $methods
"GET" -> $methods          # "safe"
"POST" -> $methods         # "unsafe"
```

Multi-key errors:

```text
[[]: 1]                    # Error: Multi-key dict entry requires non-empty list
[[[1, 2], "a"]: 1]         # Error: Dict key must be string, number, or boolean, got list
```

**Access patterns:**
- `.field` — Literal field access (identifier keys only)
- `.$key` — Variable as key
- `.($i + 1)` — Computed expression as key
- `.(a || b)` — Alternatives (try keys left-to-right)
- `.field ?? default` — Default value if missing
- `.?field` — Existence check, literal key (returns bool)
- `.?$key` — Existence check, variable key
- `.?($expr)` — Existence check, computed key
- `.?field&type` — Existence + type check (all forms support `&type`)

**Note:** Number and boolean keys require dispatch syntax (`value -> dict`) or bracket access. Dot notation (`.1`, `.true`) is not valid syntax.

**Missing key access** throws an error. Use `??` for safe access:

```rill
[:] => $d
$d.missing ?? ""           # "" (safe default)
```

### Type-Aware Dispatch

Dict dispatch uses type-aware matching. Keys are matched by both value and type:

```text
# Number vs string discrimination
[1: "number one", "1": "string one"] => $mixed
1 -> $mixed                # "number one" (number key)
"1" -> $mixed              # "string one" (string key)

# Boolean vs string discrimination
[true: "bool true", "true": "string true"] => $flags
true -> $flags             # "bool true" (boolean key)
"true" -> $flags           # "string true" (string key)
```

This enables pattern matching where the same semantic value (e.g., `1` vs `"1"`) triggers different behavior based on type.

### Dict Methods

| Method | Description |
|--------|-------------|
| `.keys` | All keys as list |
| `.values` | All values as list |
| `.entries` | List of `[key, value]` pairs |

```rill
[name: "test", count: 42] -> .keys      # ["count", "name"]
[name: "test", count: 42] -> .values    # [42, "test"]
[a: 1, b: 2] -> .entries                # [["a", 1], ["b", 2]]
```

**Reserved methods** (`keys`, `values`, `entries`) cannot be used as dict keys.

### Dict Closures

Closures in dicts have `$` late-bound to the containing dict. See [Closures](topic-closures.md) for details.

```rill
[
  name: "toolkit",
  count: 3,
  str: ||"{$.name}: {$.count} items"
] => $obj

$obj.str    # "toolkit: 3 items" (auto-invoked)
```

---

## Tuples

Tuples package values for explicit argument unpacking at closure invocation. Created with the `*` spread operator:

```rill
# From list (positional)
*[1, 2, 3] => $t              # tuple with positional values

# From dict (named)
*[x: 1, y: 2] => $t           # tuple with named values

# Via pipe target
[1, 2, 3] -> * => $t          # convert list to tuple
```

### Using Tuples at Invocation

```rill
|a, b, c| { "{$a}-{$b}-{$c}" } => $fmt

# Positional unpacking
*[1, 2, 3] -> $fmt()          # "1-2-3"

# Named unpacking (order doesn't matter)
*[c: 3, a: 1, b: 2] -> $fmt() # "1-2-3"
```

### Strict Validation

When invoking with tuples, missing required parameters error, and extra arguments error:

```rill
|x, y|($x + $y) => $fn
*[1] -> $fn()                 # Error: missing argument 'y'
*[1, 2, 3] -> $fn()           # Error: extra positional argument
*[x: 1, z: 3] -> $fn()        # Error: unknown argument 'z'
```

### Parameter Defaults with Tuples

```rill
|x, y = 10, z = 20|($x + $y + $z) => $fn
*[5] -> $fn()                 # 35 (5 + 10 + 20)
*[x: 5, z: 30] -> $fn()       # 45 (5 + 10 + 30)
```

### Auto-Unpacking with Parallel Spread

When a closure is invoked with a single tuple argument, the tuple auto-unpacks:

```rill
# List of tuples with multi-arg closure
[*[1,2], *[3,4]] -> map |x,y|($x * $y)    # [2, 12]

# Named tuples work too
[*[x:1, y:2], *[x:3, y:4]] -> map |x,y|($x + $y)  # [3, 7]
```

---

## Vectors

Vectors represent dense numeric embeddings from language models or other ML systems. Host applications provide vectors through embedding APIs.

**Display format:** `vector(model, Nd)` where `model` is the source model name and `N` is the dimension count.

```rill
app::embed("hello world") => $vec
$vec
# Result: vector(mock-embed, 3d)
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `.dimensions` | number | Number of dimensions in the vector |
| `.model` | string | Source model name |

```rill
app::embed("hello world") => $vec
$vec -> .dimensions
# Result: 3

$vec -> .model
# Result: "mock-embed"
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.similarity(other)` | number | Cosine similarity, range [-1, 1] |
| `.dot(other)` | number | Dot product |
| `.distance(other)` | number | Euclidean distance, >= 0 |
| `.norm()` | number | L2 magnitude |
| `.normalize()` | vector | Unit vector (preserves model) |

```rill
app::embed("hello") => $a
app::embed("hi") => $b
$a -> .similarity($b)
# Result: 1.0

$a -> .dot($b)
# Result: 0.14

$a -> .distance($b)
# Result: 0.0

$a -> .norm
# Result: 0.37

$a -> .normalize -> .norm
# Result: 1.0
```

### Comparison

Vectors support equality comparison (`==`, `!=`). Two vectors are equal when both model and all float elements match:

```rill
app::embed("test") => $v1
app::embed("test") => $v2
$v1 == $v2
# Result: true
```

Vectors from different models are never equal, even with identical data:

```rill
# Different models
app::embed("test", "model-a") => $v1
app::embed("test", "model-b") => $v2
$v1 == $v2
# Result: false
```

### Behavioral Notes

- **Immutable**: Vector data cannot be modified after creation
- **Always truthy**: Vectors evaluate to true in boolean contexts (non-empty by construction)
- **No string coercion**: Cannot be used in string interpolation or concatenation
- **No collection operations**: Cannot use `each`, `map`, `filter`, `fold` on vectors

```rill
# Error: cannot coerce vector to string
"Result: {$vec}"

# Error: Collection operators require list, string, dict, or iterator, got vector
$vec -> each { $ * 2 }
```

---

## Shape

A shape describes the expected structure of a dict — field names mapped to types with optional metadata. Shapes are first-class values with their own type.

### Shape Literals

```rill
# Basic shape literal
shape(name: string, age: number) => $s
$s -> :?shape
# Result: true

$s -> :?dict
# Result: false
```

### Optional Fields

Append `?` to a field type to mark it optional:

```rill
shape(name: string, tag: string?) => $s
[name: "Alice"] -> :$s
# Result: [name: "Alice"]

[name: "Alice", tag: "admin"] -> :$s
# Result: [name: "Alice", tag: "admin"]
```

### Nested Shapes

Use `shape(field: type)` or the `(field: type)` shorthand for nested structure:

```rill
# Explicit nested shape
shape(meta: shape(ts: number)) => $s
[meta: [ts: 5]] -> :$s
# Result: [meta: [ts: 5]]

# Shorthand — desugars to the same nested shape
shape(meta: (ts: number)) => $s
[meta: [ts: 5]] -> :$s
# Result: [meta: [ts: 5]]
```

Nested validation errors report the full dot-separated path:

```text
shape(user: (address: (zip: string))) => $s
[user: [address: [:]]] -> :$s
# Error: missing required field "user.address.zip"
```

### Spread Composition

Use `...` to inline all fields from a base shape:

```rill
shape(x: number) => $base
shape(...$base, age: number) => $composed
[x: 5, age: 30] -> :$composed
# Result: [x: 5, age: 30]
```

Annotations from the source shape carry through to the composed shape.

### Shape Validation

Six forms cover dict validation and shape type assertions:

| Form | Syntax | Behavior |
|------|--------|----------|
| Variable ref (assert) | `:$varName` | Halts on mismatch |
| Variable ref (check) | `:?$varName` | Returns bool, never throws |
| Inline literal (assert) | `:shape(field: type)` | Halts on mismatch |
| Inline literal (check) | `:?shape(field: type)` | Returns bool, never throws |
| Type assertion | `:shape` | Returns value if it is a shape type, halts otherwise |
| Type check | `:?shape` | Returns `true` if value is a shape type, `false` otherwise |

**Disambiguation:** After `:` (and optional `?`), `$` signals a variable shape reference, `shape` followed by `(` signals an inline shape literal, and `shape` without `(` is a plain type assertion on the value itself — checking whether the value is a shape, not validating dict contents against one.

**Assert form:** Halts execution with `RILL-R004` on mismatch. Returns the dict unchanged on success.

```rill
shape(name: string, age: number) => $s
[name: "Alice", age: 30] -> :$s
# Result: [name: "Alice", age: 30]
```

Extra undeclared fields pass — validation is lenient:

```rill
shape(name: string) => $s
[name: "Alice", extra: 99] -> :$s
# Result: [name: "Alice", extra: 99]
```

Failure cases use `text` fences because they halt:

```text
shape(name: string) => $s
[:] -> :$s
# Error: Shape assertion failed: missing required field "name"

[name: 42] -> :$s
# Error: Shape assertion failed: field "name" expected string, got number

42 -> :$s
# Error: Shape assertion failed: expected dict, got number
```

**Check form:** Returns `true` or `false`, never halts:

```rill
shape(name: string) => $s
[name: "Alice"] -> :?$s
# Result: true

[:] -> :?$s
# Result: false
```

**Inline form:** Shape literal directly in type position:

```rill
[x: 5] -> :shape(x: number)
# Result: [x: 5]

[x: 5] -> :?shape(x: number)
# Result: true

[x: "hello"] -> :?shape(x: number)
# Result: false
```

### Annotations on Shape Fields

Attach metadata to individual fields using `^(...)` before the field name:

```rill
shape(^(enum: ["admin", "user"]) role: string) => $s
[role: "admin"] -> :$s
# Result: [role: "admin"]
```

The `enum` annotation enforces allowed values during both assert and check:

```rill
shape(^(enum: ["admin", "user"]) role: string) => $s
[role: "guest"] -> :?$s
# Result: false
```

Supported annotation keys:

| Key | Type | Purpose |
|-----|------|---------|
| `description` | `string` | Human-readable field description |
| `enum` | `list` | Allowed values — enforced during assert and check |
| `default` | any | Default value hint for host tooling (metadata only) |

Annotation keys `type`, `input`, and `output` are reserved — using them is a parse error:

```text
^(type: "custom") name: string   # Error: annotation key "type" is reserved
```

### Shape Field Access

Access field names and field descriptors directly from a shape value.

`.keys` returns field names in declaration order:

```rill
shape(name: string, age: number, role: string) => $s
$s.keys   # ["name", "age", "role"]
```

`.entries` returns a list of `["fieldname", descriptor]` pairs:

```rill
shape(name: string, age: number) => $s
$s -> .entries -> each { log($[0]) }
# Logs: "name" then "age"
```

`.fieldname` returns the field descriptor for that field:

```rill
shape(name: string, age: number) => $s
$s.name           # field descriptor
$s.name.optional  # false
$s.age.optional   # false

shape(email: string?) => $s2
$s2.email.optional  # true
```

Accessing an absent field errors:

```text
shape(name: string) => $s
$s.missing   # Error: Shape has no field "missing"
```

### Field Descriptor

A field descriptor is a first-class value with type identity `"field"`. Access it via `$shape.fieldname`.

**Properties:**

| Property | Returns | Description |
|----------|---------|-------------|
| `.type` | type value | The declared type of the field |
| `.optional` | bool | `true` if the field is marked optional |
| `.shape` | shape or `false` | Nested shape for shape-typed fields; `false` otherwise |

`.type` returns the type value for the field:

```rill
shape(name: string, age: number) => $s
$s.name.type      # string (type value)
$s.name.type == string  # true
```

`.shape` returns the nested shape for shape-typed fields, or `false` for non-nested fields:

```rill
shape(user: (name: string, age: number)) => $s
$s.user.type      # shape (type value)
$s.user.shape     # shape(name: string, age: number)
```

```rill
shape(name: string) => $s
$s.name.shape     # false
```

**Annotation access:**

| Expression | Returns |
|-----------|---------|
| `$d.^key` | Annotation value for `key` |
| `$d.^keys` | List of annotation key names |

```rill
shape(
  ^("User name") name: string,
  ^("User role", enum: ["admin", "user"]) role: string
) => $s

$s.name.^description   # "User name"
$s.role.^enum          # ["admin", "user"]
$s.role.^description   # "User role"
```

`.^keys` returns all annotation key names on the field:

```rill
shape(^("User name", enum: ["alice", "bob"]) name: string) => $s
$s.name.^keys   # ["description", "enum"]
```

Accessing an absent annotation key errors:

```text
shape(name: string) => $s
$s.name.^enum   # Error: Annotation "enum" not found on field "name"
```

**Type identity:** Field descriptors have type `"field"`:

```rill
shape(name: string) => $s
$s.name.^type == field  # true
$s.name -> :?field      # true
```

### `to_shape()` Built-in

Convert a dict descriptor to a shape value. Useful for building shapes programmatically:

```rill
# String field spec: "typeName" or "typeName?"
to_shape([name: "string", count: "number?"]) => $s
[name: "Alice"] -> :$s
# Result: [name: "Alice"]

# Dict with type key: type + annotations
to_shape([role: [type: "string", enum: ["admin", "user"]]]) => $s
[role: "admin"] -> :$s
# Result: [role: "admin"]

# Dict without type key: recursive nested shape
to_shape([address: [street: "string", city: "string"]]) => $s
[address: [street: "Main St", city: "Springfield"]] -> :$s
# Result: [address: [street: "Main St", city: "Springfield"]]

# Shape passthrough: returns unchanged
shape(name: string) => $original
to_shape($original) -> :?shape
# Result: true
```

### Shape vs Dict

Shapes and dicts are distinct types with different runtime behavior:

| Property | Dict | Shape |
|----------|------|-------|
| `.^type` | `dict` (type value) | `shape` (type value) |
| `.^name` (on `.^type` result) | `"dict"` | `"shape"` |
| `:?dict` check | `true` | `false` |
| `:?shape` check | `false` | `true` |

```rill
[name: "Alice"] => $p
$p.^type == dict
# Result: true

shape(name: string) => $s
$s.^type == shape
# Result: true
```

---

## Type Assertions

Use type assertions to validate values at runtime.

### Assert Type (`:type`)

Error if type doesn't match, returns value unchanged:

```rill
# Postfix form (binds tighter than method calls)
42:number                     # passes, returns 42
(1 + 2):number                # passes, returns 3
42:number.str                 # "42" - assertion then method

# Pipe target form
"hello" -> :string            # passes, returns "hello"
"hello" -> :number            # ERROR: expected number, got string
$val -> :dict -> .keys        # assert dict, then get keys
```

### Check Type (`:?type`)

Returns boolean, no error:

```rill
# Postfix form
42:?number                    # true
"hello":?number               # false

# Pipe target form
"hello" -> :?string           # true
```

Type checks work in conditionals:

```text
$val -> :?list ? process() ! skip()   # branch on type
```

**Supported types:** `string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`, `vector`, `shape`, `field`, `any`, `type`

The `vector` type matches host-provided typed arrays. The `any` type name accepts any value type — useful for generic closures.

Both types are valid in closure parameter positions, capture annotations, and type assertions:

```rill
# Closure parameter with vector type annotation
|x: vector| { $x } => $fn
app::embed("hello") => $v
$fn($v)
# Result: vector(mock-embed, 3d)
```

```rill
# Closure parameter with any type annotation
|x: any| { $x } => $fn
$fn("hello")
# Result: "hello"
```

```rill
# Type assertion: :vector and :any
app::embed("hello") => $v
$v -> :vector
# Result: vector(mock-embed, 3d)

$v -> :any
# Result: vector(mock-embed, 3d)
```

```rill
# Capture annotation with vector type
app::embed("hello") => $x:vector
$x -> .model
# Result: "mock-embed"
```

### In Pipe Chains

```rill
# Assert type and continue processing
[1, 2, 3] -> :list -> each { $ * 2 }

# Multiple assertions in chain
"test" -> :string -> .len -> :number   # 4
```

### Use Cases

```rill
# Validate function input
|data| {
  $data -> :list              # assert input is list
  $data -> each { $ * 2 }
} => $process_items

# Type-safe branching
|val| {
  $val -> :?number ? ($val * 2) ! ($val -> .len)
} => $process
$process(5)        # 10
$process("hello")  # 5
```

---

## Type-Locked Variables

Variables lock type on first assignment. The type is inferred from the value or declared explicitly:

```rill
"hello" => $name              # implicit: locked as string
"world" => $name              # OK: same type
5 => $name                    # ERROR: cannot assign number to string

"hello" => $name:string       # explicit: declare and lock as string
42 => $count:number           # explicit: declare and lock as number
```

### Inline Capture with Type

```rill
"hello" => $x:string -> .len  # type annotation in mid-chain
```

Type annotations validate on assignment and prevent accidental type changes:

```rill
|x|$x => $fn                  # locked as closure
"text" => $fn                 # ERROR: cannot assign string to closure
```

---

## Type Values

rill has an 11th runtime type named `type`. A type value represents a rill type itself.

### `.^type` Operator

`.^type` returns the type value for any rill value. Use it on variables:

```rill
42 => $n
$n.^type == number
# Result: true

"hello" => $s
$s.^type == string
# Result: true

[1, 2] => $l
$l.^type == list
# Result: true

[a: 1] => $d
$d.^type == dict
# Result: true
```

```rill
*[1, 2] => $t
$t.^type == tuple
# Result: true

||{ $ } => $fn
$fn.^type == closure
# Result: true
```

```rill
app::embed("hello world") => $vec
$vec.^type == vector
# Result: true
```

```rill
shape(name: string) => $shp
$shp.^type == shape
# Result: true
```

### Type Name Expressions

All 11 type names are valid expressions that produce type values:

```rill
string => $st
$st.^type == type
# Result: true

number => $nt
$nt.^type == type
# Result: true

type => $tt
$tt.^type == type
# Result: true

field => $ft
$ft.^type == type
# Result: true
```

### `.^name` Property

Every type value has a `.^name` annotation that returns its string name:

```rill
42 => $n
$n.^type => $tv
$tv.^name
# Result: "number"

"hello" => $s
$s.^type => $tv
$tv.^name
# Result: "string"
```

Bare type names also support `.^name` via a variable:

```rill
dict => $t
$t.^name
# Result: "dict"

number => $t
$t.^name
# Result: "number"
```

### Type Value Equality

Type values compare with `==` and `!=`:

```rill
42 => $n
$n.^type == number
# Result: true

42 => $n
$n.^type == string
# Result: false

"hello" => $a
"world" => $b
$a.^type == $b.^type
# Result: true
```

The type of a type value is `type`:

```rill
42 => $n
$n.^type => $tv
$tv.^type == type
# Result: true

type => $t
$t.^type == type
# Result: true
```

### Global Type Utilities

| Function | Description |
|----------|-------------|
| `json` | Convert to JSON string |
| `to_shape` | Convert dict descriptor to shape value |

```rill
[a: 1, b: 2] -> json
# Result: '{"a":1,"b":2}'
```

**`json` closure handling:**
- Direct closure → error: `|x|{ $x } -> json` throws "Cannot serialize closure to JSON"
- Closures in dicts → skipped: `[a: 1, fn: ||{ 0 }] -> json` returns `'{"a":1}'`
- Closures in lists → skipped: `[1, ||{ 0 }, 2] -> json` returns `'[1,2]'`

---

## See Also

- [Variables](topic-variables.md) — Declaration, scope, `$` binding
- [Closures](topic-closures.md) — Closure semantics and patterns
- [Collections](topic-collections.md) — List iteration operators
- [Strings](topic-strings.md) — String methods reference
- [Reference](ref-language.md) — Quick reference tables
