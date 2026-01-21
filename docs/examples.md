# rill Core Examples

Examples demonstrating core language features for workflow orchestration.

> **Note:** These examples assume the host provides `prompt()`, `error()`, and other domain functions. rill is a vanilla language—all integrations come from the host runtime. Frontmatter is opaque to rill; the host parses it and provides named variables to the script context.

## Feature Implementation Workflow

Validates requirements, creates spec, iterates on review, then implements.

```text
---
timeout: 00:10:00
args: requirements: string
---

# Phase 1: Validate requirements
prompt(<<EOF
Review the requirements document at {$requirements}.
Check for completeness and clarity.
Output READY if complete, or list missing elements.
EOF
) -> $validation

$validation -> ?(!.contains("READY")) {
  error("Requirements incomplete: {$validation}")
}

# Phase 2: Create specification
prompt(<<EOF
Create a technical specification from {$requirements}.
Include API design, data models, and component structure.
EOF
) -> $spec

"Specification created" -> log

# Phase 3: Review loop - iterate until approved
($spec -> .contains("REVISION")) @ {
  prompt(<<EOF
Review this specification for issues:
{$}

Output APPROVED if ready, or REVISION REQUIRED with feedback.
EOF
  ) -> $review

  $review -> ?(.contains("APPROVED")) { break }

  # Apply feedback and continue
  prompt(<<EOF
Update the specification based on this feedback:
{$review}

Original spec:
{$}
EOF
  )
} -> $approved_spec

# Phase 4: Implementation
prompt(<<EOF
Implement the approved specification:
{$approved_spec}

Create the necessary files and tests.
EOF
) -> $implementation

# Phase 5: Verify
prompt("Run tests and verify implementation") -> $verification

$verification -> ?(.contains("PASS")) {
  [0, "Workflow complete"]
} ! {
  [1, "Verification failed: {$verification}"]
}
```

## Document-Driven Task Loop

Works through a checklist until complete.

```text
---
args: plan: string
---

# Initial check
prompt("Read {$plan} and find the first unchecked item (- [ ])") -> $status

# Work loop
$status -> @(!.contains("ALL COMPLETE")) {
  prompt(<<EOF
Based on this status:
{$}

1. Implement the identified unchecked item
2. Mark it complete in {$plan}
3. Check if any unchecked items remain
4. Output ALL COMPLETE if done, or describe next item
EOF
  )
} -> $final

"Plan complete: {$final}" -> log
```

## Test-Fix Loop

Runs tests, fixes failures, repeats until passing.

```text
---
args: target: string
---

# Run tests
prompt("Run tests for {$target} and report results") -> $result

# Fix loop
$result -> @(.contains("FAIL")) {
  "Fixing failures..." -> log

  prompt(<<EOF
Fix these test failures:
{$}

Make minimal changes. Then run tests again and report results.
EOF
  )
} -> $final

$final -> ?(.contains("PASS")) {
  "All tests passing"
} ! {
  error("Could not fix all tests")
}
```

## Code Review

Reviews code against multiple criteria.

```text
---
args: file: string
---

# Get file summary
prompt("Read and summarize {$file}") -> $summary

# Security check
prompt(<<EOF
Evaluate for SECURITY issues:
{$summary}

Output PASS, WARN, or FAIL with explanation.
EOF
) -> $security

# Performance check
prompt(<<EOF
Evaluate for PERFORMANCE issues:
{$summary}

Output PASS, WARN, or FAIL with explanation.
EOF
) -> $performance

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

```text
---
args: service: string
---

# Validate environment
$ENV.DEPLOY_ENV -> ?(.empty()) {
  error("DEPLOY_ENV not set")
}

# Environment-specific deployment
($ENV.DEPLOY_ENV == "production") ? {
  prompt(<<EOF
Deploy {$service} to production.
- Run full test suite first
- Enable monitoring
- Use blue-green deployment
EOF
  )
} ! ($ENV.DEPLOY_ENV == "staging") ? {
  prompt(<<EOF
Deploy {$service} to staging.
- Run smoke tests
- Enable debug logging
EOF
  )
} ! {
  prompt("Deploy {$service} to development environment")
} -> $result

"Deployment complete" -> log
[0, "Deployed {$service} to {$ENV.DEPLOY_ENV}"]
```

## Retry Pattern

Retries an operation until success or max attempts.

```text
---
args: operation: string
---

# Attempt loop with counter in prompt
prompt(<<EOF
Attempt 1 of 3: {$operation}

If successful, output SUCCESS.
If failed but retryable, output RETRY with what went wrong.
If failed permanently, output FAILED with reason.
EOF
) -> $result

