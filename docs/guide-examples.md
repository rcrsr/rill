# rill Core Examples

*Working code for each language feature, from extraction operators to agent workflows*

> **Note:** These examples use `app::` prefix for host-provided functions (`app::prompt()`, `app::fetch()`, etc.). Built-in functions (`log`, `range`, `json`) need no prefix. Frontmatter is opaque to rill; the host parses it and provides named variables to the script context.

## Pure Language Examples

## Extraction Operators

Demonstrates destructuring, slicing, and enumeration.

### Destructuring Function Results

```rill
# Destructure dict results into named variables
[output: "test output", code: 0] -> destruct<output: $out, code: $code>

$code -> .gt(0) ? {
  "Tests failed:\n{$out}" -> log
}

"All tests passed" -> log
```

### Processing Structured Data

```rill
# Process list of file-mode pairs
[
  ["src/auth.ts", "security"],
  ["src/api.ts", "performance"],
  ["src/db.ts", "security"]
] -> seq({
  $ -> destruct<$f, $mode>
  "Review {$f} for {$mode} issues" -> log
})
```

### Slicing Results

```rill
# Get first 3 items
["a", "b", "c", "d", "e"] -> slice<:3>
# ["a", "b", "c"]
```

```rill
# Process in reverse order
["a", "b", "c"] -> slice<::-1>
# ["c", "b", "a"]
```

### Dict Iteration

```rill
# Use .entries to iterate over dict key-value pairs
[host: "localhost", port: 8080] -> .entries -> seq({
  "{$[0]}={$[1]}"
}) -> .join("\n")
```

## Collection Operations

Pipeline operators for fan, fold, seq, filter, and aggregate patterns.

### fan: Parallel Transform

```rill
# Define closure first, then use it
|x| { $x * 2 } => $double
[1, 2, 3, 4, 5] -> fan($double)
# [2, 4, 6, 8, 10]
```

```rill
# Map with inline block
["alice", "bob", "carol"] -> fan({ "Hello, {$}!" })
# ["Hello, alice!", "Hello, bob!", "Hello, carol!"]
```

### filter: Parallel Predicate

```rill
# Keep elements matching condition (block form)
[1, 2, 3, 4, 5] -> filter({ .gt(2) })
# [3, 4, 5]
```

```rill
# Filter with closure predicate
|x| { $x % 2 == 0 } => $even
[1, 2, 3, 4, 5, 6] -> filter($even)
# [2, 4, 6]
```

```rill
# Filter non-empty strings
["hello", "", "world", ""] -> filter({ !.empty })
# ["hello", "world"]
```

```rill
# Chain filter and fan
|x| { $x * 2 } => $dbl
[1, 2, 3, 4, 5] -> filter({ .gt(2) }) -> fan($dbl)
# [6, 8, 10]
```

```rill
# Filter structured data
[
  [name: "alice", age: 30],
  [name: "bob", age: 17],
  [name: "carol", age: 25]
] -> filter({ $.age -> .ge(18) })
# [[name: "alice", age: 30], dict[name: "carol", age: 25]]
```

### fold/chain: Reduction and Sequential Chaining

```rill
# Chain transformations
|s|"{$s} -> validated" => $validate
|s|"{$s} -> processed" => $process
|s|"{$s} -> complete" => $complete

"input" -> chain([$validate, $process, $complete])
# "input -> validated -> processed -> complete"

# Numeric reduction
|x|($x + 10) => $add10
|x|($x * 2) => $double

5 -> chain([$add10, $double, $add10])
# ((5 + 10) * 2) + 10 = 40
```

### seq with break: Early Termination

```rill
# Break stops iteration and returns collected results up to that point
[1, 2, 3, 4, 5] -> seq({
  ($ == 3) ? break
  $ * 2
}) => $result
# Result: [2, 4]
```

`seq` catches the break signal and returns the partial results list. Elements processed before break are included; the element that triggered break is not.

```rill
# Use filter to find matching elements
[1, 2, 3, 4, 5] -> filter({ .gt(3) })
# Result: [4, 5]
```

### Aggregate/Sum

```rill
# Sum numbers using fold
[10, 20, 30, 40] -> fold(0, { $@ + $ })
# 100

# Count matching elements using filter (parallel predicate)
$items -> filter({ .contains("error") }) -> .len => $count
"Found {$count} errors" -> log
```

### Transform and Collect

