# rill Closures

*First-class values that capture their defining scope with late binding and dict integration*

## Expression Delimiters

rill has two expression delimiters with deterministic behavior:

| Delimiter | Semantics | Produces |
|-----------|-----------|----------|
| `{ body }` | Deferred (closure creation) | `ScriptCallable` |
| `( expr )` | Eager (immediate evaluation) | Result value |

**Key distinction:**
- **Parentheses `( )`** evaluate immediately and return the result
- **Braces `{ }`** create a closure for later invocation (deferred execution)

### Pipe Target Exception

When `{ }` appears as a pipe target, it creates a closure and **immediately invokes** it:

```rill
5 -> { $ + 1 }    # 6 (same observable result as eager evaluation)
```

This is conceptually two steps happening in sequence:

```text
5 -> { $ + 1 }
     ↓
Step 1: Create closure with implicit $ parameter
Step 2: Invoke closure with piped value (5) as argument
     ↓
Result: 6
```

The observable result matches eager evaluation, but the mechanism differs. This matters when understanding error messages or debugging—the closure exists momentarily before invocation.

**Comparison:**

| Expression | Mechanism | Result |
|------------|-----------|--------|
| `5 -> { $ + 1 }` | Create closure, invoke with 5 | 6 |
| `5 -> ($ + 1)` | Evaluate expression with $ = 5 | 6 |
| `{ $ + 1 } => $fn` | Create closure, store it | closure |
| `($ + 1) => $x` | Error: $ undefined outside pipe | — |

The last row shows the key difference: `( )` requires `$` to already be defined, while `{ }` captures `$` as a parameter for later binding.

---

## Function Syntax

```text
# Bare block (implicit $ parameter when the body reads $)
{ body }

# Zero-parameter function (no parameters, auto-invokes on dict access)
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

The pipe-delimited function literal and the `closure` type name are rejected with RILL-P012, which names the `fn` form.

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

### Bare Blocks as Pipe Targets

A bare block `{ body }` as a pipe target is a code block: it runs at once with the pipe value as `$`. It has no parameters and is never a function value. These two pipes yield the same result, but only the second pipes into a function:

```rill
5 -> { $ * 2 }
# Result: 10
```

```rill
5 -> fn(any):any { $ * 2 }
# Result: 10
```

### `$` Binding Rules

| Form | `$` in body | Behavior on violation |
|------|-------------|----------------------|
| `{ body }` (bare block) | Piped input, type `any` | N/A: no type check |
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
| Bare block `{ $ * 2 }` | `tuple[any]` |
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
{ $ * 2 } => $fn
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

A default does not infer the parameter type. `fn(x = "d")` gives `x` the type `any`; write `fn(x: string = "d")` to constrain it. A function type equals another only when parameter names, types, defaults, and outer type all match, so a function with an extra defaulted parameter does not match a type that omits it.

`.outer` returns the declared return type. An unannotated function returns `any`:

```rill
fn(number):number { $ * 2 } => $fn
$fn.^type.outer == number
# Result: true
```

```rill
{ $ } => $fn
$fn.^type.outer
# Result: any
```

---

## Block-Closures

Block syntax `{ body }` creates a closure with an implicit `$` parameter. This enables deferred execution and reusable transformations.

### Basic Block-Closure

```rill
{ $ + 1 } => $increment

5 -> $increment       # 6
10 -> $increment      # 11
$increment(7)         # 8 (direct call also works)
```

The block `{ $ + 1 }` produces a closure. When invoked, `$` is bound to the argument.

### Block-Closures vs Zero-Param Closures

| Form | Params | `isProperty` | Behavior |
|------|--------|-------------|----------|
| `{ body }` (block-closure) | `[{ name: "$" }]` | `false` | Requires argument |
| `fn() { body }` (zero-param) | `[]` | `true` | Auto-invokes on dict access |

```rill
{ $ * 2 } => $double
fn() { 42 } => $constant

5 -> $double          # 10 (requires argument)
$constant()           # 42 (no argument needed)

# In dicts
[
  double: { $ * 2 },
  constant: fn() { 42 }
] => $obj

