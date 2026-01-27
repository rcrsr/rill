# rill Core Examples

Examples demonstrating core language features for workflow orchestration.

> **Note:** These examples assume the host provides `prompt()`, `error()`, and other domain functions. rill is a vanilla language—all integrations come from the host runtime. Frontmatter is opaque to rill; the host parses it and provides named variables to the script context.

## Feature Implementation Workflow

Validates requirements, creates spec, iterates on review, then implements.

```rill
---
timeout: 00:10:00
args: requirements: string
---

# Phase 1: Validate requirements
"""
Review the requirements document at {$requirements}.
Check for completeness and clarity.
Output READY if complete, or list missing elements.
""" -> prompt() :> $validation

$validation -> ?(!.contains("READY")) {
  error("Requirements incomplete: {$validation}")
}

# Phase 2: Create specification
"""
Create a technical specification from {$requirements}.
Include API design, data models, and component structure.
""" -> prompt() :> $spec

"Specification created" -> log

# Phase 3: Review loop - iterate until approved
($spec -> .contains("REVISION")) @ {
  """
Review this specification for issues:
{$}

Output APPROVED if ready, or REVISION REQUIRED with feedback.
  """ -> prompt() :> $review

  $review -> ?(.contains("APPROVED")) { break }

  # Apply feedback and continue
  """
Update the specification based on this feedback:
{$review}

Original spec:
{$}
  """ -> prompt()} :> $approved_spec

# Phase 4: Implementation
"""
Implement the approved specification:
{$approved_spec}

Create the necessary files and tests.
""" -> prompt() :> $implementation

# Phase 5: Verify
prompt("Run tests and verify implementation") :> $verification

$verification -> ?(.contains("PASS")) {
  [0, "Workflow complete"]
} ! {
  [1, "Verification failed: {$verification}"]
}
```

## Document-Driven Task Loop

Works through a checklist until complete.

```rill
---
args: plan: string
---

# Initial check
prompt("Read {$plan} and find the first unchecked item (- [ ])") :> $status

# Work loop
$status -> @(!.contains("ALL COMPLETE")) {
  """
Based on this status:
{$}

1. Implement the identified unchecked item
2. Mark it complete in {$plan}
3. Check if any unchecked items remain
4. Output ALL COMPLETE if done, or describe next item
  """ -> prompt()} :> $final

"Plan complete: {$final}" -> log
```

## Test-Fix Loop

Runs tests, fixes failures, repeats until passing.

```rill
---
args: target: string
---

# Run tests
prompt("Run tests for {$target} and report results") :> $result

# Fix loop
$result -> @(.contains("FAIL")) {
  "Fixing failures..." -> log

  """
Fix these test failures:
{$}

Make minimal changes. Then run tests again and report results.
  """ -> prompt()} :> $final

$final -> ?(.contains("PASS")) {
  "All tests passing"
} ! {
  error("Could not fix all tests")
}
```

## Code Review

Reviews code against multiple criteria.

```rill
---
args: file: string
---

# Get file summary
prompt("Read and summarize {$file}") :> $summary

# Security check
"""
Evaluate for SECURITY issues:
{$summary}

Output PASS, WARN, or FAIL with explanation.
""" -> prompt() :> $security

# Performance check
"""
Evaluate for PERFORMANCE issues:
{$summary}

Output PASS, WARN, or FAIL with explanation.
""" -> prompt() :> $performance

# Check results
$security -> ?(.contains("FAIL")) {
  error("Security review failed: {$security}")
}

$performance -> ?(.contains("FAIL")) {
  error("Performance review failed: {$performance}")
}

"Code review passed"
```

## Environment-Aware Deployment

Deploys based on environment configuration.

```rill
---
args: service: string
---

# Validate environment
$ENV.DEPLOY_ENV -> ?(.empty()) {
  error("DEPLOY_ENV not set")
}

# Environment-specific deployment
($ENV.DEPLOY_ENV == "production") ? {
  """
Deploy {$service} to production.
- Run full test suite first
- Enable monitoring
- Use blue-green deployment
  """ -> prompt()} ! ($ENV.DEPLOY_ENV == "staging") ? {
  """
Deploy {$service} to staging.
- Run smoke tests
- Enable debug logging
  """ -> prompt()} ! {
  prompt("Deploy {$service} to development environment")
} :> $result

"Deployment complete" -> log
[0, "Deployed {$service} to {$ENV.DEPLOY_ENV}"]
```