```rill
# Process items, collect results using fan
["file1.txt", "file2.txt", "file3.txt"] -> fan({ "analyzed: {$}" }) -> .join("\n")
# "analyzed: file1.txt\nanalyzed: file2.txt\nanalyzed: file3.txt"
```

## Args Type and Strict Invocation

Explicit argument unpacking with validation.

### Named Args (Strict Invocation)

```rill
# Define a function
|a, b, c| { "{$a}-{$b}-{$c}" } => $fmt

# Create named args and invoke
ordered[a: 1, b: 2, c: 3] -> $fmt(...)    # "1-2-3"

# Store args for later use
ordered[a: 1, b: 2, c: 3] => $myArgs
$myArgs -> $fmt(...)       # "1-2-3"
```

### Named Args

```rill
# Named args spread positionally into parameters
|width, height|($width * $height) => $area

ordered[width: 10, height: 20] -> $area(...)  # 200
```

### Parameter Defaults

```rill
# Defaults fill missing trailing arguments
|x, y = 10, z = 20|($x + $y + $z) => $fn

ordered[x: 5] -> $fn(...)              # 35 (5 + 10 + 20)
ordered[x: 5, y: 10, z: 30] -> $fn(...)  # 45 (5 + 10 + 30)
```

### Type Checking with `.^type`

```rill
# Use .^type to inspect values
42 => $x
$x.^type == number      # true
"hello" => $s
$s.^type == string      # true
[1, 2] => $l
$l.^type == list        # true
ordered[a: 1, b: 2] => $t
$t.^type == ordered     # true
[a: 1] => $d
$d.^type == dict        # true

# Parameterized type comparison
[1, 2, 3] => $nums
$nums.^type == list(number)    # true — exact structural match
["a", "b"] => $strs
$strs.^type == list(string)    # true
$strs.^type == list(number)    # false

# Use json() to serialize
[name: "test", count: 42] -> json
# '{"name":"test","count":42}'

# Use log() to debug while continuing pipe
"processing" -> log -> .len    # logs "processing", returns 10
```

## Workflow Examples (require host functions)

## Feature Implementation Workflow

Validates requirements, creates spec, iterates on review, then implements.

```text
timeout: 00:10:00
args: requirements: string

# Phase 1: Validate requirements
"""
Review the requirements document at {$requirements}.
Check for completeness and clarity.
Output READY if complete, or list missing elements.
""" -> app::prompt() => $validation

$validation -> .contains("READY") -> !$ ? {
  error "Requirements incomplete: {$validation}"
}

# Phase 2: Create specification
"""
Create a technical specification from {$requirements}.
Include API design, data models, and component structure.
""" -> app::prompt() => $spec

"Specification created" -> log

# Phase 3: Review loop - iterate until approved
($spec -> .contains("REVISION")) @ {
  """
Review this specification for issues:
{$}

Output APPROVED if ready, or REVISION REQUIRED with feedback.
  """ -> app::prompt() => $review

  $review -> ?(.contains("APPROVED")) { break }

  # Apply feedback and continue
  """
Update the specification based on this feedback:
{$review}

Original spec:
{$}
  """ -> app::prompt()} => $approved_spec

# Phase 4: Implementation
"""
Implement the approved specification:
{$approved_spec}

Create the necessary files and tests.
""" -> app::prompt() => $implementation

# Phase 5: Verify
app::prompt("Run tests and verify implementation") => $verification

$verification -> ?(.contains("PASS")) {
  [0, "Workflow complete"]
} ! {
  [1, "Verification failed: {$verification}"]
}
```

## Document-Driven Task Loop

Works through a checklist until complete.

```text
args: plan: string

# Initial check
app::prompt("Read {$plan} and find the first unchecked item (- [ ])") => $status

# Work loop
$status -> (!.contains("ALL COMPLETE")) @ {
  """
Based on this status:
{$}

1. Implement the identified unchecked item
2. Mark it complete in {$plan}
3. Check if any unchecked items remain
4. Output ALL COMPLETE if done, or describe next item
  """ -> app::prompt()
} => $final

"Plan complete: {$final}" -> log
```

## Test-Fix Loop

Runs tests, fixes failures, repeats until passing.

```text
args: target: string

# Run tests
app::prompt("Run tests for {$target} and report results") => $result

# Fix loop
$result -> @(.contains("FAIL")) {
  "Fixing failures..." -> log

  """
Fix these test failures:
{$}

Make minimal changes. Then run tests again and report results.
  """ -> app::prompt()} => $final

$final -> ?(.contains("PASS")) {
  "All tests passing"
} ! {
  error "Could not fix all tests"
}
```

