# rill Type System

*Structural types, type assertions, union types, and type-locked variables*

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
| `dict(T)` | `dict(number)` | Uniform dict type (all values same type) |
| `ordered(T)` | `ordered(string)` | Uniform ordered type (all values same type) |
| `tuple(T)` | `tuple(number)` | Uniform tuple type (all entries same type) |
| `dict(k: T, ...)` | `dict(a: number, b: string)` | Dict type (fields alpha-sorted in output) |
| `tuple(T, T2, ...)` | `tuple(number, string)` | Positional tuple type |
| `ordered(k: T, ...)` | `ordered(a: number, b: string)` | Named ordered type |
| `\|p: T\| :R` | `\|x: number\| :string` | Closure signature type |

### Default Values in Type Constructors

Type constructor fields accept a default value using `= literal` syntax after the field type. When you convert a value with `:>`, the runtime fills in any missing fields using those defaults.

```rill
[b: "b"] -> :>dict(b: string, a: string = "a")
# Result: [a: "a", b: "b"]
```

The input `[b: "b"]` omits `a`. The conversion fills `a` with `"a"` from the default.

```rill
[x: 1] -> :>ordered(x: number, y: number = 0)
# Result: ordered[x: 1, y: 0]
```

```rill
tuple["x"] -> :>tuple(string, number = 0)
# Result: tuple["x", 0]
```

Tuple defaults are restricted to trailing positions. You cannot place a defaulted field before a required field in a tuple constructor.

The `:` assertion operator does not hydrate defaults. Only `:>` conversion fills missing fields. Use `:` when you want strict validation with no field synthesis.

When a required field has no default and the input omits it, the runtime raises [RILL-R044](ref-errors.md). See [Operators](topic-operators.md) for the full `:>` compatibility matrix.

#### Nested Collection Synthesis

When a field is missing with no explicit default, the runtime synthesizes the field if its type is a collection where all children have defaults. The runtime seeds an empty collection and hydrates it.

```rill
dict[a: 1] -> :>dict(a: number, b: dict(c: number = 5))
# Result: dict[a: 1, b: dict[c: 5]]
```

The field `b` has no value in the input and no explicit default on the field itself. The runtime synthesizes `b` as an empty dict and fills `c` from the nested type's default.

If any child of the nested collection lacks a default, the conversion raises [RILL-R044](ref-errors.md).

#### Explicit Default Hydration

When a field has an explicit default that is itself a collection, the runtime hydrates that default through the nested type. Child defaults fill any fields the explicit default omits.

```rill
dict[] -> :>dict(a: dict(x: number = 1, y: number = 2) = [x: 10])
# Result: dict[a: dict[x: 10, y: 2]]
```

The explicit default `[x: 10]` omits `y`. The runtime fills `y` with `2` from the nested type constructor.

#### Defaults in Closure Parameter Annotations

Type constructor defaults also work in closure parameter type annotations. When the caller passes an incomplete value, the runtime fills in missing fields from the annotation defaults.

```rill
|a: dict(b: number = 5)| { $a.b } => $fn
$fn(dict[])
# Result: 5
```

The closure expects a dict with field `b` defaulting to `5`. Calling with an empty dict causes the runtime to fill `b` from the annotation default.

```rill
|a: tuple(number = 0, string = "")| { $a } => $fn
$fn(tuple[])
# Result: tuple[0, ""]
```

A tuple annotation with trailing defaults fills all missing positions when the caller passes an empty tuple.

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

### Type Inference Cascade

When rill infers the element type of a list literal, it uses a three-level cascade:

1. **Structural match** — all elements share the same full structural type. The list retains that type.
2. **Uniform merge** — elements share the same compound kind and all their sub-values share a common type. The list retains the uniform form (e.g., `list(dict(number))`).
3. **Bare type fallback** — elements share the same compound kind (e.g., all lists, all closures) but differ in sub-structure. The list uses the bare compound type, stripping the sub-structure.

```rill
list[dict[a: 1], dict[b: 2]].^type.signature
# Result: "list(dict(number))"
```

Both dicts have number values, so the uniform merge succeeds and produces `dict(number)` as the element type.

```rill
[list[1,2], list["a","b"]].^type.signature
# Result: "list(list)"
```

The inner lists are `list(number)` and `list(string)`. They share the `list` kind but differ in element type, so the cascade falls back to bare `list`, producing `list(list)`.

```rill
[|x|($x), |a, b|($a)].^type.signature
# Result: "list(closure)"
```

The closures have different arities, so the cascade falls back to bare `closure`.

**Any-narrowing** applies when one element is an empty collection. An empty list has type `list(any)`. Paired with a concrete element type, the cascade narrows `any` to that type:

```rill
[list[], list[1,2]].^type.signature
# Result: "list(list(number))"
```

`list[]` contributes `list(any)`. `list[1,2]` contributes `list(number)`. The `any` narrows to `number`, yielding `list(list(number))`.

The cascade is recursive. If the bare fallback at one level produces a bare type, the next level applies the same rules:

```rill
[list[list[1]], list[list["a"]]].^type.signature
# Result: "list(list(list))"
```

The outer list sees two `list(list(?))` elements where the inner element types differ, so the cascade produces `list(list(list))`.

If the top-level types are incompatible (e.g., mixing a number and a list), rill raises RILL-R002.

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

### `formatStructure` Output Format

The string representation of structural types follows this format:

| Value | `^type` string |
|-------|---------------|
| Any value | `"any"` |
| Primitive | `"string"`, `"number"`, `"bool"` |
| List | `"list(number)"`, `"list(any)"`, `"list(list(number))"` |
| Dict (uniform) | `"dict(number)"` (all values same type) |
| Ordered (uniform) | `"ordered(string)"` (all values same type) |
| Tuple (uniform) | `"tuple(closure)"` (all entries same type) |
| Dict | `"dict(a: number, b: string)"` (fields alphabetically sorted) |
| Tuple | `"tuple(number, string, bool)"` (positional) |
| Ordered | `"ordered(a: number, b: string)"` (named, order-sensitive) |
| Closure | `"\|x: number\| :string"` (pipe-delimited params with colon-return) |
| Bare list (no element type) | `"list"` |
| Bare dict (no fields) | `"dict"` |
| Bare tuple (no elements) | `"tuple"` |
| Bare ordered (no fields) | `"ordered"` |
| Bare closure (no params) | `"closure"` |

## Type Assertions

Use type assertions to validate values at runtime.

### Assert Type (`:type`)

Error if type doesn't match, returns value unchanged:

```rill
# Postfix form (binds tighter than method calls)
42:number                     # passes, returns 42
(1 + 2):number                # passes, returns 3
42:number -> :>string         # "42" - assertion then conversion

# Pipe target form
"hello" -> :string            # passes, returns "hello"
[a: 1, b: 2] => $val
$val -> :dict -> .keys        # assert dict, then get keys
```

```text
"hello" -> :number            # Error: expected number, got string
```

```rill
# Parameterized type assertions
[1, 2, 3] -> :list(number)                          # passes, returns list[1, 2, 3]
[a: 1, b: "hello"] -> :dict(a: number, b: string)  # passes
```

```text
["a", "b"] -> :list(number)            # ERROR: expected list(number), got list(string)
```

#### Trailing Defaults in Collection Type Assertions

`:` and `:?` accept values that omit trailing fields when those fields have defaults in the type constructor. This applies to `dict`, `tuple`, and `ordered`.

Assign the type constructor to a variable, then use the variable in assertion position:

```rill
# dict: value omits trailing defaulted field
dict(b: string, a: string = "a") => $dt
[b: "b"] -> :$dt
# Result: [b: "b"]
```

```rill
# dict check
dict(b: string, a: string = "a") => $dt
[b: "b"] -> :?$dt
# Result: true
```

```rill
# tuple: value shorter than type, trailing field has default
tuple(string, number = 0) => $tt
tuple["x"] -> :$tt
# Result: tuple["x"]
```

```rill
# ordered: value omits trailing defaulted field
ordered(x: number, y: number = 0) => $ot
ordered[x: 1] -> :$ot
# Result: ordered[x: 1]
```

The assertion passes and returns the original value unchanged. No field synthesis occurs. Use `:>` (convert) to fill missing fields with their defaults.

A missing field without a default causes the assertion to fail:

```text
# Error: expected dict(b: string, a: string), missing required field 'a'
dict(b: string, a: string) => $dt
[b: "b"] -> :$dt
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

```text
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

```text
# Type assertion: :vector and :any
app::embed("hello") => $v
$v -> :vector
# Result: vector(mock-embed, 3d)

$v -> :any
# Result: vector(mock-embed, 3d)
```

```text
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

### Defaults in Type Expressions

Closure parameters accept an optional `= literal` default in the annotation position:

```text
|name: type = literal| body
```

This default participates in structural type matching via `:?`. The rule is one-directional:

| Value param has default | Type param has default | `:?` result |
|------------------------|----------------------|-------------|
| Yes | No | `true` (superset satisfies) |
| No | Yes | `false` (missing contract) |
| Yes | Yes | `true` if defaults are equal |
| No | No | `true` |

A closure with defaults satisfies a type annotation without defaults, because the value provides more than the annotation requires. A closure without defaults fails an annotation that requires defaults, because it cannot fulfil the contract.

```rill
# A closure type without defaults (the annotation contract)
|x: string, y: number|{ $x } => $ref
$ref.^type => $refType

