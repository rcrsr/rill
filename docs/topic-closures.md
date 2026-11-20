# rill Functions and Code Blocks

*Code blocks run where they are written, collection entries hold them, and `fn` makes the function values*

## Code Blocks

A braced body `{ body }` is a code block when nothing in front of it makes it a function. A code block runs where it is written and is never a value.

```rill
5 -> { $ + 1 }
# Result: 6
```

| Position | Behavior |
|----------|----------|
| Pipe target | Runs once with the piped value as `$` |
| Head of a chain or a statement | Runs once with the enclosing `$` |
| Alone in parentheses | Runs as a head block does |
| Construct body (`? !`, `while`, `do`, `guard`, `retry`, `timeout`, `pass`) | Runs as the construct directs |
| Entry of a collection literal | Held uncalled |
| Whole argument | Becomes a function |

### Head, Statement, and Paren Blocks

A head block binds its result. `{ 5 } => $x` binds 5, not a function.

```rill
{
  5
} => $x
$x
# Result: 5
```

```rill
(
  { 2 * 3 }
) => $six
$six
# Result: 6
```

A head block reads the enclosing `$`:

```rill
7 -> {
  {
    $ + 1
  } => $y
  $y
}
# Result: 8
```

To store a function, put `fn` in front of the block, then call it:

```rill
fn { 5 } => $f
$f()
# Result: 5
```

### `$` Inside a Code Block

A code block has no parameters. `$` and `$@` resolve lexically to the bindings around it. Reading either where nothing binds it halts RILL-R005.

```text
{
  $ + 1
} => $x
# Error: RILL-R005: undefined variable '$'
```

### Delimiters

| Expression | Mechanism | Result |
|------------|-----------|--------|
| `5 -> { $ + 1 }` | Run the block with `$` = 5 | 6 |
| `5 -> ($ + 1)` | Evaluate with `$` = 5 | 6 |
| `{ 5 } => $x` | Run the block, bind the result | 5 |
| `fn { 5 } => $f` | Bind a function | function |

`( )` groups and evaluates. A pipe target block runs at once, with the piped value as `$`.

---

## Block Assertions

`:T` after a block's closing brace asserts the block's result. `:?T` yields whether the result has type `T`. The assertion covers the whole block, so it runs before the next pipe step reads the value.

```rill
3 -> { $ + 1 }:number -> { $ * 2 }
# Result: 8
```

```rill
3 -> { $ + 1 }:?string
# Result: false
```

A conditional branch accepts the assertion and asserts the branch that runs:

```rill
true ? { 5 }:number ! { 6 }
# Result: 5
```

A failed assertion halts with `#TYPE_MISMATCH`:

```text
3 -> { "text" }:number
# Error: #TYPE_MISMATCH: Type assertion failed: expected number, got string
```

A selected held entry asserts on every run, so `dict[a: { 5 }:number]` checks the result each time `a` is selected. The parser reads `:T` and `:?T` after a block on conditional branches, pipe targets, head blocks, parenthesized blocks, and held entries. Loop, `guard`, `retry`, `pass`, and `timeout` bodies do not take it.

---

## Function Syntax

```text
# Bare function literal (unnamed parameters for each of $ and $@ the body reads)
fn { body }

# Zero-parameter function (no parameters)
fn() { body }

# Unnamed parameters (bind $ and $@, at most two)
fn(type) { body }
fn(type):returnType { body }    # with return type annotation
fn(type, type) { body }         # second parameter binds $@

# Named parameters
fn(x) { body }
fn(x, y) { body }                   # multiple parameters
fn(x: string) { body }              # typed parameter
fn(x = 10) { body }                 # default value (parameter type is any)
fn(x: number = 10) { body }         # default with explicit type
fn(x: list(string)) { body }        # parameterized typed parameter
fn(x: dict(a: number)) { body }     # dict-typed parameter

# Stream function (yields chunks, returns resolution value)
fn():stream(T):R { body }           # chunk type T, resolution type R
```

A function literal is `fn`, an optional parameter list, an optional `:outer` type, and a block on the same line. `fn { body }` takes the unnamed parameters the body reads: none for a body that reads neither `$` nor `$@`, one for `$`, two for `$@`.

The pipe-delimited function literal and the removed `closure` type name are rejected with RILL-P012, which names the `fn` form.

---

