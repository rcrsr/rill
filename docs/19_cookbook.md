# rill Cookbook

*Advanced patterns for workflow orchestration*

This cookbook demonstrates idiomatic rill patterns for common programming tasks. Each recipe shows a complete, working example.

## State Machines

State machines model systems with discrete states and transitions. Rill's dispatch operator makes state machines declarative and readable.

### Basic State Machine

Use nested dict dispatch to look up transitions by state and event:

```rill
# Traffic light state machine
[
  green: [tick: "yellow", emergency: "red"],
  yellow: [tick: "red", emergency: "red"],
  red: [tick: "green", emergency: "red"]
] :> $machine

# Current state and incoming event
"green" :> $state
"tick" :> $event

# Look up next state
$machine.$state.$event
# Result: "yellow"
```

The pattern `$machine.$state.$event` chains two property accesses: first get the state's transition table, then get the event's target state.

### State Machine with Actions

Embed closures in the transition table to execute side effects:

```rill
# Order processing state machine
[
  pending: [
    pay: [next: "paid", action: ||{ log("Payment received") }],
    cancel: [next: "cancelled", action: ||{ log("Order cancelled") }]
  ],
  paid: [
    ship: [next: "shipped", action: ||{ log("Order shipped") }],
    refund: [next: "refunded", action: ||{ log("Refund issued") }]
  ],
  shipped: [
    deliver: [next: "delivered", action: ||{ log("Order delivered") }]
  ]
] :> $machine

"pending" :> $state
"pay" :> $event

# Get transition
$machine.$state.$event :> $transition

# Execute action and get next state
$transition.action()
$transition.next
# Result: "paid"
```

### State Machine Loop

Process a sequence of events through the machine:

```rill
# Define machine
[
  idle: [start: "running", stop: "idle"],
  running: [pause: "paused", stop: "idle"],
  paused: [resume: "running", stop: "idle"]
] :> $machine

# Event sequence to process
["start", "pause", "resume", "stop"] :> $events

# Process events, accumulating state history
$events -> fold("idle") {
  $machine.($@).($)  # $@ is accumulator (current state), $ is event
}
# Result: "idle"
```

Track state history with `each`:

```rill
[
  idle: [start: "running"],
  running: [pause: "paused", stop: "idle"],
  paused: [resume: "running"]
] :> $machine

["start", "pause", "resume"] :> $events

# Accumulate state, collecting history
$events -> fold([current: "idle", history: []]) {
  $machine.($@.current).?($) ? {
    $machine.($@.current).($) :> $next
    [current: $next, history: [...$@.history, $next]]
  } ! $@
}
# Result: [current: "running", history: ["running", "paused", "running"]]
```

### Guard Conditions

Use closures as guards to conditionally allow transitions:

```rill
# Turnstile with coin counting
[
  locked: [
    coin: [
      guard: |ctx|($ctx.coins >= 1),
      next: "unlocked",
      update: |ctx|([...$ctx, coins: $ctx.coins - 1])
    ]
  ],
  unlocked: [
    push: [next: "locked"],
    coin: [
      next: "unlocked",
      update: |ctx|([...$ctx, coins: $ctx.coins + 1])
    ]
  ]
] :> $machine

# Initial context
[state: "locked", coins: 2] :> $ctx

# Process coin event
$machine.($ctx.state).coin :> $transition

# Check guard if present
$transition.?guard ? {
  $transition.guard($ctx) ? {
    # Guard passed - apply update and transition
    $transition.?update
      ? $transition.update($ctx)
      ! $ctx
    -> [...$, state: $transition.next]
  } ! $ctx  # Guard failed, no transition
} ! {
  # No guard - always transition
  $transition.?update
    ? $transition.update($ctx)
    ! $ctx
  -> [...$, state: $transition.next]
}
# Result: [state: "unlocked", coins: 1]
```

### Hierarchical State Machine

Model nested states using path dispatch:

```rill
# Media player with play/pause substates
[
  stopped: [
    play: "playing.normal"
  ],
  playing: [
    normal: [
      pause: "paused",
      slow: "playing.slow",
      fast: "playing.fast"
    ],
    slow: [
      pause: "paused",
      normal: "playing.normal"
    ],
    fast: [
      pause: "paused",
      normal: "playing.normal"
    ]
  ],
  paused: [
    play: "playing.normal",
    stop: "stopped"
  ]
] :> $machine

# Parse hierarchical state
"playing.normal" :> $state
$state -> .split(".") :> $path

# Navigate to current state config
$path -> fold($machine) { $@.$  }
# Result: [pause: "paused", slow: "playing.slow", fast: "playing.fast"]
```

---

## Dispatch Patterns

### Computed Routing

Route values through different processors based on type or content:

```rill
# Route by content type
[
  "application/json": |body|{ $body -> parse_json },
  "text/plain": |body|{ $body -> .trim },
  "text/csv": |body|{ $body -> .lines -> map { .split(",") } }
] :> $parsers

"application/json" :> $contentType
"{\"name\": \"test\"}" :> $body

$contentType -> $parsers -> |parser|{ $parser($body) }
# Result: [name: "test"]
```