# A closure WITH defaults satisfies the annotation WITHOUT defaults
|x: string = "a", y: number = 0|{ $x } => $fn
$fn -> :?$refType
# Result: true
```

The reverse fails: a closure without defaults does not satisfy an annotation that declares defaults.

```text
# A closure type WITH defaults (requires caller-omittable params)
|x: string = "a", y: number = 0|{ $x } => $ref
$ref.^type => $refType

# A closure WITHOUT defaults fails the annotation WITH defaults
|x: string, y: number|{ $x } => $fn
$fn -> :?$refType
# Result: false
```

See [Type System: Defaults in Type Expressions](#defaults-in-type-expressions) and [Host API Types](ref-host-api-types.md) for the `structureMatches` TypeScript API.

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

## Type-Locked Variables

Variables lock type on first assignment. The type is inferred from the value or declared explicitly:

```rill
"hello" => $name              # implicit: locked as string
"world" => $name              # OK: same type
```

```text
5 => $name                    # ERROR: cannot assign number to string
```

```rill
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
```

```text
"text" => $fn                 # ERROR: cannot assign string to closure
```

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

```text
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

`.signature` returns the full structural representation via `formatStructure`:

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

## Built-in Method Signatures

The following table lists all built-in methods with their typed signatures. Methods marked "any (runtime checked)" accept any receiver but throw at runtime if the receiver type is wrong.

| Method | Receiver Types | Params | Return |
|--------|---------------|--------|--------|
| `.len` | string, list, dict | (none) | `number` |
| `.trim` | string | (none) | `string` |
| `.head` | string, list | (none) | `any` |
| `.tail` | string, list | (none) | `any` |
| `.first` | any (runtime checked) | (none) | `iterator` |
| `.at` | any (runtime checked) | `index: number` | `any` |
| `.split` | string | `separator: string = "\n"` | `list` |
| `.join` | list | `separator: string = ","` | `string` |
| `.lines` | string | (none) | `list` |
| `.empty` | string, list, dict, bool, number | (none) | `bool` |
| `.starts_with` | string | `prefix: string` | `bool` |
| `.ends_with` | string | `suffix: string` | `bool` |
| `.lower` | string | (none) | `string` |
| `.upper` | string | (none) | `string` |
| `.replace` | string | `pattern: string, replacement: string` | `string` |
| `.replace_all` | string | `pattern: string, replacement: string` | `string` |
| `.contains` | string | `search: string` | `bool` |
| `.match` | string | `pattern: string` | `dict` |
| `.is_match` | string | `pattern: string` | `bool` |
| `.index_of` | string | `search: string` | `number` |
| `.repeat` | string | `count: number` | `string` |
| `.pad_start` | string | `length: number, fill: string = " "` | `string` |
| `.pad_end` | string | `length: number, fill: string = " "` | `string` |
| `.eq` | any | `other: any` | `bool` |
| `.ne` | any | `other: any` | `bool` |
| `.lt` | number, string | `other: any` | `bool` |
| `.gt` | number, string | `other: any` | `bool` |
| `.le` | number, string | `other: any` | `bool` |
| `.ge` | number, string | `other: any` | `bool` |

`bool` supports only equality (`==`, `!=`). Ordering (`<`, `>`, `<=`, `>=`) on `bool` raises RILL-R002.
| `.keys` | dict (runtime checked) | (none) | `list` |
| `.values` | dict (runtime checked) | (none) | `list` |
| `.entries` | dict (runtime checked) | (none) | `list` |
| `.has` | list (runtime checked) | `value: any` | `bool` |
| `.has_any` | list (runtime checked) | `candidates: list` | `bool` |
| `.has_all` | list (runtime checked) | `candidates: list` | `bool` |
| `.dimensions` | vector (runtime checked) | (none) | `number` |
| `.model` | vector (runtime checked) | (none) | `string` |
| `.similarity` | vector (runtime checked) | `other: any` | `number` |
| `.dot` | vector (runtime checked) | `other: any` | `number` |
| `.distance` | vector (runtime checked) | `other: any` | `number` |
| `.norm` | vector (runtime checked) | (none) | `number` |
| `.normalize` | vector (runtime checked) | (none) | `any` |

---

## Global Utilities

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

## See Also

| Document | Description |
|----------|-------------|
| [Types](topic-types.md) | Primitives, collections, and value types |
| [Variables](topic-variables.md) | Declaration, scope, `$` binding |
| [Closures](topic-closures.md) | Closure semantics and patterns |
| [Operators](topic-operators.md) | Type assertions and existence checks in operators |
| [Reference](ref-language.md) | Quick reference tables |
