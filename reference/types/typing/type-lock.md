---
id: type-lock
title: Type-locked variables
status: normative
since: 0.24.0
issues: [571, 598]
grammar: []
errors: [RILL-R001]
depends: [type-value, structural-typing, any, union, assertion, carried-type, declaration, inference]
tests: [capture-types.test.ts, declared-types.test.ts, type-assertions.test.ts]
---

# Type-locked variables

A variable locks to a type on its first capture, and a later capture of a value that lacks that type halts.

## Evaluation

r[type-lock.first] The first capture locks the variable
The first capture into a name within a scope MUST lock the variable. No annotation is required.

r[type-lock.narrowest] A variable locks to the narrowest type its first value has {pending #598}
The first capture MUST lock the variable to the carried asserted type of the value if it has one, otherwise
its declared type, otherwise its full inferred type. A lock MUST NOT reduce to the kind alone.

r[type-lock.list] A list locks to its element type {pending #598}
`list[1] => $x` MUST lock `$x` to `list(number)`, so `list["a"] => $x` MUST halt with RILL-R001.

r[type-lock.dict] A dict locks to its field types {pending #598}
`dict[a: 1] => $x` MUST lock `$x` to `dict(a: number)`, so `dict[a: "x"] => $x` MUST halt with
RILL-R001.

r[type-lock.tuple] A tuple locks to its position types {pending #598}
`tuple[1] => $x` MUST lock `$x` to `tuple(number)`, so `tuple["a"] => $x` MUST halt with
RILL-R001.

r[type-lock.empty] An empty collection locks its unspecified form {pending #598}
An empty collection infers its unspecified form. `list[] => $x` MUST lock `$x` to `list` and
admit any list.

r[type-lock.declaration] A declaration locks a narrower type {pending #571}
`list(number)[] => $x` MUST lock `$x` to `list(number)`, so `list["a"] => $x` MUST halt with
RILL-R001.

r[type-lock.asserted] An asserted type locks the variable
A captured value that carries an asserted type MUST lock the variable to that type. A union lock
admits a value of any member.

r[type-lock.annotation] A capture annotation sets the lock
`=> $x:T` MUST lock the variable to `T` when it is the first capture into the name.

r[type-lock.any] An any annotation does not unlock
`=> $x:any` MUST lock exactly as `=> $x` does, to the type the value carries.

r[type-lock.same] A capture of the locked type replaces the value
A later capture of a value that has the locked type MUST replace the variable's value. The lock
MUST remain.

r[type-lock.parameter] A parameter locks to its asserted type
A capture of a typed parameter MUST lock the new variable to the parameter's asserted type, so a
`union(string, number)` parameter captured as `$w` accepts either member later.

r[type-lock.halt] A capture that breaks the lock halts
A capture of a value that lacks the locked type MUST halt with RILL-R001 at that capture, and the
message names the variable and the locked type.

r[type-lock.annotation-after] A later annotation never relocks
A capture annotation on a variable already locked MUST NOT change the lock. `1 => $x` then
`"a" => $x:string` MUST halt with RILL-R001.

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A later capture has a value that lacks the locked type | RILL-R001 | Yes |

## Examples

```rill
1 => $x
2 => $x
$x
# Result: 2
```

```rill pending=598
# Error: RILL-R001, $x is locked as list(number)
list[1] => $x
list["a"] => $x
```

```rill pending=598
# Error: RILL-R001, $x is locked as dict(a: number)
dict[a: 1] => $x
dict[a: "x"] => $x
```

```rill pending=598
# Error: RILL-R001, $x is locked as tuple(number)
tuple[1] => $x
tuple["a"] => $x
```

```rill
list[] => $x
list["a"] => $x
$x
# Result: list["a"]
```

```rill pending=571
# Error: RILL-R001, $x is locked as list(number)
list(number)[] => $x
list["a"] => $x
```

```rill
1 => $x:union(number, string)
"a" => $x
$x
# Result: "a"
```

```text
# Error: RILL-R001, $x is locked as number
1 => $x
"a" => $x
```

## Notes

A capture that fails its own annotation, as in `3 => $x:string`, halts RILL-R001 today. The same
failure at `-> :string` halts `#TYPE_MISMATCH`.

Today the runtime locks only the kind of a collection, so `list[1] => $x` then `list["a"] => $x` succeeds. #598 builds the narrowest-type lock.

Open decision: #569, which halt a typed capture raises.