## Code Review

Reviews code against multiple criteria.

```text
---
args: file: string
---

# Get file summary
app::prompt("Read and summarize {$file}") => $summary

# Security check
"""
Evaluate for SECURITY issues:
{$summary}

Output PASS, WARN, or FAIL with explanation.
""" -> app::prompt() => $security

# Performance check
"""
Evaluate for PERFORMANCE issues:
{$summary}

Output PASS, WARN, or FAIL with explanation.
""" -> app::prompt() => $performance

# Check results
$security -> .contains("FAIL") -> ? {
  error "Security review failed: {$security}"
}

$performance -> .contains("FAIL") -> ? {
  error "Performance review failed: {$performance}"
}

"Code review passed"
```

## Environment-Aware Deployment

Deploys based on environment configuration.

```text
args: service: string

# Validate environment
$ENV.DEPLOY_ENV -> ?(.empty()) {
  error "DEPLOY_ENV not set"
}

# Environment-specific deployment
($ENV.DEPLOY_ENV == "production") ? {
  """
Deploy {$service} to production.
- Run full test suite first
- Enable monitoring
- Use blue-green deployment
  """ -> app::prompt()} ! ($ENV.DEPLOY_ENV == "staging") ? {
  """
Deploy {$service} to staging.
- Run smoke tests
- Enable debug logging
  """ -> app::prompt()} ! {
  app::prompt("Deploy {$service} to development environment")
} => $result

"Deployment complete" -> log
[0, "Deployed {$service} to {$ENV.DEPLOY_ENV}"]
```

## Retry Pattern

Retries an operation until success or max attempts. Use do-while since you always want at least one attempt:

```text
---
args: operation: string
---

# Do-while: body runs first, then condition checked
@ ^(limit: 5) {
  """
Perform: {$operation}

Output SUCCESS, RETRY, or FAILED.
  """ -> app::prompt()
} ? (.contains("RETRY")) => $result

# Loop exits when result doesn't contain RETRY
$result -> .contains("SUCCESS") ? [code: 0, msg: "Succeeded"] ! dict[code: 1, msg: "Failed: {$result}"]
```

The do-while form eliminates the separate first-attempt code since the body always executes at least once.

## Inline Capture Pattern

Captures mid-chain for debugging or later reference while data continues flowing.

```text
---
args: file: string
---

# Inline capture: value flows through $raw to log to conditional
app::prompt("Read {$file}") => $raw -> log -> .contains("ERROR") -> ? {
  error "Failed to read: {$raw}"
}

# Continue with $raw available for later use
app::prompt("Analyze this content:\n{$raw}") => $analysis -> log -> .empty -> ? {
  error "Analysis produced no output"
}

# Both $raw and $analysis available
"""
Compare the original:
{$raw}

With the analysis:
{$analysis}
""" -> app::prompt()
```

Semantically, `=> $var ->` is `=> $var.set($) ->` — the capture acts like `log`, storing the value while passing it through unchanged.

## Type-Safe Variables

Uses type annotations to prevent accidental type changes during script execution.

```text
args: file: string

# Define a typed helper closure
|input: string| {
  app::prompt("Validate: {$input}") -> ?(.contains("VALID")) { true } ! { false }
} => $validate:closure

# Capture with explicit type locks the variable
"processing" => $status:string
"checking {$file}" => $status          # OK: same type
# 42 => $status                        # ERROR: cannot assign number to string

# Closures are type-locked too
# "oops" => $validate                  # ERROR: cannot assign string to closure

# Inline type annotation in pipe chain
app::prompt("Check {$file}") => $result:string -> log -> ?(.contains("ERROR")) {
  error $result
}

# Type annotations catch mistakes early
app::prompt("Analyze {$file}") => $analysis:string

?(.contains("FAIL")) {
  error "Analysis failed: {$analysis}"
}

[0, "Processing complete"]
```

```rill
# Parameterized type annotation on closure parameter
|items: list(string)| {
  $items -> seq({ $ -> .upper })
} => $upper_all:closure

# Runtime validates element types
$upper_all(list["hello", "world"])
# Result: list["HELLO", "WORLD"]
```

## Pattern Extraction

Extracts specific information from responses.