$obj.double(5)        # 10 (explicit call required)
$obj.constant         # 42 (auto-invoked on access)
```

Piping a value into a zero-parameter closure halts RILL-R045; call it with `$constant()`.

### Type Checking

Block-closures check type at runtime:

```rill
{ $ + 1 } => $fn

$fn.^type.name == "fn"  # true
$fn(5)                # 6
$fn("text")           # Error: RILL-R002 Arithmetic requires number, got string
```

### Multi-Statement Block-Closures

Block-closures can contain multiple statements:

```rill
{
  ($ * 2) => $doubled
  "{$}: doubled is {$doubled}"
} => $describe

5 -> $describe        # "5: doubled is 10"
```

### Collection Operations

Block-closures integrate with collection operators:

```rill
[1, 2, 3] -> fan({ $ * 2 })                    # list[2, 4, 6]
[1, 2, 3] -> filter({ $ > 1 })                 # list[2, 3]
[1, 2, 3] -> fold(0, { $@ + $ })               # 6 ($@ is accumulator)
```

### Eager vs Deferred Evaluation

The choice between `( )` and `{ }` determines when code executes:

```rill
# Eager: parentheses evaluate immediately
5 -> ($ + 1) => $result
$result                # 6 (number, already computed)

# Deferred: braces create closure
{ $ + 1 } => $addOne
$addOne.^type.name == "fn"  # true

# Practical difference
(5 + 1) => $six        # 6 (immediate)
{ $ + 1 } => $fn       # closure (deferred)

$six                   # 6
10 -> $fn              # 11

# Same closure, reused with different inputs
5 -> $addOne           # 6
10 -> $addOne          # 11
```

Use `( )` when you want the result now. Use `{ }` when you want reusable logic.

---

## Stream Closures

A stream closure emits a sequence of chunks and then resolves with a final value. Declare a stream closure by appending `:stream(T):R` as the return type annotation, where `T` is the chunk type and `R` is the resolution type.

### Annotation Syntax

```text
# Stream function: emits string chunks, resolves to number
fn(string):stream(string):number { body }

# Unconstrained chunk and resolution types
fn():stream() { body }
```

The annotation `:stream(T):R` on a closure body changes invocation semantics. Calling the closure returns a stream value, not the body result directly.

### `yield` and `return`

Inside a stream closure body, two keywords control output:

| Keyword | Effect |
|---------|--------|
| `yield` | Emits the current pipe value as a chunk |
| `return` | Sets the stream's resolution value and closes the stream |

```text
# Stream closure emitting three string chunks and resolving with a count
fn():stream(string):number {
  "first" -> yield
  "second" -> yield
  "third" -> yield
  return 3
} => $producer

$producer() => $s       # calling the closure returns a stream
$s -> seq({ $ })        # ["first", "second", "third"]
$s()                    # 3 (resolution value)
```

`yield` is the inverse of `$@` (the fold accumulator). `$@` consumes values from outside into a closure; `yield` produces values outward from a closure body.

### `yield` Scoping Rules

`yield` is lexically scoped to the stream closure body. It is valid inside inline blocks and collection operators within that body. It is not valid inside a stored closure defined within the stream body.

```text
# Valid: yield inside inline collection operator block
fn():stream(number):number {
  [1, 2, 3] -> seq({ $ -> yield })
  return 3
}

# Invalid: yield inside a stored closure
fn():stream(number):number {
  { $ -> yield } => $fn   # Error: yield not valid in stored closure
  $fn(1)
}
```

### Calling a Stream Closure

Calling a stream closure returns a stream value, not the body result. The stream then accepts collection operators and the resolution call.

```text
$producer() => $s       # $s is a stream, not the body's return value
$s -> fan({ $ })         # consume chunks with map
$s()                    # get resolution value after stream closes
```

### `yield` as Inverse of `$@`

`$@` pulls a value inward (the fold accumulator). `yield` pushes a value outward (emitting a chunk). This symmetry makes stream closures composable with fold:

```text
# fold accumulates inward with $@
[1, 2, 3] -> fold(0, { $@ + $ })    # 6

