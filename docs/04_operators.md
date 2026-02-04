# rill Operators

*Pipe, arithmetic, comparison, logical, spread, and extraction operators*

## Overview

| Category | Operators |
|----------|-----------|
| Pipe | `->` |
| Capture | `:>` |
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Comparison Methods | `.eq`, `.ne`, `.lt`, `.gt`, `.le`, `.ge` |
| Logical | `!` (unary), `&&`, `||` |
| Spread | `@` (sequential), `*` (tuple) |
| Extraction | `*<>` (destructure), `/<>` (slice) |
| Type | `:type` (assert), `:?type` (check) |
| Member | `.field`, `[index]` |
| Hierarchical Dispatch | `[path] -> target` |
| Default | `?? value` |
| Existence | `.?field`, `.?field&type` |

---

## Pipe Operator `->`

The pipe operator passes the left-hand value to the right-hand side:

```rill
"hello" -> .upper              # "HELLO"
42 -> ($ + 8)                  # 50
[1, 2, 3] -> each { $ * 2 }    # [2, 4, 6]
```

### Piped Value as `$`

The piped value is available as `$`:

```rill
"world" -> "hello {$}"         # "hello world"
5 -> ($ * $ + $)               # 30
```

### Method Syntax

Method calls are sugar for pipes:

```rill
"hello".upper                  # equivalent: "hello" -> .upper
"hello".contains("ell")        # equivalent: "hello" -> .contains("ell")
```

### Implicit `$`

Bare `.method()` implies `$` as receiver:

```rill
"hello" -> {
  .upper -> log                # $."upper" -> log
  .len                         # $.len
}
```

---

## Capture Operator `:>`

Captures a value into a variable:

```rill
"hello" :> $greeting           # store in $greeting
42 :> $count                   # store in $count
```

### Capture and Continue

`:>` captures AND continues the chain:

```rill
"hello" :> $a -> .upper :> $b -> .len
# $a is "hello", $b is "HELLO", result is 5
```

See [Variables](03_variables.md) for detailed scoping rules.

---

## Arithmetic Operators

| Operator | Description |
|----------|-------------|
| `+` | Addition |
| `-` | Subtraction |
| `*` | Multiplication |
| `/` | Division |
| `%` | Modulo (remainder) |

```rill
5 + 3                          # 8
10 - 4                         # 6
3 * 4                          # 12
15 / 3                         # 5
17 % 5                         # 2
```

### Precedence

Standard mathematical precedence (high to low):
1. Unary: `-`, `!`
2. Multiplicative: `*`, `/`, `%`
3. Additive: `+`, `-`

```rill
2 + 3 * 4                      # 14 (multiplication first)
(2 + 3) * 4                    # 20 (parentheses override)
-5 + 3                         # -2
```

### Type Constraint

All operands must be numbers. No implicit conversion:

```rill
5 + 3                          # OK: 8
```

```text
"5" + 1                        # ERROR: Arithmetic requires number, got string
```

### Error Handling

```text
10 / 0                         # ERROR: Division by zero
10 % 0                         # ERROR: Modulo by zero
```

---

## Comparison Operators

| Operator | Description |
|----------|-------------|
| `==` | Equal |
| `!=` | Not equal |
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less or equal |
| `>=` | Greater or equal |

```rill
5 == 5                         # true
5 != 3                         # true
3 < 5                          # true
5 > 3                          # true
5 <= 5                         # true
5 >= 3                         # true
```

### Value Comparison

All comparisons are by value, not reference:

```rill
[1, 2, 3] == [1, 2, 3]         # true
[a: 1] == [a: 1]               # true
"hello" == "hello"             # true
```

### Comparison Methods

Methods provide readable alternatives in conditionals:

| Method | Equivalent |
|--------|------------|
| `.eq(val)` | `== val` |
| `.ne(val)` | `!= val` |
| `.lt(val)` | `< val` |
| `.gt(val)` | `> val` |
| `.le(val)` | `<= val` |
| `.ge(val)` | `>= val` |

```rill
"A" :> $v
$v -> .eq("A") ? "match" ! "no"           # "match"
5 -> .gt(3) ? "big" ! "small"             # "big"
10 -> .le(10) ? "ok" ! "over"             # "ok"
```

---

## Logical Operators

| Operator | Description |
|----------|-------------|
| `&&` | Logical AND (short-circuit) |
| `\|\|` | Logical OR (short-circuit) |
| `!` | Logical NOT |

```rill
(true && false)                # false
(true || false)                # true
!true                          # false
!false                         # true
```

