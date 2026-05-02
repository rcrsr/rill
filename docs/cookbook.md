# rill Cookbook

*Reusable design patterns: state machines, dispatch, accumulators, validation*

This cookbook demonstrates reusable rill patterns for structured programming tasks. While [Examples](guide-examples.md) shows individual language features, recipes here combine multiple features into complete solutions. Each recipe is a self-contained, working example.

## State Machines

State machines model systems with discrete states and transitions. rill's dispatch operator makes state machines declarative and readable.

### Basic State Machine

Use nested dict dispatch to look up transitions by state and event:

```rill
# Traffic light state machine
[
  green: [tick: "yellow", emergency: "red"],
  yellow: [tick: "red", emergency: "red"],
  red: [tick: "green", emergency: "red"]
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
[
  idle: [start: "running", stop: "idle"],
  running: [pause: "paused", stop: "idle"],
  paused: [resume: "running", stop: "idle"]
] => $machine

# Event sequence to process
["start", "pause", "resume", "stop"] => $events

# Process events, accumulating state history
$events -> fold("idle", {
  $machine.($@).($)  # $@ is accumulator (current state), $ is event
})
# Result: "idle"
```

Track state history with `fold`:

```rill
[
  idle: [start: "running"],
  running: [pause: "paused", stop: "idle"],
  paused: [resume: "running"]
] => $machine

["start", "pause", "resume"] => $events

$events -> fold([current: "idle", history: []], {
  $ => $event
  $machine.($@.current) => $stateConfig
  $stateConfig -> .keys -> .has($event) ? {
    $stateConfig.($event) => $next
    [current: $next, history: [...$@.history, $next]]
  } ! $@
})
# Result: [current: "running", history: ["running", "paused", "running"]]
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
] => $machine

# Parse hierarchical state
"playing.normal" => $state
$state -> .split(".") => $path

# Navigate to current state config
$path -> fold($machine, { $@.$  })
# Result: [pause: "paused", slow: "playing.slow", fast: "playing.fast"]
```

## Dispatch Patterns

### Computed Routing

Route values through different processors based on type or content:

```text
# Conceptual - string keys with special chars require dispatch syntax
[
  "application/json": |body|{ $body },
  "text/plain": |body|{ $body -> .trim },
  "text/csv": |body|{ $body -> .lines -> fan({ .split(",") }) }
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
[
  ["GET", "HEAD"]: [handler: "read", safe: true],
  ["POST", "PUT", "PATCH"]: [handler: "write", safe: false],
  ["DELETE"]: [handler: "delete", safe: false]
] => $routes

"POST" -> $routes
# Result: [handler: "write", safe: false]
```

### Default Handlers

Combine dispatch with `??` for fallback behavior:

```rill
dict[
  success: |r|{ "Completed: {$r.data}" },
  failure: |r|{ "Failed: {$r.message}" },
  pending: |r|{ "Waiting..." }
] => $handlers

dict[status: "unknown", data: "test"] => $req

$req.status -> $handlers ?? |r|{ "Unknown status: {$r.status}" }
-> |handler|{ $handler($req) }
# Result: "Unknown status: unknown"
```

## Accumulator Patterns

### Running Statistics

Calculate statistics in a single pass:

```text
# Conceptual - dict spread [...$dict, key: val] not implemented
[23, 45, 12, 67, 34, 89, 56] => $values

$values -> fold([sum: 0, count: 0, min: 999999, max: -999999], {
  [
    sum: $@.sum + $,
    count: $@.count + 1,
    min: ($ < $@.min) ? $ ! $@.min,
    max: ($ > $@.max) ? $ ! $@.max
  ]
}) => $stats

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

$employees -> fold([], {
  $@.?($$.dept) ? {
    # Key exists - append to list
    [...$@, ($$.dept): [...$@.($$.dept), $$.name]]
  } ! {
    # New key - create list
    [...$@, ($$.dept): [$$.name]]
  }
})
# Result: [Engineering: ["Alice", "Carol"], Sales: ["Bob", "Dave"]]
```

### Deduplication

Remove duplicates while preserving order:

