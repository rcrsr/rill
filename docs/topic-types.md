# rill Types

*Primitives, collections, and value types*

## Overview

rill is dynamically typed and type-safe. Types are checked at runtime, but type errors are always caught. There are no implicit conversions or coercions.

| Type | Syntax | Example |
|------|--------|---------|
| String | `"text"` | `"hello"` |
| Number | `123`, `0.5` | `42`, `0.9` |
| Bool | `true`, `false` | `true` |
| List | `[a, b]` or `list[a, b]` | `list["file.ts", 42]` |
| Dict | `[k: v]` or `dict[k: v]` | `dict[output: "text", code: 0]` |
| Ordered | `ordered[k: v]` | `ordered[a: 1, b: "hello"]` |
| Tuple | `tuple[...]` (positional) | `tuple[1, 2]` |
| Datetime | `datetime(...)` or `now()` | `datetime("2024-01-15T10:30:00Z")` |
| Duration | `duration(...)` | `duration(...dict[days: 1, hours: 2])` |
| Vector | host-provided | `vector(voyage-3, 1024d)` |
| Closure | `\|\|{ }` | `\|x\|($x * 2)` |
| Type | type name or constructor | `number`, `list(number)`, `dict(a: number)` |

**Key principles:**
- **Type-safe**: No implicit coercion; `"5" + 1` errors, not `"51"` or `6`
- **Type-locked variables**: A variable that holds a string always holds a string
- **Value-based**: All values are immutable, all comparisons by value
- **No null/undefined**: Empty values are valid (`""`, `[]`, `[:]`), but "no value" cannot exist
- **No truthiness**: Conditions require actual booleans, not "truthy" values

The type keywords (`string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`, `ordered`, `vector`, `datetime`, `duration`, `any`, `type`) are reserved in the `|...|` closure position for anonymous typed parsing. See [Closures](topic-closures.md) for full documentation of anonymous typed closures.

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

## Booleans

Literal `true` and `false`. Conditional expressions (`?`), loop conditions (`@`), and filter predicates require boolean values. Non-boolean values cause runtime errors.

```rill
true ? "yes" ! "no"        # "yes"
false ? "yes" ! "no"       # "no"
```

**No truthiness:** rill has no automatic boolean coercion. Empty strings, zero, and empty lists are not "falsy"; you must explicitly check:

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

## Lists

Ordered sequences of values. The bare `[...]` form and the keyword `list[...]` form are equivalent; `list[...]` is canonical (used in output and the LLM reference).