```text
---
args: logfile: string
---

app::prompt("Read {$logfile} and find all ERROR lines") => $errors

$errors -> .empty -> ? {
  "No errors found"
} ! {
  """
Analyze these errors and categorize them:
{$errors}

For each unique error type, suggest a fix.
  """ -> app::prompt() => $analysis

  "Error analysis complete" -> log
  $analysis
}
```

## Multi-Phase Pipeline with Bailout

Each phase can halt the pipeline on failure.

```rill
---
args: file: string
---

# Multi-phase pipeline with early exit on errors
"content of {$file}" => $content

$content -> .contains("ERROR") ? {
  "Read failed" -> return
}

"analyzed: {$content}" => $analysis

$analysis -> .contains("FAIL") ? {
  "Analysis failed" -> return
}

"Pipeline complete: {$analysis}"
```

## Arithmetic in Loops

Uses bar-delimited arithmetic for calculations within workflow logic.

```text
args: items: string

# Count items and calculate batch sizes
app::prompt("Count items in {$items}") -> .match("(\\d+) items") => $m

$m -> .empty -> ? {
  error "Could not parse item count"
}

$m.groups[0] -> number => $count

# Calculate batches: ceil(count / 10)
(($count + 9) / 10) => $batches

"Processing {$count} items in {$batches} batches" -> log

# Process each batch using range
range(1, $batches + 1) -> seq({
  $ => $batch_num
  (($batch_num - 1) * 10) => $start
  ($start + 10) => $end

  """
Process batch {$batch_num} of {$batches}
Items {$start} through {$end}
  """ -> app::prompt()})

[0, "Processed all batches"]
```

## Signal-Based Workflow

Uses explicit signals for workflow control.

```text
args: task: string
exceptions:
  - ":::BLOCKED:::"
  - ":::NEEDS_HUMAN:::"

"""
Work on this task: {$task}

Rules:
- Output :::BLOCKED::: if you need information you don't have
- Output :::NEEDS_HUMAN::: if human judgment is required
- Output :::DONE::: when complete
""" -> app::prompt() => $result

$result -> (!.contains(":::DONE:::")) @ {
  """
Continue working on: {$task}

Previous progress:
{$}

Remember the signal rules.
  """ -> app::prompt()
} => $final

"Task complete: {$final}" -> log
```

## Vector Database

Vector database operations for semantic search and RAG workflows. These examples use `qdrant::` prefix, but all functions work identically across `qdrant::`, `pinecone::`, and `chroma::` namespaces — change the prefix to switch providers.

### RAG Pipeline

Embed query, search similar vectors, format context for LLM.

```text
args: question: string

# Generate embedding for the query
$question -> openai::embed => $query_vector

# Search for similar documents
$query_vector -> qdrant::search($, [k: 3, score_threshold: 0.7]) => $results

# Extract metadata for context
$results -> fan({ $.metadata.text }) -> .join("\n\n---\n\n") => $context

# Generate answer with retrieved context
"""
Answer this question using the provided context:

Question: {$question}

Context:
{$context}
""" -> anthropic::prompt
```

### Batch Upsert with Error Handling

Store multiple documents with partial failure recovery.

```text
args: documents: list

# Embed all documents
$documents -> fan({
  [
    id: $.id,
    vector: $.text -> openai::embed,
    metadata: [title: $.title, source: $.source]
  ]
}) => $items

# Batch insert with error handling
$items -> qdrant::upsert_batch => $result

# Check for partial failure
$result.failed -> .empty -> !$ ? {
  # Partial failure occurred
  "Batch failed at {$result.failed}: {$result.error}" -> log
  "Successfully stored {$result.succeeded} vectors before failure" -> log
  error "Batch upsert incomplete"
} ! {
  # Full success
  "Successfully stored {$result.succeeded} vectors" -> log
}
```

### Collection Lifecycle Management

Create, populate, and manage vector collections.

```text
# Create a new collection
qdrant::create_collection("knowledge_base", [
  dimensions: 1536,
  distance: "cosine"
]) => $create_result

"Created collection: {$create_result.name}" -> log

# Store vectors (assumes $docs defined)
$docs -> fan({
  [
    id: $.id,
    vector: $.text -> openai::embed,
    metadata: [title: $.title]
  ]
}) -> qdrant::upsert_batch => $upsert_result

# Verify collection state
qdrant::describe() => $info
"Collection has {$info.count} vectors with {$info.dimensions} dimensions" -> log

# List all collections
qdrant::list_collections() => $collections
$collections -> seq({ $ -> log })

# Clean up when done
# qdrant::delete_collection("knowledge_base")
```

