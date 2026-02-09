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
"POST" -> [
  ["GET", "HEAD", "OPTIONS"]: "safe",
  ["POST", "PUT", "PATCH"]: "mutation",
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
3 -> @[$double, $offset, $square]`,
  },
  'collection-pipeline': {
    id: 'collection-pipeline',
    label: 'Collection Pipeline',
    source: `[
  [name: "Alice", score: 85],
  [name: "Bob", score: 42],
  [name: "Carol", score: 91],
  [name: "Dave", score: 67],
  [name: "Eve", score: 95]
]
  -> filter { $.score >= 70 }
  -> map {
    ($.score >= 90) ? "A" ! "B" => $grade
    [name: $.name, grade: $grade]
  }`,
  },
  destructuring: {
    id: 'destructuring',
    label: 'Destructuring',
    source: `[10, 20, 30, 40, 50] -> *<$first, _, $third, _, $last>
log("first: {$first}")
log("third: {$third}")
log("last: {$last}")
$first + $third + $last`,
  },
  slicing: {
    id: 'slicing',
    label: 'Slicing',
    source: `"Hello, World!" => $str
log($str -> /<0:5>)
log($str -> /<7:12>)
log($str -> /<::-1>)
[0, 1, 2, 3, 4, 5, 6, 7, 8, 9] -> /<::2>`,
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
["hello", 42, [1, 2, 3], true] -> each $describe`,
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
    source: `[
  items: [12, 5, 8, 23, 3],
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
[state: "red", cycles: 0]
  -> ($.cycles < 6) @ {
    log($.state)
    $.state -> [
      red: [state: "green", cycles: $.cycles + 1],
      green: [state: "yellow", cycles: $.cycles + 1],
      yellow: [state: "red", cycles: $.cycles + 1]
    ]
  }`,
  },
  spread: {
    id: 'spread',
    label: 'Spread',
    source: `[1, 2, 3] => $a
[4, 5, 6] => $b
[...$a, ...$b] => $combined
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