# stream closure emits outward with yield
fn():stream(number):number {
  1 -> yield
  2 -> yield
  3 -> yield
  return 0
}
```

For stream type signatures and chunk semantics, see [Types](topic-types.md). For how collection operators consume streams, see [Collections](topic-collections.md).

---

## Late Binding

Closures resolve captured variables at **call time**, not definition time. This enables recursive patterns and forward references.

### Basic Example

```rill
10 => $x
fn() { $x + 5 } => $fn
20 => $x
$fn()    # 25 (sees current $x=20, not $x=10 at definition)
```

### Recursive Closures

```rill
fn(n) { ($n < 1) ? 1 ! ($n * $factorial($n - 1)) } => $factorial
$factorial(5)    # 120
```

The closure references `$factorial` before it exists. Late binding resolves `$factorial` when the closure executes.

Recursion is bounded. A chain of nested closure calls deeper than `maxCallDepth` (default 1000) halts with `RILL-R010`. Inside `fan`, `filter`, and `sort`, each concurrent body counts depth from the call that started it. Separately, calls in flight at once across all concurrent bodies are capped at `maxCallDepth` + 10,000 (11,000 by default). Recursion that fans out at each level halts there with `Calls in flight exceeded 11000` instead of exhausting host memory. Both halts are fatal. To run a wider body that itself calls closures or host functions, pass `concurrency`.

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

fn(n) { $n * 10 } => $helper    # defined after closures

$handlers[0]()    # 10
$handlers[1]()    # 20
```

### Variable Mutation Visibility

Closures see the current value of captured variables:

```rill
0 => $counter
fn() { $counter } => $get
fn() { $counter + 1 } => $getPlus1

5 => $counter

[$get(), $getPlus1()]    # list[5, 6]
```

---

## Dict-Stored Functions

A function stored in a dict does not receive the dict automatically. A function that needs its dict declares a parameter for it, and the caller pipes the dict in.

### Zero-Arg Functions Auto-Invoke

A `fn()` stored in a dict runs on field access:

```rill
[
  name: "toolkit",
  count: 3,
  label: fn() { "toolkit" }
] => $obj

$obj.label
# Result: "toolkit"
```

### Reading Sibling Fields

Declare a parameter for the dict and pipe the dict in:

```rill
[
  name: "toolkit",
  count: 3,
  summary: fn(d) { "{$d.name}: {$d.count} items" }
] => $obj

$obj -> $obj.summary
# Result: "toolkit: 3 items"
```

```rill
[
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
[
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

[name: "tools", count: 3, str: $describer] => $obj1
[name: "actions", count: 5, str: $describer] => $obj2

tuple[$obj1 -> $obj1.str, $obj2 -> $obj2.str]
# Result: tuple["tools: 3 items", "actions: 5 items"]
```

### Calling Sibling Functions

Pass the dict along to reach sibling functions:

```rill
[
  double: fn(n) { $n * 2 },
  quad: fn(d, n) { $d.double($d.double($n)) }
] => $math

$math.quad($math, 3)
# Result: 12
```

---

## List-Stored Closures

Closures in lists maintain their defining scope. Invoke via bracket access:

```rill
[
  fn(x) { $x + 1 },
  fn(x) { $x * 2 },
  fn(x) { $x * $x }
] => $transforms

$transforms[0](5)    # 6
$transforms[1](5)    # 10
$transforms[2](5)    # 25
```

### Chaining List Closures

```rill
fn(n) { $n + 1 } => $inc
fn(n) { $n * 2 } => $double

5 -> chain([$inc, $double, $inc])    # 13: (5+1)*2+1
```

---

## Inline Closures

Closures can appear inline in expressions:

```rill
[1, 2, 3] -> fan(fn(x) { $x * 2 })    # list[2, 4, 6]

[1, 2, 3] -> filter(fn(x) { $x > 1 })    # list[2, 3]

[1, 2, 3] -> fold(0, fn(x) { $@ + $x })    # 6
```

### Inline with Block Bodies

```rill
[1, 2, 3] -> fan(fn(x) {
  ($x * 10) => $scaled
  "{$x} -> {$scaled}"
})
# ["1 -> 10", "2 -> 20", "3 -> 30"]
```

---

## Nested Closures

Closures can contain closures. Each captures its defining scope:

```rill
fn(n) { fn() { $n } } => $makeGetter
$makeGetter(42)()    # 42
```

