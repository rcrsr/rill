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
5 -> :>string
# Result: "5"
```

### Number from String

```text
"42" -> $ + 1
# Error: Arithmetic requires number, got string
```

**Fix:** Convert with `:>number`.

```rill
"42" -> :>number -> ($ + 1)
# Result: 43
```

Non-numeric strings throw on conversion:

```text
"abc" -> :>number
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
# Result: false
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
42 -> :>string => $x     # OK: still a string
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
$list -> .empty ? "nothing" ! $list -> .head
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

## See Also

| Document | Description |
|----------|-------------|
| [Error Reference](ref-errors.md) | All error codes with causes and resolutions |
| [Types](topic-types.md) | Type rules and value semantics |
| [Design Principles](topic-design-principles.md) | Why rill works this way |
| [Guide](guide-getting-started.md) | Beginner-friendly introduction |
