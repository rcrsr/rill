# rill Stream and Time-Domain Examples

*Working code for stream consumption, error recovery, and time-domain operators*

## Stream Examples

Stream host functions are unavailable in the test harness, so all stream examples use `text` fences.
See [Types](topic-types.md) for stream type documentation and [Collections](topic-collections.md) for operator behavior.

### Stream Consumption with `seq` (Token Processing)

Consume a host-provided token stream one chunk at a time:

```text
use<ext:app> => $app

# Process each token from an LLM stream
$app.llm_stream("Explain rill in 3 sentences") => $tokens

$tokens -> seq({
  $ -> log
})
# logs each token string as it arrives
```

Each iteration body receives one chunk as `$`. The host disposes the stream when all chunks are consumed.

### Stream Resolution with `$s()`

Iterate chunks and then read the resolution value:

```text
use<ext:app> => $app

# Consume chunks, then get the final token usage
$app.llm_stream("Summarize this document") => $s

$s -> seq({ $ -> log })

# Resolution value is available after the stream closes
$s()
# Returns the resolution value (e.g., token count or finish reason)
```

`$s()` is safe to call after the stream closes. The resolution is cached and returns the same value on every call.

### Stream with `fold` (Accumulation)

Accumulate all chunks into a single string:

```text
use<ext:app> => $app

# Fold all tokens into a complete response string
$app.llm_stream("Write a haiku") => $s

$s -> fold("", { $@ ++ $ }) => $full_response

"Complete response: {$full_response}" -> log
```

`fold` reduces every chunk using `$@` as the accumulator. The initial value is the empty string `""`.

### Parallel Resolution with `fan { $() }`

Resolve multiple streams in parallel using `fan`:

```text
use<ext:app> => $app

# Create streams from a list of prompts
["Summarize A", "Summarize B", "Summarize C"] -> fan({
  $app.llm_stream($)
}) => $streams

# Consume all streams in parallel, collecting resolution values
$streams -> fan({ $() })
# Returns list of resolution values, one per stream
```

`fan` runs each `$()` concurrently. Results preserve input order despite parallel execution.

### Script Stream Production with `:stream(T):R`

Define a stream closure that emits chunks from a script:

```text
# Stream closure: emit processed lines, resolve with line count
|input: string| {
  $input -> .split("\n") -> seq({
    $ -> .trim -> .empty -> !$ ? { $ -> yield }
  })
  return $input -> .split("\n") -> .len
}:stream(string):number => $line_stream

$line_stream("line one\nline two\nline three") => $s
$s -> seq({ $ -> log })
$s()
# Returns 3 (total line count)
```

`yield` emits the piped value as a chunk. `return` sets the resolution value and closes the stream.

## Recovering from Failures

rill has no try/catch. Failed operations produce **invalid values**. Use `guard` and `.!` to recover.

### Detect an Invalid Result

```rill
"hello" => $val
guard { $val.upper } => $out
$out.!
# Result: false
```

`.!` returns `false` when `guard` caught nothing. A `true` result means the body halted.

### Coerce to a Default

Replace an invalid result with a safe default using `??`:

```rill
guard { "hello" -> .upper } => $out
$out ?? "fallback"
# Result: "HELLO"
```

### End-to-End: Fetch with Fallback

```text
use<ext:app> => $app

retry<limit: 3> {
  $app.fetch("https://api.example.com/data")
} => $result

$result.! ? {
  "fetch failed ({$result.!code}), using cache" -> log
  $cache
} ! {
  $result -> json -> .items
}
```

`retry<limit: 3>` re-enters the body up to 3 times. After all attempts fail, `.!` is `true`.

### Read the Error Atom

```rill
"ok".!code
# Result: #ok
```

`.!code` returns `#ok` on valid values. On invalid values it returns the error atom (e.g. `#TIMEOUT`, `#AUTH`). Use `==` to compare atoms.

## Time-Domain Examples

These examples demonstrate iterate sequences, timeout recovery, and fire-and-forget side effects.

### Iterating an Infinite Sequence with `take`

`iterate` produces an infinite sequence by repeatedly applying a step function; `take(5)` limits it to the first 5 values:

```rill
iterate(0, { $ + 1 }) -> take(5)
# Result: [0, 1, 2, 3, 4]
```

### Timeout with Fallback

Wrap a host fetch in `timeout<>` inside `guard` to recover from slow responses with a cached value:

```text
guard { timeout<total: duration(0,0,0,0,0,0,500)> { app::fetch("https://api.example.com") } } ?? "cached"
```

### Fire-and-Forget with `pass<async: true>`

Pipe a value through `pass<async: true, on_error: #IGNORE>` to trigger a side-effect audit log without blocking the pipeline:

```text
42 -> pass<async: true, on_error: #IGNORE> { app::audit_log($) }
```

## See Also

| Document | Description |
|----------|-------------|
| [Examples](guide-examples.md) | Core language examples |
| [Collections](topic-collections.md) | Collection operators and stream iteration |
| [Collection Slicing](topic-collection-slicing.md) | Stream slicing operators |
| [Error Handling](topic-error-handling.md) | `.!`, `guard`, `retry`, and recovery patterns |