### Closure Factory Pattern

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
$outer()()    # 5 (inner closure sees updated $x)
```

---

## Parameter Shadowing

Closure parameters shadow captured variables of the same name:

```rill
100 => $x
fn(x) { $x * 2 } => $double
$double(5)    # 10 (parameter $x=5 shadows captured $x=100)
```

---

## Scope Isolation

### Loop Closures

Each loop iteration creates a new child scope. Capture variables explicitly to preserve per-iteration values:

```rill
# Capture $ into named variable for each iteration
[1, 2, 3] -> seq({
  $ => $item
  fn() { $item }
}) => $closures

[$closures[0](), $closures[1](), $closures[2]()]    # list[1, 2, 3]
```

**Note:** `$` (pipeValue) is a context property, not a variable. Use explicit capture for closure access.

### Conditional Branch Closures

```rill
10 => $x
true ? { fn() { $x } } ! { fn() { 0 } } => $fn
20 => $x
$fn()    # 20 (late binding sees updated $x)
```

---

## Invocation Patterns

### Direct Call

```rill
fn(x) { $x + 1 } => $inc
$inc(5)    # 6

{ $ + 1 } => $inc
$inc(5)    # 6 (block-closure)
```

### Pipe Call

```rill
fn(x) { $x + 1 } => $inc
5 -> $inc()    # 6

{ $ + 1 } => $inc
5 -> $inc      # 6 (block-closure, no parens needed)
```

Block-closures work seamlessly with pipe syntax since `$` receives the piped value.

### Postfix Invocation

Call closures from bracket access or expressions:

```rill
[fn(x) { $x * 2 }] => $fns
$fns[0](5)    # 10

[{ $ * 2 }] => $fns
$fns[0](5)    # 10 (block-closure)

fn() { fn(n) { $n * 2 } } => $factory
$factory()(5)    # 10 (chained invocation)
```

### Method Access After Bracket (Requires Grouping)

```rill
["hello", "world"] => $list

# Use grouping to call method on bracket result
($list[0]).upper    # "HELLO"

# Or use pipe syntax
$list[0] -> .upper    # "HELLO"
```

Note: `$[0].upper` parses `.upper` as field access on `$list`, not as a method call on the element. This throws an error since lists don't have an `upper` field.

---

## Error Behavior

### Non-Producing Body (RILL-R043)

A closure body must produce a value. Invoking a closure with an empty body (or a body containing only comments) raises RILL-R043 at invocation time:

```text
fn(x: number) { } => $fn
$fn(5)
# Error: RILL-R043: Closure body produced no value
```

A script with no statements (only comments) also raises RILL-R043 at execution time:

```text
# only a comment — no expression produces a value
# Error: RILL-R043: Script body produced no value
```

RILL-R043 replaces the former behavior where an empty script raised RILL-R005 ("Undefined variable") because `$` was never bound.

### Undefined Variables

Undefined variables throw an error at call time (rill has no null):

```text
fn() { $undefined } => $fn
$fn()    # Error: Undefined variable: $undefined
```

### Invoking Non-Callable

```rill
[1, 2, 3] => $list
$[0]()    # Error: Cannot invoke non-callable value (got number)
```

### Type Errors

```rill
fn(x: string) { $x } => $fn
$fn(42)    # Error: Parameter type mismatch: x expects string, got number
```

---

## Implementation Notes

### Scope Chain

Closures store a reference to their defining scope (`definingScope`). At invocation:
1. A child context is created with `definingScope` as parent
2. Parameters are bound in the child context
3. Variable lookups traverse: local → definingScope → parent chain

### Memory Considerations

- Closures hold references to their defining scope
- Scopes form a tree structure (no circular references)
- Scopes remain live while referenced by closures

### Performance

- Variable lookup traverses the scope chain at each access
- No caching (ensures mutation visibility)
- Closure creation is lightweight (stores reference, not copy)

---

## See Also

| Document | Description |
|----------|-------------|
| [Closure Annotations](topic-closure-annotations.md) | Parameter metadata, annotations, and reflection |
| [Reference](ref-language.md) | Language specification |
| [Collections](topic-collections.md) | `seq`, `fan`, `filter`, `fold`, `acc` with closures |
| [Guide](guide-getting-started.md) | Getting started tutorial |