## Retry Pattern

Retries an operation until success or max attempts. Use do-while since you always want at least one attempt:

```rill
---
args: operation: string
---

# Do-while: body runs first, then condition checked
^(limit: 5) @ {
  """
Perform: {$operation}

Output SUCCESS, RETRY, or FAILED.
  """ -> prompt()} ? (.contains("RETRY"))

# Loop exits when result doesn't contain RETRY
.contains("SUCCESS") ? [0, "Succeeded"] ! [1, "Failed: {$}"]
```

The do-while form eliminates the separate first-attempt code since the body always executes at least once.

## Inline Capture Pattern

Captures mid-chain for debugging or later reference while data continues flowing.

```rill
---
args: file: string
---

# Inline capture: value flows through $raw to log to conditional
prompt("Read {$file}") :> $raw -> log -> ?(.contains("ERROR")) {
  error("Failed to read: {$raw}")
}

# Continue with $raw available for later use
prompt("Analyze this content:\n{$raw}") :> $analysis -> log -> ?(.empty()) {
  error("Analysis produced no output")
}

# Both $raw and $analysis available
"""
Compare the original:
{$raw}

With the analysis:
{$analysis}
""" -> prompt()
```

Semantically, `:> $var ->` is `:> $var.set($) ->` — the capture acts like `log`, storing the value while passing it through unchanged.

## Type-Safe Variables

Uses type annotations to prevent accidental type changes during script execution.

```rill
---
args: file: string
---

# Define a typed helper closure
|input: string| {
  prompt("Validate: {$input}") -> ?(.contains("VALID")) { true } ! { false }
} :> $validate:closure

# Capture with explicit type locks the variable
"processing" :> $status:string
"checking {$file}" :> $status          # OK: same type
# 42 :> $status                        # ERROR: cannot assign number to string

# Closures are type-locked too
# "oops" :> $validate                  # ERROR: cannot assign string to closure

# Inline type annotation in pipe chain
prompt("Check {$file}") :> $result:string -> log -> ?(.contains("ERROR")) {
  error($result)
}

# Type annotations catch mistakes early
prompt("Analyze {$file}") :> $analysis:string

?(.contains("FAIL")) {
  error("Analysis failed: {$analysis}")
}

[0, "Processing complete"]
```

## Pattern Extraction

Extracts specific information from responses.

```rill
---
args: logfile: string
---

prompt("Read {$logfile} and find all ERROR lines") :> $errors

$errors -> ?(.empty()) {
  "No errors found"
} ! {
  """
Analyze these errors and categorize them:
{$errors}

For each unique error type, suggest a fix.
  """ -> prompt() :> $analysis

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
"content of {$file}" :> $content

$content -> .contains("ERROR") ? {
  "Read failed" -> return
}

"analyzed: {$content}" :> $analysis

$analysis -> .contains("FAIL") ? {
  "Analysis failed" -> return
}

"Pipeline complete: {$analysis}"
```

## Arithmetic in Loops

Uses bar-delimited arithmetic for calculations within workflow logic.

```rill
---
args: items: string
---

# Count items and calculate batch sizes
prompt("Count items in {$items}") -> .match("(\\d+) items") :> $m

$m -> ?(.empty()) {
  error("Could not parse item count")
}

$m.groups[0] -> .num :> $count

# Calculate batches: ceil(count / 10)
(($count + 9) / 10) :> $batches

"Processing {$count} items in {$batches} batches" -> log

# Process each batch using range
range(1, $batches + 1) -> each {
  $ :> $batch_num
  (($batch_num - 1) * 10) :> $start
  ($start + 10) :> $end

  """
Process batch {$batch_num} of {$batches}
Items {$start} through {$end}
  """ -> prompt()}

[0, "Processed all batches"]
```

## Signal-Based Workflow

Uses explicit signals for workflow control.

