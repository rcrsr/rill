# rill String Methods Reference

String methods for text manipulation, pattern matching, and formatting.

## Case Conversion

| Method   | Signature    | Description           |
|----------|-------------|-----------------------|
| `.lower` | `() -> string` | Convert to lowercase |
| `.upper` | `() -> string` | Convert to uppercase |

```rill
"Hello World" -> .lower              # "hello world"
"Hello World" -> .upper              # "HELLO WORLD"
```

## Prefix and Suffix

| Method         | Signature              | Description                    |
|----------------|------------------------|--------------------------------|
| `.starts_with` | `(prefix: string) -> bool` | True if string starts with prefix |
| `.ends_with`   | `(suffix: string) -> bool` | True if string ends with suffix   |

```rill
"hello" -> .starts_with("he")        # true
"file.txt" -> .ends_with(".txt")     # true
"Hello" -> .starts_with("hello")     # false (case sensitive)
```

## Search and Position

| Method      | Signature              | Description                         |
|-------------|------------------------|-------------------------------------|
| `.contains` | `(substr: string) -> bool` | True if string contains substring |
| `.index_of` | `(substr: string) -> number` | Position of first match (-1 if none) |

```rill
"hello world" -> .contains("world")  # true
"hello world" -> .index_of("o")      # 4
"hello" -> .index_of("x")            # -1
```

## Pattern Matching

| Method      | Signature              | Description                      |
|-------------|------------------------|----------------------------------|
| `.match`    | `(pattern: string) -> dict` | First regex match info, or `[:]` if none |
| `.is_match` | `(pattern: string) -> bool` | True if regex matches anywhere   |

### `.match` Return Value

Returns a dict with three fields:
- `matched`: The matched text
- `index`: Position of match in string
- `groups`: Capture groups as list

```rill
"hello123" -> .match("[0-9]+")
# [matched: "123", index: 5, groups: []]

"v1.2.3" -> .match("v(\\d+)\\.(\\d+)\\.(\\d+)")
# [matched: "v1.2.3", index: 0, groups: ["1", "2", "3"]]

"hello" -> .match("[0-9]+")
# [:] (empty dict = no match)
```

### `.is_match` for Boolean Checks

```rill
"hello123" -> .is_match("[0-9]+")    # true
"hello" -> .is_match("[0-9]+")       # false
```

### Pattern Matching in Conditionals

```rill
$response -> .is_match("ERROR") ? handle_error()

$response -> .match("code: (\\d+)") -> $m
$m -> !.empty ? process($m.groups[0])
```

## Replacement

| Method         | Signature                               | Description              |
|----------------|-----------------------------------------|--------------------------|
| `.replace`     | `(pattern: string, replacement: string) -> string` | Replace first regex match |
| `.replace_all` | `(pattern: string, replacement: string) -> string` | Replace all regex matches |

```rill
"a-b-c" -> .replace("-", "_")        # "a_b-c"
"a-b-c" -> .replace_all("-", "_")    # "a_b_c"

"a1b2c3" -> .replace("[0-9]", "X")       # "aXb2c3"
"a1b2c3" -> .replace_all("[0-9]", "X")   # "aXbXcX"

"hello" -> .replace_all("l", "")     # "heo"
```

## Formatting

| Method       | Signature                              | Description                    |
|--------------|----------------------------------------|--------------------------------|
| `.trim`      | `() -> string`                         | Remove leading/trailing whitespace |
| `.repeat`    | `(n: number) -> string`                | Repeat string n times          |
| `.pad_start` | `(length: number, fill: string = " ") -> string` | Pad start to length |
| `.pad_end`   | `(length: number, fill: string = " ") -> string` | Pad end to length   |

```rill
"  hello  " -> .trim                 # "hello"

"ab" -> .repeat(3)                   # "ababab"
"ab" -> .repeat(0)                   # ""

"42" -> .pad_start(5)                # "   42"
"42" -> .pad_start(5, "0")           # "00042"

"42" -> .pad_end(5)                  # "42   "
"42" -> .pad_end(5, "0")             # "42000"
```

## Splitting and Joining

| Method   | Signature                    | Description                        |
|----------|------------------------------|------------------------------------|
| `.split` | `(sep: string = "\n") -> list` | Split by separator               |
| `.join`  | `(sep: string = ",") -> string` | Join list with separator        |
| `.lines` | `() -> list`                 | Split on newlines (same as .split) |

```rill
"a,b,c" -> .split(",")               # ["a", "b", "c"]
"a\nb\nc" -> .lines                  # ["a", "b", "c"]

["a", "b", "c"] -> .join("-")        # "a-b-c"
["a", "b", "c"] -> .join("\n")       # "a\nb\nc"
```

## Conversion and Length

| Method | Signature       | Description                 |
|--------|----------------|-----------------------------|
| `.str` | `() -> string` | Convert any value to string |
| `.num` | `() -> number` | Parse string to number      |
| `.len` | `() -> number` | String length               |

```rill
42 -> .str                           # "42"
"42" -> .num                         # 42
"hello" -> .len                      # 5
```

## Element Access

| Method   | Signature              | Description              |
|----------|------------------------|--------------------------|
| `.head`  | `-> string`            | First character (errors on empty) |
| `.tail`  | `-> string`            | Last character (errors on empty)  |
| `.at`    | `(index: number) -> string` | Character at index  |

```rill
"hello" -> .head                     # "h"
"hello" -> .tail                     # "o"
"hello" -> .at(1)                    # "e"
```

## Common Patterns

### Normalize and Compare

```rill
$input -> .trim -> .lower -> .eq("yes")
```

### Extract and Validate

```rill
$email -> .is_match("^[^@]+@[^@]+$") ? process($email) ! error("Invalid email")
```

### Format Output

```rill
$items -> each {
  $.name -> .pad_end(20) -> $name
  $.value -> .str -> .pad_start(10) -> $val
  "{$name}{$val}"
} -> .join("\n")
```

### Replace Patterns

```rill
$text -> .replace_all("\\s+", " ") -> .trim
```

### Parse Structured Text

```rill
$line -> .match("(\\w+):\\s*(.+)") -> $m
$m -> !.empty ? [key: $m.groups[0], value: $m.groups[1]]
```
