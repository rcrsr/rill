# What Makes rill Unique

*Structural differences from mainstream and niche languages*

rill combines constraints that no other language enforces together. Each feature below describes a design decision, a working example, and what other languages do instead.

## No Assignment Operator

rill has no `=`. Data flows through pipes (`->`) and captures (`=>`).

```rill
"  hello world  " -> .trim -> .upper -> .split(" ")
# Result: ["HELLO", "WORLD"]

"hello" => $a -> .upper => $b -> .len
# $a = "hello", $b = "HELLO", result = 5
```

Other languages treat pipes as syntax sugar over assignment. rill makes pipes the only sequencing mechanism. Every statement either continues the pipe or captures a value for later reuse. There is no "modify in place" anywhere.

## `$` Is a Grammar Construct

The pipe value `$` changes meaning based on syntactic context. The parser resolves it without a symbol table.

```rill
"test" -> { .upper }              # $ is "test"
[1, 2, 3] -> each { $ * 2 }      # $ is each element
[1, 2, 3] -> fold(0) { $@ + $ }  # $ is element, $@ is accumulator
```

Languages with implicit parameters (F#'s `_`, Scala's `_`) treat them as runtime variables. rill's `$` is a parser-level construct whose type and binding shift by position. The `$` prefix on user variables (`$name`) disambiguates at tokenization, not via type inference.

## Booleans-Only Conditionals with No Null

Empty strings, zero, and empty lists are not falsy. Conditions require actual booleans. There is no `nil`, `null`, or `undefined`.

```rill
"" ? "yes" ! "no"         # ERROR: condition must be boolean
"" -> .empty ? "yes"      # OK: .empty returns boolean
0 -> ($ == 0) ? "yes"     # OK: comparison returns boolean
```

TypeScript, Rust, and Python all allow some form of truthiness coercion. rill forbids it. Combined with the absence of null, this means: (1) values can be empty, (2) emptiness is not a condition, (3) you must convert emptiness to a boolean explicitly.

## Sealed Scopes

Inner scopes cannot mutate outer variables. Loop bodies get their own copy of the enclosing scope.

```rill
0 => $count
[1, 2, 3] -> each { $count + 1 => $count }
$count  # Still 0
```

Python, JavaScript, and Rust let closures and loops mutate outer scope variables. rill prevents this structurally. Accumulation uses explicit mechanisms: `$@` in `fold`/`each(init)`, or `$` as state in while loops.

## Runtime Type System

Every value has a type checked at runtime. Type annotations are optional but fully supported, including structural types.

```rill
5 => $n:number                              # explicit annotation
"hello" => $name                            # inferred as string, locked
5 => $name                                  # ERROR: cannot assign number to string-locked variable
[a: 1] => $d:dict(a: number, b: string)    # ERROR: missing field b
```

TypeScript erases types at compile time. Python allows any reassignment. rill checks types at runtime on every assignment. Annotations validate the value on first binding. Without an annotation, the inferred type locks automatically. This catches type drift that dynamic languages miss, without requiring a separate compilation step.

## Immutable Values, No Mutation

Every value is immutable after creation. There are no mutation operators, no field assignment, no `push` or `pop`.

```rill
[1, 2, 3] => $a
$a => $b
# $a and $b can never diverge — neither can be mutated
```

Rust has mutable references and borrowing. Python and JavaScript allow in-place mutation by default. rill eliminates aliasing bugs by making mutation impossible, not by copying.

## Dict Closures with Implicit `$` Binding

Zero-argument closures stored in dicts auto-bind `$` to the containing dict and auto-invoke on field access.

```rill
[
  name: "toolkit",
  count: 3,
  summary: || { "{$.name}: {$.count} items" }
] => $obj

$obj.summary    # "toolkit: 3 items"
```

OOP languages require explicit `this`/`self` declarations and method syntax. rill's dict closures bind `$` to the dict automatically and invoke without parentheses. This produces computed properties without special syntax.

## Structural Types as First-Class Values

The `.^type` operator returns a runtime type value describing the full structure of a value. Type values are comparable data.

```rill
[1, 2, 3].^type == list(number)              # true
[a: 1, b: "hi"].^type == dict(a: number, b: string)  # true
```

TypeScript erases types at runtime. Python's `type()` returns a class, not a structural description. rill produces type values that describe the shape of data, and those values can be stored, passed, and compared.

## Sequential vs Parallel Collection Operators

`each` runs iterations sequentially. `map` and `filter` run iterations in parallel via `Promise.all`. The distinction is explicit.

```rill
$urls -> each { fetch($) }     # Sequential: one request at a time
$urls -> map { fetch($) }      # Parallel: all requests concurrent
```

Most languages have `map` that runs sequentially (Python, JavaScript) or require explicit parallelism (`rayon` in Rust, `parallelStream` in Java). rill forces a conscious choice between sequential and parallel at the call site.

## Closure Annotations with Runtime Reflection

Closures carry `^(key: value)` metadata accessible at runtime via `.^key` syntax.

```rill
^(timeout: 30000, retry: 3) |url| { fetch($url) } => $fetcher
$fetcher.^timeout    # 30000
$fetcher.^retry      # 3
```

Python decorators transform functions. Java annotations require reflection APIs. rill annotations are first-class values on the closure itself, accessed with dedicated syntax (`.^`) that the grammar defines.

## Functions Are Their Own Schema

Closure annotations and parameter annotations combine to make functions self-describing. A single closure carries its name, description, parameter types, constraints, and behavior.

```rill
^(description: "Search the knowledge base", timeout: 5000)
|^(min: 1, max: 200) query: string, ^(default: 10) limit: number| {
  use<ext:qdrant.search>($query, $limit)
} => $search_tool
```

The runtime reflects everything an agent framework needs to build a tool schema:

```rill
$search_tool.^description    # "Search the knowledge base"
$search_tool.^timeout        # 5000
$search_tool.params          # parameter names, types, and annotations
```

An LLM tool definition needs a name, description, parameter names with types, and constraints. That closure already carries all of it. No separate JSON schema file, no decorator layer, no registration boilerplate. The function and its metadata are the same object.

Python requires `@tool` decorators or Pydantic models alongside the function. TypeScript needs separate Zod schemas or JSON schema files. rill closures are the definition, the schema, and the implementation in one value.

## No Exceptions

There is no try/catch. Errors halt execution immediately. The only control flow constructs are conditionals, loops, `break`, `return`, and `assert`.

```rill
$input -> .empty ? error("Input required")
# Execution only reaches here if $input is non-empty
```

Every language with exceptions creates invisible control flow paths. rill eliminates these. Error handling is always explicit validation before the operation, never recovery after.

## Transparent Iterator Protocol

Iterators are dicts with `value`, `done`, and `next` fields. No hidden interfaces or special symbols.

```rill
|start, max| [
  value: $start,
  done: ($start > $max),
  next: || { $counter($.value + 1, $max) }
] => $counter
```

Python hides iterators behind `__iter__`/`__next__`. JavaScript uses `Symbol.iterator`. rill iterators are ordinary dicts. You can inspect, copy, and create them without implementing an interface.

## Bare Expressions as Closure Bodies

Closures accept any expression as their body. No braces, arrows, or keywords required.

```rill
|a, b| [$a, $b]                          # dict literal body
|x| $x + 1                               # arithmetic body
|start, max| [                            # multi-line dict body
  value: $start,
  done: ($start > $max),
  next: || { $counter($.value + 1, $max) }
] => $counter
```

Other languages require explicit body delimiters: JavaScript needs `=>` and `{}`, Python needs `lambda` or `def`, Rust needs `||{}`. rill's grammar rule is `body = block | grouped-expr | postfix-expr`, so any primary expression after `|params|` is the body. Braces are only needed for multiple statements.

## Collection Dispatch

Piping a value into a dict performs key lookup. Piping a number into a list performs index access. Piping a list of keys performs hierarchical path navigation. Collections are functions.

```rill
# Dict dispatch: key lookup
"apple" -> [apple: "fruit", carrot: "vegetable"]
# Result: "fruit"

# List dispatch: index access
1 -> ["first", "second", "third"]
# Result: "second"

# Hierarchical dispatch: path navigation
["address", "city"] -> [address: dict[street: "Main", city: "Boston"]]
# Result: "Boston"

# Type-aware dispatch: keys match by value AND type
1 -> [1: "number", "1": "string"]
# Result: "number"
```

rill has no `switch`, `case`, or `match` statement. Dict dispatch replaces all of them. Pipe a value into a dict, get the matching value out. Multi-key syntax (`[k1, k2]: value`) handles fallthrough cases. The `??` operator handles defaults. This makes dicts work as pattern matchers, lookup tables, and state machines without additional syntax.

```rill
# State machine via nested dispatch
[
  green: [tick: "yellow"],
  yellow: [tick: "red"],
  red: [tick: "green"]
] => $machine

"green" => $state
$machine.$state.tick    # "yellow"
```

## Dicts as Structural Types

Dicts serve triple duty: data containers, dispatch targets, and structural type definitions. The same literal syntax defines data and its shape.

```rill
# Dict as data
[name: "Alice", age: 30] => $person

# Dict as type (via type constructor)
dict(name: string, age: number) => $personType

# Runtime structural comparison
$person.^type == $personType    # true
```

Type constructors like `dict(name: string, age: number)` produce first-class type values using the same key-value mental model as dict literals. There is no separate schema language, no class definitions, no interface declarations. The type system reuses the data model. Validating a dict against a shape is a single assertion:

```rill
[name: "Alice", age: 30] -> :dict(name: string, age: number)
# Passes — returns the dict unchanged

[name: "Alice", age: "thirty"] -> :dict(name: string, age: number)
# ERROR: age is string, expected number
```

Structural types also support default values. The `:>` conversion operator hydrates missing fields automatically:

```rill
[b: "b"] -> :>dict(b: string, a: string = "a")
# Result: [a: "a", b: "b"]

tuple["x"] -> :>tuple(string, number = 0)
# Result: tuple["x", 0]
```

No builder pattern, no constructor overloads, no `Object.assign`. The type definition carries the defaults, and conversion applies them.

## Applications Composed Through Configuration

rill applications are assembled from a config file, not from import statements in code. SDKs ship as extensions (npm packages). A config file mounts them, configures them, and the script accesses them through `use<>`. The script has zero control over instantiation.

```json
{
  "extensions": {
    "mounts": {
      "ai": "@rcrsr/rill-ext-claude",
      "db": "@rcrsr/rill-ext-postgres"
    },
    "config": {
      "ai": { "model": "claude-sonnet-4-20250514" },
      "db": { "host": "localhost", "port": 5432 }
    }
  }
}
```

```rill
# Script uses mounted resources — cannot choose provider or configure them
use<ext:ai.prompt> => $prompt
use<ext:db.query> => $query

$prompt("Summarize this") => $summary
$query("INSERT INTO notes (text) VALUES ({$summary})")
```

The `use<>` syntax is a request, not an instruction. The config file decides what the script gets access to, which credentials it uses, and how services connect. Swapping a database or AI provider means changing one line in the config. The script stays identical.

Python, JavaScript, and Go let scripts import modules, open files, and create connections. rill scripts cannot instantiate anything. Configuration owns the wiring. Scripts own the logic. The separation is enforced at the language level, not by convention.

## Vanilla Language Design

rill provides zero I/O, zero imports, and zero domain functions. The host application registers every capability the script can use.

```rill
# Host provides fetch(), prompt(), save() — rill provides nothing
app::fetch("https://api.example.com")
  -> .json
  -> app::save("result.json")
```

Lua embeds similarly but ships a standard library. rill ships with 6 built-in functions (`log`, `json`, `identity`, `range`, `repeat`, `chain`) and nothing else. The language is a pure computation substrate. The host controls every side effect.

## The Combination

No single feature above is without precedent. What makes rill unique is enforcing all of them together:

| Constraint | Effect |
|-----------|--------|
| No assignment operator | Forces dataflow thinking |
| No null, no coercion | Eliminates implicit behavior |
| Sealed scopes, immutable values | Prevents hidden mutation |
| No exceptions | Makes error paths visible |
| Runtime type system | Catches type errors without a compiler |
| Collections as dispatch targets | Data structures double as logic |
| Dicts as structural types | No separate schema language |
| Bare expression closure bodies | Minimal syntax overhead |
| Config-composed applications | Wiring lives in config, logic lives in script |
| Vanilla host model | Enables total sandboxing |
| Sequential vs parallel split | Makes concurrency choices explicit |

The result: every statement's effect is traceable from reading the code. An AI agent can generate rill, and a human can audit it line by line without reasoning about hidden state, implicit conversions, or exception paths.
