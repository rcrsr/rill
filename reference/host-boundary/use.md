---
id: use
title: use
status: normative
since: 0.24.0
issues: [618, 619]
grammar: [use-expr, use-id]
errors: [RILL-P007, RILL-P022, RILL-R005, RILL-R054, RILL-R055, RILL-R056, RILL-R058, TYPE_MISMATCH]
depends: [pipe, scope]
tests: [use-expr.test.ts]
---

# use

`use<scheme:resource>` asks the host to resolve a resource and yields the value it resolves
to.

## Syntax

```ebnf
use-expr      = "use" "<" use-id ">" [ ":" , ( type-ref | use-closure-annotation ) ] ;
use-id        = identifier ":" identifier { "." identifier }
              | "$" identifier
              | "(" pipe-chain ")" ;
```

```text
use<ext:app>             static
use<ext:app.search>      a member path
use<$id>                 the identifier held in a variable
use<("ext:" -> "{$}app")>   a computed identifier
```

## Static rules

r[use.adjacent] use touches its bracket
`use <...>` MUST be rejected with RILL-P007.

r[use.static-id] A static identifier is scheme, colon, and dotted path
A static identifier MUST be an identifier, a `:`, and one or more identifiers joined by `.`.
Any other text MUST be rejected with RILL-P022.

## Evaluation

r[use.id-value] A variable or computed identifier is a string with a scheme
A variable or computed identifier MUST evaluate to a string containing `:`. A string without
one MUST halt with RILL-R058.

r[use.scheme] The scheme selects a host resolver
The text before the first `:` MUST select the resolver the host registered for that scheme,
and the rest MUST be passed to it as the resource. An unregistered scheme MUST halt with
RILL-R054.

r[use.value] A resolved value is the result
When the resolver returns a value, `use<...>` MUST yield it.

r[use.source] A resolved source runs as its own script
When the resolver returns source text, `use<...>` MUST run it as a script in a scope of its
own, and yield its result. Its variables MUST NOT be visible to the caller, and the caller's
variables MUST NOT be visible to it.

r[use.source-dollar] A piped value is the module's $
`v -> use<...>` MUST bind `v` as `$` for a source module. Without a piped value, a module that
reads `$` MUST halt with RILL-R005.

r[use.each-time] Each use resolves again
Each evaluation of `use<...>` MUST call the resolver again. Two uses of one resource MUST NOT
share a result.

r[use.cycle] A resource that uses itself halts
A source module that, directly or through others, uses a resource still being resolved MUST
halt with RILL-R055.

r[use.resolver-failure] A failing resolver halts
A resolver that fails, returns a malformed result, or returns a value that is not a rill value
MUST halt with RILL-R056. A source module that does not parse MUST halt with RILL-R056.

r[use.type] A type after use asserts the result {pending #618}
`use<id>:T` MUST assert the result against `T` as `-> :T` does. A mismatch MUST halt with
`#TYPE_MISMATCH`, and the result MUST carry `T`.

r[use.module-halt] A halt inside a module is not caught at the use site {pending #619}
A halt raised while a source module runs MUST pass through `use<...>` and every `guard` around
it uncaught.

r[use.resolution-catchable] Resolution failures are catchable {pending #619}
RILL-R054, RILL-R056, and RILL-R058 MUST be catchable, a source module that does not parse
included.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A space between `use` and `<` | RILL-P007 | No |
| A malformed static identifier | RILL-P022 | No |
| An identifier string without `:` | RILL-R058 | Yes |
| No resolver for the scheme | RILL-R054 | Yes |
| A resource that uses itself | RILL-R055 | No |
| The resolver fails or returns a non-rill value | RILL-R056 | Yes |
| A source module reads `$` with nothing piped {pending #619} | RILL-R005 | No |
| The result does not have the type after `use<...>` {pending #618} | `#TYPE_MISMATCH` | Yes |

## Examples

```text
use<ext:app> => $app
$app.search("rill")

"hello" -> use<host:shout>
```