## Unnamed Parameters

An unnamed parameter is a type with no name: `fn(string)`. The function type-checks the piped input against that type and binds it to `$`. A second unnamed parameter binds `$@`. A function takes at most two unnamed parameters, never mixes them with named ones, and never gives one a default. Each violation raises RILL-P028.

### Basic Syntax

```rill
"hello" -> fn(string) { $ -> .upper }
# Result: "HELLO"
```

```rill
5 -> fn(number) { $ * 2 }
# Result: 10
```

The type before `{` is the input type, not a parameter name. The runtime rejects values that do not match.

### Return Type Annotation

Append `:type` after the parameter list to declare and enforce the return type. A mismatch halts with `#TYPE_MISMATCH`.

```rill
fn(number):number { $ * 2 } => $double
$double(5)
# Result: 10
```

When the body result does not match the declared return type, execution halts with a type assertion error. Use a `text` fence to illustrate the error case:

```text
# Return type mismatch halts
5 -> fn(number):number { "hello" }
# Error: #TYPE_MISMATCH: Type assertion failed: expected number, got string
```

### Pipe Chain Example

Unnamed-parameter functions compose in pipe chains:

```rill
"hello" -> fn(string) { $ -> .upper } -> fn(string) { $ -> .lower }
# Result: "hello"
```

### Parameterized Types

The `list`, `dict`, `tuple`, and `ordered` types accept type arguments for deep structural validation:

```rill
[1, 2, 3] -> fn(list(number)) { $ -> seq({ $ * 2 }) }
# Result: list[2, 4, 6]
```

```text
# Type mismatch with a parameterized unnamed parameter
["a", "b"] -> fn(list(number)) { $ }
# Error: Parameter type mismatch: $ expects list(number), got list
```

### `$` Binding Rules

| Form | `$` in body | Behavior on violation |
|------|-------------|----------------------|
| `fn { body }` (bare literal) | Piped input, type `any` | N/A: no type check |
| `fn(type) { body }` (unnamed) | Piped input, type-checked | Type mismatch halt |
| `fn(x: type) { body }` (named) | Hard error | RILL-R005 |
| `fn() { body }` (zero-param) | Rejected where written | RILL-P029 |

Accessing `$` inside a named-param function is a hard error (RILL-R005) because that form defines no pipe binding.

### Input Type Mismatch

When the piped value does not match the declared type, execution halts:

```text
# Input type mismatch halts
"hello" -> fn(number) { $ * 2 }
# Error: Parameter type mismatch: $ expects number, got string
```

### Zero-Param `$` Error

A `fn()` body that reads `$` or `$@` raises RILL-P029 where the function is written. `fn()` declares no parameters, so the body has nothing to bind. Declare an unnamed parameter, a named parameter, or use `fn { body }`:

```text
# fn() declares no params, so its body cannot read '$'
fn() { $ } => $f
# Error: RILL-P029: fn() declares no params, so its body cannot read '$' or '$@'
```

```rill
fn(any) { $ } => $f
$f(7)
# Result: 7
```

---

## Reflecting Parameters and Return Type

`$fn.^type` returns the function's type, printed in the complete form. Its `.inner` holds the parameters: an `ordered` of types for named parameters, a `tuple` of types for unnamed ones, and `ordered[]` for `fn()`. Its `.outer` holds the declared return type.

| Receiver Kind | `.^type.inner` |
|---|---|
| `fn { 5 }` | `ordered[]` |
| `fn { $ * 2 }` | `tuple[any]` |
| `fn { $@ + $ }` | `tuple[any, any]` |
| Unnamed `fn(string) { ... }` | `tuple[string]` |
| Two unnamed `fn(number, number) { ... }` | `tuple[number, number]` |
| Named `fn(x: string) { ... }` | `ordered[x: string]` |
| Named with default `fn(a: string, b: string = "hi") { ... }` | `ordered[a: string, b: string]` |
| Zero-param `fn() { ... }` | `ordered[]` |
| Non-callable value, such as `1` | Raises RILL-R003 |

```rill
fn(string) { $ } => $fn
$fn.^type.inner
# Result: tuple[string]
```

```rill
fn(list(string)) { $ } => $fn
$fn.^type.inner
# Result: tuple[list(string)]
```

```rill
fn { $ * 2 } => $fn
$fn.^type.inner
# Result: tuple[any]
```

