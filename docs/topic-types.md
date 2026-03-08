# rill Type System

*Value types, type assertions, and type checking*

## Overview

rill is dynamically typed and type-safe. Types are checked at runtime, but type errors are always caught—there are no implicit conversions or coercions.

| Type | Syntax | Example |
|------|--------|---------|
| String | `"text"` | `"hello"` |
| Number | `123`, `0.5` | `42`, `0.9` |
| Bool | `true`, `false` | `true` |
| List | `[a, b]` or `list[a, b]` | `list["file.ts", 42]` |
| Dict | `[k: v]` or `dict[k: v]` | `dict[output: "text", code: 0]` |
| Ordered | `ordered[k: v]` | `ordered[a: 1, b: "hello"]` |
| Tuple | `tuple[...]` (positional) | `tuple[1, 2]` |
| Vector | host-provided | `vector(voyage-3, 1024d)` |
| Closure | `\|\|{ }` | `\|x\|($x * 2)` |
| Type | type name or constructor | `number`, `list(number)`, `dict(a: number)` |

**Key principles:**
- **Type-safe**: No implicit coercion—`"5" + 1` errors, not `"51"` or `6`
- **Type-locked variables**: A variable that holds a string always holds a string
- **Value-based**: All copies are deep, all comparisons by value
- **No null/undefined**: Empty values are valid (`""`, `[]`, `[:]`), but "no value" cannot exist
- **No truthiness**: Conditions require actual booleans, not "truthy" values

The type keywords (`string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`, `ordered`, `vector`, `any`, `type`) are reserved in the `|...|` closure position for anonymous typed parsing. See [Closures](topic-closures.md) for full documentation of anonymous typed closures.

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
"" -> .empty -> (!$) ? "has content" ! "empty"         # Negate boolean result
[1,2,3] -> .empty -> (!$) ? "has items" ! "none"   # Check non-empty
```

---

## Lists

Ordered sequences of values. The bare `[...]` form and the keyword `list[...]` form are equivalent — `list[...]` is canonical (used in output and the LLM reference).

```rill
[1, 2, 3]         # bare form
list[1, 2, 3]     # keyword form (canonical)
```

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
[...$a, 3]             # list[1, 2, 3]
[...$a, ...$a]         # list[1, 2, 1, 2] (concatenation)
[...[], 1]         # list[1] (empty spread contributes nothing)
```

Spread expressions evaluate before inlining:

```rill
[1, 2, 3] => $nums
[...($nums -> map {$ * 2})]  # list[2, 4, 6]
```

Spreading a non-list throws an error:

```text
"hello" => $str
[...$str]              # Error: Spread in list literal requires list, got string
```

**Access methods:**
- `[0]`, `[1]` — Index access (0-based)
- `[-1]`, `[-2]` — Negative index (from end)
- `.head` — First element (errors on empty)
- `.tail` — Last element (errors on empty)
- `.at(n)` — Element at index

**Out-of-bounds access** throws an error:

```text
[] -> .at(0)           # Error: List index out of bounds
["a"] -> .at(5)        # Error: List index out of bounds
```

Use `??` for safe access with default:

```rill
["a"] => $list
$list[0] ?? "default"  # "a"
```

See [Collections](topic-collections.md) for iteration operators.

---

## Dicts

Key-value mappings with identifier, number, boolean, variable, or computed keys. The bare `[k: v]` form and the keyword `dict[...]` form are equivalent — `dict[...]` is canonical.

```rill
[name: "alice", age: 30]         # bare form
dict[name: "alice", age: 30]     # keyword form (canonical)
[:]                               # empty dict (bare)
dict[]                            # empty dict (canonical)
```

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
[$key: "active"]       # dict[status: "active"]

# Computed keys (key from expression, must be string)
"user" => $prefix
[($prefix -> "{$}_name"): "alice"]  # dict[user_name: "alice"]

# Multi-key syntax (same value for multiple keys)
[["a", "b"]: 1]    # dict[a: 1, b: 1]
[[1, "1"]: "x"]    # dict[1: "x", "1": "x"] (mixed types)
[a: 0, ["b", "c"]: 1]  # dict[a: 0, b: 1, c: 1] (mixed entries)
[a: 0, ["a", "b"]: 1]  # dict[a: 1, b: 1] (last-write-wins)

# Multi-key dispatch
[["GET", "HEAD"]: "safe", list["POST", "PUT"]: "unsafe"] => $methods
"GET" -> $methods          # "safe"
"POST" -> $methods         # "unsafe"
```

Multi-key errors:

```text
[[]: 1]            # Error: Multi-key dict entry requires non-empty list
[[list[1, 2], "a"]: 1]  # Error: Dict key must be string, number, or boolean, got list
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
[a: 1, b: 2] -> .entries                # [list["a", 1], list["b", 2]]
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

## Ordered

`ordered` is a first-class container produced by the `ordered[...]` literal syntax. It preserves key insertion order.

```rill
ordered[a: 1, b: "hello"] => $o
$o.^type.name
# Result: "ordered"
```

Use `ordered` for named argument unpacking:

```rill
|a, b| { "{$a}-{$b}" } => $fmt
ordered[a: 1, b: "hello"] -> $fmt(...)
# Result: "1-hello"
```

Key order in `ordered` is the insertion order. This differs from `dict`, which is unordered.

`ordered` converts to a plain object via `toNative()` — the `NativeResult.value` field holds `{ key: value, ... }`.

---

## Tuples

Tuples are positional containers created with `tuple[...]` syntax.

### Using Ordered for Named Unpacking

For named unpacking, use `ordered[...]`:

```rill
|a, b, c| { "{$a}-{$b}-{$c}" } => $fmt
dict[c: 3, a: 1, b: 2] -> $fmt(...)   # "1-2-3" (named, via dict; key order irrelevant)
```

### Strict Validation

When invoking with ordered containers, missing required parameters error, and extra keys error:

```rill
|x, y|($x + $y) => $fn
ordered[x: 1, y: 2] -> $fn(...)        # 3
```

### Parameter Defaults with Ordered

```rill
|x, y = 10, z = 20|($x + $y + $z) => $fn
ordered[x: 5] -> $fn(...)              # 35 (5 + 10 + 20)
```

### Parallel Spread with Tuples

Use tuples with explicit spread `...` to pass positional args in `map`:

```rill
|x, y|($x * $y) => $mul
[tuple[1, 2], tuple[3, 4]] -> map { $mul(...) }    # list[2, 12]
```

---

## Vectors

Vectors represent dense numeric embeddings from language models or other ML systems. Host applications provide vectors through embedding APIs.

**Display format:** `vector(model, Nd)` where `model` is the source model name and `N` is the dimension count.

```rill
app::embed("hello world") => $vec
$vec -> .model
# Result: "mock-embed"
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

## Structural Type Values

`^type` returns a structural type value — a first-class value describing the full structure of a collection, not just a coarse type name.

### `^type` Returns Structural Types

```rill
[1, 2, 3] => $list
$list.^type == list(number)
# Result: true
```

```rill
[a: 1, b: "hello"] => $d
$d.^type.name
# Result: "dict"
```

```rill
42 => $n
$n.^type == number
# Result: true
```

### Type Constructors

Type constructors produce structural type values. They are primary expressions — valid anywhere an expression is valid.

```rill
list(number) => $lt
$lt.^type.name
# Result: "type"
```

| Constructor | Example | Produced Type |
|-------------|---------|---------------|
| `list(T)` | `list(number)` | List-of-number type |
| `dict(k: T, ...)` | `dict(a: number, b: string)` | Dict type (fields alpha-sorted in output) |
| `tuple(T, T2, ...)` | `tuple(number, string)` | Positional tuple type |
| `ordered(k: T, ...)` | `ordered(a: number, b: string)` | Named ordered type |
| `\|p: T\| :R` | `\|x: number\| :string` | Closure signature type |

### Comparing Structural Types

```rill
[1, 2, 3] => $list
$list.^type == list(number)
# Result: true
```

```rill
[a: 1, b: "hello"] => $d
$d.^type == dict(a: number, b: string)
# Result: true
```

### `.^type.name` for Coarse Type Name

`.^type.name` returns the coarse type name as a string:

```rill
[1, 2, 3] => $list
$list.^type.name
# Result: "list"
```

```rill
[a: 1] => $d
$d.^type.name
# Result: "dict"
```

### Metatype Fixed Point

The `^type` of a type value is always `type`. `type.^type` is `type`:

```rill
list(number) => $lt
$lt.^type == type
# Result: true
```

```rill
type => $t
$t.^type == type
# Result: true
```

### `formatStructuralType` Output Format

The string representation of structural types follows this format:

| Value | `^type` string |
|-------|---------------|
| Any value | `"any"` |
| Primitive | `"string"`, `"number"`, `"bool"` |
| List | `"list(number)"`, `"list(any)"`, `"list(list(number))"` |
| Dict | `"dict(a: number, b: string)"` (fields alphabetically sorted) |
| Tuple | `"tuple(number, string, bool)"` (positional) |
| Ordered | `"ordered(a: number, b: string)"` (named, order-sensitive) |
| Closure | `"\|x: number\| :string"` (pipe-delimited params with colon-return) |

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

```rill
# Parameterized type assertions
[1, 2, 3] -> :list(number)                          # passes, returns list[1, 2, 3]
[a: 1, b: "hello"] -> :dict(a: number, b: string)  # passes
```

```text
["a", "b"] -> :list(number)            # ERROR: expected list(number), got list(string)
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

```rill
[1, 2, 3]:?list(number)               # true
["a", "b"]:?list(number)              # false
```

Type checks work in conditionals:

```text
$val -> :?list ? process() ! skip()   # branch on type
```

**Supported types:** `string`, `number`, `bool`, `closure`, `list`, `dict`, `ordered`, `tuple`, `vector`, `any`, `type`

Parameterized forms accept a type argument list: `list(string)`, `dict(a: number, b: string)`, `tuple(number, string)`. The runtime deep-validates element types on match.

The `vector` type matches host-provided typed arrays. The `any` type name accepts any value type — useful for generic closures. The `ordered` type matches containers produced by `*dict` spread.