### Short-Circuit Evaluation

```rill
(false && undefined_var)       # false (right side not evaluated)
(true || undefined_var)        # true (right side not evaluated)
```

### With Comparisons

```rill
(1 < 2 && 3 > 2)               # true
(5 > 10 || 3 < 5)              # true
```

### Grouping Required

Compound expressions require grouping in simple-body contexts:

```rill
true -> ($ && true) ? "both" ! "not both"    # "both"
```

### Negation in Pipes

In pipe targets, `!expr` binds tightly and returns a boolean:

```rill
"hello" -> !.empty                 # true (not empty)
"" -> !.empty                      # false (is empty)
```

This works naturally with conditionals and captures:

```rill
"hello" -> !.empty ? "has content" ! "empty"   # "has content"
"hello" -> !.empty :> $not_empty               # $not_empty = true
```

No grouping needed — `!.empty` is parsed as a unit before `?` or `:>`.

---

## Spread Operators

### Sequential Spread `@`

Chain closures where each receives the previous result (fold pattern):

```rill
|x|($x + 1) :> $inc
|x|($x * 2) :> $double
|x|($x + 10) :> $add10

# Chain: (5 + 1) = 6, (6 * 2) = 12, (12 + 10) = 22
5 -> @[$inc, $double, $add10]    # 22
```

Single closure:

```rill
|x|($x * 2) :> $dbl
5 -> @$dbl                       # 10
```

### Tuple Spread `*`

Create tuples for argument unpacking:

```rill
# From list (positional)
*[1, 2, 3] :> $args

# From dict (named)
*[x: 1, y: 2] :> $named

# Convert list to tuple via pipe
[1, 2, 3] -> * :> $tuple
```

Using tuples at invocation:

```rill
|a, b, c|"{$a}-{$b}-{$c}" :> $fmt
*[1, 2, 3] -> $fmt()             # "1-2-3"
*[c: 3, a: 1, b: 2] -> $fmt()    # "1-2-3" (named, order doesn't matter)
```

See [Types](02_types.md) for full tuple documentation.

---

## Extraction Operators

### Destructure `*<>`

Extract elements from lists or dicts into variables. Returns the original value unchanged.

**List destructuring** (pattern count must match list length):

```rill
[1, 2, 3] -> *<$a, $b, $c>
# $a = 1, $b = 2, $c = 3
```

**With type annotations:**

```rill
[0, "ok"] -> *<$code:number, $msg:string>
# $code = 0, $msg = "ok"
```

**Skip elements with `_`:**

```rill
[1, 2, 3, 4] -> *<$first, _, _, $last>
# $first = 1, $last = 4
```

**Dict destructuring** (explicit key mapping):

```rill
[name: "test", count: 42] -> *<name: $n, count: $c>
# $n = "test", $c = 42
```

**Nested destructuring:**

```rill
[[1, 2], 3] -> *<*<$a, $b>, $c>
# $a = 1, $b = 2, $c = 3
```

**Errors:**

```text
[1, 2] -> *<$a, $b, $c>           # Error: pattern has 3 elements, list has 2
[name: "x"] -> *<name: $n, age: $a>  # Error: key 'age' not found
```

### Slice `/<>`

Extract a portion using Python-style `start:stop:step`. Works on lists and strings.

**Basic slicing:**

```rill
[0, 1, 2, 3, 4] -> /<0:3>        # [0, 1, 2]
[0, 1, 2, 3, 4] -> /<1:4>        # [1, 2, 3]
```

**Omitted bounds:**

```rill
[0, 1, 2, 3, 4] -> /<:3>         # [0, 1, 2] (first 3)
[0, 1, 2, 3, 4] -> /<2:>         # [2, 3, 4] (from index 2)
```

**Negative indices:**

```rill
[0, 1, 2, 3, 4] -> /<-2:>        # [3, 4] (last 2)
[0, 1, 2, 3, 4] -> /<:-1>        # [0, 1, 2, 3] (all but last)
```

**Step:**

```rill
[0, 1, 2, 3, 4] -> /<::2>        # [0, 2, 4] (every 2nd)
[0, 1, 2, 3, 4] -> /<::-1>       # [4, 3, 2, 1, 0] (reversed)
```

**String slicing:**

```rill
"hello" -> /<1:4>                # "ell"
"hello" -> /<::-1>               # "olleh"
```

**Edge cases:**

```rill
[1, 2, 3] -> /<0:100>            # [1, 2, 3] (clamped)
[1, 2, 3] -> /<2:1>              # [] (empty when start >= stop)
```