```rill
---
args: task: string
exceptions:
  - ":::BLOCKED:::"
  - ":::NEEDS_HUMAN:::"
---

"""
Work on this task: {$task}

Rules:
- Output :::BLOCKED::: if you need information you don't have
- Output :::NEEDS_HUMAN::: if human judgment is required
- Output :::DONE::: when complete
""" -> prompt() :> $result

$result -> @(!.contains(":::DONE:::")) {
  """
Continue working on: {$task}

Previous progress:
{$}

Remember the signal rules.
  """ -> prompt()} :> $final

"Task complete: {$final}" -> log
```

## Extraction Operators

Demonstrates destructuring, slicing, and enumeration.

### Destructuring Function Results

```rill
# Destructure list results into named variables
["test output", 0] -> *<$out, $code>

$code -> .gt(0) ? {
  "Tests failed:\n{$out}" -> log
}

"All tests passed" -> log
```

### Processing Structured Data

```rill
# Process list of [file, mode] pairs
[
  ["src/auth.ts", "security"],
  ["src/api.ts", "performance"],
  ["src/db.ts", "security"]
] -> each {
  $ -> *<$f, $mode>
  "Review {$f} for {$mode} issues" -> log
}
```

### Enumerated Progress

```rill
# ...
# enumerate($tasks) -> each {
#   "[{$.index + 1}/{$tasks.len}] Processing: {$.value}" -> log()
#   prompt("Complete task: {$.value}")
# }
```

### Slicing Results

```rill
# Get first 3 items
["a", "b", "c", "d", "e"] -> /<:3>
# ["a", "b", "c"]
```

```rill
# Process in reverse order
["a", "b", "c"] -> /<::-1>
# ["c", "b", "a"]
```

### Dict Iteration

```rill
# Use .entries to iterate over dict key-value pairs
[host: "localhost", port: 8080] -> .entries -> each {
  "{$[0]}={$[1]}"
} -> .join("\n")
```

## Args Type and Strict Invocation

Explicit argument unpacking with validation.

### Positional Args

```rill
# Define a function
|a, b, c| { "{$a}-{$b}-{$c}" } :> $fmt

# Create args from tuple and invoke
*[1, 2, 3] -> $fmt()    # "1-2-3"

# Store args for later use
*[1, 2, 3] :> $myArgs
$myArgs -> $fmt()       # "1-2-3"
```

### Named Args

```rill
# Named args match by parameter name, order doesn't matter
|width, height|($width * $height) :> $area

*[height: 20, width: 10] -> $area()  # 200
```

### Parameter Defaults

```rill
# Defaults provide opt-in leniency
|x, y = 10, z = 20|($x + $y + $z) :> $fn

*[5] -> $fn()                 # 35 (5 + 10 + 20)
*[x: 5, z: 30] -> $fn()       # 45 (5 + 10 + 30)
```

### Type Checking with Global Functions

```rill
# Use type() to inspect values
42 -> type              # "number"
"hello" -> type         # "string"
[1, 2] -> type          # "list"
*[1, 2] -> type         # "tuple"
[a: 1] -> type          # "dict"

# Use json() to serialize
[name: "test", count: 42] -> json
# '{"name":"test","count":42}'

# Use log() to debug while continuing pipe
"processing" -> log -> .len    # logs "processing", returns 10
```

## Parsing LLM Output

Built-in functions for extracting structured data from LLM responses.

### Auto-Detect with `parse_auto`

```rill
# parse_auto detects and extracts structured content
"{{\"status\": \"ok\", \"count\": 42}}" -> parse_auto :> $result

$result.type -> log        # "json"
$result.data.status -> log # "ok"
```

For XML content, use `parse_xml` for more precise extraction:

```rill
"<response>200</response>" -> parse_xml("response")
# "200"
```

### Extract JSON from Fenced Blocks

```rill
# LLM returns: "Here's the config:\n```json\n{...}\n```"
prompt("Generate JSON config") -> parse_fence("json") -> parse_json :> $config

# Access parsed data
$config.host -> log
$config.port -> log
```

### Extract XML Tags (Claude-Style)

```rill
# LLM returns: "<thinking>...</thinking><answer>...</answer>"
prompt("Analyze step by step") :> $response

# Extract thinking for logging
$response -> parse_xml("thinking") -> log

# Extract and parse answer
$response -> parse_xml("answer") -> parse_json :> $answer
```

### Parse Tool Calls