^(limit: 3) ($result -> .contains("RETRY")) @ {
  pause("00:00:05")

  prompt(<<EOF
Previous attempt result:
{$}

Try again. Output SUCCESS, RETRY, or FAILED.
EOF
  ) -> $result
} -> $final

$final -> ?(.contains("SUCCESS")) {
  [0, "Operation succeeded"]
} ! {
  [1, "Operation failed: {$final}"]
}
```

### Do-While Retry

When you always want at least one attempt, do-while is cleaner:

```text
---
args: operation: string
---

# Do-while: body runs first, then condition checked
^(limit: 5) @ {
  prompt(<<EOF
Perform: {$operation}

Output SUCCESS, RETRY, or FAILED.
EOF
  )
} ? (.contains("RETRY"))

# Loop exits when result doesn't contain RETRY
.contains("SUCCESS") ? [0, "Succeeded"] ! [1, "Failed: {$}"]
```

The do-while form eliminates the separate first-attempt code since the body always executes at least once.

## Inline Capture Pattern

Captures mid-chain for debugging or later reference while data continues flowing.

```text
---
args: file: string
---

# Inline capture: value flows through $raw to log to conditional
prompt("Read {$file}") -> $raw -> log -> ?(.contains("ERROR")) {
  error("Failed to read: {$raw}")
}

# Continue with $raw available for later use
prompt("Analyze this content:\n{$raw}") -> $analysis -> log -> ?(.empty()) {
  error("Analysis produced no output")
}

# Both $raw and $analysis available
prompt(<<EOF
Compare the original:
{$raw}

With the analysis:
{$analysis}
EOF
)
```

Semantically, `-> $var ->` is `-> $var.set($) ->` — the capture acts like `log`, storing the value while passing it through unchanged.

## Type-Safe Variables

Uses type annotations to prevent accidental type changes during script execution.

```text
---
args: file: string
---

# Define a typed helper closure
|input: string| {
  prompt("Validate: {$input}") -> ?(.contains("VALID")) { true } ! { false }
} -> $validate:closure

# Capture with explicit type locks the variable
"processing" -> $status:string
"checking {$file}" -> $status          # OK: same type
# 42 -> $status                        # ERROR: cannot assign number to string

# Closures are type-locked too
# "oops" -> $validate                  # ERROR: cannot assign string to closure

# Inline type annotation in pipe chain
prompt("Check {$file}") -> $result:string -> log -> ?(.contains("ERROR")) {
  error($result)
}

# Type annotations catch mistakes early
prompt("Analyze {$file}") -> $analysis:string

?(.contains("FAIL")) {
  error("Analysis failed: {$analysis}")
}

[0, "Processing complete"]
```

## Pattern Extraction

Extracts specific information from responses.

```text
---
args: logfile: string
---

prompt("Read {$logfile} and find all ERROR lines") -> $errors

$errors -> ?(.empty()) {
  "No errors found"
} ! {
  prompt(<<EOF
Analyze these errors and categorize them:
{$errors}

For each unique error type, suggest a fix.
EOF
  ) -> $analysis

  "Error analysis complete" -> log
  $analysis
}
```

## Multi-Phase Pipeline with Bailout

Each phase can halt the pipeline on failure.

```text
---
args: file: string
---

{
  # Phase 1: Read
  prompt("Read {$file} and validate format") -> $content
  $content -> ?(.contains("INVALID")) { "Read failed: invalid format" -> return }

  # Phase 2: Analyze
  prompt("Analyze this content:\n{$content}") -> $analysis
  $analysis -> ?(.contains("ERROR")) { "Analysis failed" -> return }

  # Phase 3: Transform
  prompt("Transform based on analysis:\n{$analysis}") -> $result
  $result -> ?(.contains("FAILED")) { "Transform failed" -> return }

  # Success
  [0, $result]
} -> $outcome

$outcome -> ?(.contains("failed")) {
  error($outcome)
} ! {
  "Pipeline complete"
}
```

## Arithmetic in Loops

Uses bar-delimited arithmetic for calculations within workflow logic.

```text
---
args: items: string
---

# Count items and calculate batch sizes
prompt("Count items in {$items}") -> .match("(\\d+) items") -> $m

$m -> ?(.empty()) {
  error("Could not parse item count")
}

$m.groups[0] -> .num -> $count

# Calculate batches: ceil(count / 10)
(($count + 9) / 10) -> $batches

"Processing {$count} items in {$batches} batches" -> log

# Process each batch
1 -> $batch_num
@($batch_num -> .le($batches)) {
  (($batch_num - 1) * 10) -> $start
  ($start + 10) -> $end

  prompt(<<EOF
Process batch {$batch_num} of {$batches}
Items {$start} through {$end}
EOF
  )

  ($batch_num + 1) -> $batch_num
} -> $result