```rill
["a", "b", "a", "c", "b", "d", "a"] => $items

$items -> fold([seen: [], result: []], {
  $ => $item
  $@.seen -> .has($item) ? [seen: $@.seen, result: $@.result] ! dict[seen: [...$@.seen, $item], result: list[...$@.result, $item]]
}) -> .result
# Result: ["a", "b", "c", "d"]
```

## Control Flow Patterns

### Early Exit with Validation

Validate multiple conditions and exit on first failure:

```rill
[username: "", email: "test@", age: 15] => $formData

$formData -> {
  $.username -> .empty ? ([valid: false, err: "Username required"] -> return)
  $.email -> .contains("@") -> ! ? ([valid: false, err: "Invalid email"] -> return)
  ($.age < 18) ? ([valid: false, err: "Must be 18+"] -> return)
  [valid: true, data: $]
}
# Result: [valid: false, err: "Username required"]
```

### Retry with Backoff

Retry an operation with exponential backoff:

```rill
# Simulate flaky operation (host would provide real implementation)
|attempt|{
  ($attempt < 3) ? [ok: false, err: "Network error"] ! dict[ok: true, data: "Success"]
} => $operation

# Retry loop with backoff
1 -> while ($ <= 5) do {
  $operation($) => $result
  $result.ok ? ($result -> return)
  log("Attempt {$} failed: {$result.err}")
  $ + 1
} => $final

$final.?ok ? $final ! [ok: false, err: "Max retries exceeded"]
# Result: [ok: true, data: "Success"]
```

### Pipeline with Short-Circuit

Process steps that can fail at any point:

```rill
|input|{
  [ok: true, value: $input -> .trim]
} => $step1

|input|{
  $input -> .len => $len
  ($len < 3) ? [ok: false, err: "Too short"] ! dict[ok: true, value: $input -> .upper]
} => $step2

|input|{
  $input -> .contains("HELLO") => $hasHello
  $hasHello ? [ok: true, value: $input] ! dict[ok: false, err: "Must contain HELLO"]
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
# Result: [ok: false, err: "Must contain HELLO"]
```

## Data Transformation

### Flatten Nested Structure

Flatten arbitrarily nested lists:

```rill
# For known depth, chain operations
[list[1, 2], list[3, 4], list[5, 6]] => $nested

# Flatten one level
$nested -> fold([], { [...$@, ...$] })
# Result: [1, 2, 3, 4, 5, 6]
```

### Transpose Matrix

Convert rows to columns:

```rill
[
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9]
] => $matrix

range(0, $matrix[0] -> .len) -> fan(|col|{
  $matrix -> fan(|row|{ $row[$col] })
})
# Result: [[1, 4, 7], [2, 5, 8], [3, 6, 9]]
```

### Zip Lists

Combine parallel lists into dicts:

```rill
["a", "b", "c"] => $zipKeys
[1, 2, 3] => $zipValues

range(0, $zipKeys -> .len) -> fan(|i|{
  [key: $zipKeys[$i], value: $zipValues[$i]]
})
# Result: [[key: "a", value: 1], [key: "b", value: 2], [key: "c", value: 3]]
```

Converting to a dict requires dict spread (not yet implemented):

```text
# Conceptual - dict spread [...$@, (key): val] not implemented
range(0, $zipKeys -> .len) -> fold([], |i|{
  [...$@, ($zipKeys[$i]): $zipValues[$i]]
})
# Result: [a: 1, b: 2, c: 3]
```

## String Processing

### Template Expansion

Simple template with variable substitution (using angle brackets as delimiters):

```rill
"Hello <name>, your order <orderId> ships on <date>." => $template

[name: "Alice", orderId: "12345", date: "2024-03-15"] => $templateVars

$templateVars -> .entries -> fold($template, {
  $@.replace_all("<{$[0]}>", $[1] -> string)
})
# Result: "Hello Alice, your order 12345 ships on 2024-03-15."
```

### Parse Key-Value Pairs

Extract structured data from formatted text:

```text
# Conceptual - uses dict spread with computed keys
"name=Alice;age=30;city=Seattle" => $input

$input
  -> .split(";")
  -> fold([:], {
    $ -> .split("=") -> destruct<$key, $value>
    [...$@, ($key): $value]
  })
# Result: [name: "Alice", age: "30", city: "Seattle"]
```

### Word Frequency

Count word occurrences:

```text
# Conceptual - uses dynamic existence check and dict spread
"the quick brown fox jumps over the lazy dog the fox" => $text

$text
  -> .lower
  -> .split(" ")
  -> fold([], {
    $@.?$
      ? [...$@, ($): $@.$ + 1]
      ! [...$@, ($): 1]
  })
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

```text
# Build cache alongside computation
|n, cache|{
  $cache.?($n -> string) ? $cache.($n -> string) ! {
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

$schema.entries -> fold([valid: true, errors: []], {
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
})
# Result: [valid: false, errors: ["age above maximum"]]
```

## Extension Binding

### Extension Binding with use&lt;ext:...&gt;

The `use<ext:name>` construct binds a host-registered extension to a variable. The host registers an `extResolver` and provides extension values via `RuntimeOptions.resolvers`.

```typescript
import { createRuntimeContext, extResolver } from "@rcrsr/rill";
import { qdrantExtValue } from "./extensions/qdrant";

const ctx = createRuntimeContext({
  resolvers: { ext: extResolver },
  configurations: {
    resolvers: { ext: { qdrant: qdrantExtValue } }
  }
});
```

```text
use<ext:qdrant> => $qdrant
$qdrant.search("my-collection", $embedding, 10)
```

The script binds the full `qdrant` extension dict to `$qdrant` and calls its `search` member. Use `use<ext:name.member>` to bind a single callable directly.

```text
use<ext:qdrant.search> => $search
$search("my-collection", $embedding, 10)
```

---

### Provider Swap via Extension Config

The `use<ext:...>` pattern decouples rill scripts from specific provider implementations. The same script runs unchanged when the host swaps the extension config.

```typescript
// Provider A
const ctxA = createRuntimeContext({
  resolvers: { ext: extResolver },
  configurations: {
    resolvers: { ext: { vectordb: pineconeExtValue } }
  }
});

// Provider B — same script, different extension
const ctxB = createRuntimeContext({
  resolvers: { ext: extResolver },
  configurations: {
    resolvers: { ext: { vectordb: qdrantExtValue } }
  }
});
```

```text
use<ext:vectordb> => $vectordb
$vectordb.search("my-collection", $embedding, 10)
```

The rill script references `vectordb` by name; the host binds it to any compatible extension at runtime. Switch providers by changing the config, not the script.

---

## Stream Patterns

Stream host functions are unavailable in the test harness, so all stream examples use `text` fences.
See [Types](topic-types.md) and [Collections](topic-collections.md) for stream documentation.

### Token Accumulation with fold

Accumulate all streaming tokens into a single string before processing:

```text
use<ext:app> => $app

$app.llm_stream("Write a summary") => $s

$s -> fold("", { $@ ++ $ }) => $full_response

"Summary: {$full_response}" -> log
```

`fold` consumes every chunk and concatenates it into `$@`. The result is available only after the stream closes.

### Budget-Aware Accumulation with break

Track token count across chunks and stop when a budget is reached:

```text
use<ext:app> => $app

$app.llm_stream("Generate a long document") => $s

$s -> acc(0, {
  $ -> .len => $chunk_len
  ($@ + $chunk_len) => $running_total
  ($running_total > 500) ? break
  $ -> log
  $running_total
})
```

`acc(init, body)` carries `$@` across chunks. When the budget exceeds 500 characters, `break` stops iteration and the host disposes the stream.

### Multi-Source Orchestration

Consume multiple streams sequentially with `seq`, or in parallel with `fan`:

```text
use<ext:app> => $app

# Sequential: one stream at a time
["Summarize A", "Summarize B"] -> seq({
  $app.llm_stream($) => $s
  $s -> fold("", { $@ ++ $ })
}) => $sequential_results

# Parallel: all streams concurrently, results in order
["Summarize A", "Summarize B"] -> fan({
  $app.llm_stream($) => $s
  $s -> fold("", { $@ ++ $ })
}) => $parallel_results
```

Use `seq` when order matters or streams depend on prior results. Use `fan` when sources are independent and concurrency helps.

---

## Error Handling

Recipes for recovering from failed operations, coercing invalid results, and classifying errors.

### Guard and Coerce

Catch a halt from a risky access and convert the invalid result to a safe default value:

```rill
"hello" => $val
guard { $val.upper } => $out
$out.! ? "FALLBACK" ! $out
# Result: "HELLO"
```

When `guard` catches a halt, `.!` returns `true` and the right branch supplies the fallback. When the body succeeds, `.!` returns `false` and `$out` passes through.

For invalid inputs, use `??` to replace a vacant or invalid result:

```rill
guard { "hello" -> .upper } ?? "fallback"
# Result: "HELLO"
```

### Retry and Coerce

Retry a failing operation up to N times, then coerce the result to a default:

```text
use<ext:app> => $app

retry<limit: 3> {
  $app.fetch("https://api.example.com/data")
} => $result

$result.! ? "unavailable" ! $result
```

`retry<limit: 3>` re-enters the body up to 3 times. If all attempts fail, the final invalid value is returned. The `??` operator replaces it with a safe default.

Combine with `??` for a one-liner fallback:

```text
use<ext:app> => $app

retry<limit: 3> { $app.fetch("https://api.example.com/data") } ?? "unavailable"
```

### Nested Guard and Retry

Wrap an inner `guard` with an outer retry to re-execute on partial failure:

```text
use<ext:app> => $app

retry<limit: 3, on: list[#UNAVAILABLE]> {
  guard<on: list[#NOT_FOUND]> {
    $app.fetch("https://api.example.com/resource")
  } => $inner
  $inner.! ? (error "not found") ! $inner
} => $result

$result.! ? "all retries failed: {$result.!message}" ! $result
```

`guard<on: list[#NOT_FOUND]>` catches only `#NOT_FOUND` halts and surfaces them as values. The inline `error` re-escalates them as non-catchable halts. `retry<limit: 3, on: list[#UNAVAILABLE]>` retries only on service unavailability.

### Per-Item Collection Recovery

Apply `guard` per item so one failure does not stop the whole collection:

```text
use<ext:app> => $app

["https://a.example.com", "https://b.example.com", "https://c.example.com"] -> fan({
  guard { $app.fetch($) } => $r
  $r.! ? [url: $, ok: false, err: $r.!message] ! dict[url: $, ok: true, data: $r]
})
```

Each item runs its own `guard`. Failed fetches produce an `[ok: false]` record. Downstream code filters or reports failures without halting.

Filter out failures after collection:

```rill
[
  [url: "a", ok: true, data: "response"],
  [url: "b", ok: false, err: "timeout"],
  [url: "c", ok: true, data: "response2"]
] => $results

$results -> filter({ $.ok })
# Result: list[dict[url: "a", ok: true, data: "response"], dict[url: "c", ok: true, data: "response2"]]
```

### Detect and Branch on `.!code`

Use the error atom to route different error types to different handlers:

```rill
# Probe a valid value — guard succeeds, so .! is false
"hello" => $val
guard { $val.upper } => $result
$result.! ? "error occurred" ! $result
# Result: "HELLO"
```

For real error routing with host functions, use a `text` fence since the harness cannot produce specific error atoms:

```text
guard { app::fetch("https://api.example.com") } => $result
$result.! ? {
  ($result.!code == #TIMEOUT) ? "Request timed out — try again later"
  ! ($result.!code == #AUTH) ? "Authentication failed — check credentials"
  ! ($result.!code == #RATE_LIMIT) ? "Rate limit exceeded — wait before retrying"
  ! "Unexpected error: {$result.!message}"
} ! $result
```

Read `.!code` to branch by error type. The default branch handles unrecognized codes.

### Wrap with Context via `error`

Add context to an error by wrapping it with `error "..."` before re-raising:

```text
guard { app::fetch("https://api.example.com/users") } => $fetch_result
$fetch_result.! ? {
  error "user-fetch failed: {$fetch_result.!message}"
} ! $fetch_result
```

`error "..."` raises a **non-catchable** halt that propagates through any outer `guard` or `retry`. Use it when the error is unrecoverable and the script must stop.

To wrap and re-raise as catchable, capture the context in a new invalid value instead:

```rill
"hello" => $val
guard { $val.upper } => $result
$result.! ? "wrapped: {$result.!message}" ! $result
# Result: "HELLO"
```

---

## Stream Slicing Patterns

Recipes for chunking, gating, and restructuring streams using the slicing operators.

### Batch Processing

Process a list in fixed-size chunks, applying an operation to each batch:

```rill
range(1, 11) -> batch(3) -> seq({ log($) })
# Result: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]
```

`batch(3)` groups the 10-element range into chunks of 3. The trailing chunk `[10]` is kept because `drop_partial` defaults to `false`. Each chunk arrives as a list inside `seq`.

To discard the trailing short chunk, pass `drop_partial: true`:

```rill
range(1, 11) -> batch(3, [drop_partial: true]) -> seq({ $ })
# Result: [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
```

---

### Bounded Cycling

Repeat a pattern a fixed number of times by combining `cycle` with `take`:

```rill
[1, 2, 3] -> cycle -> take(6)
# Result: [1, 2, 3, 1, 2, 3]
```

`cycle` turns the list into an infinite iterator. `take(6)` extracts 6 elements before stopping. The source list length does not need to divide evenly into the count.

Use this to fill fixed-length slots with a repeating value set:

```rill
["a", "b"] -> cycle -> take(5)
# Result: ["a", "b", "a", "b", "a"]
```

---

### Predicate-Gated Streams

Start or stop iteration based on a runtime condition using `start_when` and `stop_when`.

Gate a stream to begin after a threshold:

```rill
range(1, 8) -> start_when(|x| ($x > 3))
# Result: [4, 5, 6, 7]
```

Gate a stream to stop at a threshold (the matching element is included):

```rill
range(1, 8) -> stop_when(|x| ($x > 3))
# Result: [1, 2, 3, 4]
```

Combine both to extract a bounded window from a larger stream:

```rill
range(1, 20) -> start_when(|x| ($x >= 5)) -> stop_when(|x| ($x >= 10))
# Result: [5, 6, 7, 8, 9, 10]
```

`start_when` discards elements before the first match. `stop_when` stops after the first match. Chaining them gives a precise range gate.

---

### Non-Halting Audit Logging

Use `pass<on_error: #IGNORE>` to log a side effect without risking a halt that breaks the pipe:

```rill
5 -> pass<on_error: #IGNORE> { log($) }
# Result: 5
```

The pipe value `5` flows through unchanged. `log($)` executes as a side effect. If `log` raises a catchable halt, `on_error: #IGNORE` suppresses it and the pipe continues.

This pattern is useful when audit or observability calls must not interrupt the main pipeline:

```rill
range(1, 4) -> seq({
  $ -> pass<on_error: #IGNORE> { log($) }
})
# Result: [1, 2, 3]
```

Each element is logged, then passed through to `seq`'s result list. A logging failure on any element does not abort the iteration.

## Time-Domain Patterns
### Fibonacci via iterate
```rill
iterate(dict[a: 0, b: 1], { dict[a: $.b, b: ($.a + $.b)] }) -> take(8) -> seq({ $.a })
# Result: [0, 1, 1, 2, 3, 5, 8, 13]
```
The closure advances the Fibonacci pair at each step; `seq` extracts `$.a` from each emitted state.
### Timeout Recovery via `??`
```text
guard { timeout<total: duration(0,0,0,0,0,0,500)> { app::fetch("https://api.example.com") } } ?? "cached"
```
Expiry emits `#RILL_R082`. `guard` catches the halt; `??` replaces it with the fallback.
### Debounce, Throttle, and Sample
```text
$stream -> debounce(duration(0,0,0,0,0,0,200))   # latest chunk after 200ms silence
$stream -> throttle(duration(0,0,0,0,0,0,100))   # first chunk per 100ms window
$stream -> sample(duration(0,0,0,0,0,0,250))     # latest chunk at 250ms intervals
```
All three are stream-only; passing a list halts with `#INVALID_INPUT`. Under synchronous batch execution, debounce and sample return the last element; throttle returns the first.

## See Also

- [Examples](guide-examples.md) — Language feature demonstrations
- [Reference](ref-language.md) — Complete language specification
- [Collections](topic-collections.md) — `seq`, `fan`, `filter`, `fold`, `acc` details
- [Collection Slicing](topic-collection-slicing.md) — `take`, `skip`, `cycle`, `batch`, `window`, `start_when`, `stop_when`, `pass<>` details
- [Closures](topic-closures.md) — Function patterns and binding
- [Host Integration](integration-host.md) — Embedding API
- [Error Handling](topic-error-handling.md) — guard, retry, status probes
