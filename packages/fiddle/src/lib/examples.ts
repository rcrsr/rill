/**
 * Code examples registry for rill fiddle
 */

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface CodeExample {
  readonly id: string;
  readonly label: string;
  readonly source: string;
}

// ============================================================
// EXAMPLE REGISTRY
// ============================================================

const EXAMPLES: Record<string, CodeExample> = {
  'hello-world': {
    id: 'hello-world',
    label: 'Hello World',
    source: '"Hello, world!"',
  },
  variables: {
    id: 'variables',
    label: 'Variables',
    source: `"hello" => $greeting
$greeting -> .upper => $shouted
"{$shouted}!"`,
  },
  pipes: {
    id: 'pipes',
    label: 'Pipes',
    source: `"  hello world  " -> .trim -> .split(" ") -> .join("-")`,
  },
  functions: {
    id: 'functions',
    label: 'Functions',
    source: `range(0, 5) -> seq({ $ * 2 })`,
  },
  conditionals: {
    id: 'conditionals',
    label: 'Conditionals',
    source: `5 -> ($ > 3) ? "big" ! "small"`,
  },
  fold: {
    id: 'fold',
    label: 'Fold',
    source: `# Factorial of 10
range(1, 11) -> fold(1, { $@ * $ })`,
  },
  fizzbuzz: {
    id: 'fizzbuzz',
    label: 'FizzBuzz',
    source: `range(1, 21) -> seq({
  ($ % 15 == 0) ? "FizzBuzz"
    ! ($ % 3 == 0) ? "Fizz"
    ! ($ % 5 == 0) ? "Buzz"
    ! "{$}"
})`,
  },
  dispatch: {
    id: 'dispatch',
    label: 'Dispatch',
    source: `# Dict dispatch — match value against keys
"POST" -> dict[
  list["GET", "HEAD", "OPTIONS"]: "safe",
  list["POST", "PUT", "PATCH"]: "mutation",
  "DELETE": "destructive"
] ?? "unknown"`,
  },
  closures: {
    id: 'closures',
    label: 'Closures',
    source: `|x| ($x * 2) => $double
|x| ($x + 10) => $offset
|x| ($x * $x) => $square

# Closure chain: 3 -> 6 -> 16 -> 256
3 -> chain(list[$double, $offset, $square])`,
  },
  'collection-pipeline': {
    id: 'collection-pipeline',
    label: 'Collection Pipeline',
    source: `list[
  dict[name: "Alice", score: 85],
  dict[name: "Bob", score: 42],
  dict[name: "Carol", score: 91],
  dict[name: "Dave", score: 67],
  dict[name: "Eve", score: 95]
]
  -> filter({ $.score >= 70 })
  -> fan({
    ($.score >= 90) ? "A" ! "B" => $grade
    dict[name: $.name, grade: $grade]
  })`,
  },
  destructuring: {
    id: 'destructuring',
    label: 'Destructuring',
    source: `list[10, 20, 30, 40, 50] -> destruct<$first, _, $third, _, $last>
log("first: {$first}")
log("third: {$third}")
log("last: {$last}")
$first + $third + $last`,
  },
  slicing: {
    id: 'slicing',
    label: 'Slicing',
    source: `"Hello, World!" => $str
log($str -> slice<0:5>)
log($str -> slice<7:12>)
log($str -> slice<::-1>)
list[0, 1, 2, 3, 4, 5, 6, 7, 8, 9] -> slice<::2>`,
  },
  'type-checking': {
    id: 'type-checking',
    label: 'Type Checking',
    source: `# Type check with :?type (returns boolean)
42:?number => $is_num
log("42 is number: {$is_num}")
log("42 is string: {42:?string}")

# Type assertion with :type (errors on mismatch)
"hello":string => $greeting
log($greeting)

# Inspect type at runtime with .^type
log(list[1, 2, 3].^type.name)
log(dict[a: 1].^type.name)

# Type-based branching on a single value
"hello" => $val
$val:?string ? "it's a string" ! "not a string"`,
  },
  'string-processing': {
    id: 'string-processing',
    label: 'String Processing',
    source: `"  Hello,  World!  This  is   rill.  "
  -> .trim
  -> .replace_all("\\\\s+", " ")
  -> .split(" ")
  -> fan({ .lower })
  -> .join(" -> ")`,
  },
  'dict-methods': {
    id: 'dict-methods',
    label: 'Dict Methods',
    source: `dict[
  items: list[12, 5, 8, 23, 3],
  total: ||{ $.items -> fold(0, { $@ + $ }) },
  max: ||{ $.items -> fold(0, { ($@ > $) ? $@ ! $ }) }
] => $bag
log($bag.total)
log($bag.max)
$bag.items -> filter({ $ > 10 })`,
  },
  'state-machine': {
    id: 'state-machine',
    label: 'State Machine',
    source: `# Traffic light with dispatch in condition loop
dict[state: "red", cycles: 0]
  -> (.cycles < 6) @ {
    log(.state)
    dict[
      state: .state -> dict[
        red: "green",
        green: "yellow",
        yellow: "red"
      ],
      cycles: .cycles + 1
    ]
  }`,
  },
  spread: {
    id: 'spread',
    label: 'Spread',
    source: `list[1, 2, 3] => $a
list[4, 5, 6] => $b
list[...$a, ...$b] => $combined
log($combined)
# Running total with acc(init)
$combined -> acc(0, { $@ + $ })`,
  },
  'type-conversion': {
    id: 'type-conversion',
    label: 'Type Conversion',
    source: `# Assert type with :type (errors on mismatch)
42:number => $n
log($n)

# Check type with :?type (returns boolean)
log("hello":?string)
log("hello":?number)

# Convert with -> type
42 -> string => $s
log("number to string: {$s}")
"3.14" -> number => $pi
log("string to number: {$pi}")

# Inspect type at runtime
list[1, 2, 3].^type.name`,
  },
  'while-loop': {
    id: 'while-loop',
    label: 'While Loop',
    source: `# Condition loop: (cond) @ { body }
# Counts from 1 to 10
1 -> ($ <= 10) @ { $ + 1 } => $result
log("count result: {$result}")

# Do-condition loop: @ { body } ? (cond)
# Body runs at least once
0 -> @ { $ + 5 } ? ($ < 20) => $total
log("do-while result: {$total}")

# Collatz sequence length
dict[value: 27, steps: 0]
  -> ($.value != 1) @ {
    ($.value % 2 == 0)
      ? dict[value: $.value / 2, steps: $.steps + 1]
      ! dict[value: $.value * 3 + 1, steps: $.steps + 1]
  }`,
  },
  'typed-closures': {
    id: 'typed-closures',
    label: 'Typed Closures',
    source: `# Anonymous typed closure: |type|{ body }
"hello" -> |string|{ $ -> .upper } => $shouted
log($shouted)

# Return type assertion with :type
|x: number| { $x * 2 }:number => $double
log($double(5))

# Type-checked parameter
|n: number| { $n + 1 } => $inc
log($inc(10))

# Default parameter values
|x = 0| ($x + 1) => $inc_or_one
log($inc_or_one())
$inc_or_one(99)`,
  },
  'existence-defaults': {
    id: 'existence-defaults',
    label: 'Existence & Defaults',
    source: `# Default operator ?? for missing fields
dict[name: "Alice"] => $user
log($user.name)
log($user.age ?? "unknown")

# Existence check .?field (returns boolean)
log($user.?name)
log($user.?age)

# Existence + type check .?field&type
dict[score: 95, label: "A+"] => $data
log($data.?score&number)
log($data.?score&string)

# Nested defaults
dict[config: dict[theme: "dark"]] => $app
$app.config.debug ?? false`,
  },
  'assert-error': {
    id: 'assert-error',
    label: 'Assert & Error',
    source: `# Assert validates and passes through
5 -> assert ($ > 0) => $positive
log("validated: {$positive}")

# Assert with custom message
"hello" -> assert (!.empty) "Input required" => $input
log("input: {$input}")

# Type validation with assert
list[1, 2, 3] -> assert ($:?list) "Expected list" => $items
log("items: {$items}")

# Chain assertions in a pipeline
42
  -> assert ($ > 0)
  -> assert ($ < 100)
  -> { $ * 2 }`,
  },
  'break-return': {
    id: 'break-return',
    label: 'Break & Return',
    source: `# Break exits loop, returns collected results
list[1, 2, 3, 4, 5] -> seq({
  ($ == 4) ? break
  $ * 10
}) => $before_four
log($before_four)

# Return exits script with value
10 => $x
($x > 5) ? ("big: {$x}" -> return)
"small"`,
  },
  'pass-keyword': {
    id: 'pass-keyword',
    label: 'Pass',
    source: `# Pass returns $ unchanged (explicit no-op)
list[1, -2, 3, -4, 5] -> fan({
  ($ > 0) ? pass ! 0
}) => $clamped
log($clamped)

# Pass in conditional branches
"data" -> {
  dict[status: pass, processed: true]
} => $result
log($result)

# Preserve value in filter-like logic
list["a", "", "b", "", "c"]
  -> fan({ .empty ? "empty" ! pass })`,
  },
  enumerate: {
    id: 'enumerate',
    label: 'Enumerate',
    source: `# Enumerate adds index to each item
enumerate(list["apple", "banana", "cherry"])
  -> seq({
    "{$.index}: {$.value}"
  }) => $indexed
log($indexed)

# Enumerate a dict (index, key, value)
enumerate(dict[x: 10, y: 20, z: 30])
  -> seq({
    "#{$.index} {$.key}={$.value}"
  })`,
  },
  'dict-iteration': {
    id: 'dict-iteration',
    label: 'Dict Iteration',
    source: `# Iterating dicts: $ has .key and .value
dict[alice: 95, bob: 82, carol: 91]
  -> filter({ $.value >= 90 })
  -> seq({ "{$.key} scored {$.value}" })
  => $honors
log($honors)

# Fold dict entries into a total
dict[apples: 3, bananas: 5, cherries: 2]
  -> fold(0, { $@ + $.value })`,
  },
  'list-dispatch': {
    id: 'list-dispatch',
    label: 'List Dispatch',
    source: `# List dispatch: pipe index to list
0 -> list["first", "second", "third"] => $item
log($item)

# Negative index counts from end
-1 -> list["alpha", "beta", "gamma"] => $last
log($last)

# With default for out-of-bounds
10 -> list["a", "b", "c"] ?? "not found" => $safe
log($safe)

# Hierarchical dispatch: navigate nested structure
list["users", "alice"]
  -> dict[users: dict[alice: "Admin", bob: "Editor"]]`,
  },
  'comparison-methods': {
    id: 'comparison-methods',
    label: 'Comparison Methods',
    source: `# Comparison methods work on all comparable types
18 => $age
log($age -> .ge(18) ? "adult" ! "minor")
log($age -> .lt(21) ? "under 21" ! "21+")

# String comparison
"hello" -> .eq("hello") => $match
log("exact match: {$match}")

# In pipelines with filter
list[3, 7, 2, 9, 1, 8, 4]
  -> filter({ .ge(5) })
  -> seq({ "{$}" })
  -> .join(", ")`,
  },
};

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Load a code example by ID.
 *
 * @param id - Example identifier
 * @returns CodeExample if found, undefined otherwise
 */
export function loadExample(id: string): CodeExample | undefined {
  return EXAMPLES[id];
}