```text
[1, 2, 3] -> /<::0>              # Error: step cannot be zero
```

---

## Member Access Operators

### Field Access `.field`

Access dict fields:

```rill
[name: "alice", age: 30] :> $person
$person.name                     # "alice"
$person.age                      # 30
```

### Index Access `[n]`

Access list elements (0-based, negative from end):

```rill
["a", "b", "c"] :> $list
$list[0]                         # "a"
$list[-1]                        # "c"
$list[1]                         # "b"
```

### Variable Key `.$key`

Use a variable as key:

```text
"name" :> $key
[name: "alice"] :> $data
$data.$key                       # "alice"
```

### Computed Key `.($expr)`

Use an expression as key:

```text
0 :> $i
["a", "b", "c"] :> $list
$list.($i + 1)                   # "b"
```

### Alternative Keys `.(a || b)`

Try keys left-to-right:

```text
[nickname: "Al"] :> $user
$user.(name || nickname)         # "Al"
```

---

## Hierarchical Dispatch

Navigate nested data structures using a list of keys/indexes as a path:

```rill
["name", "first"] -> [name: [first: "Alice", last: "Smith"]]
# Result: "Alice"
```

### Path Syntax

Pipe a list path to a target structure. Path elements are applied sequentially:

- **Strings** navigate dict fields
- **Numbers** index into lists
- **Empty path** returns target unchanged

### Dict Path

```rill
["address", "city"] -> [address: [street: "Main", city: "Boston"]]
# Result: "Boston"
```

### List Path

```rill
[0, 1] -> [[1, 2, 3], [4, 5, 6]]
# Result: 2 (first list, second element)
```

### Mixed Path

```rill
["users", 0, "name"] -> [users: [[name: "Alice"], [name: "Bob"]]]
# Result: "Alice"
```

### Empty Path

```rill
[] -> [name: "test"]
# Result: [name: "test"] (unchanged)
```

### Error Handling

```text
["missing"] -> [name: "test"]    # Error: key 'missing' not found
[5] -> [1, 2, 3]                 # Error: index 5 out of bounds
```

See [Reference](11_reference.md) for full dispatch semantics including dict dispatch, list dispatch, and default values.

---

## Default Operator `??`

Provide a default value if field is missing or function call returns undefined:

```rill
[:] :> $empty
$empty.name ?? "unknown"         # "unknown"

[name: "alice"] :> $user
$user.name ?? "unknown"          # "alice"
$user.age ?? 0                   # 0
```

### With Function Calls

The default operator works with any expression, including function calls:

```text
get_data().status ?? "default"   # "default" if status field missing
fetch_value() ?? "fallback"      # "fallback" if fetch_value returns undefined
```

Function calls evaluate fully before the default operator applies.

---

## Existence Operators

### Field Existence `.?field`

Returns boolean:

```rill
[name: "alice"] :> $user
$user.?name                      # true
$user.?age                       # false
```

### Existence with Type `.?field&type`

Check existence AND type:

```rill
[name: "alice", age: 30] :> $user
$user.?name&string               # true
$user.?age&number                # true
$user.?age&string                # false
```

---

## Type Operators

### Type Assert `:type`

Error if type doesn't match, returns value unchanged:

```rill
42:number                        # 42
"hello" -> :string               # "hello"
```

```text
"hello" -> :number               # ERROR: expected number, got string
```

### Type Check `:?type`

Returns boolean:

```rill
42:?number                       # true
"hello":?number                  # false
"hello" -> :?string              # true
```

See [Types](02_types.md) for detailed type system documentation.

---

## Operator Precedence

From highest to lowest:

1. Member access: `.field`, `[index]`
2. Type operators: `:type`, `:?type`
3. Unary: `-`, `!`
4. Multiplicative: `*`, `/`, `%`
5. Additive: `+`, `-`
6. Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
7. Logical AND: `&&`
8. Logical OR: `||`
9. Default: `??`
10. Pipe: `->`
11. Capture: `:>`

Use parentheses to override precedence:

```rill
(2 + 3) * 4                      # 20
5 -> ($ > 3) ? "big" ! "small"   # "big"
```

---

## See Also

- [Types](02_types.md) — Type system and assertions
- [Variables](03_variables.md) — Capture and scope
- [Control Flow](05_control-flow.md) — Conditionals and loops
- [Collections](07_collections.md) — Collection operators
- [Reference](11_reference.md) — Quick reference tables
