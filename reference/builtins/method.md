---
id: method
title: Built-in methods
status: normative
since: 0.24.0
issues: []
grammar: []
errors: [RILL-P006, RILL-R001, RILL-R003, RILL-R007, RILL-R044, RILL-R045]
depends: [access, pipe, invocation, defaults, halt]
tests: [methods.test.ts, variable-method-calls.test.ts, access-halt.test.ts, builtin-string.test.ts]
---

# Built-in methods

A built-in method is a function the runtime defines for one or more value kinds, called on a
receiver with `.name`.

## Syntax

The `method-call` production is stated in `access`.

```text
receiver.name(arguments)    receiver.name    value -> .name(arguments)    value -> .name
```

## Static rules

r[method.no-spread] A method takes no spread argument
A spread in a method's argument list MUST be rejected with RILL-P006.

## Evaluation

r[method.receiver] A method runs on the value before it
`v.m(args)` MUST call the method `m` with `v` as its receiver, whether `v` is a variable, a
literal, a grouped expression, or a call result. `v -> .m(args)` is stated in `pipe.method`.

r[method.no-parens] Parentheses MAY be omitted when no argument is passed
`v.m` and `v -> .m` MUST call `m` with no arguments, as `v.m()` does.

r[method.unknown] A name no kind defines halts
A method name that no value kind defines MUST halt with RILL-R007.

r[method.wrong-kind] A method the receiver's kind lacks halts
A method that another value kind defines, called on a receiver whose kind does not define it,
MUST halt with RILL-R003.

r[method.arguments] Method arguments bind as call arguments do
A method's arguments MUST bind to its parameters as `invocation.positional`,
`invocation.excess`, `invocation.type`, `defaults.param`, and `defaults.param-required` state.

## Interactions

`.empty` is stated in `vacancy.empty-probe`, `.at` in `selection.at`, and `.eq`, `.ne`, `.has`,
`.has_any`, and `.has_all` in `equality.methods`. A method call carries no name: value argument
(`invocation.no-named`).

## Errors

| Condition | Error | Catchable |
|-----------|-------|-----------|
| A spread in a method's argument list | RILL-P006 | No |
| A method name no kind defines | RILL-R007 | Yes |
| A method the receiver's kind lacks | RILL-R003 | Yes |
| An argument fails its parameter type (`invocation.type`) | RILL-R001 | No |
| A required argument is omitted (`defaults.param-required`) | RILL-R044 | No |
| More arguments than parameters (`invocation.excess`) | RILL-R045 | No |

## Examples

```rill
"abc" => $s
list[$s.len, $s.len(), $s -> .upper, "a,b".split(",")]
# Result: list[3, 3, "ABC", list["a", "b"]]
```

```rill
guard { 5 -> .trim } => $r
$r.!code
# Result: #RILL_R003
```

```rill
# Error: Function expects 0 arguments, got 1
"abc" -> .len(1)
```

## Notes

`.keys`, `.values`, and `.entries` on a receiver without them, and `.at` on a dict or an ordered,
halt RILL-R003 that `guard` cannot catch, a runtime defect against `method.wrong-kind`.
