# rill Type System

*Structural types, type assertions, union types, and type-locked variables*

## Structural Type Values

`^type` returns a structural type value — a first-class value describing the full structure of a collection, not just a coarse type name. It reports the declared type when the value carries one, else the own type. See [Declared and Effective Types](#declared-and-effective-types).

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
| `tuple(T)` | `tuple(number)` | Tuple of exactly one position |
| `dict(k: T, ...)` | `dict(a: number, b: string)` | Dict type (fields alpha-sorted in output) |
| `tuple(T, T2, ...)` | `tuple(number, string)` | Positional tuple type |
| `ordered(k: T, ...)` | `ordered(a: number, b: string)` | Named ordered type |
| `fn(p: T):R` | `fn(x: number):string` | Function type, named param |
| `fn():R` | `fn():string` | Function type, zero params |
| `fn(T, U):R` | `fn(number, string):bool` | Function type, unnamed params (bound as `$` and `$@`) |
| `fn(^(...) p: T):R` | `fn(^("label") x: string):int` | Function type, annotated param |
| `stream(T):R` | `stream(string):number` | Stream type with chunk type T and resolution type R |

### Default Values in Type Constructors

Type constructor fields accept a default value using `= literal` syntax after the field type. When you convert a value with `-> type`, the runtime fills in any missing fields using those defaults.

```rill
[b: "b"] -> dict(b: string, a: string = "a")
# Result: dict[a: "a", b: "b"]
```

The input `[b: "b"]` omits `a`. The conversion fills `a` with `"a"` from the default.

A default is evaluated each time its type expression runs. This includes `:` and `:?` positions, which check the value and do not fill the default in.

```rill
[x: 1] -> ordered(x: number, y: number = 0)
# Result: ordered[x: 1, y: 0]
```

```rill
tuple["x"] -> tuple(string, number = 0)
# Result: tuple["x", 0]
```

A list element type, a uniform dict or ordered value type, and a stream chunk or return type carry no default. No element is ever omitted, so a default would never fill anything. The type halts `#INVALID_INPUT` when it is built.

```rill
list[1] -> list(number = 1)
# Error: list element type cannot carry a default
```

```rill
stream(number = 1)
# Error: stream chunk type cannot carry a default
```

Write `list(number)`. Defaults belong on named fields, trailing tuple positions, and function parameters.

Tuple defaults are restricted to trailing positions. You cannot place a defaulted field before a required field in a tuple constructor.

The `:` assertion operator only checks and never converts. `-> T` converts every field, element, and position, and fills missing defaults.

When a required field has no default and the input omits it, the runtime raises [RILL-R044](ref-errors.md). See [Operators](topic-operators.md) for the full `-> type` compatibility matrix.

#### Nested Collection Synthesis

When a field is missing with no explicit default, the runtime synthesizes the field if its type is a collection where all children have defaults. The runtime seeds an empty collection and hydrates it.

```rill
dict[a: 1] -> dict(a: number, b: dict(c: number = 5))
# Result: dict[a: 1, b: dict[c: 5]]
```

The field `b` has no value in the input and no explicit default on the field itself. The runtime synthesizes `b` as an empty dict and fills `c` from the nested type's default.

If any child of the nested collection lacks a default, the conversion raises [RILL-R044](ref-errors.md).

#### Explicit Default Hydration

When a field has an explicit default that is itself a collection, the runtime hydrates that default through the nested type. Child defaults fill any fields the explicit default omits.

```rill
dict[] -> dict(a: dict(x: number = 1, y: number = 2) = [x: 10])
# Result: dict[a: dict[x: 10, y: 2]]
```

The explicit default `[x: 10]` omits `y`. The runtime fills `y` with `2` from the nested type constructor.

#### Defaults in Function Parameter Annotations

Type constructor defaults also work in function parameter type annotations. When the caller passes an incomplete value, the runtime fills in missing fields from the annotation defaults.

```rill
fn(a: dict(b: number = 5)) { $a.b } => $fn
$fn(dict[])
# Result: 5
```

The function expects a dict with field `b` defaulting to `5`. Calling with an empty dict causes the runtime to fill `b` from the annotation default.

```rill
fn(a: tuple(number = 0, string = "")) { $a } => $fn
$fn(tuple[])
# Result: tuple[0, ""]
```

A tuple annotation with trailing defaults fills all missing positions when the caller passes an empty tuple. When the annotation is a union, see [Defaults Under a Union](#defaults-under-a-union).

### Type Form

Every type is written `name(inner):outer`. The inner and the outer are both optional.

```rill
list[list() == list(any), dict() == dict, tuple() == tuple]
# Result: list[true, true, true]
```

Empty parentheses and a bare name both mean unspecified, so `list()` equals `list(any)`.

Only `stream` takes an outer, and an outer nests inline, as in `list(stream(number):string)`. A bare name takes one too: `stream:number` is `stream(any):number`. Inside parentheses, `name:` starts a named field, so `dict(stream: number)` has a field called `stream`; write `stream():number` there. An outer on `list`, `dict`, `tuple`, `ordered`, or `union` halts with RILL-P006:

```text
list(number):string    # RILL-P006: list takes no outer type
```

`tuple(T)` names exactly one position. `tuple(number, string)` names two. A sequence of any length with one element type is `list(T)`, not a tuple. `dict(T)` and `ordered(T)` keep their uniform value form.

### Element Type Inference

A list literal takes its element type from the elements it holds. Two steps run in order:

1. **One structure.** All elements share one structure, and that structure is the element type.
2. **Union.** Otherwise the element type is the set of maximal element types present. A member that another member accepts is dropped. Dicts, ordereds, and tuples that differ stay separate members.

```rill
list[dict[a: 1], dict[b: 2]].^type.signature
# Result: "list(union(dict(a: number), dict(b: number)))"
```

```rill
list[1, "a"].^type.signature
# Result: "list(union(number, string))"
```

Mixed elements do not halt. A union is a set, so element order and count do not change the type: `list["a", 1].^type == list[1, "a"].^type` is `true`. Dict elements follow the same rule:

```rill
list[dict[a: 1], dict[b: 2]].^type == list[dict[b: 2], dict[a: 1], dict[b: 5]].^type
# Result: true
```

```rill
list[list["a", 1], list["a"]].^type.signature
# Result: "list(list(union(number, string)))"
```

`list(string)` is accepted by `list(union(number, string))`, so it is dropped.

An empty collection yields to its populated sibling:

```rill
[list[], list[1,2]].^type.signature
# Result: "list(list(number))"
```

`seq`, `fan`, `filter`, `acc`, and dict `.values` results follow the same rule. When neither of two members accepts the other, both stay.

An inferred type describes what is there, and a declaration enforces. A declared element type rejects a mixed list:

```rill
list[1, "a"] -> :list(number)
# Error: #TYPE_MISMATCH Type assertion failed
```

### Metatype Fixed Point

The `^type` of a type value is always `type`, and every type name is an expression that produces a type value, so `string.^type == type`. `type.^type` is `type`:

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
| List | `"list(number)"`, `"list(list(number))"` |
| Dict (uniform) | `"dict(number)"` (all values same type) |
| Ordered (uniform) | `"ordered(string)"` (all values same type) |
| Dict | `"dict(a: number, b: string)"` (fields alphabetically sorted; a key not spelled as an identifier or reserved word, and `true`/`false`, is quoted, as in `"dict(\"a b\": number)"`) |
| Tuple | `"tuple(number, string, bool)"` (positional) |
| Ordered | `"ordered(a: number, b: string)"` (named, order-sensitive) |
| Function | `"fn(x: number):string"` (named params with colon-return) |
| Stream | `"stream(string):number"` (chunk type and resolution type) |
| Unspecified container | `"list"`, `"dict"`, `"tuple"`, `"ordered"`, `"stream"`: `list[].^type` and `list(any)` both print `"list"` |
| Bare list (no element type) | `"list"` |
| Bare dict (no fields) | `"dict"` |
| Bare tuple (no elements) | `"tuple"` |
| Bare ordered (no fields) | `"ordered"` |
| Bare function | `"fn"` |

### Stream Reflection

A stream type answers `.inner` with its chunk type and `.outer` with its resolution type; each is `any` when unconstrained:

```rill
stream(number):string => $t
list[$t.inner, $t.outer]
# Result: list[number, string]
```

A script stream value reports its declared chunk and resolution types:

```rill
fn(input: string):stream(string):number {
  $input -> yield
  3 -> return
} => $producer
$producer("x") => $s
list[$s.^type.inner, $s.^type.outer]
# Result: list[string, number]
```

Structural subtyping applies to both chunk and resolution types. The removed `.^chunk` and `.^output` probes are in [Removed Reflection Probes](ref-language.md#removed-reflection-probes). A `stream(string):number` satisfies `:stream(any):any` and `:stream`.

## Type Assertions

Use type assertions to validate values at runtime.

### Assert Type (`:type`)

Error if type doesn't match, returns value unchanged:

```rill
# Postfix form (binds tighter than method calls)
42:number                     # passes, returns 42
(1 + 2):number                # passes, returns 3
42:number -> string           # "42" - assertion then conversion

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

#### Extra and Missing Dict Fields

The table shows how each operation treats a dict value whose keys differ from the dict type.

| Operation | Extra fields | Missing field with a default | Missing field with no default | Field or element of another type |
|-----------|--------------|------------------------------|-------------------------------|----------------------------------|
| `:T` / `:?T` | `:` halts `#TYPE_MISMATCH`; `:?` returns false. Bare `dict` and `dict()` accept any keys | Accepted; not filled | `:` halts `#TYPE_MISMATCH`; `:?` returns false | `:T` halts `#TYPE_MISMATCH`; `:?` returns false |
| `-> T` | Dropped | Filled with the default | Halts RILL-R044, except a collection-typed field whose children all have defaults (see [Nested Collection Synthesis](#nested-collection-synthesis)) | Converts; halts RILL-R036 or RILL-R038 naming the part |
| `.^type == T` (undeclared dict) | false | false | false | false |

```rill
list[1, 2] -> list(string)
# Result: list["1", "2"]
```

```rill
# Error: RILL-R038
list["1", "x"] -> list(number)
```

```rill
# Error: #TYPE_MISMATCH
list[1, 2] -> :list(string)
```

`.^type == T` requires the exact key set, field types, and default presence on the dict's own type.

```rill
# Error: #TYPE_MISMATCH
dict[a: 1, x: 2] -> :dict(a: number)
```

```rill
dict[a: 1, x: 2] -> dict(a: number)
# Result: dict[a: 1]
```

```rill
dict[a: 1, x: 2] => $d
$d.^type == dict(a: number)
# Result: false
```

```rill
dict[a: 1] => $d
$d.^type == dict(a: number, b: number = 0)
# Result: false
```

#### Defaulted Fields in Collection Type Assertions

`:` and `:?` accept values that omit defaulted fields in the type constructor. Tuple and ordered values may omit trailing defaulted fields. Dict values may omit any defaulted field.

Write the type constructor inline in `:` or `:?` position, or bind it to a variable first:

```rill
# dict: value omits a non-trailing defaulted field
dict[b: 1] -> :dict(a: number = 0, b: number)
# Result: dict[b: 1]
```

```rill
# dict check, variable form
dict(b: string, a: string = "a") => $dt
dict[b: "b"] -> :?$dt
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

The assertion passes and returns the original value unchanged. No field synthesis occurs. Use `-> type` (convert) to fill missing fields with their defaults.

A missing field without a default causes the assertion to fail:

```rill
dict(b: string, a: string) => $dt
dict[b: "b"] -> :$dt
# Error: type assertion fails
```

Inside a bare bracket, `$x:` and `(expr):` read as dict keys, so `[$x:number]` is a dict. Write an inline assertion on a list element in parentheses, as in `[($x:number)]`.

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

**Supported types:** `string`, `number`, `bool`, `fn`, `list`, `dict`, `ordered`, `tuple`, `vector`, `stream`, `any`, `type`

Parameterized forms accept a type argument list: `list(string)`, `dict(a: number, b: string)`, `tuple(number, string)`. The runtime deep-validates element types on match.

The `vector` type matches host-provided typed arrays. The `any` type name accepts any value type — useful for generic functions. The `ordered` type matches containers produced by `*dict` spread.

Both types are valid in function parameter positions, capture type assertions, and type assertions:

```text
use<ext:app> => $app

# Function parameter with vector type annotation
fn(x: vector) { $x } => $fn
$app.embed("hello") => $v
$fn($v) -> .model
# Result: "mock-embed"
```

```rill
# Function parameter with any type annotation
fn(x: any) { $x } => $fn
$fn("hello")
# Result: "hello"
```

```text
use<ext:app> => $app

# Type assertion: :vector and :any
$app.embed("hello") => $v
$v -> :vector
# Result: vector(mock-embed, 3d)

$v -> :any
# Result: vector(mock-embed, 3d)
```

```text
use<ext:app> => $app

# Capture type assertion with vector type
$app.embed("hello") => $x:vector
$x -> .model
# Result: "mock-embed"
```

```rill
# Capture type assertion with parameterized type
[1, 2] => $x:list(number)
$x[0]
# Result: 1
```

### Stream Assertions

`:stream` asserts the value is a stream. `:stream(T)` additionally validates the chunk type. `:stream(T):R` validates both the chunk type and the resolution type. `:?stream` returns a boolean.

```text
use<ext:app> => $app

# :stream — assert value is a stream (requires host-provided stream)
$app.make_stream() => $s
$s -> :stream
```

```text
use<ext:app> => $app

# :stream(T) — assert stream with specific chunk type
$app.make_stream() => $s
$s -> :stream(string)
```

```text
use<ext:app> => $app

# :stream(T):R — assert stream with chunk and resolution types
$app.make_stream() => $s
$s -> :stream(string):number
```

```text
use<ext:app> => $app

# :?stream — check type without halting
$app.make_stream() => $s
$s -> :?stream
# Result: true
```

Attempting to convert a non-stream value to a stream with `-> stream` halts execution — there is no conversion path to the stream type:

```text
# Error: RILL-R003: Type conversion not supported for stream type
"hello" -> stream
```

### In Pipe Chains

```rill
[1, 2, 3] -> :list(number) -> seq({ $ * 2 })
"test" -> :string -> .len -> :number   # 4
```

### Use Cases

```rill
# Validate function input
fn(data) {
  $data -> :list              # assert input is list
  $data -> seq({ $ * 2 })
} => $process_items

# Type-safe branching
fn(val) {
  $val -> :?number ? ($val * 2) ! ($val -> .len)
} => $process
$process(5)        # 10
$process("hello")  # 5
```

### Defaults in Type Expressions

Function parameters accept an optional `= literal` default in the annotation position:

```text
fn(name: type = literal) { body }
```

A default is part of the function type. `:?` compares function types exactly: parameter names, parameter types, defaults, and the outer type must all be equal. A function with an extra defaulted parameter, or with a default the type omits, does not match.

| Value param has default | Type param has default | `:?` result |
|------------------------|----------------------|-------------|
| Yes | No | `false` (default not in the type) |
| No | Yes | `false` (default missing from the value) |
| Yes | Yes | `true` if defaults are equal |
| No | No | `true` |

```rill
fn(x: string, y: number) { $x } => $ref
$ref.^type => $refType

# A function WITH defaults does not match the type WITHOUT defaults
fn(x: string = "a", y: number = 0) { $x } => $fn
$fn -> :?$refType
# Result: false
```

A function without defaults does not match a type that declares them either.

```rill
fn(x: string = "a", y: number = 0) { $x } => $ref
$ref.^type => $refType

fn(x: string, y: number) { $x } => $fn
$fn -> :?$refType
# Result: false
```

A default does not infer the parameter type. `fn(x = "d")` gives `x` the type `any`; write `fn(x: string = "d")` to constrain it.

```rill
fn(x = "d") { $x } => $fn
$fn.^type.inner
# Result: ordered[x: any]
```

See [Type System: Defaults in Type Expressions](#defaults-in-type-expressions) and [Host API Types](ref-host-api-types.md) for the `structureMatches` TypeScript API.

## Union Types

A union type matches a value that satisfies any one member. Write it `union(...)`, with types or scalar literals (string, number, bool, atom) as members. A union is accepted wherever a type is.

### Assertions, Checks, and Captures

```rill
42 -> :union(string, number)              # assertion passes: 42
true:?union(string, number) => $ok        # check returns false
"hello" => $x:union(string, number)       # capture validates the value
$x
# Result: "hello"
```

### Literal Members

A type member matches by type. A literal member matches by equality. A closed set of values is a union of literals:

```rill
"c" -> :union("c", "f")
# Result: "c"
```

A comparison between a declared set and a literal outside it halts `#TYPE_MISMATCH`, so a misspelled member cannot pass as false. Closed-set checks apply only when an operand carries a declared set. See [Operators](topic-operators.md) for the comparison forms.

```rill
#wired => $kind:union(#wired, #wireless)
$kind == #wireless
# Result: false
```

```rill
# Error: #TYPE_MISMATCH
#wired => $kind:union(#wired, #wireless)
$kind == #wirless
```

The one-value type is `union("c")`. A bare literal after a colon is a parse error:

```rill
# Error: Expected type name
"c" => $a:"c"
```

### Conversion into a Union

`-> union(...)` returns a member value unchanged and declares it as the union. A value that is not a member halts `RILL-R036`, not the `#TYPE_MISMATCH` of an assertion. Members are never tried in turn, so a string is not converted into a number member.

```rill
"5" -> union(number, string)
# Result: "5"
```

```rill
"5" -> union(number, string) => $v
$v.^type.signature
# Result: "union(number, string)"
```

```rill
"5" -> union(number, string) => $v
$v.^effective.signature
# Result: "string"
```

```rill
# Error: RILL-R036
"5" -> union(number, bool)
```

### Closed-Set Dispatch

An atom is not a dict key. Convert a value from a closed set of atoms to its name before selecting:

```rill
#wired => $kind:union(#wired, #wireless)
$kind -> string -> dict[wired: { "cable" }, wireless: { "radio" }]
# Result: "cable"
```

### Unions as Type Values

A union is a type value. Capture it and reuse it as a member of another union:

```rill
union(#wired, #wireless) => $lan
#mesh -> :union($lan, #mesh)
# Result: #mesh
```

```rill
union(string, number).signature
# Result: "union(number, string)"
```

A variable member must hold a type. Any other value halts with `#TYPE_MISMATCH`.

### The error_code Type

`error_code` is a built-in type that holds the core error codes. An error code passes the assertion:

```rill
#TIMEOUT -> :error_code
# Result: #TIMEOUT
```

`#ok` is not an error code, so the assertion halts:

```rill
#ok -> :error_code
# Error: Type assertion failed: expected error_code, got #ok
```

The check form reports membership without halting:

```rill
#BOGUS -> :?error_code
# Result: false
```

`error_code` is a reserved type name like `union`, so `fn(error_code: string)` is a parse error. `$error_code` variables and dict keys are unaffected. `error_code.inner` lists its codes in canonical order. See [Error Handling](topic-error-handling.md) for the `.!code` probe, whose value is always a member of `union(#ok, error_code)`.

### Set Rules

A union is a set. These rules apply when the union is built:

| Rule | Example | Outcome |
|------|---------|---------|
| Order is ignored for equality | `union(string, number) == union(number, string)` | `true` |
| A duplicate member is rejected | `union(string, string)` | halts `#INVALID_INPUT` |
| A nested union merges | `union(union(string, number), bool)` | `union(string, number, bool)` |
| A subsumed member is dropped | `union(list(string), list)` | `list` |
| A member that keeps a default survives a broader member | `union(dict(a: string, b: string = "x"), dict)` | both kept |
| One type member equals that type | `union(string) == string` | `true` |
| An empty union is rejected | `union()` | halts `#INVALID_INPUT` |
| A compound literal is rejected | `union(list[1, 2])` | halts `#INVALID_INPUT` |

Reduction applies inside nested types:

```rill
union(list(union(string, number)), list(string)).signature
# Result: "list(union(number, string))"
```

### Defaults Under a Union

Reduction comes first. Members that differ only by an omittable defaulted field reduce to the wide member, so `union(dict(a: number), dict(a: number, b: number = 9))` is `dict(a: number, b: number = 9)` and its default fills in either written order.

```rill
fn(d: union(dict(a: number), dict(a: number, b: number = 9))) { $d.b } => $f
fn(d: union(dict(a: number, b: number = 9), dict(a: number))) { $d.b } => $g
tuple[$f(dict[a: 1]), $g(dict[a: 1])]
# Result: tuple[9, 9]
```

Among members that survive reduction, a call fills defaults from the narrowest member the argument matches, whatever the written order. Incomparable matches resolve by canonical order. The rule applies to script function and host parameters.

```rill
fn(d: union(dict(a: number, b: number = 9), dict)) { $d.b } => $f
fn(d: union(dict, dict(a: number, b: number = 9))) { $d.b } => $g
tuple[$f(dict[a: 1]), $g(dict[a: 1])]
# Result: tuple[9, 9]
```

A pipe into a union fills nothing (see [Conversion into a Union](#conversion-into-a-union)). A union that reduces to one member is that member, so it converts:

```rill
dict[] -> union(dict(a: number = 1), dict(a: number = 1, b: number = 2)) => $one
dict[] -> union(dict(a: number = 1), string) => $two
tuple[$one, $two]
# Result: tuple[dict[a: 1, b: 2], dict[]]
```

### Reserved Name

`union` is a reserved type name. Bare `union` and `union[...]` halt with `RILL-P003`; write `union(...)` with members. A host function registered as `union` is not callable by that bare name, because `union(...)` calls the union constructor. A dict key still works: `dict[union: 1]`.

### Error Behavior

A failed assertion names the whole union and the offending value:

```rill
guard { "x" -> :union("c", "f") } => $out
$out.!message
# Result: Type assertion failed: expected union("c", "f"), got "x"
```

See [Operators](topic-operators.md) for union types in destructure and existence positions.

## Type-Locked Variables

Variables lock type on first assignment. The lock is the declared type the value carries, or its full inferred type, element and field types included (see [Type-Locked Variables](topic-variables.md)). An annotation declares a type explicitly:

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

A capture of a value that carries a declaration locks the new variable to that declaration:

```rill
1 => $x:union(number, string)
$x => $y                      # $y locks to union(number, string)
"a" => $y                     # OK: string is a member
$y
# Result: "a"
```

### Inline Capture with Type

```rill
"hello" => $x:string -> .len  # type annotation in mid-chain
```

Type annotations validate on assignment and prevent accidental type changes:

```rill
fn(x) { $x } => $fn                  # locked as its full fn type
```

```text
"text" => $fn                 # ERROR: cannot assign string to fn
```

## Type Values

rill has a runtime type named `type`. A type value represents a rill type — including full structural information for collection types.

### `.^type` Operator

`.^type` returns the structural type value for any rill value: the declared type when one is carried, else the own type. The examples here use undeclared values.

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

fn(x) { $x } => $fn
$fn.^type.name == "fn"
# Result: true
```

```text
use<ext:app> => $app

$app.embed("hello world") => $vec
$vec.^type == vector
# Result: true
```

### Declared and Effective Types

A declared type travels with a value. A union capture shows it:

```rill
42 => $x:union(string, number)
$x.^type.signature
# Result: "union(number, string)"
```

`.^effective` always reports the own type of the value:

```rill
42 => $x:union(string, number)
$x.^effective.signature
# Result: "number"
```

A written type before a literal declares the literal the same way; see [Declared Literals](topic-variables.md#declared-literals).

A declaration comes from a capture annotation, a `:T` assertion, a pipe into a union, a typed parameter, or `.!code`. It stays with `$`, captures, grouped expressions, `pass`, destructures, and function parameters. Element and field reads on a declared collection project the declared element type:

```rill
list[1, 2] => $xs:list(union(string, number))
$xs -> seq({ $.^type.name })
# Result: list["union", "union"]
```

```rill
list[1, 2] => $xs:list(union(string, number))
$xs[0].^effective.name
# Result: "number"
```

A new declaration replaces the old one:

```rill
42 => $x:union(string, number)
$x => $y:number
$y.^type.signature
# Result: "number"
```

Every element and field read carries the declared element or field type: `[expr]`, `.name`, `.$k`, and pipe selection such as `"a" -> $d`. Methods such as `.head` take the own type:

```rill
dict[a: 1] => $d:dict(a: union(number, string))
$d.a.^type.signature
# Result: "union(number, string)"
```

```rill
dict[a: 1] => $d:dict(a: union(number, string))
"a" -> $d => $v
tuple[$d["a"].^type.signature, $v.^type.signature]
# Result: tuple["union(number, string)", "union(number, string)"]
```

A declaration that names no element type projects nothing: a bare `list`, `list(any)`, or `union(list(number), string)` leaves `[0]` reporting the own type. A bare kind annotation also reports only the kind:

```rill
list[1, 2] => $l:list
[$l.^type.signature, $l.^effective.signature]
# Result: list["list", "list(number)"]
```

A computed result takes its own type. Binary and unary operators, method calls, call results, conditionals, and loops all drop the declaration:

```rill
42 => $x:union(string, number)
($x + 1).^type.signature
# Result: "number"
```

A collection without a declaration carries none, so its elements report their own types:

```rill
list[1, "a"] => $xs
tuple[$xs[0].^type.signature, $xs[1].^type.signature]
# Result: tuple["number", "string"]
```

A variable's declared type is its lock, so a later capture does not change it:

```rill
42 => $x:union(string, number)
"a" => $x
$x.^type.signature
# Result: "union(number, string)"
```

`any` declares nothing. `1 => $x:any` locks the variable as `number`.

`.^type` reports the declared type when one is carried, else the own type. To dispatch on the runtime type of a value under a declared union, read `.^effective.name`, because `.^type.name` is `"union"`.

At the host boundary, `toNative` reports the own type, not the declaration.

Migrating from own-type reads: write `$v.^effective.name` and `$v.^effective == number` where `$v.^type.name` and `$v.^type == number` used to dispatch. A member check also works, as in `$v -> :?number`:

```rill
1 => $v:union(number, string)
$v -> :?number
# Result: true
```

### Dot-Notation Properties on Type Values

Type values expose six properties via dot notation:

| Property | Return Type | Description |
|----------|-------------|-------------|
| `.name` | `string` | Coarse type name (`"number"`, `"list"`, `"dict"`, etc.) |
| `.signature` | `string` | Full structural type string |
| `.inner` | type, collection, or list | What the type holds or takes |
| `.outer` | type | What a function or stream type yields |
| `.defaults` | `dict` | Defaults of a dict, ordered, or function type; only fields that have one |
| `.annotations` | `dict` | Annotations of a dict, ordered, or function type's fields or parameters; only those that have any |

```rill
number => $t
$t.name
# Result: "number"
```

`.signature` returns the full structural representation via `formatStructure`:

```rill
list(number) => $t
$t.signature
# Result: "list(number)"
```

```rill
fn(y: string):string { $y } => $fn
$fn.^type.signature
# Result: "fn(y: string):string"
```

Combining `.^type` with `.name` and `.signature` gives both coarse and structural information:

```rill
tuple[42.^type.name, 42.^type.signature]
# Result: tuple["number", "number"]
```

`.inner` returns one value per slot. Named fields and positions return the type's own collection kind, and every entry is a type:

| Type | `.inner` |
|------|----------|
| `list(T)`, `dict(T)` | `T` |
| `dict(a: T)` | `dict[a: T]` |
| `ordered(a: T)` | `ordered[a: T]` |
| `tuple(T, U)`, `tuple(T)` | `tuple[T, U]`, `tuple[T]` (always a tuple) |
| `union(...)`, `error_code` | `list` of members in canonical order |
| `fn(a: T)` | `ordered[a: T]` |
| `fn(T, U)` | `tuple[T, U]` |
| `stream(T):R` | `T` |
| `list`, `dict`, `tuple`, `ordered`, `stream`, `fn` without arguments | `any` |
| `string`, `number`, `bool`, `atom`, `vector`, `datetime`, `duration`, `type`, `any` | halts RILL-R003 |

A union's `.inner` sorts type members by name first, then literals by kind (atom, bool, number, string) and by value. Equal unions return equal lists, and `.signature` prints the same order:

```rill
union("x", list, #a, 1, true).inner
# Result: list[list, #a, true, 1, "x"]
```

`.outer` is defined on function and stream types and returns the declared result type, `any` when undeclared; bare `fn.outer` is `any` and `fn.defaults` is `dict[]`, so `tuple[fn.inner, fn.outer, fn.defaults]` is `tuple[any, any, dict[]]`. Any other type halts RILL-R003. A leaf type has no `.inner`; guard the read with `??`, or test with `.?`. `.defaults` lists only the fields that declare a default: `dict(a: string = "x", b: number).defaults` is `dict[a: "x"]`. It halts RILL-R003 on types other than dict, ordered, and function:

```rill
string => $t
tuple[$t.inner ?? any, $t.?name, $t.?inner, $t.missing ?? "x"]
# Result: tuple[any, true, false, "x"]
```

`.annotations` lists only the fields or parameters that carry annotations. An unnamed parameter is keyed `"0"`, and a tuple type halts RILL-R003:

```rill
fn(^(min: 0) x: number, y: string) { $x } => $f
$f.^type.annotations
# Result: dict[x: dict[min: 0]]
```

```rill
string => $t
$t.inner
# Error: Type value has no property "inner"
```

`.inner`, `-> .inner`, and `.?inner` agree on what a type value has. A variable key is a selector, not a field name, so `$t.$k` and `$t.?$k` halt RILL-R002 `Cannot index type`, as `$t["inner"]` does. The general rule lives in [Language Reference](ref-language.md).

```rill
string => $t
"signature" => $k
$t.$k ?? "none"
# Error: Cannot index type
```

The removed `.^input`, `.^output`, and `.^chunk` probes halt and name their replacements. See [Removed Reflection Probes](ref-language.md#removed-reflection-probes) for the table.

`.^name` on a type value raises RILL-R008 ("Annotation access not supported on type values"); use `.name` instead.

### Type Value Equality

Type values compare with `==` and `!=`. Structural types compare structurally:

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

## See Also

| Document | Description |
|----------|-------------|
| [Types](topic-types.md) | Primitives, collections, and value types |
| [Variables](topic-variables.md) | Declaration, scope, `$` binding |
| [Functions and Code Blocks](topic-closures.md) | Function semantics and patterns |
| [Closure Annotations](topic-closure-annotations.md) | Field annotations on dict, ordered, and tuple types, and their TypeScript access |
| [Operators](topic-operators.md) | Type assertions and existence checks in operators |
| [Reference](ref-language.md) | Quick reference tables |
