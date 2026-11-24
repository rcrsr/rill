---
id: use
title: use
status: normative
since: 0.24.0
issues: []
grammar: [use-expr, use-id]
errors: [RILL-P007, RILL-P022, RILL-R002, RILL-R005, RILL-R054, RILL-R055, RILL-R056, RILL-R057, RILL-R058, RILL-R090, TYPE_MISMATCH]
depends: [pipe, scope]
tests: [use-expr.test.ts, declarations.test.ts]
---

# use

`use<scheme:resource>` asks the host to resolve a resource and yields the value it resolves
to.

## Syntax

```ebnf
use-expr      = "use" "<" use-id ">" [ ":" , type-ref ] ;
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

r[use.id-kind] A variable or computed identifier that is not a string halts
A variable or computed identifier that evaluates to a value other than a string MUST halt with
RILL-R057.

r[use.scheme] The scheme selects a host resolver
The text before the first `:` MUST select the resolver the host registered for that scheme,
and the rest MUST be passed to it as the resource. An unregistered scheme MUST halt with
RILL-R054.

r[use.value] A resolved value is the result outside a pipe target
When the resolver returns a value, `use<...>` MUST yield it outside a pipe target.

r[use.pipe-target] A pipe into a resolved value acts on it as a variable does
`v -> use<...>` MUST act on a host-resolved value as `pipe.variable` states for a variable
holding it. A value of no target kind MUST halt with RILL-R002, and the message MUST name the
use as written and the kind, as in `cannot pipe into use<host:value>: it holds a string`.
A source module's result is the pipe's result.

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

r[use.member-cap] A resolved value holds at most 10,000 members
A host-resolved value MUST halt with RILL-R090 when the value itself and every dict, list, and
function it holds, at any depth, number more than 10,000. Scalars it holds MUST NOT count.

r[use.type] A type after use asserts the result
`use<id>:T` MUST assert the result against `T` as `-> :T` does. A mismatch MUST halt with
`#TYPE_MISMATCH`, and the result MUST carry `T`. In `v -> use<id>:T`, a host-resolved value MUST be
asserted before the pipe acts on it, and a source module's result MUST be asserted as the pipe's
result.

r[use.module-halt] A halt inside a module is not caught at the use site
A halt raised while a source module runs MUST pass through `use<...>` and every `guard` around
it uncaught.

r[use.resolution-catchable] Resolution failures are catchable
RILL-R054, RILL-R056, and RILL-R058 MUST be catchable, a source module that does not parse
included.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A space between `use` and `<` | RILL-P007 | No |
| A malformed static identifier | RILL-P022 | No |
| An identifier that is not a string | RILL-R057 | Yes |
| An identifier string without `:` | RILL-R058 | Yes |
| No resolver for the scheme | RILL-R054 | Yes |
| A resource that uses itself | RILL-R055 | No |
| The resolver fails, returns a non-rill value, or a source module does not parse | RILL-R056 | Yes |
| A host-resolved value holds more than 10,000 dicts, lists, and functions | RILL-R090 | Yes |
| A source module reads `$` with nothing piped | RILL-R005 | No |
| A value is piped into a host-resolved value of no target kind | RILL-R002 | Yes |
| The result does not have the type after `use<...>` | `#TYPE_MISMATCH` | Yes |

## Examples

```text
use<ext:app> => $app
$app.search("rill")

"hello" -> use<host:shout>
```

## Notes

On 0.23.0 a type after `use<...>` was parsed and never checked.

On 0.23.0 a non-callable resolved value is returned unchanged, and a callable source-module
result was called with the piped value.

The `use<id>:|params|` annotation is removed. It raises RILL-P012; write `use<id>:fn(params)`.

The namespaced host call `ns::fn()` is removed. It raises RILL-P012; write `use<ext:ns> => $ns`,
then `$ns.fn()`.
