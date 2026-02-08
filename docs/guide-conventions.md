# rill Conventions and Idioms

*Idiomatic patterns for readable, maintainable rill code*

This document collects conventions and best practices. It is a living document that will grow as the language matures.

## Naming

### Case Style: snake_case

Use **snake_case** for all identifiers in rill:

```rill
# variables
"hello" => $user_name
[1, 2, 3] => $item_list
true => $is_valid

# closures
|x|($x * 2) => $double_value
|s|($s -> .trim) => $cleanup_text

# dict keys
[first_name: "Alice", last_name: "Smith", is_active: true] => $user
```

### Variables

Use descriptive snake_case names with `$` prefix:

```rill
"hello" => $greeting           # good: descriptive
"hello" => $g                  # avoid: too terse
```

For loop variables, short names are acceptable when scope is small:

```rill
[1, 2, 3] -> each |x| ($x * 2)    # fine: small scope
```

### Closures

Name closures for their action:

```rill
|x|($x * 2) => $double            # verb describing transformation
|s|($s -> .trim) => $cleanup      # verb describing action
||{ $.count * $.price } => $total # noun for computed value
```

## Capture and Flow

### Prefer inline capture when continuing the chain

Capture mid-chain with `=>` to store and continue:

```text
# good: capture and continue
prompt("Read file") => $raw -> log -> .contains("ERROR") ? {
  error("Failed: {$raw}")
}

# less clear: separate statements
prompt("Read file") => $raw
$raw -> log
$raw -> .contains("ERROR") ? { error("Failed: {$raw}") }
```

### Use explicit capture before branching

Capture values before conditionals when you need them in multiple branches:

```text
# good: $result available in both branches
checkStatus() => $result
$result -> .contains("OK") ? {
  "Success: {$result}"
} ! {
  "Failed: {$result}"
}
```

## Collection Operators

### Choose the right operator

| Use case | Operator | Why |
|----------|----------|-----|
| Transform each element | `map` | Parallel, all results |
| Transform with side effects | `each` | Sequential order |
| Keep matching elements | `filter` | Parallel filter |
| Reduce to single value | `fold` | Final result only |
| Running totals | `each(init)` | All intermediate results |
| Find first match | `each` + `break` | Early termination |

### Prefer method shorthand in collection operators

```rill
# good: concise
["hello", "world"] -> map .upper

# equivalent but verbose
["hello", "world"] -> map { $.upper() }
["hello", "world"] -> map |x| $x.upper()
```

Method chains work too:

```rill
["  HELLO  ", "  WORLD  "] -> map .trim.lower
```

### Use grouped form for negation

```rill
# correct: grouped negation
["", "a", "b"] -> filter (!.empty)

# wrong: .empty returns truthy elements
["", "a", "b"] -> filter .empty    # returns [""]
```

### Use fold for reduction, each(init) for running totals

```rill
# sum: use fold (returns final value)
[1, 2, 3] -> fold(0) { $@ + $ }    # 6

# running sum: use each (returns all intermediates)
[1, 2, 3] -> each(0) { $@ + $ }    # [1, 3, 6]
```

### Break returns partial results in each

```rill
[1, 2, 3, 4, 5] -> each {
  ($ == 3) ? break
  $ * 2
}
# Result: [2, 4] (elements processed BEFORE break)
```

## Loops

### Use $ as accumulator in while/do-while

```rill
# good: $ accumulates naturally
0 -> ($ < 5) @ { $ + 1 }

# avoid: named variables don't persist across iterations
0 -> ($ < 5) @ {
  $ => $x        # $x exists only in this iteration
  $x + 1
}
```

### Prefer do-while for retry patterns

Do-while runs body at least once, eliminating duplicate first-attempt code:

```text
# good: body runs at least once
@ {
  attemptOperation()
} ? (.contains("RETRY"))

# less clean: separate first attempt
attemptOperation() => $result
$result -> .contains("RETRY") @ {
  attemptOperation()
}
```

### Use each for collection iteration, not while

```text
# good: each is designed for collections
$items -> each { process($) }

# avoid: manual iteration with while
$items -> .first() -> (!$.done) @ {
  process($.value)
  $.next()
}
```

## Conditionals

### Condition must be boolean

The condition in `cond ? then ! else` must evaluate to boolean:

```rill
# correct: .contains() returns boolean
"hello" -> .contains("ell") ? "found" ! "not found"

# correct: comparison returns boolean
5 -> ($ > 3) ? "big" ! "small"
```

### Use ?? for defaults, not conditionals

