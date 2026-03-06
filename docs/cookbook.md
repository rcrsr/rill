# rill Cookbook

*Advanced patterns for agent scripting*

This cookbook demonstrates idiomatic rill patterns for common programming tasks. Each recipe shows a complete, working example.

## State Machines

State machines model systems with discrete states and transitions. rill's dispatch operator makes state machines declarative and readable.

### Basic State Machine

Use nested dict dispatch to look up transitions by state and event:

```rill
# Traffic light state machine
dict[
  green: dict[tick: "yellow", emergency: "red"],
  yellow: dict[tick: "red", emergency: "red"],
  red: dict[tick: "green", emergency: "red"]
] => $machine

# Current state and incoming event
"green" => $state
"tick" => $event

# Look up next state
$machine.$state.$event
# Result: "yellow"
```

The pattern `$machine.$state.$event` chains two property accesses: first get the state's transition table, then get the event's target state.

### State Machine with Actions

Embed closures in the transition table to execute side effects:

```rill
# Order processing state machine
dict[
  pending: dict[
    pay: dict[next: "paid", action: ||{ log("Payment received") }],
    cancel: dict[next: "cancelled", action: ||{ log("Order cancelled") }]
  ],
  paid: dict[
    ship: dict[next: "shipped", action: ||{ log("Order shipped") }],
    refund: dict[next: "refunded", action: ||{ log("Refund issued") }]
  ],
  shipped: dict[
    deliver: dict[next: "delivered", action: ||{ log("Order delivered") }]
  ]
] => $machine

"pending" => $state
"pay" => $event

# Get transition
$machine.$state.$event => $transition

# Execute action and get next state
$transition.action()
$transition.next
# Result: "paid"
```

### State Machine Loop

Process a sequence of events through the machine:

```rill
# Define machine
dict[
  idle: dict[start: "running", stop: "idle"],
  running: dict[pause: "paused", stop: "idle"],
  paused: dict[resume: "running", stop: "idle"]
] => $machine

# Event sequence to process
list["start", "pause", "resume", "stop"] => $events

# Process events, accumulating state history
$events -> fold("idle") {
  $machine.($@).($)  # $@ is accumulator (current state), $ is event
}
# Result: "idle"
```

Track state history with `fold`:

```rill
dict[
  idle: dict[start: "running"],
  running: dict[pause: "paused", stop: "idle"],
  paused: dict[resume: "running"]
] => $machine

list["start", "pause", "resume"] => $events

$events -> fold(dict[current: "idle", history: list[]]) {
  $ => $event
  $machine.($@.current) => $stateConfig
  $stateConfig -> .keys -> .has($event) ? {
    $stateConfig.($event) => $next
    dict[current: $next, history: list[...$@.history, $next]]
  } ! $@
}
# Result: dict[current: "running", history: list["running", "paused", "running"]]
```

### Guard Conditions

Use closures as guards to conditionally allow transitions:

```text
# Turnstile with coin counting (conceptual - dict spread not implemented)
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
] => $machine

# Initial context
[state: "locked", coins: 2] => $ctx

# Process coin event
$machine.($ctx.state).coin => $transition

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
dict[
  stopped: dict[
    play: "playing.normal"
  ],
  playing: dict[
    normal: dict[
      pause: "paused",
      slow: "playing.slow",
      fast: "playing.fast"
    ],
    slow: dict[
      pause: "paused",
      normal: "playing.normal"
    ],
    fast: dict[
      pause: "paused",
      normal: "playing.normal"
    ]
  ],
  paused: dict[
    play: "playing.normal",
    stop: "stopped"
  ]
] => $machine

# Parse hierarchical state
"playing.normal" => $state
$state -> .split(".") => $path

# Navigate to current state config
$path -> fold($machine) { $@.$  }
# Result: dict[pause: "paused", slow: "playing.slow", fast: "playing.fast"]
```

## Dispatch Patterns

### Computed Routing

Route values through different processors based on type or content:

```text
# Conceptual - string keys with special chars require dispatch syntax
[
  "application/json": |body|{ $body },
  "text/plain": |body|{ $body -> .trim },
  "text/csv": |body|{ $body -> .lines -> map { .split(",") } }
] => $parsers

"application/json" => $contentType
"{\"name\": \"test\"}" => $body

$contentType -> $parsers -> |parser|{ $parser($body) }
# Result: [name: "test"]
```

