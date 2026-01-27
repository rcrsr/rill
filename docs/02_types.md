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
| Closure | `\|\|{ }` | `\|x\|($x * 2)` |

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
"alice" :> $name
3 :> $a
5 :> $b
true :> $ok
"Hello, {$name}!"                    # Variable
"sum: {$a + $b}"                     # Arithmetic
"valid: {$a > 0}"                    # Comparison
"status: {$ok ? \"yes\" ! \"no\"}"   # Conditional
"upper: {$name -> .upper}"           # Method chain
```

### Multiline Strings

Multiline strings use triple-quote syntax:

```rill
"World" :> $name
"""
Hello, {$name}!
Line two
"""
```

Triple-quote strings support interpolation like regular strings.

See [Strings](09_strings.md) for string methods.

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
"5" + 1                    # ERROR: Arithmetic requires number, got string
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

---

## Lists

Ordered sequences of values:

```rill
[1, 2, 3] :> $nums
$nums[0]                   # 1
$nums[-1]                  # 3 (last element)
$nums -> .len              # 3
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
["a"] :> $list
$list[0] ?? "default"  # "a"
```

See [Collections](07_collections.md) for iteration operators.

---

## Dicts

Key-value mappings with string keys:

```rill
[name: "alice", age: 30] :> $person
$person.name               # "alice"
$person.age                # 30
```

**Access patterns:**
- `.field` — Literal field access
- `.$key` — Variable as key
- `.($i + 1)` — Computed expression as key
- `.(a || b)` — Alternatives (try keys left-to-right)
- `.field ?? default` — Default value if missing
- `.?field` — Existence check (returns bool)
- `.?field&type` — Existence + type check

**Missing key access** throws an error. Use `??` for safe access:

```rill
[:] :> $d
$d.missing ?? ""           # "" (safe default)
```

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

Closures in dicts have `$` late-bound to the containing dict. See [Closures](06_closures.md) for details.

```rill
[
  name: "toolkit",
  count: 3,
  str: ||"{$.name}: {$.count} items"
] :> $obj

$obj.str    # "toolkit: 3 items" (auto-invoked)
```

---

## Tuples

Tuples package values for explicit argument unpacking at closure invocation. Created with the `*` spread operator:

```rill
# From list (positional)
*[1, 2, 3] :> $t              # tuple with positional values

# From dict (named)
*[x: 1, y: 2] :> $t           # tuple with named values

# Via pipe target
[1, 2, 3] -> * :> $t          # convert list to tuple
```

### Using Tuples at Invocation

```rill
|a, b, c| { "{$a}-{$b}-{$c}" } :> $fmt

# Positional unpacking
*[1, 2, 3] -> $fmt()          # "1-2-3"

# Named unpacking (order doesn't matter)
*[c: 3, a: 1, b: 2] -> $fmt() # "1-2-3"
```

### Strict Validation

When invoking with tuples, missing required parameters error, and extra arguments error:

```rill
|x, y|($x + $y) :> $fn
*[1] -> $fn()                 # Error: missing argument 'y'
*[1, 2, 3] -> $fn()           # Error: extra positional argument
*[x: 1, z: 3] -> $fn()        # Error: unknown argument 'z'
```

### Parameter Defaults with Tuples

```rill
|x, y = 10, z = 20|($x + $y + $z) :> $fn
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

**Supported types:** `string`, `number`, `bool`, `closure`, `list`, `dict`, `tuple`

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
} :> $process_items

# Type-safe branching
|val| {
  $val -> :?number ? ($val * 2) ! ($val -> .len)
} :> $process
$process(5)        # 10
$process("hello")  # 5
```

---

## Type-Locked Variables

Variables lock type on first assignment. The type is inferred from the value or declared explicitly:

```rill
"hello" :> $name              # implicit: locked as string
"world" :> $name              # OK: same type
5 :> $name                    # ERROR: cannot assign number to string

"hello" :> $name:string       # explicit: declare and lock as string
42 :> $count:number           # explicit: declare and lock as number
```

### Inline Capture with Type

```rill
"hello" :> $x:string -> .len  # type annotation in mid-chain
```

Type annotations validate on assignment and prevent accidental type changes:

```rill
|x|$x :> $fn                  # locked as closure
"text" :> $fn                 # ERROR: cannot assign string to closure
```

---

## Global Type Functions

| Function | Description |
|----------|-------------|
| `type` | Returns type name as string |
| `json` | Convert to JSON string |

```rill
42 -> type              # "number"
"hello" -> type         # "string"
[1, 2] -> type          # "list"
*[1, 2] -> type         # "tuple"
[a: 1] -> type          # "dict"
||{ $ } -> type         # "closure"

[a: 1, b: 2] -> json    # '{"a":1,"b":2}'
```

**`json` closure handling:**
- Direct closure → error: `|x|{ $x } -> json` throws "Cannot serialize closure to JSON"
- Closures in dicts → skipped: `[a: 1, fn: ||{ 0 }] -> json` returns `'{"a":1}'`
- Closures in lists → skipped: `[1, ||{ 0 }, 2] -> json` returns `'[1,2]'`

---

## See Also

- [Variables](03_variables.md) — Declaration, scope, `$` binding
- [Closures](06_closures.md) — Closure semantics and patterns
- [Collections](07_collections.md) — List iteration operators
- [Strings](09_strings.md) — String methods reference
- [Reference](11_reference.md) — Quick reference tables
