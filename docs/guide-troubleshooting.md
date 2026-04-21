# rill Troubleshooting

*Common mistakes, why they happen, and how to fix them*

## No Implicit Type Coercion

rill never converts between types automatically. Operations that silently coerce in other languages produce errors in rill.

### String + Number

```text
"count: " + 5
# Error: Arithmetic requires number, got string
```

**Fix:** Use string interpolation or explicit conversion.

```rill
"count: {5}"
# Result: "count: 5"
```

```rill
5 -> string
# Result: "5"
```

### Number from String

```text
"42" -> $ + 1
# Error: Arithmetic requires number, got string
```

**Fix:** Convert with `-> number`.

```rill
"42" -> number -> ($ + 1)
# Result: 43
```

Non-numeric strings throw on conversion:

```text
"abc" -> number
# Error: Cannot convert "abc" to number
```

## No Truthiness

rill requires actual `bool` values for conditions. Empty strings, zero, and empty lists are not "falsy."

### Condition Expects Boolean

```text
"hello" ? "yes" ! "no"
# Error: Conditional requires boolean, got string
```

**Fix:** Produce a boolean explicitly.

```rill
"hello" -> .empty -> (!$) ? "yes" ! "no"
# Result: "yes"
```

```rill
0 -> ($ == 0) ? "zero" ! "nonzero"
# Result: "zero"
```

### Negation Requires Boolean

```text
!"hello"
# Error: Negation requires boolean, got string
```

**Fix:** Negate a boolean expression.

```rill
"hello" -> .empty -> !$
# Result: true
```

## Type-Locked Variables

Variables lock to the type of their first assignment. Reassigning a different type fails.

```rill
"hello" => $x
"world" => $x            # OK: string to string
```

```text
42 => $x
# Error: cannot assign number to string variable $x
```

**Fix:** Use a new variable or convert the value.

```rill
"hello" => $x
42 -> string => $x       # OK: still a string
```

## Missing Dict Keys

Accessing a key that does not exist throws an error. rill has no `undefined` or `null`.

```text
[name: "alice"] => $person
$person.age
# Error: Key 'age' not found in dict
```

**Fix:** Use `??` for a default value, or `.?key` to check existence.

```rill
[name: "alice"] => $person
$person.age ?? 0
# Result: 0
```

```rill
[name: "alice"] => $person
$person.?age ? "has age" ! "no age"
# Result: "no age"
```

## List Index Out of Bounds

```text
["a", "b"] => $list
$list[5]
# Error: List index out of bounds
```

**Fix:** Check length before accessing.

```rill
["a", "b"] => $list
$list -> .len -> .gt(5) ? $list[5] ! "default"
# Result: "default"
```

## Pipe Value (`$`) Outside Pipe

`$` refers to the current pipe value. Using it outside a pipe context produces an error.

**Fix:** Capture with `=>` when you need the value later.

```rill
"hello" => $greeting -> .upper
$greeting
# Result: "hello"
```

## Empty Collection Operations

Methods like `.head` and `.tail` error on empty collections.

```text
[] -> .head
# Error: Cannot get head of empty list
```

**Fix:** Check `.empty` first.

```rill
[] => $list
$list -> .empty ? "nothing" ! ($list -> .head)
# Result: "nothing"
```

## Spread Type Mismatch

List spread requires a list operand. Dict spread requires a dict operand.

```text
"hello" => $str
[...$str]
# Error: Spread in list literal requires list, got string
```

**Fix:** Ensure the spread operand matches the container type.

```rill
"hello" -> .split("") => $chars
[...$chars]
# Result: ["h", "e", "l", "l", "o"]
```

## Closure Parameter Count

Calling a closure with wrong argument count produces an error.

```text
|a, b|($a + $b) => $add
$add(1)
# Error: Expected 2 arguments, got 1
```

**Fix:** Pass the correct number of arguments, or use default parameters.

```rill
|a, b = 0|($a + $b) => $add
$add(1)
# Result: 1
```

## Reserved Dict Keys

`keys`, `values`, and `entries` are reserved method names on dicts. Using them as keys produces errors.

```text
[keys: "test"]
# Error: Reserved key 'keys'
```

**Fix:** Choose a different key name.

```rill
[key_list: "test"] => $d
$d.key_list
# Result: "test"
```

## Debugging Tips

### Use `log` for Pipeline Inspection

`log` prints its input and passes the value through unchanged, so it works inline.

```rill
"hello" -> log -> .upper -> log -> .len
# Logs: "hello"
# Logs: "HELLO"
# Result: 5
```

### Use `json` to Inspect Structure

```rill
[name: "alice", scores: [90, 85, 92]] -> json -> log
# Logs: {"name":"alice","scores":[90,85,92]}
```

### Use `^type` to Check Types

```rill
[1, 2, 3] => $val
$val.^type.name -> log
# Logs: "list"
$val.^type.signature -> log
# Logs: "list(number)"
```

### Use Type Assertions to Validate

Insert `:type` assertions at pipe boundaries to catch unexpected types early.

```rill
[1, 2, 3] -> :list(number) -> map { $ * 2 }
# Result: [2, 4, 6]
```

## Stream Pitfalls

### Re-Iterating a Consumed Stream

A stream can be iterated only once. Passing it to a second collection operator halts execution.

```text
app::llm_stream("hello") => $s
$s -> each { $ }
$s -> map { $ }
# Error: RILL-R002: Stream already consumed; cannot re-iterate
```