### Multi-Key Dispatch

Map multiple inputs to the same handler:

```rill
# HTTP method routing - correct multi-key syntax
dict[
  list["GET", "HEAD"]: dict[handler: "read", safe: true],
  list["POST", "PUT", "PATCH"]: dict[handler: "write", safe: false],
  list["DELETE"]: dict[handler: "delete", safe: false]
] => $routes

"POST" -> $routes
# Result: dict[handler: "write", safe: false]
```

### Default Handlers

Combine dispatch with `??` for fallback behavior:

```rill
dict[
  success: |r|{ "Completed: {$r.data}" },
  error: |r|{ "Failed: {$r.message}" },
  pending: |r|{ "Waiting..." }
] => $handlers

dict[status: "unknown", data: "test"] => $response

$response.status -> $handlers ?? |r|{ "Unknown status: {$r.status}" }
-> |handler|{ $handler($response) }
# Result: "Unknown status: unknown"
```

## Accumulator Patterns

### Running Statistics

Calculate statistics in a single pass:

```text
# Conceptual - dict spread [...$dict, key: val] not implemented
[23, 45, 12, 67, 34, 89, 56] => $values

$values -> fold([sum: 0, count: 0, min: 999999, max: -999999]) {
  [
    sum: $@.sum + $,
    count: $@.count + 1,
    min: ($ < $@.min) ? $ ! $@.min,
    max: ($ > $@.max) ? $ ! $@.max
  ]
} => $stats

[...$stats, avg: $stats.sum / $stats.count]
# Result: [sum: 326, count: 7, min: 12, max: 89, avg: 46.57...]
```

### Grouping

Group items by a computed key:

```text
# Conceptual - uses dict spread and $$ syntax not implemented
[
  [name: "Alice", dept: "Engineering"],
  [name: "Bob", dept: "Sales"],
  [name: "Carol", dept: "Engineering"],
  [name: "Dave", dept: "Sales"]
] => $employees

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
list["a", "b", "a", "c", "b", "d", "a"] => $items

$items -> fold(dict[seen: list[], result: list[]]) {
  $ => $item
  $@.seen -> .has($item) ? dict[seen: $@.seen, result: $@.result] ! dict[seen: list[...$@.seen, $item], result: list[...$@.result, $item]]
} -> .result
# Result: list["a", "b", "c", "d"]
```

## Control Flow Patterns

### Early Exit with Validation

Validate multiple conditions and exit on first failure:

```rill
dict[username: "", email: "test@", age: 15] => $formData

$formData -> {
  $.username -> .empty ? (dict[valid: false, err: "Username required"] -> return)
  $.email -> .contains("@") -> ! ? (dict[valid: false, err: "Invalid email"] -> return)
  ($.age < 18) ? (dict[valid: false, err: "Must be 18+"] -> return)
  dict[valid: true, data: $]
}
# Result: dict[valid: false, err: "Username required"]
```

### Retry with Backoff

Retry an operation with exponential backoff:

```rill
# Simulate flaky operation (host would provide real implementation)
|attempt|{
  ($attempt < 3) ? dict[ok: false, err: "Network error"] ! dict[ok: true, data: "Success"]
} => $operation

# Retry loop with backoff
1 -> ($ <= 5) @ {
  $operation($) => $result
  $result.ok ? ($result -> return)
  log("Attempt {$} failed: {$result.err}")
  $ + 1
} => $final

$final.?ok ? $final ! dict[ok: false, err: "Max retries exceeded"]
# Result: dict[ok: true, data: "Success"]
```

### Pipeline with Short-Circuit

Process steps that can fail at any point:

```rill
|input|{
  dict[ok: true, value: $input -> .trim]
} => $step1

|input|{
  $input -> .len => $len
  ($len < 3) ? dict[ok: false, err: "Too short"] ! dict[ok: true, value: $input -> .upper]
} => $step2

|input|{
  $input -> .contains("HELLO") => $hasHello
  $hasHello ? dict[ok: true, value: $input] ! dict[ok: false, err: "Must contain HELLO"]
} => $step3

# Chain steps with early exit
"  test input  " => $pipelineInput
$pipelineInput -> {
  $step1($) => $r1
  ($r1.ok == false) ? ($r1 -> return)

  $step2($r1.value) => $r2
  ($r2.ok == false) ? ($r2 -> return)

  $step3($r2.value) => $r3
  $r3
}
# Result: dict[ok: false, err: "Must contain HELLO"]
```

