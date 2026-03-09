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