```rill
fn(x: string) { $x } => $fn
$fn.^type.inner
# Result: ordered[x: string]
```

Defaults sit under `.defaults`, which lists only the parameters that have one:

```rill
fn(a: string, b: string = "hi") { $a } => $fn
$fn.^type.defaults
# Result: dict[b: "hi"]
```

Parameter annotations sit under `.annotations`, which lists only the parameters that have any:

```rill
fn(^(min: 0) x: number, y: string) { $x } => $fn
$fn.^type.annotations
# Result: dict[x: dict[min: 0]]
```

A default does not infer the parameter type. `fn(x = "d")` gives `x` the type `any`; write `fn(x: string = "d")` to constrain it. A function type equals another only when parameter names, types, defaults, and outer type all match, so a function with an extra defaulted parameter does not match a type that omits it.

`.outer` returns the declared return type. An unannotated function returns `any`:

```rill
fn(number):number { $ * 2 } => $fn
$fn.^type.outer == number
# Result: true
```

```rill
fn { $ } => $fn
$fn.^type.outer
# Result: any
```

---

## Blocks as Arguments

A block that is a whole argument converts to a function. The function takes the unnamed parameters the body reads.

| Body reads | Function type |
|------------|---------------|
| Neither `$` nor `$@` | `fn():any` |
| `$` only | `fn(any):any` |
| `$@`, with or without `$` | `fn(any, any):any` |

```rill
[1, 2, 3] -> seq({ $ * 2 })
# Result: list[2, 4, 6]
```

```rill
[1, 2, 3] -> fold(0, { $@ + $ })
# Result: 6
```

An assertion on an argument block sets the function's outer, and each call asserts its result:

```rill
[1, 2] -> seq({ $ + 1 }:number)
# Result: list[2, 3]
```

A check on an argument block makes a function that returns `bool`:

```rill
list[1, "a"] -> seq({ $ }:?number)
# Result: list[true, false]
```

Operators take exact arity. `seq`, `fan`, `filter`, and `sort` call their function with one argument. `fold` and `acc` call it with the element and the accumulator.

```text
[1, 2] -> seq({ 5 })
# Error: RILL-R045: function takes no argument

[1, 2] -> seq({ $@ })
# Error: RILL-R044: function requires a second argument
```

`seq`, `fan`, `filter`, `sort`, `start_when`, `stop_when`, `iterate`, and `chain` pass one argument. A `fold` or `acc` function with fewer than two parameters halts RILL-R045, and one with a third required parameter halts RILL-R044. For the operators themselves, see [Collections](topic-collections.md).

A closure annotation on an argument block attaches to the function it becomes. On a head block it is ignored. An annotation on a held entry attaches to the held block. See [Closure Annotations](topic-closure-annotations.md).

---

## Held Entries

A code block written as a list element, tuple element, dict value, or ordered value is held uncalled. It does not convert to a function.

Selecting the entry runs the block. Each selection runs it again.

### Dispatch

`sel -> $c` runs a held block with `$` bound to the selector:

```rill
"a" -> dict[a: { "got {$}" }]
# Result: "got a"
```

```rill
0 -> list[{ $ + 10 }]
# Result: 10
```

A path step in a hierarchical dispatch that selects a held block runs it with the step key as `$`:

```rill
list["a", "x"] -> dict[a: { dict[x: 1] }]
# Result: 1
```

### Access

`$c.name`, `$c.$k`, `$c[sel]`, `.at(i)`, and a `destruct<>` position each select one entry, so they run a held block with the enclosing `$`. `$@` inside a held block is lexical, so it reads the enclosing accumulator:

```rill
5 -> {
  dict[a: { $ + 1 }] => $d
  $d.a
}
# Result: 6
```

```rill
[1, 2, 3] -> fold(0, {
  dict[a: { $@ + $ }] => $d
  $d.a
})
# Result: 6
```

Written as a pipe target, access binds the piped value as `$`:

```rill
dict[n: 2, double: { $.n * 2 }] => $d
$d -> $d.double
# Result: 4
```

### Reads That Do Not Select