## Data Transformation

### Flatten Nested Structure

Flatten arbitrarily nested lists:

```rill
# For known depth, chain operations
list[list[1, 2], list[3, 4], list[5, 6]] => $nested

# Flatten one level
$nested -> fold(list[]) { list[...$@, ...$] }
# Result: list[1, 2, 3, 4, 5, 6]
```

### Transpose Matrix

Convert rows to columns:

```rill
list[
  list[1, 2, 3],
  list[4, 5, 6],
  list[7, 8, 9]
] => $matrix

range(0, $matrix[0] -> .len) -> map |col|{
  $matrix -> map |row|{ $row[$col] }
}
# Result: list[list[1, 4, 7], list[2, 5, 8], list[3, 6, 9]]
```

### Zip Lists

Combine parallel lists into dicts:

```rill
list["a", "b", "c"] => $zipKeys
list[1, 2, 3] => $zipValues

range(0, $zipKeys -> .len) -> map |i|{
  dict[key: $zipKeys[$i], value: $zipValues[$i]]
}
# Result: list[dict[key: "a", value: 1], dict[key: "b", value: 2], dict[key: "c", value: 3]]
```

Converting to a dict requires dict spread (not yet implemented):

```text
# Conceptual - dict spread [...$@, (key): val] not implemented
range(0, $zipKeys -> .len) -> fold([]) |i|{
  [...$@, ($zipKeys[$i]): $zipValues[$i]]
}
# Result: [a: 1, b: 2, c: 3]
```

## String Processing

### Template Expansion

Simple template with variable substitution (using angle brackets as delimiters):

```rill
"Hello <name>, your order <orderId> ships on <date>." => $template

dict[name: "Alice", orderId: "12345", date: "2024-03-15"] => $templateVars

$templateVars -> .entries -> fold($template) {
  $@.replace_all("<{$[0]}>", $[1] -> .str)
}
# Result: "Hello Alice, your order 12345 ships on 2024-03-15."
```

### Parse Key-Value Pairs

Extract structured data from formatted text:

```text
# Conceptual - uses dict spread with computed keys
"name=Alice;age=30;city=Seattle" => $input

$input
  -> .split(";")
  -> fold(dict[:]) {
    $ -> .split("=") -> destruct<$key, $value>
    dict[...$@, ($key): $value]
  }
# Result: dict[name: "Alice", age: "30", city: "Seattle"]
```

### Word Frequency

Count word occurrences:

```text
# Conceptual - uses dynamic existence check and dict spread
"the quick brown fox jumps over the lazy dog the fox" => $text

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

## Closure Patterns

### Partial Application

Create specialized functions from general ones:

```rill
# General formatter
|prefix, suffix, value|{
  "{$prefix}{$value}{$suffix}"
} => $format

# Partial application via closure
|value|{ $format("[", "]", $value) } => $bracket
|value|{ $format("<", ">", $value) } => $angle

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
      $n - 1 -> |prev|{ |prev, cache|{ ... }($prev, $cache) } => $a  # Simplified
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
} => $compose

|x|{ $x * 2 } => $double
|x|{ $x + 1 } => $increment

$compose($double, $increment) => $doubleThenIncrement

5 -> $doubleThenIncrement()
# Result: 11
```

## Validation Patterns

### Schema Validation

Validate dict structure against rules:

```text
# Conceptual - uses dynamic existence checks and dict spread
[
  name: [type: "string", required: true, minLen: 1],
  age: [type: "number", required: true, min: 0, max: 150],
  email: [type: "string", required: false]
] => $schema

[name: "Alice", age: 200] => $data

$schema.entries -> fold([valid: true, errors: []]) {
  $[0] => $field
  $[1] => $rules

  # Check required
  ($rules.required && ($data.?($field) -> !)) ? {
    [valid: false, errors: [...$@.errors, "{$field} is required"]]
  } ! {
    # Check type and constraints if field exists
    $data.?($field) ? {
      $data.($field) => $value

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

## See Also

- [Reference](ref-language.md) — Complete language specification
- [Collections](topic-collections.md) — `each`, `map`, `filter`, `fold` details
- [Closures](topic-closures.md) — Function patterns and binding
- [Host Integration](integration-host.md) — Embedding API