[0, "Processed all batches"]
```

## Signal-Based Workflow

Uses explicit signals for workflow control.

```text
---
args: task: string
exceptions:
  - ":::BLOCKED:::"
  - ":::NEEDS_HUMAN:::"
---

prompt(<<EOF
Work on this task: {$task}

Rules:
- Output :::BLOCKED::: if you need information you don't have
- Output :::NEEDS_HUMAN::: if human judgment is required
- Output :::DONE::: when complete
EOF
) -> $result

$result -> @(!.contains(":::DONE:::")) {
  prompt(<<EOF
Continue working on: {$task}

Previous progress:
{$}

Remember the signal rules.
EOF
  )
} -> $final

"Task complete: {$final}" -> log
```

## Extraction Operators

Demonstrates destructuring, slicing, and enumeration.

### Destructuring Function Results

```text
# exec() is host-provided, returns [output: string, exitcode: number]
exec("run-tests", [$ARGS[0]]) -> *<output: $out, exitcode: $code>

$code -> ?(.gt(0)) {
  "Tests failed:\n{$out}" -> log
  error("Test failure")
}

"All tests passed" -> log
```

### Processing Structured Data

```text
# Process list of [file, mode] pairs
[
  ["src/auth.ts", "security"],
  ["src/api.ts", "performance"],
  ["src/db.ts", "security"]
] -> each {
  $ -> *<$file, $mode>
  prompt("Review {$file} for {$mode} issues")
}
```

### Enumerated Progress

```text
enumerate($tasks) @ {
  "[{$.index + 1}/{$tasks.len}] Processing: {$.value}" -> log()
  prompt("Complete task: {$.value}")
}
```

### Slicing Results

```text
# Get first 3 errors
prompt("List all errors") -> .lines() -> /<:3> -> each {
  prompt("Fix error: {$}")
}

# Process in reverse order
$items -> /<::-1> -> each {
  prompt("Process {$}")
}
```

### Dict Iteration

```text
# Iterate over dict directly (yields { key, value } objects)
[host: "localhost", port: 8080, debug: true] -> each {
  "{$.key}={$.value}"
} -> .join("\n")
# "debug=true\nhost=localhost\nport=8080"

# Use enumerate() when you need the index
enumerate([host: "localhost", port: 8080]) @ {
  "{$.index}: {$.key}={$.value}"
}
# => ["0: host=localhost", "1: port=8080"]
```

## Args Type and Strict Invocation

Explicit argument unpacking with validation.

### Positional Args

```text
# Define a function
|a, b, c| { "{$a}-{$b}-{$c}" } -> $fmt

# Create args from tuple and invoke
*[1, 2, 3] -> $fmt()    # "1-2-3"

# Store args for later use
*[1, 2, 3] -> $myArgs
$myArgs -> $fmt()       # "1-2-3"
```

### Named Args

```text
# Named args match by parameter name, order doesn't matter
|width, height|($width * $height) -> $area

*[height: 20, width: 10] -> $area()  # 200
```

### Parameter Defaults

```text
# Defaults provide opt-in leniency
|x, y = 10, z = 20|($x + $y + $z) -> $fn

*[5] -> $fn()                 # 35 (5 + 10 + 20)
*[x: 5, z: 30] -> $fn()       # 45 (5 + 10 + 30)
```

### Type Checking with Global Functions

```text
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

### Auto-Detect with `parse`

```text
# Parse any structured response
prompt("Return a JSON config") -> parse_auto -> $result

?($result.type == "json") {
  $result.data -> process_config()
} ! {
  error("Expected JSON, got {$result.type}")
}

# Check confidence for ambiguous responses
prompt("Analyze this") -> parse_auto -> $parsed
?($parsed.confidence -> .lt(0.8)) {
  "Low confidence parse: {$parsed.type}" -> log
}
```

### Extract JSON from Fenced Blocks

```text
# LLM returns: "Here's the config:\n```json\n{...}\n```"
prompt("Generate JSON config") -> parse_fence("json") -> parse_json -> $config

# Access parsed data
$config.host -> log
$config.port -> log
```

### Extract XML Tags (Claude-Style)

```text
# LLM returns: "<thinking>...</thinking><answer>...</answer>"
prompt("Analyze step by step") -> $response

# Extract thinking for logging
$response -> parse_xml("thinking") -> log

# Extract and parse answer
$response -> parse_xml("answer") -> parse_json -> $answer
```

### Parse Tool Calls

```text
prompt(<<EOF
What function should I call?
Return in format: <tool><name>func</name><args>{...}</args></tool>
EOF
) -> $response

$response -> parse_xml("tool") -> $tool
$tool -> parse_xml("name") -> $fn_name
$tool -> parse_xml("args") -> parse_json -> $fn_args

# Call the function
call($fn_name, $fn_args)
```