A read that does not select one entry halts `#TYPE_MISMATCH` naming the entry when it reaches a held block, so a held block never escapes as a value. These reads are iteration, `.values`, `.entries`, `.first`, `.head`, `.tail`, `.reverse`, `.join`, `.has`, `.has_any`, `.has_all`, spread, `slice<>`, `take`, `skip`, `chain`, equality, interpolation, conversion (`-> list(any)`, `-> string`), and `log`. `enumerate` reads entries too, so a list or dict that holds a block halts `#TYPE_MISMATCH` there. `.keys` and `.len` do not read entries. `.^type` and a type lock see the entry as `fn()`, even for `{ 1 }:number`, and a host receives a returned entry as the signature `fn():any` without running it. Passing a collection that holds a block to a host function halts `#TYPE_MISMATCH` naming the entry.

```rill
guard { list[{ 5 }] -> seq({ $ }) } => $r
$r.!code
# Result: #TYPE_MISMATCH
```

### Function Entries

A function written with `fn` is a value. Selecting it returns it uncalled; call the result with parentheses. `$c.name(args)` selects the entry, then calls it.

```rill
dict[inc: fn(n) { $n + 1 }] => $d
$d.inc(4)
# Result: 5
```

`x.name` without parentheses is a selection and does not call.

A function read from a dict does not see the dict as `$`. Pass the dict as an argument:

```rill
dict[n: 2, twice: fn(d) { $d.n * 2 }] => $d
$d.twice($d)
# Result: 4
```

A function with named parameters cannot read a bare `$`; the parser rejects it with RILL-P029.

---

## Stream Functions

A stream function emits a sequence of chunks and then resolves with a final value. Declare a stream function by appending `:stream(T):R` as the return type annotation, where `T` is the chunk type and `R` is the resolution type.

### Annotation Syntax

```text
# Stream function: emits string chunks, resolves to number
fn(string):stream(string):number { body }

# Unconstrained chunk and resolution types
fn():stream() { body }
```

The annotation `:stream(T):R` on a function body changes invocation semantics. Calling the function returns a stream value, not the body result directly.

### `yield` and `return`

Inside a stream function body, two keywords control output:

| Keyword | Effect |
|---------|--------|
| `yield` | Emits the current pipe value as a chunk |
| `return` | Sets the stream's resolution value and closes the stream |

```text
# Stream function emitting three string chunks and resolving with a count
fn():stream(string):number {
  "first" -> yield
  "second" -> yield
  "third" -> yield
  return 3
} => $producer

$producer() => $s       # calling the function returns a stream
$s -> seq({ $ })        # ["first", "second", "third"]
$s()                    # 3 (resolution value)
```

`yield` is the inverse of `$@` (the fold accumulator). `$@` consumes values from outside into a function; `yield` produces values outward from a function body.

### `yield` Scoping Rules

`yield` is lexically scoped to the stream function body. It is valid inside inline blocks and collection operators within that body. It is not valid inside a stored function defined within the stream body.

```text
# Valid: yield inside inline collection operator block
fn():stream(number):number {
  [1, 2, 3] -> seq({ $ -> yield })
  return 3
}

# Invalid: yield inside a stored function
fn():stream(number):number {
  fn { $ -> yield } => $fn   # Error: yield not valid in stored function
  $fn(1)
}
```

### Calling a Stream Function

Calling a stream function returns a stream value, not the body result. The stream then accepts collection operators and the resolution call.

```text
$producer() => $s       # $s is a stream, not the body's return value
$s -> fan({ $ })         # consume chunks with map
$s()                    # get resolution value after stream closes
```

### `yield` as Inverse of `$@`

`$@` pulls a value inward (the fold accumulator). `yield` pushes a value outward (emitting a chunk). This symmetry makes stream functions composable with fold:

```text
# fold accumulates inward with $@
[1, 2, 3] -> fold(0, { $@ + $ })    # 6

# stream function emits outward with yield
fn():stream(number):number {
  1 -> yield
  2 -> yield
  3 -> yield
  return 0
}
```

For stream type signatures and chunk semantics, see [Types](topic-types.md). For how collection operators consume streams, see [Collections](topic-collections.md).

---

## Dict-Stored Functions

A function stored in a dict does not receive the dict automatically. Selecting it returns it uncalled. A function that needs its dict declares a parameter for it, and the caller passes the dict.

### Calling Stored Functions

```rill
dict[
  name: "toolkit",
  label: fn() { "toolkit" }
] => $obj

$obj.label()
# Result: "toolkit"
```

### Reading Sibling Fields