Both types are valid in closure parameter positions, capture type assertions, and type assertions:

```rill
# Closure parameter with vector type annotation
|x: vector| { $x } => $fn
app::embed("hello") => $v
$fn($v) -> .model
# Result: "mock-embed"
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
true
```

```rill
# Capture type assertion with vector type
app::embed("hello") => $x:vector
$x -> .model
# Result: "mock-embed"
```

```rill
# Capture type assertion with parameterized type
[1, 2] => $x:list(number)
$x[0]
# Result: 1
```

### In Pipe Chains

```rill
# Assert typed list and continue processing
[1, 2, 3] -> :list(number) -> each { $ * 2 }

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

## Union Types

A union type matches any one of two or more listed types. Use `T1|T2` syntax wherever a type annotation is accepted.

### Overview

Union types appear in type assertions, type checks, capture annotations, and destructure patterns. The `|` separator joins members into a union. At runtime, a union matches if the value satisfies any member.

```rill
# Union assertion: number satisfies string|number
42 -> :string|number
# Result: 42
```

### Type Assertion

Assert that a value matches at least one union member. Execution halts if no member matches:

```rill
42 -> :string|number
# Result: 42
```

```text
# Error: Type assertion failed: expected string|number, got bool
true -> :string|number
```

### Type Check

Check whether a value matches a union without halting on failure:

```rill
42:?string|number
# Result: true
```

```rill
"hello":?string|number
# Result: true
```

```rill
true:?string|number
# Result: false
```

### Capture Annotation

Annotate a capture variable with a union type. The runtime validates the assigned value against all union members:

```rill
"hello" => $x:string|number
$x
# Result: "hello"
```

```text
# Error: Type mismatch: cannot assign bool to $x:string|number
true => $x:string|number
```

### Parameterized Unions

Union members can be parameterized types. Structural validation applies to each member:

```rill
["a", "b"] -> :list(string)|dict
# Result: list["a", "b"]
```

### Three-or-More Members

Chain additional members with `|`. The runtime checks each member left to right:

```rill
"hello" -> :string|number|bool
# Result: "hello"
```

### Error Behavior

A type assertion fails when the value does not satisfy any member. The error message names the full union:

```text
# Error: Type assertion failed: expected string|number, got bool
true -> :string|number
```

See [Operators](topic-operators.md) for union types in destructure and existence positions.

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

rill has a runtime type named `type`. A type value represents a rill type — including full structural information for collection types.

### `.^type` Operator

`.^type` returns the structural type value for any rill value:

```rill
42 => $n
$n.^type == number
# Result: true

"hello" => $s
$s.^type == string
# Result: true

[1, 2] => $l
$l.^type == list(number)
# Result: true

[a: 1] => $d
$d.^type == dict(a: number)
# Result: true
```

```rill
ordered[a: 1, b: 2] => $o
$o.^type.name
# Result: "ordered"

||{ $ } => $fn
$fn.^type == closure
# Result: true
```

```rill
app::embed("hello world") => $vec
$vec.^type == vector
# Result: true
```

### Type Name Expressions

All type names are valid expressions that produce type values:

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
```

### `.^type.name` Property

Access the coarse type name via `.^type.name` on any value:

```rill
42 => $n
$n.^type.name
# Result: "number"
```

```rill
"hello" => $s
$s.^type.name
# Result: "string"
```

```rill
[1, 2] => $l
$l.^type.name
# Result: "list"
```

### Dot-Notation Properties on Type Values

Type values expose two properties via dot notation:

| Property | Return Type | Description |
|----------|-------------|-------------|
| `.name` | `string` | Coarse type name (`"number"`, `"list"`, `"dict"`, etc.) |
| `.signature` | `string` | Full structural type string |

```rill
number => $t
$t.name
# Result: "number"
```

```rill
dict => $t
$t.name
# Result: "dict"
```

`.signature` returns the full structural representation via `formatStructuralType`:

```rill
list(number) => $t
$t.signature
# Result: "list(number)"
```

```rill
|y: string|($y):string => $fn
$fn.^type.signature
# Result: "|y: string| :string"
```

Combining `.^type` with `.name` and `.signature` gives both coarse and structural information:

```rill
42.^type.name
# Result: "number"
```

```rill
42.^type.signature
# Result: "number"
```

Unknown dot properties on type values raise RILL-R009:

```text
number.unknownProp
# Error: RILL-R009: Unknown property 'unknownProp' on type value
```

`.^name` on a type value raises RILL-R008 ("Annotation access not supported on type values"). Use `.name` (dot notation) instead:

```text
number.^name
# Error: RILL-R008: Annotation access not supported on type values
```

### Type Value Equality

Type values compare with `==` and `!=`. Structural types compare structurally:

```rill
42 => $n
$n.^type == number
# Result: true
```

```rill
42 => $n
$n.^type == string
# Result: false
```

```rill
"hello" => $a
"world" => $b
$a.^type == $b.^type
# Result: true
```

```rill
[1, 2] => $l
$l.^type == list(number)
# Result: true
```

```rill
["a", "b"] => $strs
$strs.^type == list(number)
# Result: false
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
