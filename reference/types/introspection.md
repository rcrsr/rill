---
id: introspection
title: Type introspection
status: normative
since: 0.24.0
issues: [565, 571]
errors: [RILL-R003]
depends: [type-value, structural-typing, any, carried-type]
tests: [type-inner-outer.test.ts, type-values.test.ts, declared-types.test.ts]
---

# Type introspection

A script reads a value's type through `.^type`, and reads the structure of a type value through `.name`, `.signature`, `.inner`, `.outer`, and `.defaults`.

## Evaluation

r[introspection.type-probe] .^type returns a type value
The result of `.^type` MUST be a type value. The `carried-type` concept states which type it
reports, through `carried-type.type-probe` and `carried-type.effective-probe`.

r[introspection.name] A type value has a name
`.name` MUST return the type's kind as a string, such as `"list"`, and MUST NOT halt.

r[introspection.signature] A type value has a signature
`.signature` MUST return the type written in canonical form, such as `"list(number)"`, and MUST
NOT halt.

r[introspection.bare] A bare type is its constructor with every parameter at its default {pending #571}
Every type parameter MUST default to `any`. A bare type MUST equal its constructor with every
parameter at that default: `list` is `list(any)`, and `stream` is `stream(any):any`.

r[introspection.bare-open] An open parameter list defaults as a whole
A constructor with an open parameter list, `dict`, `ordered`, `tuple`, or a function type, MUST
default the whole list to `any`: `.inner` on the bare type returns `any`, not a container of
`any` entries.

r[introspection.bare-inner] The inner of a bare fixed-parameter type is any
`.inner` on a bare `list` or `stream` MUST return `any`, the default of its one inner parameter.

r[introspection.inner] .inner returns the parameters in their written shape
`.inner` MUST return a type's parameters in the shape they are written, with every unwritten
parameter at its default. The result type of `.inner` is the union of the shapes a constructor
admits:

| Constructor, with defaults | `.inner` | Type of `.inner` |
|----------------------------|----------|------------------|
| `list(T = any)` | `T` | `type` |
| `stream(T = any):(R = any)` | `T` | `type` |
| `tuple(A, B, ...)`, or `any` | `tuple[A, B, ...]`, or `any` | `union(tuple, type)` |
| `dict(a: A, ...)`, or `any` | `dict[a: A, ...]`, or `any` | `union(dict, type)` |
| `ordered(a: A, ...)`, or `any` | `ordered[a: A, ...]`, or `any` | `union(ordered, type)` |
| `union(m1, m2, ...)` | `list[m1, m2, ...]` | `list(union(type, string, number, bool, atom))` |

A field with a default keeps its type in `.inner`; the default is not part of the entry. The
members of a union follow `union.canonical-order`.

r[introspection.literal-member] A literal union member appears as its value
`.inner` on a union MUST list a literal member as the literal value, not as a type.
`union("a", number).inner` is `list[number, "a"]`.

r[introspection.leaf] A leaf type has no inner
`.inner` on a scalar type, `vector`, `iterator`, `type`, or `any` MUST halt with RILL-R003.

r[introspection.outer] .outer returns what a computing type yields
`.outer` on a function type MUST return its declared result, or `any` when none is declared.
`.outer` on a stream type MUST return its resolution type, or `any` when none is declared.

r[introspection.no-outer] A type with no outer halts
`.outer` on any type other than a function or stream type MUST halt with RILL-R003.

r[introspection.defaults] .defaults lists the fields that declare a default
`.defaults` on a `dict`, `ordered`, or function type MUST return a dict of the default
values, keyed by field or parameter name. A field without a default MUST NOT appear, and a type
with none MUST return an empty dict.

r[introspection.defaults-halt] A type with no named fields has no defaults
`.defaults` on a list, union, stream, or scalar type MUST halt with RILL-R003.

r[introspection.annotations] .annotations lists field annotations {pending #565}
`.annotations` MUST list the annotations of a type's fields, as a property parallel to
`.defaults`. The entries of `.inner` stay plain types.

## Interactions

r[introspection.presence] The presence probe reports a property without halting
`.?p` on a type value MUST return `true` exactly when `.p` does not halt.

r[introspection.fallback] The fallback operator recovers a missing property
`??` MUST supply its right operand when the left side reads a property the type lacks. It MUST
NOT recover any other halt.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| `.inner` read on a leaf type | RILL-R003 | Yes |
| `.outer` read on a type with no outer | RILL-R003 | Yes |
| `.defaults` read on a type with no named fields | RILL-R003 | Yes |

## Examples

```rill
dict(a: number, b: string).inner == dict[a: number, b: string]
# Result: true
```

```rill
list(number).inner == number
# Result: true
```

```rill
stream(string):number => $t
list[$t.inner, $t.outer] == list[string, number]
# Result: true
```

```rill
dict(a: string = "x", b: number).defaults
# Result: dict[a: "x"]
```

```rill
number.inner ?? any
# Result: any
```

```rill
union("b", "a").inner
# Result: list["a", "b"]
```

```rill pending=571
fn(a: string, b: number) { $a } => $f
$f.^type.inner == ordered[a: string, b: number]
# Result: true
```

## Notes

Removed probes halt naming `.^type.inner` or `.^type.outer`: `.^input` and `.^output` on a
function (RILL-R008), `.^chunk` and `.^output` on a stream (RILL-R003).

Open decision: #595. A default on a tuple position cannot be read from the type, because
`.defaults` is keyed by name and `.defaults` on a tuple type halts RILL-R003 today. The
`.inner` of a tuple type omits positional defaults, and `.signature` prints them.

On `main`, `list == list(any)` and `stream == stream(any):any` are false; #571 makes a bare type
equal its defaulted form.