Declare a parameter for the dict and pipe the dict in:

```rill
dict[
  name: "toolkit",
  count: 3,
  summary: fn(d) { "{$d.name}: {$d.count} items" }
] => $obj

$obj -> $obj.summary
# Result: "toolkit: 3 items"
```

```rill
dict[
  width: 10,
  height: 5,
  area: fn(d) { $d.width * $d.height }
] => $rect

$rect -> $rect.area
# Result: 50
```

### Parameterized Dict Functions

Add further parameters after the dict parameter:

```rill
dict[
  name: "tools",
  greet: fn(d, x) { "{$d.name} says: {$x}" }
] => $obj

$obj.greet($obj, "hello")
# Result: "tools says: hello"
```

### Reusable Functions Across Dicts

One function serves every dict that has the fields it reads:

```rill
fn(d) { "{$d.name}: {$d.count} items" } => $describer

dict[name: "tools", count: 3, str: $describer] => $obj1
dict[name: "actions", count: 5, str: $describer] => $obj2

tuple[$obj1 -> $obj1.str, $obj2 -> $obj2.str]
# Result: tuple["tools: 3 items", "actions: 5 items"]
```

### Calling Sibling Functions

Pass the dict along to reach sibling functions:

```rill
dict[
  double: fn(n) { $n * 2 },
  quad: fn(d, n) { $d.double($d.double($n)) }
] => $math

$math.quad($math, 3)
# Result: 12
```

---

## List-Stored Functions

Functions in lists keep their defining scope. Select by index, then call:

```rill
list[
  fn(x) { $x + 1 },
  fn(x) { $x * 2 },
  fn(x) { $x * $x }
] => $transforms

list[$transforms[0](5), $transforms[1](5), $transforms[2](5)]
# Result: list[6, 10, 25]
```

### Chaining List Functions

```rill
fn(n) { $n + 1 } => $inc
fn(n) { $n * 2 } => $double

5 -> chain([$inc, $double, $inc])
# Result: 13
```

---

## Inline Functions

Functions can appear inline in expressions. A named-parameter function in `fold` receives the element, then the accumulator:

```rill
[1, 2, 3] -> fan(fn(x) { $x * 2 })
# Result: list[2, 4, 6]
```

```rill
[1, 2, 3] -> filter(fn(x) { $x > 1 })
# Result: list[2, 3]
```

```rill
[1, 2, 3] -> fold(0, fn(x, a) { $a + $x })
# Result: 6
```

### Inline with Block Bodies

```rill
[1, 2, 3] -> fan(fn(x) {
  ($x * 10) => $scaled
  "{$x} -> {$scaled}"
})
# Result: list["1 -> 10", "2 -> 20", "3 -> 30"]
```

---

## Late Binding

Functions resolve captured variables at **call time**, not definition time. This enables recursive patterns and forward references.

### Basic Example

```rill
10 => $x
fn() { $x + 5 } => $fn
20 => $x
$fn()    # 25 (sees current $x=20, not $x=10 at definition)
```

### Recursive Functions

```rill
fn(n) { ($n < 1) ? 1 ! ($n * $factorial($n - 1)) } => $factorial
$factorial(5)    # 120
```

The function references `$factorial` before it exists. Late binding resolves `$factorial` when the function executes.

Recursion is bounded. A chain of nested function calls deeper than `maxCallDepth` (default 1000) halts with `RILL-R010`. Inside `fan`, `filter`, and `sort`, each concurrent body counts depth from the call that started it. Separately, calls in flight at once across all concurrent bodies are capped at `maxCallDepth` + 10,000 (11,000 by default). Recursion that fans out at each level halts there with `Calls in flight exceeded 11000` instead of exhausting host memory. Both halts are fatal. To run a wider body that itself calls functions or host functions, pass `concurrency`.

### Mutual Recursion

```rill
fn(n) { ($n == 0) ? true ! $odd($n - 1) } => $even
fn(n) { ($n == 0) ? false ! $even($n - 1) } => $odd
$even(4)    # true
```

### Forward References

```rill
[
  fn() { $helper(1) },
  fn() { $helper(2) }
] => $handlers

fn(n) { $n * 10 } => $helper    # defined after the functions

$handlers[0]()    # 10
$handlers[1]()    # 20
```

### Variable Mutation Visibility

