---
id: inference
title: Type inference
status: normative
since: 0.24.0
issues: [562, 600]
grammar: []
errors: [RILL-R002]
depends: [type-value, structural-typing, any, union, list, dict, tuple, ordered]
tests: [collection-literals.test.ts, collection-operators.test.ts, type-values.test.ts]
---

# Type inference

Inference gives a value with no carried type the most precise type that describes it.

## Evaluation

r[inference.scalar] A scalar infers its own kind
A string, number, bool, or atom value MUST infer `string`, `number`, `bool`, or `atom`.

r[inference.describes] Inference describes and never rejects {pending #562}
Inference MUST NOT reject a well-formed value because its parts differ. Strictness comes from an
assertion or a declaration, as `assertion` and `declaration` state.

r[inference.uniform] A list of one element type infers that type
A list whose elements share one type MUST infer `list(T)` for that type.

r[inference.positions] A tuple infers one type per position
A tuple MUST infer one type for each position, so `tuple[1, "a"]` infers
`tuple(number, string)`.

r[inference.fields] A dict or ordered value infers one type per field
A dict or ordered value MUST infer one type for each field, so `dict[a: 1, b: "x"]` infers
`dict(a: number, b: string)`.

r[inference.empty] An empty list infers any
`list[]` MUST infer `list(any)`.

r[inference.empty-sibling] An empty list yields to its populated siblings
An empty collection among populated siblings MUST yield to the siblings' type, so
`list[list[1], list[]]` infers `list(list(number))`.

r[inference.shape-union] Dicts that differ in keys infer a union of their shapes {pending #600}
Dict elements with different keys MUST infer `list(union(...))` over their shapes, so
`list[dict[a: 1], dict[b: 2]]` infers `list(union(dict(a: number), dict(b: number)))`.

r[inference.shape-union-ordered] Ordered values that differ in keys infer a union {pending #600}
Ordered elements with different keys MUST infer `list(union(...))` over their shapes, so
`list[ordered[a: 1], ordered[b: 2]]` infers `list(union(ordered(a: number), ordered(b: number)))`.

r[inference.union-element] A list of mixed elements infers a union of their types
When elements share no one type, the list MUST infer `list(union(...))` over the element types
present, reduced by the union rules. This holds for a list built by `seq`, `fan`, `acc`, `.values`,
and any other operation that builds a list at run time.

r[inference.literal-union] A mixed list literal infers a union {pending #562}
A list literal whose elements differ in type MUST infer `list(union(...))` and MUST NOT halt.
`list[1, "a"]` ⇒ a list of type `list(union(number, string))`.

r[inference.nested-union] Mixed compound elements keep their detail {pending #562}
`list[list[1], list["a"]]` MUST infer `list(union(list(number), list(string)))`. The inferred type
MUST NOT drop the inner types of the elements.

r[inference.dict-iteration] Dict iteration infers its entry union {pending #562}
Iterating a dict whose fields differ in type MUST yield entries typed `dict(key: string, value: T)`,
and the result list MUST infer the reduced union of those entries.

r[inference.recursive] The union rule recurses through nested collections {pending #562}
The union rule MUST apply at every depth, so `list[list["a", 1], list["a"]]` infers
`list(list(union(string, number)))`.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A list literal has elements of differing types | RILL-R002 | Yes |

The row describes the behavior until `inference.literal-union` is built; `inference.describes`
holds from the same point.

## Examples

```rill
list[1, 2] -> .^type -> .signature
# Result: "list(number)"
```

```rill
dict[a: 1, b: 2] -> .values -> .^type -> .signature
# Result: "list(number)"
```

```rill
dict[a: 1, b: "x"] -> .values -> .^type -> .signature
# Result: "list(union(number, string))"
```

```rill pending=600
list[dict[a: 1], dict[b: 2]] -> .^type -> .signature
# Result: "list(union(dict(a: number), dict(b: number)))"
```

```rill pending=562
list[1, "a"] -> .^type -> .signature
# Result: "list(union(number, string))"
```

## Notes

Today a list of dicts with different keys infers the uniform type: `list[dict[a: 1], dict[b: 2]]` infers
`list(dict(number))`, and `list[ordered[a: 1], ordered[b: 2]]` infers `list(ordered(number))`. Superseded rule id: `inference.uniform-value`.

Known conflict: a literal `list[1, "a"]` halts RILL-R002 today, while every other mixed list infers
`list(union(...))`. `inference.literal-union` removes the conflict.

Compound elements that differ, such as `list[list[1], list["a"]]`, infer `list(list)` today, and
`dict` entries from iteration infer `list(dict)`.
