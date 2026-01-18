# Closures

Closures are first-class values that capture their defining scope. This document covers closure semantics, binding behavior, and common patterns.

## Closure Syntax

```text
# No parameters (property-style)
|| { body }
||body           # shorthand for simple expressions

# With parameters
|x| { body }
|x|body          # shorthand
|x, y| { body }  # multiple parameters
|x: string| { body }           # typed parameter
|x: number = 10| { body }      # default value (type inferred)
|x: string = "hi"| { body }    # default with explicit type
```

**Key distinction:**
- **Blocks `{ }`** execute immediately
- **Closures `||{ }` or `|params|{ }`** are stored for later invocation

## Late Binding

Closures resolve captured variables at **call time**, not definition time. This enables recursive patterns and forward references.

### Basic Example

```text
10 -> $x
||($x + 5) -> $fn
20 -> $x
$fn()    # 25 (sees current $x=20, not $x=10 at definition)
```

### Recursive Closures

```text
|n| { ($n < 1) ? 1 ! ($n * $factorial($n - 1)) } -> $factorial
$factorial(5)    # 120
```

The closure references `$factorial` before it exists. Late binding resolves `$factorial` when the closure executes.

### Mutual Recursion

```text
|n| { ($n == 0) ? true ! $odd($n - 1) } -> $even
|n| { ($n == 0) ? false ! $even($n - 1) } -> $odd
$even(4)    # true
```

### Forward References

```text
[
  || { $helper(1) },
  || { $helper(2) }
] -> $handlers

|n| { $n * 10 } -> $helper    # defined after closures

$handlers[0]()    # 10
$handlers[1]()    # 20
```

### Variable Mutation Visibility

Closures see the current value of captured variables:

```text
0 -> $counter
|| { $counter } -> $get
|| { $counter + 1 } -> $getPlus1

5 -> $counter

[$get(), $getPlus1()]    # [5, 6]
```

## Dict-Bound Closures

Closures stored in dicts have `$` late-bound to the containing dict at invocation (like `this` in other languages).

### Zero-Arg Closures Auto-Invoke

```text
[
  name: "toolkit",
  count: 3,
  summary: || { "{$.name}: {$.count} items" }
] -> $obj

$obj.summary    # "toolkit: 3 items" (auto-invoked on access)
```

### Accessing Sibling Fields

```text
[
  width: 10,
  height: 5,
  area: || { $.width * $.height }
] -> $rect

$rect.area    # 50
```

### Parameterized Dict Closures

```text
[
  name: "tools",
  greet: |x| { "{$.name} says: {$x}" }
] -> $obj

$obj.greet("hello")    # "tools says: hello"
```

### Reusable Closures Across Dicts

```text
|| { "{$.name}: {$.count} items" } -> $describer

[name: "tools", count: 3, str: $describer] -> $obj1
[name: "actions", count: 5, str: $describer] -> $obj2

$obj1.str    # "tools: 3 items"
$obj2.str    # "actions: 5 items"
```

### Calling Sibling Methods

```text
[
  double: |n| { $n * 2 },
  quad: |n| { $.double($.double($n)) }
] -> $math

$math.quad(3)    # 12
```

## List-Stored Closures

Closures in lists maintain their defining scope. Invoke via bracket access:

```text
[
  |x| { $x + 1 },
  |x| { $x * 2 },
  |x| { $x * $x }
] -> $transforms

$transforms[0](5)    # 6
$transforms[1](5)    # 10
$transforms[2](5)    # 25
```

### Chaining List Closures

```text
|n| { $n + 1 } -> $inc
|n| { $n * 2 } -> $double

5 -> @[$inc, $double, $inc]    # 13: (5+1)*2+1
```

## Inline Closures

Closures can appear inline in expressions:

```text
[1, 2, 3] -> map |x| { $x * 2 }    # [2, 4, 6]

[1, 2, 3] -> filter |x| { $x > 1 }    # [2, 3]

[1, 2, 3] -> fold(0) |acc, x| { $acc + $x }    # 6
```

### Inline with Block Bodies

```text
[1, 2, 3] -> map |x| {
  ($x * 10) -> $scaled
  "{$x} -> {$scaled}"
}
# ["1 -> 10", "2 -> 20", "3 -> 30"]
```

## Nested Closures

Closures can contain closures. Each captures its defining scope:

```text
|n| { || { $n } } -> $makeGetter
$makeGetter(42)()    # 42
```

### Closure Factory Pattern

```text
|multiplier| {
  |x| { $x * $multiplier }
} -> $makeMultiplier

$makeMultiplier(3) -> $triple
$makeMultiplier(10) -> $tenX

$triple(5)    # 15
$tenX(5)      # 50
```

### Nested Late Binding

```text
1 -> $x
|| { || { $x } } -> $outer
5 -> $x
$outer()()    # 5 (inner closure sees updated $x)
```

## Parameter Shadowing

Closure parameters shadow captured variables of the same name:

```text
100 -> $x
|x| { $x * 2 } -> $double
$double(5)    # 10 (parameter $x=5 shadows captured $x=100)
```

## Scope Isolation

### Loop Closures

Each loop iteration creates a new child scope. Capture variables explicitly to preserve per-iteration values:

```text
# Capture $ into named variable for each iteration
[1, 2, 3] -> @ {
  $ -> $item
  || { $item }
} -> $closures

[$closures[0](), $closures[1](), $closures[2]()]    # [1, 2, 3]
```

**Note:** `$` (pipeValue) is a context property, not a variable. Use explicit capture for closure access.

### Conditional Branch Closures

```text
10 -> $x
true ? { || { $x } } ! { || { 0 } } -> $fn
20 -> $x
$fn()    # 20 (late binding sees updated $x)
```

## Invocation Patterns

### Direct Call

```text
|x| { $x + 1 } -> $inc
$inc(5)    # 6
```

### Pipe Call

```text
5 -> $inc()    # 6
```

### Postfix Invocation

Call closures from bracket access or expressions:

```text
[|x| { $x * 2 }] -> $fns
$fns[0](5)    # 10

|| { |n| { $n * 2 } } -> $factory
$factory()(5)    # 10 (chained invocation)
```

### Method Access After Bracket (Requires Grouping)

```text
["hello", "world"] -> $list

# This parses .upper as field access on $list (returns null)
$list[0].upper    # null

# Use grouping to call method on bracket result
($list[0]).upper    # "HELLO"

# Or use pipe syntax
$list[0] -> .upper    # "HELLO"
```

## Error Behavior

### Undefined Variables

Undefined variables return `null` at call time:

```text
|| { $undefined } -> $fn
$fn()    # null
```

### Invoking Non-Callable

```text
[1, 2, 3] -> $list
$list[0]()    # Error: Cannot invoke non-callable value (got number)
```

### Type Errors

```text
|x: string| { $x } -> $fn
$fn(42)    # Error: Parameter type mismatch: x expects string, got number
```

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

## Related Documentation

- [Reference](reference.md) — Language specification
- [Collections](collections.md) — `each`, `map`, `filter`, `fold` with closures
- [Guide](guide.md) — Getting started tutorial