### Tool Loop Integration

Vector search as an LLM tool within `anthropic::tool_loop`.

```rill
---
args: user_query: string
---

# Define search tool with closure annotation
^("Search the knowledge base for relevant information")
|^("Search query text") query: string| {
  $query -> openai::embed -> qdrant::search($, [k: 5]) -> fan({
    "ID: {$.id}\nScore: {$.score}\nContent: {$.metadata.text}"
  }) -> .join("\n\n---\n\n")
} => $search_knowledge_base

# Define store tool with closure annotation
^("Store a new document in the knowledge base")
|^("Document ID") id: string, ^("Document text") text: string, ^("Document title") title: string| {
  [
    id: $id,
    vector: $text -> openai::embed,
    metadata: [title: $title, text: $text]
  ] => $item

  $item.vector -> qdrant::upsert($item.id, $, [title: $item.metadata.title])
  "Stored document {$item.id}"
} => $store_document

# Run tool loop with dict-form tools
anthropic::tool_loop(
  "Answer the user's question. Use search_knowledge_base to find relevant information. If the user provides new information to remember, use store_document.",
  [
    tools: [search_knowledge_base: $search_knowledge_base, store_document: $store_document],
    max_turns: 10,
    user_message: $user_query
  ]
) => $loop_result

$loop_result.content
```

## Stream Examples

Stream host functions are unavailable in the test harness, so all stream examples use `text` fences.
See [Types](topic-types.md) for stream type documentation and [Collections](topic-collections.md) for operator behavior.

### Stream Consumption with `seq` (Token Processing)

Consume a host-provided token stream one chunk at a time:

```text
# Process each token from an LLM stream
app::llm_stream("Explain rill in 3 sentences") => $tokens

$tokens -> seq({
  $ -> log
})
# logs each token string as it arrives
```

Each iteration body receives one chunk as `$`. The host disposes the stream when all chunks are consumed.

### Stream Resolution with `$s()`

Iterate chunks and then read the resolution value:

```text
# Consume chunks, then get the final token usage
app::llm_stream("Summarize this document") => $s

$s -> seq({ $ -> log })

# Resolution value is available after the stream closes
$s()
# Returns the resolution value (e.g., token count or finish reason)
```

`$s()` is safe to call after the stream closes. The resolution is cached and returns the same value on every call.

### Stream with `fold` (Accumulation)

Accumulate all chunks into a single string:

```text
# Fold all tokens into a complete response string
app::llm_stream("Write a haiku") => $s

$s -> fold("", { $@ ++ $ }) => $full_response

"Complete response: {$full_response}" -> log
```

`fold` reduces every chunk using `$@` as the accumulator. The initial value is the empty string `""`.

### Parallel Resolution with `fan { $() }`

Resolve multiple streams in parallel using `fan`:

```text
# Create streams from a list of prompts
["Summarize A", "Summarize B", "Summarize C"] -> fan({
  app::llm_stream($)
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

`??` returns the fallback when the left-hand side is vacant or invalid. No halt occurs.

### End-to-End: Fetch with Fallback

This pattern fetches a URL, retries on failure, and falls back to cached data:

```text
# Attempt fetch with retry
retry<3> {
  app::fetch("https://api.example.com/data")
} => $result

# Branch on success or failure
$result.! ? {
  # Log the error code and use cached data
  "fetch failed ({$result.!code}), using cache" -> log
  $cache
} ! {
  # Parse and use the live response
  $result -> json -> .items
}
```

`retry<3>` re-enters the body up to 3 times. After all attempts fail, `.!` is `true`. The `!` branch reads `.!code` to log which error occurred before falling back to `$cache`.

### Read the Error Atom

```rill
"ok".!code
# Result: #ok
```

`.!code` returns `#ok` on valid values. On invalid values it returns the error atom (e.g. `#TIMEOUT`, `#AUTH`). Use `==` to compare atoms.

## See Also

- [Guide](guide-getting-started.md) — Getting started tutorial
- [Cookbook](cookbook.md) — Reusable design patterns (state machines, dispatch, accumulators)
- [Troubleshooting](guide-troubleshooting.md) — Common mistakes and fixes
- [Reference](ref-language.md) — Language specification
- [Error Handling](topic-error-handling.md) — guard, retry, `.!`, and status probes