### Process Checklists

```text
# LLM returns task list with checkboxes
prompt("Create a todo list for deployment") -> parse_checklist -> $tasks

# Filter incomplete tasks
$tasks -> filter { !$.0 } -> each {
  "TODO: {$.1}" -> log
}

# Count completed
$tasks -> filter { $.0 } -> .len -> $done
"{$done} of {$tasks -> .len} tasks complete" -> log
```

### Parse Frontmatter Documents

```text
# LLM returns document with YAML frontmatter
prompt("Generate a document with metadata") -> parse_frontmatter -> $doc

$doc.meta.title -> log
$doc.meta.status -> ?(.eq("draft")) {
  "Document is still in draft" -> log
}

$doc.body -> process_content()
```

### Repair Malformed JSON

```text
# LLM returns JSON with common errors
# {name: 'test', items: [1, 2, 3,],}
prompt("Return JSON data") -> parse_json -> $data

# parse_json auto-repairs:
# - Unquoted keys (name: -> "name":)
# - Single quotes ('test' -> "test")
# - Trailing commas ([1, 2, 3,] -> [1, 2, 3])
```

### Multi-Block Extraction

```text
# LLM returns multiple code examples
prompt("Show examples in Python, JavaScript, and TypeScript") -> parse_fences -> each {
  "{$.lang}:" -> log
  $.content -> log
  "" -> log
}
```

### Structured Response Validation

```text
# Expect specific format, validate before use
prompt("Return JSON with 'status' and 'items' fields") -> parse_auto -> $result

?($result.type != "json") {
  error("Expected JSON response")
}

?($result.data.status -> .empty) {
  error("Missing 'status' field")
}

?($result.data.items -> type -> .ne("tuple")) {
  error("'items' must be an array")
}

$result.data.items -> each {
  process_item($)
}
```

## Collection Operations

Pipeline operators for map, reduce, find, and aggregate patterns.

### Map with Parallel Spread

```text
# Transform each element
|x|($x * 2) -> $double
[1, 2, 3, 4, 5] -> map $double
# [2, 4, 6, 8, 10]

# Map with inline block
["alice", "bob", "carol"] -> map { "Hello, {$}!" }
# ["Hello, alice!", "Hello, bob!", "Hello, carol!"]

# Parallel API calls
$endpoints -> map {
  prompt("Fetch status from {$}")
}
```

### Filter with Parallel Filter

```text
# Keep elements matching condition (block form)
[1, 2, 3, 4, 5] -> filter { .gt(2) }
# [3, 4, 5]

# Filter with closure predicate
|x|($x % 2 == 0) -> $even
[1, 2, 3, 4, 5, 6] -> filter $even
# [2, 4, 6]

# Filter non-empty strings
["hello", "", "world", ""] -> filter { !.empty }
# ["hello", "world"]

# Chain filter and map
[1, 2, 3, 4, 5] -> filter { .gt(2) } -> map $double
# [6, 8, 10]

# Filter log lines for errors
$log -> .lines -> filter { .contains("ERROR") } -> each {
  prompt("Analyze error: {$}")
}

# Filter structured data
[
  [name: "alice", age: 30],
  [name: "bob", age: 17],
  [name: "carol", age: 25]
] -> filter { $.age -> .ge(18) }
# [[name: "alice", age: 30], [name: "carol", age: 25]]
```

### Reduce with Sequential Spread

```text
# Chain transformations
|s|"{$s} -> validated" -> $validate
|s|"{$s} -> processed" -> $process
|s|"{$s} -> complete" -> $complete

"input" -> @[$validate, $process, $complete]
# "input -> validated -> processed -> complete"

# Numeric reduction
|x|($x + 10) -> $add10
|x|($x * 2) -> $double

5 -> @[$add10, $double, $add10]
# ((5 + 10) * 2) + 10 = 40
```

### Find First Match

```text
# Find first element matching condition
[1, 2, 3, 4, 5] -> each {
  ?(.gt(3)) { $ -> break }
} -> $found
# 4

# Find with default
[1, 2, 3] -> each {
  ?(.gt(10)) { $ -> break }
} -> $result
$result -> ?(.empty) { "not found" } ! { "found: {$result}" }
```

### Aggregate/Sum

```text
# Sum numbers
0 -> $total
[10, 20, 30, 40] -> each {
  ($total + $) -> $total
}
$total
# 100

# Count matching elements
0 -> $count
$items -> each {
  ?(.contains("error")) {
    ($count + 1) -> $count
  }
}
"Found {$count} errors" -> log
```

### Transform and Collect

```text
# Process files, collect results
[] -> $results
$files -> each {
  prompt("Analyze {$}") -> $analysis
  [$results, $analysis] -> $results
}
$results -> .join("\n---\n")
```