When list elements share a compound type but differ in sub-structure, rill infers the bare compound type. See [Type Inference Cascade](topic-type-system.md#type-inference-cascade).

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
- `[0]`, `[1]`: Index access (0-based)
- `[-1]`, `[-2]`: Negative index (from end)
- `.head`: First element (errors on empty)
- `.tail`: Last element (errors on empty)
- `.at(n)`: Element at index

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

## Dicts

Key-value mappings with identifier, number, boolean, variable, or computed keys. The bare `[k: v]` form and the keyword `dict[...]` form are equivalent; `dict[...]` is canonical.

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
- `.field`: Literal field access (identifier keys only)
- `.$key`: Variable as key
- `.($i + 1)`: Computed expression as key
- `.(a || b)`: Alternatives (try keys left-to-right)
- `.field ?? default`: Default value if missing
- `.?field`: Existence check, literal key (returns bool)
- `.?$key`: Existence check, variable key
- `.?($expr)`: Existence check, computed key
- `.?field&type`: Existence + type check (all forms support `&type`)

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

### Uniform Value Type

`dict(T)` asserts that every value in the dict matches type T. The dict itself is returned unchanged.

```rill
[a: 1, b: 2] -> :>dict(number)
# Result: dict[a: 1, b: 2]
```

An empty dict passes; there are no values to violate the constraint.

```rill
dict[] -> :>dict(number)
# Result: dict[]
```

### Field Annotations

Dict type constructors support `^()` inline field annotations. Annotations attach metadata to individual fields and appear on the type structure when you call `.^type`. See [Closure Annotations](topic-closure-annotations.md) for the full `^()` syntax and TypeScript access patterns.

```text
dict(^("A person's name") name: string, ^("Age in years") age: number)
```

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

`ordered` converts to a plain object via `toNative()`. The `NativeResult.value` field holds `{ key: value, ... }`.

### Uniform Value Type

`ordered(T)` asserts that every entry value in the ordered container matches type T. The container is returned unchanged.

```rill
ordered[x: 1, y: 2] -> :>ordered(number)
# Result: ordered[x: 1, y: 2]
```

An empty ordered container passes; there are no values to violate the constraint.

### Field Annotations

`ordered` type constructors support `^()` inline field annotations. Annotations attach at each index in the type structure. See [Closure Annotations](topic-closure-annotations.md) for syntax and TypeScript access patterns.

```text
ordered(^("X coordinate") x: number, ^("Y coordinate") y: number)
```

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

### Trailing Defaults with Tuples

Tuple type constructors accept default values on trailing positional fields. When you assert or check against a tuple type, values shorter than the full field count match if every omitted trailing field has a default.

Assign the type constructor to a variable, then use the variable in `:?` or `:` position:

```rill
tuple(string, number = 0) => $t
tuple["x"] -> :?$t
# Result: true
```

The value `tuple["x"]` has 1 element. The type has 2 fields, but the second field defaults to `0`. The check passes because the omitted trailing field has a default.

```rill
tuple(string, number = 0) => $t
tuple["x"] -> :$t
# Result: tuple["x"]
```

The `:` assertion also accepts the shorter value. No field synthesis occurs; the returned value is unchanged. Use `:>` to fill missing fields with their defaults.

Defaults must appear at trailing positions only. A required field after a defaulted field is a type constructor error.

This matches the trailing-default behavior of `dict` and `ordered` type constructors.

#### Nested Default Synthesis

When a collection-typed field has no value and no explicit default, `:>` synthesizes it if all its children have defaults. The runtime seeds an empty collection and fills each child from the nested type.

```rill
dict[a: 1] -> :>dict(a: number, b: dict(c: number = 5))
# Result: dict[a: 1, b: dict[c: 5]]
```

When a field has an explicit collection default, `:>` hydrates that default through the nested type. Child defaults fill any fields the explicit default omits.

If any required child field lacks a default, the conversion raises RILL-R044.

### Parallel Spread with Tuples

Use tuples with explicit spread `...` to pass positional args in `map`:

```rill
|x, y|($x * $y) => $mul
[tuple[1, 2], tuple[3, 4]] -> map { $mul(...) }    # list[2, 12]
```

### Uniform Value Type

`tuple(T)` asserts that every entry in the tuple matches type T. The tuple is returned unchanged.

```rill
tuple[1, 2, 3] -> :>tuple(number)
# Result: tuple[1, 2, 3]
```

An empty tuple passes; there are no values to violate the constraint.

**Breaking change:** The single-positional-argument form `tuple(T)` now defines a uniform value type, not a 1-element structural tuple. Use `tuple(T1, T2)` (two or more positional args) for structural tuples with specific element types.

### Field Annotations

Tuple type constructors support `^()` inline annotations on positional elements. Annotations attach at each index in the type structure. See [Closure Annotations](topic-closure-annotations.md) for syntax and TypeScript access patterns.

```text
tuple(^("X coordinate") number, ^("Y coordinate") number)
```

## Vectors

Vectors represent dense numeric embeddings from language models or other ML systems. Host applications provide vectors through embedding APIs.

**Display format:** `vector(model, Nd)` where `model` is the source model name and `N` is the dimension count.

```text
app::embed("hello world") => $vec
$vec -> .model
# Result: "mock-embed"
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `.dimensions` | number | Number of dimensions in the vector |
| `.model` | string | Source model name |

```text
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

```text
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

```text
app::embed("test") => $v1
app::embed("test") => $v2
$v1 == $v2
# Result: true
```

Vectors from different models are never equal, even with identical data:

```text
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

## Datetime

A datetime represents an instant in time stored as UTC milliseconds since the Unix epoch. It is an opaque scalar type; values are immutable and compared by their Unix timestamp.

### Construction

Three forms construct a datetime value:

| Form | Example | Notes |
|------|---------|-------|
| ISO 8601 string | `datetime("2024-01-15T10:30:00Z")` | Accepts date-only and datetime with offset |
| Named components | `datetime(...dict[year: 2024, month: 1, day: 15])` | UTC; `hour`, `minute`, `second`, `ms` default to 0 |
| Unix milliseconds | `datetime(...dict[unix: 1705312200000])` | UTC ms since epoch |

```text
datetime("2024-01-15T10:30:00Z") -> .iso()
# Result: "2024-01-15T10:30:00Z"

datetime(...dict[year: 2024, month: 1, day: 15]) -> .iso()
# Result: "2024-01-15T00:00:00Z"

datetime(...dict[unix: 0]) -> .iso()
# Result: "1970-01-01T00:00:00Z"
```

### `now()`

`now()` returns the current UTC instant as a datetime.

```rill
now() -> .iso()
```

The test harness does not fix the clock, so `# Result:` is omitted. Pass `nowMs` in `RuntimeContext` to pin the instant in deterministic scripts.

### Properties

UTC component properties decompose the stored timestamp:

| Property | Type | Description |
|----------|------|-------------|
| `.year` | number | UTC year (e.g. 2024) |
| `.month` | number | UTC month, 1–12 |
| `.day` | number | UTC day, 1–31 |
| `.hour` | number | UTC hour, 0–23 |
| `.minute` | number | UTC minute, 0–59 |
| `.second` | number | UTC second, 0–59 |
| `.ms` | number | UTC millisecond, 0–999 |
| `.unix` | number | Raw UTC ms since epoch |
| `.weekday` | number | ISO weekday: 1 (Monday) – 7 (Sunday) |

```rill
now() => $t
$t -> .year
$t -> .month
$t -> .weekday
```

### String Output Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.iso(offset?)` | string | Full ISO 8601 with timezone indicator (default UTC) |
| `.date(offset?)` | string | `YYYY-MM-DD` portion |
| `.time(offset?)` | string | `HH:MM:SS` portion |

`offset` is hours east of UTC. Pass `2` for `+02:00`, `-5` for `-05:00`, `5.5` for `+05:30`.

```rill
now() => $t
$t -> .iso(0)
$t -> .iso(2)
$t -> .date(0)
$t -> .time(0)
```

### Local Properties

These properties apply the `timezone` offset from `RuntimeContext` automatically:

| Property | Type | Description |
|----------|------|-------------|
| `.local_iso` | string | ISO 8601 at host timezone |
| `.local_date` | string | `YYYY-MM-DD` at host timezone |
| `.local_time` | string | `HH:MM:SS` at host timezone |
| `.local_offset` | number | Host timezone offset in hours |

```rill
now() => $t
$t -> .local_iso
$t -> .local_offset
```

### Arithmetic

| Method | Argument | Returns | Description |
|--------|----------|---------|-------------|
| `.add(dur)` | duration | datetime | Adds duration to datetime; months applied first, then ms |
| `.diff(other)` | datetime | duration | Absolute difference as a fixed-ms duration |

```rill
now() => $t1
$t1 -> .diff($t1) => $gap
$gap -> .display
# Result: "0ms"
```

```text
# Add one month (calendar duration)
now() -> .add(duration(...dict[months: 1])) -> .iso()
```

```rill
datetime("2024-03-01T00:00:00Z") -> .diff(datetime("2024-01-01T00:00:00Z")) -> .display
# Result: "60d"
```

### Comparison

Datetimes support equality (`==`, `!=`) and ordering (`<`, `>`, `<=`, `>=`). Comparison uses the Unix timestamp directly.

```rill
now() == now()
# Result: true

now() <= now()
# Result: true
```

### JSON

`json()` serializes a datetime as an ISO 8601 string with milliseconds. `deserializeValue` accepts an ISO 8601 string to reconstruct the datetime.

```text
json(datetime("2024-01-15T10:30:00Z"))
# Result: "\"2024-01-15T10:30:00.000Z\""
```

### String Interpolation

Interpolating a datetime produces its UTC ISO 8601 string (same as `.iso()`).

```rill
now() => $t
"Event at {$t}"
```

### Empty Value

`.empty` returns `datetime(unix: 0)`, the Unix epoch.

```rill
now() -> .empty -> .iso()
# Result: "1970-01-01T00:00:00Z"

now() -> .empty -> .unix
# Result: 0
```

### Behavioral Notes

- **Immutable**: Datetime values cannot be modified after creation
- **Scalar**: A single UTC timestamp; no timezone or locale stored on the value
- **String coercion permitted**: Datetimes can appear in string interpolation; they format as ISO UTC
- **No collection operations**: Cannot use `each`, `map`, `filter`, `fold` on datetimes

### Extension Boundary

The core datetime type stores UTC timestamps and formats with numeric offsets only. IANA timezone names (e.g. `"America/New_York"`) require the `datetime-extension` package, which is not part of core rill. rill uses POSIX time (Unix milliseconds); POSIX time does not model leap seconds.

---

## Duration

A duration represents a span of time. It stores two fields independently: `months` for calendar units and `ms` for fixed units. These fields never mix in arithmetic.

### Construction

Two families of units construct duration values:

| Form | Example | Notes |
|------|---------|-------|
| Fixed units | `duration(...dict[days: 1, hours: 2])` | Collapses to ms; exact arithmetic |
| Calendar units | `duration(...dict[months: 3, years: 1])` | Collapses years to months; variable-length |
| Raw milliseconds | `duration(...dict[ms: 86400000])` | Direct ms count |

```text
duration(...dict[days: 1, hours: 2]) -> .display
# Result: "1d2h"

duration(...dict[months: 3]) -> .months
# Result: 3

duration(...dict[years: 1]) -> .months
# Result: 12

duration(...dict[ms: 5000]) -> .display
# Result: "5s"
```

### Properties

Fixed-unit durations decompose their `ms` field using remainder arithmetic:

| Property | Type | Description |
|----------|------|-------------|
| `.days` | number | `floor(ms / 86400000)` |
| `.hours` | number | Remainder hours after days |
| `.minutes` | number | Remainder minutes after hours |
| `.seconds` | number | Remainder seconds after minutes |
| `.ms` | number | Remainder milliseconds after seconds |
| `.months` | number | Calendar months count |
| `.total_ms` | number | Raw ms field; halts on calendar durations |

```text
duration(...dict[hours: 25]) -> .days
# Result: 1

duration(...dict[hours: 25]) -> .hours
# Result: 1

duration(...dict[hours: 25]) -> .total_ms
# Result: 90000000
```

Requesting `.total_ms` on a calendar duration halts execution:

```text
# Error: total_ms is not defined for calendar durations
duration(...dict[months: 1]) -> .total_ms
```

### Display

`.display` formats a duration as a compact string, omitting zero components. Zero duration displays as `"0ms"`.

```text
duration(...dict[days: 1, hours: 2, minutes: 30]) -> .display
# Result: "1d2h30m"

duration(...dict[years: 1, months: 3]) -> .display
# Result: "1y3mo"
```

```rill
now() => $t
$t -> .diff($t) -> .empty -> .display
# Result: "0ms"
```

### Arithmetic

| Method | Argument | Returns | Description |
|--------|----------|---------|-------------|
| `.add(other)` | duration | duration | Sums `months` and `ms` fields independently |
| `.subtract(other)` | duration | duration | Subtracts fields; halts if result would be negative |
| `.multiply(n)` | number | duration | Multiplies both fields by `n`; halts if `n` is negative |

```text
duration(...dict[hours: 1]) -> .add(duration(...dict[hours: 1])) -> .display
# Result: "2h"

duration(...dict[hours: 2]) -> .subtract(duration(...dict[hours: 1])) -> .display
# Result: "1h"

duration(...dict[hours: 1]) -> .multiply(3) -> .display
# Result: "3h"
```

### Comparison

Equality compares both `months` and `ms` fields. Two durations are equal only when both fields match.

```text
duration(...dict[hours: 48]) == duration(...dict[days: 2])
# Result: true

duration(...dict[months: 1]) == duration(...dict[months: 1])
# Result: true
```

Ordering compares the `ms` field only, and only when both durations have equal `months` fields. Comparing durations with different `months` halts:

```text
duration(...dict[hours: 1]) < duration(...dict[hours: 2])
# Result: true

# Error: Cannot order durations with different calendar components
duration(...dict[months: 1]) < duration(...dict[hours: 24])
```

### JSON

Fixed durations serialize as a number (raw ms). Calendar durations serialize as `{"months": N, "ms": M}`.

```text
json(duration(...dict[hours: 1]))
# Result: "3600000"

json(duration(...dict[months: 1]))
# Result: "{\"months\":1,\"ms\":0}"
```

### String Interpolation

Interpolating a duration produces its `.display` string.

```text
"Gap: {duration(...dict[days: 3])}"
# Result: "Gap: 3d"
```

```rill
now() => $t
$t -> .diff($t) => $gap
"Gap: {$gap}"
# Result: "Gap: 0ms"
```

### Empty Value

`.empty` returns `duration(ms: 0)`.

```rill
now() => $t
$t -> .diff($t) -> .empty -> .display
# Result: "0ms"
```

### Behavioral Notes

- **Immutable**: Duration values cannot be modified after creation
- **Scalar**: Stored as two independent fields; no normalization between fields
- **No negatives**: Duration values are always non-negative; subtraction halts on negative results
- **String coercion permitted**: Durations can appear in string interpolation; they format via `.display`

### Extension Boundary

Core duration arithmetic is fixed-field only. Fractional months, business-day arithmetic, and calendar-aware duration normalization require the `datetime-extension` package.

## Streams

A stream is a collection type that produces values over time. Unlike lists, streams emit chunks one at a time and carry a separate resolution value returned when the stream closes.

The type signature `stream(T):R` names both parts: `T` is the chunk type, and `R` is the resolution type.

```text
stream(string):number   # chunks are strings, resolution is a number
stream(number)          # chunks are numbers, resolution is unconstrained
stream()                # unconstrained chunk and resolution types
```

### Chunk Type

The chunk type `T` in `stream(T):R` constrains each emitted value. Inside a stream closure, `yield` emits the current pipe value as a chunk.

```text
|x| {
  $x -> .upper -> yield
  $x -> .lower -> yield
} :stream(string)
```

`yield` appears as the terminator in a pipe chain. Use `$x -> yield` to emit a specific value, or bare `yield` to emit the current pipe value (`$`).

The `yield` keyword is only valid inside a closure annotated with `:stream(T):R`. Using `yield` without that annotation is a parse error.

### Resolution Type

The resolution type `R` in `stream(T):R` constrains the value the stream returns when it closes. Call the stream variable as a function (`$s()`) to get the resolution value.

```text
make_stream() => $s
$s()   # returns the resolution value
```

The resolution is produced by the stream's final expression or an explicit `return` statement in the stream closure body. Host-provided streams supply the resolution from the underlying async producer.

A zero-chunk stream resolves immediately. Calling `$s()` returns the resolution value without consuming any chunks.

### Single-Use Constraint

A stream can be iterated only once. Passing a stream to a collection operator (`each`, `map`, `filter`, `fold`) consumes all its chunks. After that, the stream is done and produces no further chunks.

```text
make_stream() => $s
$s -> each { $ }   # consumes the stream
$s -> map { $ }    # Error: stream already consumed
```

Calling `$s()` after consuming the stream still returns the resolution value. The resolution is cached after the stream closes. `$s()` also works on any `.next()` step, including stale steps that can no longer advance. Only `.next()` fails on stale steps.

### Stream as Collection

All four collection operators work on streams. They consume chunks as the stream emits them and collect results when the stream closes.

```text
make_stream() => $s
$s -> map { $ * 2 }           # transforms each chunk, returns list
$s -> filter { $ > 0 }        # keeps matching chunks, returns list
$s -> fold(0) { $@ + $ }      # reduces all chunks to a single value
```

See [Collections](topic-collections.md) for full operator documentation including stream behavior.

For stream closure syntax and the `:stream(T):R` annotation on closures, see [Closures](topic-closures.md).

## Atom (`:code`)

`:code` is the 16th primitive type. It carries a named error identity via `#NAME` literals. See [Error Handling: Error Atoms](topic-error-handling.md#error-atoms-code) for full syntax, conversions, pre-registered atoms, and extension registration.

---

## See Also

| Document | Description |
|----------|-------------|
| [Type System](topic-type-system.md) | Structural types, type assertions, unions, type-locked variables |
| [Variables](topic-variables.md) | Declaration, scope, `$` binding |
| [Closures](topic-closures.md) | Closure semantics and patterns |
| [Collections](topic-collections.md) | List iteration operators |
| [Strings](topic-strings.md) | String methods reference |
| [Reference](ref-language.md) | Quick reference tables |

