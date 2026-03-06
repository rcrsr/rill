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
    source: `range(0, 5) -> each { $ * 2 }`,
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
range(1, 11) -> fold(1) { $@ * $ }`,
  },
  fizzbuzz: {
    id: 'fizzbuzz',
    label: 'FizzBuzz',
    source: `range(1, 21) -> each {
  ($ % 15 == 0) ? "FizzBuzz"
    ! ($ % 3 == 0) ? "Fizz"
    ! ($ % 5 == 0) ? "Buzz"
    ! "{$}"
}`,
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
3 -> chain($double, $offset, $square)`,
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
  -> filter { $.score >= 70 }
  -> map {
    ($.score >= 90) ? "A" ! "B" => $grade
    dict[name: $.name, grade: $grade]
  }`,
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
    source: `|val| {
  $val:?string ? "string: {$val}"
    ! $val:?number ? "number: {$val}"
    ! $val:?list ? "list[{$val.len}]"
    ! "other"
} => $describe
list["hello", 42, list[1, 2, 3], true] -> each $describe`,
  },
  'string-processing': {
    id: 'string-processing',
    label: 'String Processing',
    source: `"  Hello,  World!  This  is   rill.  "
  -> .trim
  -> .replace_all("\\\\s+", " ")
  -> .split(" ")
  -> map .lower
  -> .join(" -> ")`,
  },
  'dict-methods': {
    id: 'dict-methods',
    label: 'Dict Methods',
    source: `dict[
  items: list[12, 5, 8, 23, 3],
  total: ||{ $.items -> fold(0) { $@ + $ } },
  max: ||{ $.items -> fold(0) { ($@ > $) ? $@ ! $ } }
] => $bag
log($bag.total)
log($bag.max)
$bag.items -> filter { $ > 10 }`,
  },
  'state-machine': {
    id: 'state-machine',
    label: 'State Machine',
    source: `# Traffic light with dispatch in condition loop
dict[state: "red", cycles: 0]
  -> ($.cycles < 6) @ {
    log($.state)
    $.state -> dict[
      red: dict[state: "green", cycles: $.cycles + 1],
      green: dict[state: "yellow", cycles: $.cycles + 1],
      yellow: dict[state: "red", cycles: $.cycles + 1]
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
# Running total with each(init)
$combined -> each(0) { $@ + $ }`,
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
