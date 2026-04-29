# rill Operators

*Pipe, arithmetic, comparison, logical, spread, and extraction operators*

## Overview

| Category | Operators |
|----------|-----------|
| Pipe | `->` |
| Capture | `=>` |
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Comparison Methods | `.eq`, `.ne`, `.lt`, `.gt`, `.le`, `.ge` |
| Logical | `!` (unary), `&&`, `||` |
| Chain | `chain($fn)`, `chain([...])` |
| Ordered | `ordered[k: v]` (named ordered container) |
| Extraction | `destruct<...>` (destructure), `slice<...>` (slice) |
| Convert | `-> type` (type conversion) |
| Type | `:type` (assert), `:?type` (check) |
| Member | `.field`, `[index]` |
| Hierarchical Dispatch | `[path] -> target` |
| Default | `?? value` |
| Existence | `.?field`, `.?field&type` |
| Status probe | `.!` (status code on current `$`), `.!field` (status code on field) |

---

## Pipe Operator `->`

The pipe operator passes the left-hand value to the right-hand side:

```rill
"hello" -> .upper              # "HELLO"
42 -> ($ + 8)                  # 50
[1, 2, 3] -> seq({ $ * 2 })    # list[2, 4, 6]
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

### Pipe Binding Rule

When `->` targets a callable, the runtime decides how to bind the piped value to arguments. Two rules apply, checked in order:

**Rule 1 — Explicit `$` (manual placement).** The runtime scans the immediate argument list for `$`. If at least one top-level `$` is found, every occurrence resolves to the piped value. No auto-prepend occurs.

**Rule 2 — Auto-prepend.** If no top-level `$` is found in the argument list, the piped value is prepended as the first argument automatically.

**Zero-parameter callables.** When auto-prepend is selected but the callable declares zero parameters, the piped value is silently dropped. The callable runs with no arguments. Execution does not halt.

**Closures stop the scan.** The scanner walks the immediate argument list but stops at closure boundaries (`{`). References to `$` inside a closure literal are not counted — they are late-bound when the callable invokes the closure per element. Only top-level `$` in the argument list triggers explicit placement.

**Sub-expressions are scanned.** The scanner descends into non-closure sub-expressions. `fn(g($))` contains a top-level `$` inside `g(...)`, so explicit placement is used.

#### Worked Examples

| Call form | `$` in top-level args? | Effective call | Notes |
|-----------|------------------------|---------------|-------|
| `$val -> fn` | n/a (no args) | `fn($val)` | Auto-prepend |
| `$val -> fn()` | n/a (empty args) | `fn($val)` | Auto-prepend |
| `$val -> fn` (fn takes 0 params) | n/a | `fn()` | `$val` silently dropped |
| `$val -> fn(1, 2)` | no | `fn($val, 1, 2)` | Auto-prepend |
| `$val -> fn($)` | yes | `fn($val)` | Explicit: single `$` |
| `$val -> fn(1, $, 0)` | yes | `fn(1, $val, 0)` | Explicit: middle position |
| `$val -> fn(1, $, $)` | yes | `fn(1, $val, $val)` | Explicit: both resolve to piped value |
| `$val -> fn(g($))` | yes (inside sub-expr) | `fn(g($val))` | Sub-expr `$` counts as top-level |
| `$list -> filter({ $.active })` | no (closure boundary stops scan) | `filter($list, { $.active })` | Closure `$` is late-bound per element |
| `$matrix -> seq({ $ -> seq({ $ * 2 }) })` | no (outer closure stops scan) | `seq($matrix, { $ -> seq({ $ * 2 }) })` | Nested closures; outer and inner `$` both late-bound |

#### Auto-prepend — no args

When a callable is called with no arguments, the piped value is prepended automatically.

```rill
|x|($x * 2) => $double
5 -> $double
# Result: 10
```

#### Auto-prepend — host function with existing args

When a host function is called with existing args and no top-level `$`, the piped value is prepended as the first argument. The existing args shift right. This applies to built-in and host-provided functions in pipe-target position.

```rill
[1, 2, 3] -> fold(0, { $@ + $ })
# fold([1, 2, 3], 0, { $@ + $ }) — list auto-prepended
# Result: 6
```

#### Explicit placement with `$`

```rill
|a, b, c|"{$a},{$b},{$c}" => $fmt
10 -> $fmt(1, $, 0)
# Result: "1,10,0"
```

#### Duplicate `$` — both resolve to piped value

```rill
|a, b, c|"{$a},{$b},{$c}" => $fmt
10 -> $fmt(1, $, $)
# Result: "1,10,10"
```

#### Sub-expression `$` counts as top-level

```rill
|x|($x * 2) => $double
|n|($n + 1) => $inc
5 -> $double($inc($))
# Result: 12
```

The `$` inside `$inc($)` is a top-level `$` in the argument list of `$double`, so explicit placement is used. The piped value `5` goes to `$inc`, producing `6`, which becomes the single argument to `$double`.

#### Closure `$` is late-bound — not counted by the scanner

```rill
[[active: true, name: "a"], [active: false, name: "b"], [active: true, name: "c"]] -> filter({ $.active })
# Result: [[active: true, name: "a"], [active: true, name: "c"]]
```

The `$` inside `{ $.active }` is inside a closure boundary. The scanner stops there and finds no top-level `$`. Auto-prepend activates: the list is prepended as the first argument to `filter`, and the closure is passed as the second argument. Inside the closure body, `$` is late-bound to each element during iteration.

#### Nested closures — all closure `$` are late-bound

```rill
[[1, 2, 3], [4, 5, 6]] -> seq({ $ -> seq({ $ * 2 }) })
# Result: [[2, 4, 6], [8, 10, 12]]
```

Both the outer `{ $ -> ... }` and the inner `{ $ * 2 }` use late-bound `$`. Neither counts toward the pipe-site scan for the top-level `seq` call. Auto-prepend places the list as the first argument.

#### Zero-parameter callable — piped value silently dropped

```rill
||("constant") => $zero
42 -> $zero()
# Result: "constant"
```

`$zero` takes zero parameters. The piped value `42` is silently discarded. `$zero` runs and returns `"constant"`. Execution does not halt.

---

## Capture Operator `=>`

Captures a value into a variable:

```rill
"hello" => $greeting           # store in $greeting
42 => $count                   # store in $count
```

### Capture and Continue

`=>` captures AND continues the chain:

```rill
"hello" => $a -> .upper => $b -> .len
# $a is "hello", $b is "HELLO", result is 5
```

See [Variables](topic-variables.md) for detailed scoping rules.

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
[1, 2, 3] == list[1, 2, 3]         # true
[a: 1] == dict[a: 1]               # true
"hello" == "hello"                     # true
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
"A" => $v
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
"hello" -> !.empty => $not_empty               # $not_empty = true
```

No grouping needed; `!.empty` is parsed as a unit before `?` or `=>`.

---

## Chain and Ordered

### `chain()` Built-in

`chain` pipes a value through a sequence of closures. Each closure receives the result of the previous one.

Chain a list of closures:

```rill
|x|($x + 1) => $inc
|x|($x * 2) => $double
|x|($x + 10) => $add10

# Chain: (5 + 1) = 6, (6 * 2) = 12, (12 + 10) = 22
5 -> chain([$inc, $double, $add10])    # 22
```

Chain a single closure:

```rill
|x|($x * 2) => $dbl
5 -> chain($dbl)                           # 10
```

### `ordered[...]` Literal

`ordered[...]` produces a named, ordered container. It preserves insertion order and carries named keys. Use it to pass named arguments to closures:

```rill
|a, b, c|"{$a}-{$b}-{$c}" => $fmt
dict[c: 3, a: 1, b: 2] -> $fmt(...)       # "1-2-3" (names matched, key order irrelevant)
```

`ordered` values convert to plain objects via `toNative()`. The `native` field holds `{ key: value, ... }`. Closures, iterators, vectors, and type values produce `native: null`.

See [Types](topic-types.md) for full type documentation.

---

## Extraction Operators

### Destructure `destruct<>`

Extract elements from lists or dicts into variables. Returns the original value unchanged.

**List destructuring** (pattern count must match list length):

```rill
[1, 2, 3] -> destruct<$a, $b, $c>
# $a = 1, $b = 2, $c = 3
```

**With dict destructuring:**

```rill
[code: 0, msg: "ok"] -> destruct<code: $code, msg: $msg>
# $code = 0, $msg = "ok"
```

**Skip elements with `_`:**

```rill
[1, 2, 3, 4] -> destruct<$first, _, _, $last>
# $first = 1, $last = 4
```

**Dict destructuring** (explicit key mapping):

```rill
[name: "test", count: 42] -> destruct<name: $n, count: $c>
# $n = "test", $c = 42
```

**Nested destructuring:**

```rill
[list[1, 2], list[3, 4]] -> destruct<destruct<$a, $b>, destruct<$c, $d>>
# $a = 1, $b = 2, $c = 3, $d = 4
```

**Errors:**

```text
[1, 2] -> destruct<$a, $b, $c>           # Error: pattern has 3 elements, list has 2
[name: "x"] -> destruct<name: $n, age: $a>  # Error: key 'age' not found
```

### Type-Annotated Destructure

Capture variables in `destruct<>` accept type annotations using `:type` syntax. The runtime validates the extracted element against the declared type before assignment.

**Parameterized type on a destructure capture:**

```rill
[["a", "b"]] -> destruct<$a:list(string)>
$a[0]
# Result: "a"
```

**Dict structural type on a destructure capture:**

```rill
[[name: "alice"]] -> destruct<$a:dict(name: string)>
$a.name
# Result: "alice"
```

**Union type on a destructure capture:**

```rill
["hello"] -> destruct<$a:string|number>
$a
# Result: "hello"
```

**Type mismatch error:**

```text
# Error: Type mismatch: cannot assign list(number) to $a:list(string)
[[1, 2]] -> destruct<$a:list(string)>
```

### Slice `slice<>`

Extract a portion using Python-style `start:stop:step`. Works on lists and strings.

**Basic slicing:**

```rill
[0, 1, 2, 3, 4] -> slice<0:3>        # list[0, 1, 2]
[0, 1, 2, 3, 4] -> slice<1:4>        # list[1, 2, 3]
```

**Omitted bounds:**

```rill
[0, 1, 2, 3, 4] -> slice<:3>         # list[0, 1, 2] (first 3)
[0, 1, 2, 3, 4] -> slice<2:>         # list[2, 3, 4] (from index 2)
```

**Negative indices:**

```rill
[0, 1, 2, 3, 4] -> slice<-2:>        # list[3, 4] (last 2)
[0, 1, 2, 3, 4] -> slice<:-1>        # list[0, 1, 2, 3] (all but last)
```

**Step:**

```rill
[0, 1, 2, 3, 4] -> slice<::2>        # list[0, 2, 4] (every 2nd)
[0, 1, 2, 3, 4] -> slice<::-1>       # list[4, 3, 2, 1, 0] (reversed)
```

**String slicing:**

```rill
"hello" -> slice<1:4>                    # "ell"
"hello" -> slice<::-1>                   # "olleh"
```

**Edge cases:**

```rill
[1, 2, 3] -> slice<0:100>            # list[1, 2, 3] (clamped)
[1, 2, 3] -> slice<2:1>              # [] (empty when start >= stop)
```

```text
[1, 2, 3] -> slice<::0>              # Error: step cannot be zero
```

---

## Member Access Operators

### Field Access `.field`

Access dict fields:

```rill
[name: "alice", age: 30] => $person
$person.name                     # "alice"
$person.age                      # 30
```

See [Types](topic-types.md) for dict `.keys` and `.entries` documentation.

### Index Access `[n]`

Access list elements (0-based, negative from end):

```rill
["a", "b", "c"] => $list
$list[0]                     # "a"
$list[-1]                    # "c"
$list[1]                     # "b"
```

### Variable Key `.$key`

Use a variable as key:

```text
"name" => $key
[name: "alice"] => $data
$data.$key                       # "alice"
```

### Computed Key `.($expr)`

Use an expression as key:

```text
0 => $i
["a", "b", "c"] => $list
$list.($i + 1)                   # "b"
```

### Alternative Keys `.(a || b)`

Try keys left-to-right:

```text
[nickname: "Al"] => $user
$user.(name || nickname)         # "Al"
```

---

## Hierarchical Dispatch

Navigate nested data structures using a list of keys/indexes as a path:

```rill
["name", "first"] -> [name: dict[first: "Alice", last: "Smith"]]
# Result: "Alice"
```

### Path Syntax

Pipe a list path to a target structure. Path elements are applied sequentially:

- **Strings** navigate dict fields
- **Numbers** index into lists
- **Empty path** returns target unchanged

### Dict Path

```rill
["address", "city"] -> [address: dict[street: "Main", city: "Boston"]]
# Result: "Boston"
```

### List Path

```rill
[0, 1] -> list[list[1, 2, 3], list[4, 5, 6]]
# Result: 2 (first list, second element)
```

### Mixed Path

```text
["users", 0, "name"] -> [users: list[dict[name: "Alice"], dict[name: "Bob"]]]
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
[5] -> list[1, 2, 3]                 # Error: index 5 out of bounds
```

See [Reference](ref-language.md) for full dispatch semantics including dict dispatch, list dispatch, and default values.

---

## Status Probe (`.!`, `.!field`)

Bare `.!` tests whether a value is invalid (halted). `.!field` projects a named field of the status sidecar.

```text
$result.!              # bool: true if $result is invalid, false if valid
$result.!code          # :atom status code (#ok when valid)
$result.!message       # string message
```

| Form | Returns |
|------|---------|
| `$v.!` | `bool` — `false` when valid, `true` when invalid |
| `$v.!code` | `:atom` status code (`#ok` when valid) |
| `$v.!message` | `string` status message |
| `$v.!provider` | `string` provider tag |
| `$v.!trace` | `list` of trace-frame dicts |
| `$v.!<other>` | provider-specific raw field; missing keys yield `""` |

Compare with existence probes: `.?` tests presence (returns `bool`). `.!` bare also returns `bool`; field projections (`.!code`, `.!message`, ...) return the projected value's type. See [Error Handling](topic-error-handling.md) for guard and invalid value patterns.

---

## Default Operator `??`

Provide a default value if field is missing or access fails:

```rill
[:] => $empty
$empty.name ?? "unknown"         # "unknown"

[name: "alice"] => $user
$user.name ?? "unknown"          # "alice"
$user.age ?? 0                   # 0
```

### With Function Calls

The default operator works with any expression, including function and method calls:

```text
get_data().status ?? "default"   # "default" if status field missing
fetch_value() ?? "fallback"      # "fallback" if fetch_value returns undefined
```

### With Method Calls

The `??` operator applies after method invocations in access chains:

```text
$dict.transform() ?? "default"   # default if method throws or result missing
$obj.compute().value ?? 0        # default if value field missing after method
$config.get_setting() ?? [:]     # default if method returns undefined
```

Method calls evaluate fully before the default operator applies.

---

## Existence Operators

### Presence Probe `.?`

`.?` on a bare value (no field name) returns `true` when the current `$` is a valid (non-halted) value.

```text
$result.?           # true if $result is valid, false if invalid
$value -> .?        # bool: present and valid?
```

Use `.?` after `guard` to branch on success vs. invalid result. The status probe `.!` retrieves the specific code when `.?` returns false.

### Field Existence `.?field`

Returns boolean:

```rill
[name: "alice"] => $user
$user.?name                      # true
$user.?age                       # false
```

### Existence with Type `.?field&type`

Check existence AND type:

```rill
[name: "alice", age: 30] => $user
$user.?name&string               # true
$user.?age&number                # true
$user.?age&string                # false
```

The `&type` position accepts parameterized types and union types.

**Parameterized type:**

```rill
[items: [1, 2, 3]] => $data
$data.?items&list(number)
# Result: true
```

**Dict structural type:**

```rill
[cfg: [key: "x"]] => $data
$data.?cfg&dict(key: string)
# Result: true
```

**Union type:**

```rill
[score: 42] => $data
$data.?score&string|number
# Result: true
```

The `&` operator binds to the entire union expression. `$data.?score&string|number` parses as `$data.?score & (string|number)`, not `($data.?score&string) | number`.

---

## Type Operators

### Type Assert `:type`

Error if type doesn't match, returns value unchanged:

```rill
42:number                        # 42
"hello" -> :string               # "hello"
```

Structural type syntax is supported in assertions. The structural form specifies element or field types:

```text
[1, 2, 3] -> :list(number)                    # passes: all elements are number
[a: 1, b: 2] -> :dict(a: number, b: number)   # passes: fields match types
[1, "x"] -> :list(number)                     # ERROR: structural type mismatch
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

Coarse checks return boolean directly:

```rill
[1, 2, 3] -> :?list              # true
[a: 1] -> :?dict                 # true
```

Structural checks are also supported. These match element and field types:

```text
[1, 2, 3] -> :?list(number)      # true
[1, "x"] -> :?list(number)       # false
[a: 1] -> :?dict(a: number)      # true
```

### `^type` Operator

`^type` returns the structural `RillTypeValue` for a value. The type value carries both a coarse name and a full structural description:

```text
[1, 2, 3] -> ^type               # list(number)
[a: 1, b: "x"] -> ^type         # dict(a: number, b: string)
42 -> ^type                      # number
```

The type value formats as a structural string via `-> string` or string interpolation:

```text
[1, 2, 3] -> ^type -> string   # "list(number)"
"hello {[1,2,3] -> ^type}"       # "hello list(number)"
```

To get the type name only, chain `.name` on the type value:

```text
[1, 2, 3] -> ^type -> .name      # "list"
42 -> ^type -> .name             # "number"
```

See [Types](topic-types.md) for detailed type system documentation.

### Conversion Operator `-> type`

The `-> type` operator converts a value to the target type. Same-type conversions are no-ops. Incompatible conversions halt with `RILL-R036`.

| Source | `-> list` | `-> dict` | `-> tuple` | `-> ordered(sig)` | `-> number` | `-> string` | `-> bool` |
|---------|--------|--------|---------|----------------|----------|----------|--------|
| `list`    | no-op  | error  | valid   | error          | error    | valid¹   | error  |
| `dict`    | error  | no-op  | error   | valid          | error    | valid¹   | error  |
| `tuple`   | valid  | error  | no-op   | error          | error    | valid¹   | error  |
| `ordered` | error  | valid  | error   | no-op          | error    | valid¹   | error  |
| `string`  | error  | error  | error   | error          | valid²   | no-op    | valid³ |
| `number`  | error  | error  | error   | error          | no-op    | valid¹   | valid⁵ |
| `bool`    | error  | error  | error   | error          | valid⁴   | valid¹   | no-op  |

¹ Uses `formatValue` semantics for formatted output.
² Parseable strings only; halts with `RILL-R038` on failure.
³ Accepts only `"true"` and `"false"`; halts with `RILL-R036` otherwise.
⁴ `true` maps to `1`, `false` maps to `0`.
⁵ `0` maps to `false`, `1` maps to `true`; all other values halt with `RILL-R036`.

**Structural conversion with signatures:** `-> dict(sig)`, `-> ordered(sig)`, and `-> tuple(sig)` accept a structural type signature as the conversion target. The source value must match the target kind (dict-to-dict, tuple-to-tuple, or list-to-tuple). Fields present in the signature but absent from the source are hydrated with the signature's default values. See [Type System](topic-type-system.md) for structural type and default value documentation.

---

## Spread Call Operator

The spread call operator expands a value into the positional or named arguments of a function call. Spreading is opt-in; passing a tuple or ordered value without `...` passes it as a single argument.

### Syntax Forms

| Form | Description |
|------|-------------|
| `$fn(...)` | Spread piped value into call arguments |
| `$fn(...$expr)` | Spread a specific expression into call arguments |
| `$fn(a, ...$rest)` | Mix fixed args with a spread |

`...` (bare) is equivalent to `...$`; it spreads the current piped value.

At most one spread is permitted per call.

### Piped Spread

Spread the piped value into a multi-param closure:

```rill
|a, b, c| { "{$a}-{$b}-{$c}" } => $fmt
tuple[1, 2, 3] -> $fmt(...)
# Result: "1-2-3"
```

### Variable Spread

Spread a stored value directly:

```rill
|a, b| { $a + $b } => $add
tuple[3, 4] => $args
$add(...$args)
# Result: 7
```

### Mixed Args

Combine fixed arguments with a spread:

```rill
|a, b, c| { "{$a}-{$b}-{$c}" } => $fmt
tuple[2, 3] => $rest
$fmt(1, ...$rest)
# Result: "1-2-3"
```

### No Spread (Pass-Through)

Without `...`, a tuple passes as a single argument:

```rill
|t| { $t } => $passthrough
tuple[1, 2, 3] -> $passthrough()
# Result: tuple[1, 2, 3]
```

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
11. Capture: `=>`

Use parentheses to override precedence:

```rill
(2 + 3) * 4                      # 20
5 -> ($ > 3) ? "big" ! "small"   # "big"
```

---

## Operator-Level Annotations

The `^(limit: N)` form is **not part of the current parser surface**. The parser emits RILL-R081 (migration error) for any occurrence of `^(limit:` in expression position. The examples below show the rejected syntax for reference only.

**Rejected syntax (RILL-R081):**

```text
# Error: RILL-R081 — Migration error: use `do<limit: N> { body }` at 1:N
[1, 2, 3] -> seq(^(limit: 1000) { $ * 2 })
```

```text
# Error: RILL-R081 — Migration error: use `do<limit: N> { body }` at 1:N
[1, 2, 3] -> fan(^(limit: 10) { $ + 1 })
```

```text
# Error: RILL-R081 — Migration error: use `do<limit: N> { body }` at 1:N
[1, 2, 3, 4] -> filter(^(limit: 50) { $ > 2 })
```

```text
# Error: RILL-R081 — Migration error: use `do<limit: N> { body }` at 1:N
[1, 2, 3] -> fold(0, ^(limit: 20) |x|($@ + $x))
```

Iteration limits are controlled via the `do<limit: N>` loop construct, not via operator-level annotation. See [Control Flow](topic-control-flow.md) for `do<limit: N>` syntax.

---

## See Also

- [Types](topic-types.md): Type system and assertions
- [Variables](topic-variables.md): Capture and scope
- [Control Flow](topic-control-flow.md): Conditionals and loops
- [Collections](topic-collections.md): Collection operators
- [Reference](ref-language.md): Quick reference tables