Functions see the current value of captured variables:

```rill
0 => $counter
fn() { $counter } => $get
fn() { $counter + 1 } => $getPlus1

5 => $counter

[$get(), $getPlus1()]    # list[5, 6]
```

---

## Nested Functions

Functions can contain functions. Each captures its defining scope:

```rill
fn(n) { fn() { $n } } => $makeGetter
$makeGetter(42)()    # 42
```

### Function Factory Pattern

```rill
fn(multiplier) {
  fn(x) { $x * $multiplier }
} => $makeMultiplier

$makeMultiplier(3) => $triple
$makeMultiplier(10) => $tenX

$triple(5)    # 15
$tenX(5)      # 50
```

### Nested Late Binding

```rill
1 => $x
fn() { fn() { $x } } => $outer
5 => $x
$outer()()    # 5 (inner function sees updated $x)
```

---

## Parameter Shadowing

Function parameters shadow captured variables of the same name:

```rill
100 => $x
fn(x) { $x * 2 } => $double
$double(5)
# Result: 10
```

---

## Scope Isolation

### Loop Functions

Each loop iteration creates a new child scope. Capture variables explicitly to preserve per-iteration values:

```rill
[1, 2, 3] -> seq({
  $ => $item
  fn() { $item }
}) => $fns

list[$fns[0](), $fns[1](), $fns[2]()]
# Result: list[1, 2, 3]
```

`$` is a context property, not a variable. Capture it into a named variable for a function to read.

### Conditional Branch Functions

```rill
10 => $x
true ? { fn() { $x } } ! { fn() { 0 } } => $fn
20 => $x
$fn()
# Result: 20
```

---

## Invocation Patterns

### Direct Call

```rill
fn(x) { $x + 1 } => $inc
$inc(5)
# Result: 6
```

### Pipe Call

```rill
fn { $ + 1 } => $inc
5 -> $inc
# Result: 6
```

A function with an unnamed parameter reads the piped value as `$`. A named-parameter function takes the pipe as its first argument with `5 -> $inc()`.

### Postfix Invocation

Call functions from index selection or expressions:

```rill
list[fn(x) { $x * 2 }] => $fns
$fns[0](5)
# Result: 10
```

```rill
fn() { fn(n) { $n * 2 } } => $factory
$factory()(5)
# Result: 10
```

### Method Access After Bracket (Requires Grouping)

```rill
list["hello", "world"] => $words
($words[0]).upper
# Result: "HELLO"
```

```rill
list["hello", "world"] => $words
$words[0] -> .upper
# Result: "HELLO"
```

`$list[0].upper` parses `.upper` as field access on the element, not as a method call.

---

## Error Behavior

### Non-Producing Body (RILL-R043)

A function body must produce a value. Invoking a function with an empty body (or a body containing only comments) raises RILL-R043 at invocation time:

```text
fn(x: number) { } => $fn
$fn(5)
# Error: RILL-R043: Function body produced no value
```

A script with no statements (only comments) also raises RILL-R043 at execution time:

```text
# only a comment — no expression produces a value
# Error: RILL-R043: Script body produced no value
```

### Undefined Variables

Undefined variables throw an error at call time (rill has no null):

```text
fn() { $undefined } => $fn
$fn()    # Error: Undefined variable: $undefined
```

### Invoking Non-Callable

```text
list[1, 2, 3] => $list
$list[0]()    # Error: Cannot invoke non-callable value (got number)
```

### Type Errors

```text
fn(x: string) { $x } => $fn
$fn(42)    # Error: Parameter type mismatch: x expects string, got number
```

---

## Scope Chain and Cost

A function stores a reference to its defining scope. At invocation:

1. A child context is created with the defining scope as parent.
2. Parameters are bound in the child context.
3. Variable lookups traverse local, defining scope, then parent chain.

Scopes form a tree with no circular references, and they stay live while a function references them. Lookup traverses the chain at each access with no caching, which keeps mutation visible.

---

## See Also

| Document | Description |
|----------|-------------|
| [Closure Annotations](topic-closure-annotations.md) | Parameter metadata, annotations, and reflection |
| [Reference](ref-language.md) | Language specification |
| [Collections](topic-collections.md) | `seq`, `fan`, `filter`, `fold`, `acc` with function arguments |
| [Guide](guide-getting-started.md) | Getting started tutorial |