```text
# good: concise default
$dict.field ?? "default"

# avoid: verbose conditional
$dict.?field ? $dict.field ! "default"
```

### Chain conditionals for multi-way branching

```text
($status == "ok") ? {
  "Success"
} ! ($status == "pending") ? {
  "Waiting"
} ! {
  "Unknown: {$status}"
}
```

### Multi-line conditionals for readability

Use 2-space indent for `?` and `!` continuations:

```text
# good: multi-line conditional
some_condition
  ? "yes"
  ! "no"

# good: piped conditional split
value -> is_valid
  ? "ok"
  ! "error"

# good: chained else-if
$val -> .eq("A") ? "a"
  ! .eq("B") ? "b"
  ! "c"

# avoid: inconsistent indent
condition
    ? "yes"
  ! "no"
```

## Closures

### Use braces for complex bodies

```rill
# simple: parentheses ok
|x|($x * 2) => $double

# complex: braces required
|n| {
  ($n < 1) ? 1 ! ($n * $factorial($n - 1))
} => $factorial
```

### Capture loop variable explicitly for deferred closures

```rill
# good: explicit capture per iteration
[1, 2, 3] -> each {
  $ => $item
  || { $item }
} => $closures

# result: closures return [1, 2, 3] when called
```

### Dict closures for computed properties

Zero-arg closures auto-invoke when accessed:

```rill
[
  items: [1, 2, 3],
  count: ||{ $.items -> .len }
] => $data

$data.count    # 3 (auto-invokes)
```

Parameterized closures work as methods:

```rill
[
  name: "test",
  greet: |x|{ "{$.name}: {$x}" }
] => $obj

$obj.greet("hello")    # "test: hello"
```

## Type Safety

### Annotate closure parameters for clarity

```rill
|name: string, count: number| {
  "{$name}: {$count}"
} => $format
```

### Capture with type annotation for documentation

```rill
"processing" => $status:string
```

### Use type assertions sparingly

Type assertions (`:type`) are for validation, not conversion:

```text
# good: validate external input
parseJson($input):dict => $data

# unnecessary: type is already known
5:number => $n
```

## String Handling

### Use triple-quotes for multiline content

```text
"""
Analyze this content:
{$content}

Provide a summary.
"""
```

### Use .empty for emptiness checks

```rill
# idiomatic: use .empty property
"" -> .empty ? "empty" ! "not empty"
```

Direct string comparison works but `.empty` is preferred:

```text
# works, but verbose
$str == "" ? "empty"

# idiomatic: clearer intent
$str -> .empty ? "empty"
```

### Chain string methods naturally

```rill
"  HELLO world  " -> .trim.lower.split(" ")
```

## Error Handling

### Validate early with conditionals

```text
$input -> .empty ? { error("Input required") }

# continue with validated input
process($input)
```

### Use explicit signals for workflow control

```text
prompt("...") => $result

$result -> .contains(":::ERROR:::") ? {
  error("Operation failed: {$result}")
}

$result -> .contains(":::DONE:::") ? {
  "Complete" -> return
}
```

## Parsing LLM Output

### Chain parsers for structured extraction

```text
# extract JSON from code fence
$response -> parse_fence("json") -> parse_json => $data
```

### Use parse_auto for unknown formats

```text
$response -> parse_auto => $parsed
($parsed.type == "json") ? {
  $parsed.data
} ! {
  error("Expected JSON, got {$parsed.type}")
}
```

### Extract XML tags for Claude-style responses

```text
$response -> parse_xml("thinking") -> log
$response -> parse_xml("answer") => $answer
```

## Anti-Patterns

### Avoid reassigning variables

Variables lock to their first type. Reassigning suggests misuse:

```text
# avoid: confusing reassignment
"initial" => $x
"updated" => $x    # works but unclear

# prefer: new variable or functional style
"initial" -> transform() => $result
```

### Avoid bare $ in stored closures

```rill
# confusing: what is $?
|| { $ + 1 } => $fn    # $ is undefined when called

# clear: explicit parameter
|x| { $x + 1 } => $fn
```

### Avoid break in parallel operators

Break is not supported in `map` or `filter` (they run in parallel):

```text
# wrong: break in map
[1, 2, 3] -> map { ($ > 2) ? break }

# correct: use each if you need break
[1, 2, 3] -> each { ($ > 2) ? break }

# or filter first
[1, 2, 3] -> filter { $ <= 2 } -> map { $ }
```

### Avoid complex logic in conditions