### Multi-Key Dispatch

Map multiple inputs to the same handler:

```rill
# HTTP method routing
[
  [["GET", "HEAD"]]: [handler: "read", safe: true],
  [["POST", "PUT", "PATCH"]]: [handler: "write", safe: false],
  [["DELETE"]]: [handler: "delete", safe: false]
] :> $routes

"POST" -> $routes
# Result: [handler: "write", safe: false]
```

### Default Handlers

Combine dispatch with `??` for fallback behavior:

```rill
[
  success: |r|{ "Completed: {$r.data}" },
  error: |r|{ "Failed: {$r.message}" },
  pending: |r|{ "Waiting..." }
] :> $handlers

[status: "unknown", data: "test"] :> $response

$response.status -> $handlers ?? |r|{ "Unknown status: {$r.status}" }
-> |handler|{ $handler($response) }
# Result: "Unknown status: unknown"
```

---

## Accumulator Patterns

### Running Statistics

Calculate statistics in a single pass:

```rill
[23, 45, 12, 67, 34, 89, 56] :> $values

$values -> fold([sum: 0, count: 0, min: 999999, max: -999999]) {
  [
    sum: $@.sum + $,
    count: $@.count + 1,
    min: ($ < $@.min) ? $ ! $@.min,
    max: ($ > $@.max) ? $ ! $@.max
  ]
} :> $stats

[...$stats, avg: $stats.sum / $stats.count]
# Result: [sum: 326, count: 7, min: 12, max: 89, avg: 46.57...]
```

### Grouping

Group items by a computed key:

```rill
[
  [name: "Alice", dept: "Engineering"],
  [name: "Bob", dept: "Sales"],
  [name: "Carol", dept: "Engineering"],
  [name: "Dave", dept: "Sales"]
] :> $employees

$employees -> fold([]) {
  $@.?($$.dept) ? {
    # Key exists - append to list
    [...$@, ($$.dept): [...$@.($$.dept), $$.name]]
  } ! {
    # New key - create list
    [...$@, ($$.dept): [$$.name]]
  }
}
# Result: [Engineering: ["Alice", "Carol"], Sales: ["Bob", "Dave"]]
```

### Deduplication

Remove duplicates while preserving order:

```rill
["a", "b", "a", "c", "b", "d", "a"] :> $items

$items -> fold([seen: [], result: []]) {
  $@.seen -> .has($) ? $@ ! {
    [
      seen: [...$@.seen, $],
      result: [...$@.result, $]
    ]
  }
} -> .result
# Result: ["a", "b", "c", "d"]
```

---

## Control Flow Patterns

### Early Exit with Validation

Validate multiple conditions and exit on first failure:

```rill
[username: "", email: "test@", age: 15] :> $input

{
  ($input.username -> .empty) ? (
    [valid: false, error: "Username required"] -> return
  )

  ($input.email -> .contains("@") -> !) ? (
    [valid: false, error: "Invalid email"] -> return
  )

  ($input.age < 18) ? (
    [valid: false, error: "Must be 18+"] -> return
  )

  [valid: true, data: $input]
}
# Result: [valid: false, error: "Username required"]
```

### Retry with Backoff

Retry an operation with exponential backoff:

```rill
# Simulate flaky operation (host would provide real implementation)
|attempt|{
  ($attempt < 3) ? [ok: false, error: "Network error"] ! [ok: true, data: "Success"]
} :> $operation

# Retry loop with backoff
1 -> ($ <= 5) @ {
  $operation($) :> $result

  $result.ok ? ($result -> return)

  log("Attempt {$} failed: {$result.error}")
  $ + 1
} :> $final

$final.?ok ? $final ! [ok: false, error: "Max retries exceeded"]
# Result: [ok: true, data: "Success"]
```

### Pipeline with Short-Circuit

Process steps that can fail at any point:

```rill
|input|{
  [ok: true, value: $input -> .trim]
} :> $step1

|input|{
  ($input -> .len) < 3
    ? [ok: false, error: "Too short"]
    ! [ok: true, value: $input -> .upper]
} :> $step2

|input|{
  $input -> .contains("TEST")
    ? [ok: true, value: $input]
    ! [ok: false, error: "Must contain TEST"]
} :> $step3

# Chain steps with early exit
"  test input  " :> $data
{
  $step1($data) :> $r1
  $r1.ok ? ! ($r1 -> return)

  $step2($r1.value) :> $r2
  $r2.ok ? ! ($r2 -> return)

  $step3($r2.value) :> $r3
  $r3
}
# Result: [ok: false, error: "Must contain TEST"]
```

---

## Data Transformation

### Flatten Nested Structure

Flatten arbitrarily nested lists:

```rill
# For known depth, chain operations
[[1, 2], [3, [4, 5]], [6]] :> $nested

# Flatten one level
$nested -> fold([]) { [...$@, ...$] }
# Result: [1, 2, 3, [4, 5], 6]
```