**Fix:** Consume the stream once and store results in a variable if you need the data again.

```text
app::llm_stream("hello") => $s
$s -> fold("") { $@ ++ $ } => $full_text
$full_text -> log
$full_text -> .len -> log
```

### `yield` Outside a Stream Closure

`yield` is a keyword scoped to stream closure bodies. Using it outside that context is a parse error.

```text
"hello" -> yield
# Error: RILL-P: yield is not valid outside a stream closure body
```

`yield` is also invalid inside a stored closure defined within a stream body.

```text
|| {
  { $ -> yield } => $fn
  $fn(1)
}:stream(number):number
# Error: yield is not valid in stored closure
```

**Fix:** Use `yield` only as a terminator in a pipe chain inside the stream closure body directly.

```text
|| {
  "first" -> yield
  "second" -> yield
  return 2
}:stream(string):number => $producer
```

### Calling `$s()` Before Consuming the Stream

Calling `$s()` on a stream that has not been fully iterated triggers internal consumption. All chunks are consumed before the resolution value is returned. This prevents separate chunk processing afterward.

```text
app::llm_stream("hello") => $s
$s()    # forces internal consumption of all chunks
$s -> each { $ -> log }
# Error: RILL-R002: Stream already consumed; cannot re-iterate
```

**Fix:** Iterate chunks first, then call `$s()` for the resolution value.

```text
app::llm_stream("hello") => $s
$s -> each { $ -> log }
$s()    # safe: stream is closed, resolution is cached
```

### Stale Step Access with `.next()`

Manual stream iteration with `.next()` creates new step objects. Holding a reference to an old step and calling `.next()` on it halts execution.

```text
app::llm_stream("hello") => $s
$s.next() => $step1
$step1.next() => $step2
$step1.next()
# Error: RILL-R002: Stale step; this step is no longer current
```

**Fix:** Always reassign the step variable when advancing. Use `each` for automatic iteration instead.

```text
app::llm_stream("hello") => $s
$s -> each { $ -> log }
```

`$s()` remains valid on stale steps. Only `.next()` fails when called on a non-current step.

## My Script Halted at an Access

An access on an invalid value halts execution. Common causes: a host function returned an error, a type assertion failed, or a field did not exist.

**Symptom:** Script stops mid-execution with no apparent syntax error.

**Fix:** Wrap the risky access in `guard` to catch the halt and inspect the result.

```rill
"hello" => $val
guard { $val.upper } => $out
$out.! ? "halted: {$out.!message}" ! $out
# Result: "HELLO"
```

To find which operation halted, read `.!trace`:

```text
guard { app::fetch("https://api.example.com") } => $result
$result.!trace -> each { log("{$.kind} at {$.site}") }
```

Access halts are catchable. Halts from `error "..."` and `assert` are **non-catchable** and propagate through `guard`.

## Why Does `#MY_CODE` Not Match?

Atom comparison uses identity, not string equality. An atom name that was not registered resolves to `#R001`.

```text
# Error: #MY_CODE resolves to #R001 if not registered
$result.!code == #MY_CODE ? "matched" ! "no match"
```

**Cause:** `#MY_CODE` was not registered before the script ran.

**Fix:** Use a pre-registered atom, or register the atom via `ctx.registerErrorCode("MY_CODE", "generic")` in your host before running the script.

Use `.!` to test validity without comparing atoms:

```rill
"hello" => $val
guard { $val.upper } => $result
$result.! ? "invalid" ! "valid"
# Result: "valid"
```

Pre-registered atoms: `#TIMEOUT`, `#AUTH`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#NOT_FOUND`, `#CONFLICT`, `#INVALID_INPUT`, `#DISPOSED`, `#R001`, `#R999`. Note: `#ok` is a runtime sentinel, not a script-level atom literal — the lexer does not emit it.

To convert a registered atom to its string name:

```rill
#TIMEOUT -> string
# Result: TIMEOUT
```

## Guard Did Not Catch My Error

`guard` catches **catchable** halts only. Halts from `error "..."` and `assert` are non-catchable.

```text
# Non-catchable halt — propagates through guard
guard { error "fatal" }
# Error: non-catchable halt from 'error' propagates
```

**Cause 1:** The halt originated from `error "..."` or `assert`. These are intentional escalations, not recoverable failures.

**Cause 2:** A filtered `guard<on: list[#CODE]>` did not match the actual error code. Non-matching codes propagate.

```text
guard<on: list[#TIMEOUT]> {
  app::fetch("https://api.example.com")
  # If this returns #AUTH, the halt propagates — not caught
}
```

**Fix for cause 1:** Remove `guard` — the script must stop. If the error is expected, do not use `error "..."` to produce it. Use `ctx.invalidate` from the host instead.

**Fix for cause 2:** Widen the filter or remove it to catch all catchable codes.

```rill
"hello" => $val
guard { $val.upper } => $out
$out.!
# Result: false
```

The filter `<on: list[...]>` is optional. Without it, `guard` catches every catchable halt.

## See Also

| Document | Description |
|----------|-------------|
| [Error Reference](ref-errors.md) | All error codes with causes and resolutions |
| [Error Handling](topic-error-handling.md) | guard, retry, `.!`, and status probes |
| [Types](topic-types.md) | Type rules and value semantics |
| [Design Principles](topic-design-principles.md) | Why rill works this way |
| [Guide](guide-getting-started.md) | Beginner-friendly introduction |