```text
# hard to read
(($x > 5) && (($y < 10) || ($z == 0))) ? { ... }

# clearer: extract to named check
($x > 5) => $big_enough
(($y < 10) || ($z == 0)) => $valid_range
($big_enough && $valid_range) ? { ... }
```

## Formatting

### Spacing Rules

**Operators**: space on both sides

```text
# good
5 + 3
$x -> .upper
"hello" => $greeting
($a == $b) ? "yes" ! "no"

# avoid
5+3
$x->.upper
"hello"=>$greeting
```

**Parentheses**: no inner spaces

```text
# good
($x + 1)
($ > 3) ? "big"
[1, 2, 3] -> each |x| ($x * 2)

# avoid
( $x + 1 )
( $ > 3 ) ? "big"
```

**Braces**: space after `{` and before `}`

```text
# good
{ $x + 1 }
[1, 2, 3] -> each { $ * 2 }
|x| { $x -> .trim }

# avoid
{$x + 1}
[1, 2, 3] -> each {$ * 2}
```

**Multiline braces**: opening brace on same line, closing on own line

```text
# good
[1, 2, 3] -> each {
  $ => $item
  $item * 2
}

# avoid
[1, 2, 3] -> each
{
  $ * 2
}
```

**Brackets**: no inner spaces for indexing

```text
# good
$list[0]
$dict.items[1]

# avoid
$list[ 0 ]
```

**List/dict literals**: space after colons and commas

```text
# good
[1, 2, 3]
[name: "alice", age: 30]

# avoid
[1,2,3]
[name:"alice",age:30]
```

**Closure parameters**: no space before pipe, space after

```text
# good
|x| ($x * 2)
|a, b| { $a + $b }
|| { $.count }

# avoid
| x | ($x * 2)
|a,b|{ $a + $b }
```

**Method calls**: no space before dot or parentheses

```text
# good
$str.upper()
$list.join(", ")
"hello" -> .trim.lower

# avoid
$str .upper()
$list.join (", ")
```

**Pipes**: space on both sides of `->` and `=>`

```text
# good
"hello" -> .upper -> .len
"value" => $x -> log

# avoid
"hello"->.upper->.len
"value"=>$x->log
```

**Implicit `$` shorthand**: prefer sugared forms

```text
# methods: $.foo() -> .foo
# good
"hello" -> .upper -> .len
[1, 2, 3] -> map .str

# avoid
"hello" -> $.upper() -> $.len
[1, 2, 3] -> map $.str

# global functions: foo($) -> foo
# good
"hello" -> log -> .upper
42 -> type

# avoid
"hello" -> log($) -> .upper
42 -> type($)

# closures: $fn($) -> $fn
# good
|x| ($x * 2) => $double
5 -> $double

# avoid
5 -> $double($)
```

**No throwaway captures**: don't capture just to continue

```text
# avoid: unnecessary intermediate variables
"hello" => $x
$x -> .upper => $y
$y -> .len

# good: use line continuation instead
"hello"
  -> .upper
  -> .len

# good: capture only when reused later
"hello" => $input
$input -> .upper => $upper
"{$input} became {$upper}"    # both variables referenced
```

**Chain continuations**: indent continued lines by 2 spaces

```text
# good: align continuation with pipe
$data
  -> .filter { $.active }
  -> map { $.name }
  -> .join(", ")

# good: long method chains
"  hello world  "
  -> .trim
  -> .upper
  -> .split(" ")
  -> .join("-")

# good: capture mid-chain
prompt("analyze {$file}")
  => $result
  -> log
  -> .contains("ERROR") ? { error($result) }

# good: conditional continuation
value -> is_valid
  ? "ok"
  ! "error"

# good: split else-if chain
$val -> .eq("A") ? 1
  ! .eq("B") ? 2
  ! 3

# avoid: no indent on continuation
$data
-> .filter { $.active }
-> map { $.name }
```

### One statement per line for complex code

```text
# good: clear structure
$input -> validate() => $valid
$valid -> process() => $result
$result -> format()

# acceptable for simple chains
$input -> .trim -> .lower -> .split(" ")
```

### Indent block contents

```rill
{
  "first" => $a
  "second" => $b
  "{$a} {$b}"
}
```

### Align related captures

```text
prompt("Get name") => $name
prompt("Get age")  => $age
prompt("Get role") => $role
```

*This document will be extended as conventions emerge from real-world usage.*

## See Also

- [Design Principles](topic-design-principles.md) — Core philosophy
- [Reference](ref-language.md) — Language specification
- [Guide](guide-getting-started.md) — Getting started tutorial