### Transpose Matrix

Convert rows to columns:

```rill
[
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9]
] :> $matrix

range(0, $matrix[0] -> .len) -> map |col|{
  $matrix -> map |row|{ $row[$col] }
}
# Result: [[1, 4, 7], [2, 5, 8], [3, 6, 9]]
```

### Zip Lists

Combine parallel lists into tuples:

```rill
["a", "b", "c"] :> $keys
[1, 2, 3] :> $values

range(0, $keys -> .len) -> map |i|{
  [$keys[$i], $values[$i]]
}
# Result: [["a", 1], ["b", 2], ["c", 3]]

# As dict
range(0, $keys -> .len) -> fold([]) |i|{
  [...$@, ($keys[$i]): $values[$i]]
}
# Result: [a: 1, b: 2, c: 3]
```

---

## String Processing

### Template Expansion

Simple template with variable substitution:

```rill
"Hello {{name}}, your order {{orderId}} ships on {{date}}." :> $template

[name: "Alice", orderId: "12345", date: "2024-03-15"] :> $vars

$vars.entries -> fold($template) {
  $@.replace_all("{{{$[0]}}}", $[1] -> .str)
}
# Result: "Hello Alice, your order 12345 ships on 2024-03-15."
```

### Parse Key-Value Pairs

Extract structured data from formatted text:

```rill
"name=Alice;age=30;city=Seattle" :> $input

$input
  -> .split(";")
  -> fold([]) {
    $ -> .split("=") -> *<$key, $value>
    [...$@, ($key): $value]
  }
# Result: [name: "Alice", age: "30", city: "Seattle"]
```

### Word Frequency

Count word occurrences:

```rill
"the quick brown fox jumps over the lazy dog the fox" :> $text

$text
  -> .lower
  -> .split(" ")
  -> fold([]) {
    $@.?$
      ? [...$@, ($): $@.$ + 1]
      ! [...$@, ($): 1]
  }
# Result: [the: 3, quick: 1, brown: 1, fox: 2, jumps: 1, over: 1, lazy: 1, dog: 1]
```

---

## Closure Patterns

### Partial Application

Create specialized functions from general ones:

```rill
# General formatter
|prefix, suffix, value|{
  "{$prefix}{$value}{$suffix}"
} :> $format

# Partial application via closure
|value|{ $format("[", "]", $value) } :> $bracket
|value|{ $format("<", ">", $value) } :> $angle

$bracket("test")  # "[test]"
$angle("html")    # "<html>"
```

### Memoization Pattern

Cache expensive computations:

```rill
# Build cache alongside computation
|n, cache|{
  $cache.?($n -> .str) ? $cache.($n -> .str) ! {
    # Compute fibonacci
    ($n <= 1) ? $n ! {
      $n - 1 -> |prev|{ |prev, cache|{ ... }($prev, $cache) } :> $a  # Simplified
      # Real memoization requires host support for mutable cache
      $a + $n - 2
    }
  }
}
```

Note: True memoization with persistent cache requires host-provided storage since rill values are immutable.

### Composition

Combine functions into pipelines:

```rill
|f, g|{
  |x|{ $x -> $f() -> $g() }
} :> $compose

|x|{ $x * 2 } :> $double
|x|{ $x + 1 } :> $increment

$compose($double, $increment) :> $doubleThenIncrement

5 -> $doubleThenIncrement()
# Result: 11
```

---

## Validation Patterns

### Schema Validation

Validate dict structure against rules:

```rill
[
  name: [type: "string", required: true, minLen: 1],
  age: [type: "number", required: true, min: 0, max: 150],
  email: [type: "string", required: false]
] :> $schema

[name: "Alice", age: 200] :> $data

$schema.entries -> fold([valid: true, errors: []]) {
  $[0] :> $field
  $[1] :> $rules

  # Check required
  ($rules.required && ($data.?($field) -> !)) ? {
    [valid: false, errors: [...$@.errors, "{$field} is required"]]
  } ! {
    # Check type and constraints if field exists
    $data.?($field) ? {
      $data.($field) :> $value

      # Type check
      (type($value) != $rules.type) ? {
        [valid: false, errors: [...$@.errors, "{$field} must be {$rules.type}"]]
      } ! {
        # Range check for numbers
        ($rules.type == "number") ? {
          ($rules.?min && $value < $rules.min) ? {
            [valid: false, errors: [...$@.errors, "{$field} below minimum"]]
          } ! ($rules.?max && $value > $rules.max) ? {
            [valid: false, errors: [...$@.errors, "{$field} above maximum"]]
          } ! $@
        } ! $@
      }
    } ! $@
  }
}
# Result: [valid: false, errors: ["age above maximum"]]
```

---

## See Also

- [Reference](11_reference.md) — Complete language specification
- [Collections](07_collections.md) — `each`, `map`, `filter`, `fold` details
- [Closures](06_closures.md) — Function patterns and binding
- [Parsing](10_parsing.md) — Text extraction utilities