```rill
"""
What function should I call?
Return in format: <tool><name>func</name><args>{...}</args></tool>
""" -> prompt() :> $response

$response -> parse_xml("tool") :> $tool
$tool -> parse_xml("name") :> $fn_name
$tool -> parse_xml("args") -> parse_json :> $fn_args

# Call the function
call($fn_name, $fn_args)
```

### Process Checklists

```rill
# parse_checklist extracts checkbox items as [done, text] pairs
"- [ ] Deploy to staging\n- [x] Run tests\n- [ ] Update docs" -> parse_checklist :> $tasks

# Filter incomplete tasks
$tasks -> filter |task| { !$task.at(0) } -> each |task| {
  "TODO: " -> log
  $task.at(1) -> log
}
```

### Parse Frontmatter Documents

```rill
# parse_frontmatter extracts YAML header and body
"---\ntitle: Guide\nstatus: draft\n---\nContent here" -> parse_frontmatter :> $doc

$doc.meta.title -> log    # "Guide"
$doc.body -> log          # "Content here"
```

### Multi-Block Extraction

```rill
# parse_fences extracts all fenced code blocks
"```python\nprint(1)\n```\n```js\nconsole.log(1)\n```" -> parse_fences -> each {
  $.lang -> log
  $.content -> log
}
```

### Structured Response Validation

```rill
# Validate parsed content before use
"{{\"status\": \"ok\", \"items\": [1, 2, 3]}}" -> parse_auto :> $result

($result.type != "json") ? {
  "Expected JSON" -> log
}

$result.data.status -> log   # "ok"
$result.data.items -> each { $ -> log }
```

## Collection Operations

Pipeline operators for map, reduce, find, and aggregate patterns.

### Map with Parallel Spread

```rill
# Define closure first, then use it
|x| { $x * 2 } :> $double
[1, 2, 3, 4, 5] -> map $double
# [2, 4, 6, 8, 10]

# Map with inline block
["alice", "bob", "carol"] -> map { "Hello, {$}!" }
# ["Hello, alice!", "Hello, bob!", "Hello, carol!"]
```

### Filter with Parallel Filter

```rill
# Keep elements matching condition (block form)
[1, 2, 3, 4, 5] -> filter { .gt(2) }
# [3, 4, 5]

# Filter with closure predicate
|x| { $x % 2 == 0 } :> $even
[1, 2, 3, 4, 5, 6] -> filter $even
# [2, 4, 6]

# Filter non-empty strings
["hello", "", "world", ""] -> filter { !.empty }
# ["hello", "world"]

# Chain filter and map
|x| { $x * 2 } :> $dbl
[1, 2, 3, 4, 5] -> filter { .gt(2) } -> map $dbl
# [6, 8, 10]

# Filter structured data
[
  [name: "alice", age: 30],
  [name: "bob", age: 17],
  [name: "carol", age: 25]
] -> filter { $.age -> .ge(18) }
# [[name: "alice", age: 30], [name: "carol", age: 25]]
```

### Reduce with Sequential Spread

```rill
# Chain transformations
|s|"{$s} -> validated" :> $validate
|s|"{$s} -> processed" :> $process
|s|"{$s} -> complete" :> $complete

"input" -> @[$validate, $process, $complete]
# "input -> validated -> processed -> complete"

# Numeric reduction
|x|($x + 10) :> $add10
|x|($x * 2) :> $double

5 -> @[$add10, $double, $add10]
# ((5 + 10) * 2) + 10 = 40
```

### Find First Match

```rill
# Find first element matching condition
[1, 2, 3, 4, 5] -> each {
  .gt(3) ? { $ -> break }
} :> $found
# 4

# Find with default
[1, 2, 3] -> each {
  .gt(10) ? { $ -> break }
} :> $result
$result -> .empty ? { "not found" } ! { "found: {$result}" }
```

### Aggregate/Sum

```rill
# Sum numbers using fold
[10, 20, 30, 40] -> fold(0) { $@ + $ }
# 100

# Count matching elements using filter
$items -> filter { .contains("error") } -> .len :> $count
"Found {$count} errors" -> log
```

### Transform and Collect

```rill
# Process items, collect results using map
["file1.txt", "file2.txt", "file3.txt"] -> map { "analyzed: {$}" } -> .join("\n")
# "analyzed: file1.txt\nanalyzed: file2.txt\nanalyzed: file3.txt"
```
