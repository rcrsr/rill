# rill Error Handling

*Invalid values halt; recover with guard, retry, and status probes*

## Overview

rill has no exceptions and no try/catch. Errors are values.

When a computation fails, the result becomes an **invalid value**. Invalid values carry a status sidecar with an error code, message, and trace. Any access on an invalid value halts execution. Recovery requires explicit `guard` or `retry<limit: N>` blocks.

| Concept | Syntax | Purpose |
|---------|--------|---------|
| Status probe | `$x.!` | Test whether a value is invalid |
| Status field | `$x.!code` | Read the error atom from the sidecar |
| Guard recovery | `guard { body }` | Catch a halt; return the invalid value |
| Filtered guard | `guard<on: #AUTH> { body }` | Catch only specific error atoms |
| Retry | `retry<limit: 3> { body }` | Re-enter the body up to N times |
| Vacancy default | `$x ?? fallback` | Replace a vacant or missing value |
| Presence check | `$x.?field` | Test field existence without halting |

---

## Status Sidecar

Every rill value logically carries a status sidecar. Valid values share one frozen singleton (zero allocations). Invalid values carry a populated clone.

The sidecar has a fixed shape:

| Field | Type | Meaning |
|-------|------|---------|
| `code` | atom, a member of `union(#ok, error_code)` | `#ok` on a valid value, else an error code such as `#TIMEOUT` |
| `message` | string | Human-readable description |
| `provider` | string | Name of the component that produced the error |
| `raw` | dict | Provider-specific payload |
| `trace` | list | Ordered sequence of trace frames |

Read sidecar fields using `.!field` on any value:

```rill
"hello".!               # false  (valid value — not invalid)
"hello".!code           # #ok
"hello".!message        # ""
"hello".!provider       # ""
```

`.!` never halts. It bypasses the access gate and reads the sidecar directly.

---

## Access vs Non-Access

Not all operations behave the same when applied to an invalid value. The access gate enforces a strict two-category split.

**Access forms halt on an invalid value:**

| Form | Example |
|------|---------|
| Field read | `$x.name` |
| Index read | `$x[0]` |
| Method call | `$x.upper` |
| Pipe | `$x -> fn` |
| Arithmetic | `$x + 1` |
| Type assertion | `$x :string` |

**Non-access forms pass the invalid value through unchanged:**

| Form | Example |
|------|---------|
| Capture | `$x => $y` |
| Conditional | `$x -> ? "yes" ! "no"` |
| Status probe | `$x.!` |
| Presence check | `$x.?field` |
| Default operator | `$x ?? fallback` |
| `guard` / `retry<limit: N>` wrapping | `guard { $x.name }` |

Access halts are **catchable** by `guard` and `retry<limit: N>`. Halts from `error` and `assert` are **non-catchable** and propagate through any recovery block.

```rill
"valid" => $v
$v.upper
# Result: "VALID"
```

```rill
# Error: access halt
guard { 1 / 0 } => $x
$x.upper
```

---

## Error Atoms (`:atom`)

Error codes are atoms. An atom literal is an identifier prefixed with `#`. Names are case-sensitive; error codes are uppercase by convention only. Atoms are identified and compared by name; nothing is registered.

Read the code from any value's sidecar:

```rill
"ok".!code
# Result: #ok
```

A valid value's code is always `#ok`. An invalid value's code is the atom set at invalidation time.

`:atom` is the 16th primitive type in rill. Two atoms with the same name are equal.

Convert between atoms and strings with the built-in forms:

| Operation | Syntax | Result |
|-----------|--------|--------|
| Atom to string | `#TIMEOUT -> string` | `"TIMEOUT"` (no `#` sigil) |
| String to atom | `"TIMEOUT" -> atom` | `#TIMEOUT` atom identity |
| Any well-formed name | `"BOGUS" -> atom` | `#BOGUS` |
| The sentinel name | `"ok" -> atom` | `#ok` |
| Malformed name | `"1x" -> atom` | Halts `#INVALID_INPUT` |

The `.!code` probe returns the atom value. Pass `#CODE` literals to `on:` as one atom or a list.

A name is well-formed when it starts with a letter or underscore and continues with letters, digits, or underscores. Atoms with different names are never equal, so `#WIRED` does not equal `#WIRELESS`:

```rill
(#WIRED == #WIRELESS)
# Result: false
```

```rill
(#WIRED -> string)
# Result: "WIRED"
```

Names are case-sensitive, so a lowercase spelling is a different atom:

```rill
(#timeout == #TIMEOUT)
# Result: false
```

```rill
"ok" -> atom
# Result: #ok
```

A malformed name halts instead of converting:

```rill
"1x" -> atom
# Error: cannot convert string "1x" to atom: not a valid atom name
```

---

## Built-in Atoms and the Core Error Set

rill defines these atoms. Every halt and every invalid value carries one of them as its code, except `#ok` and `#IGNORE`, which are not error codes. The remaining atoms form the **core error set**, a closed list that hosts cannot extend:

| Atom | Meaning |
|------|---------|
| `#ok` | Not an error code. Code on every valid value; never appears on invalid values |
| `#R001` | Ordinary error code. Carried by an invalid value from a parse-recovery node and by a synthesized or host-built `retry` node with an attempt count below 1 (script `retry<limit: 0>` is a parse error) |
| `#R999` | Unhandled extension throw reshaped at the extension boundary |
| `#TIMEOUT` | Operation exceeded its time limit |
| `#RILL_R###` | Family of 36 atoms, one per halting registry error. Each is named for its error ID and carries that halt's code, for example `#RILL_R002` for a type error. The names are `RILL_R001`, `RILL_R002`, `RILL_R003`, `RILL_R005` to `RILL_R010`, `RILL_R012`, `RILL_R015`, `RILL_R016`, `RILL_R036` to `RILL_R038`, `RILL_R040` to `RILL_R044`, `RILL_R054` to `RILL_R058`, `RILL_R060`, `RILL_R061`, `RILL_R064` to `RILL_R066`, `RILL_R082`, `RILL_R083`, `RILL_R085`, and `RILL_R088` to `RILL_R090`. See [Error Reference](ref-errors.md) |
| `#RILL_R082` | `timeout<total:>` wall-time bound exceeded; recover via `guard`/`??` |
| `#RILL_R083` | `timeout<idle:>` inactivity bound exceeded; recover via `guard`/`??` |
| `#AUTH` | Authentication failure (HTTP 401) |
| `#FORBIDDEN` | Authorization failure after authentication (HTTP 403, scope mismatch, content-filter block) |
| `#RATE_LIMIT` | Temporal throttling (HTTP 429); recover via retry-after |
| `#QUOTA_EXCEEDED` | Account-level resource exhaustion (billing credits, plan limit) |
| `#UNAVAILABLE` | Service or resource not available |
| `#NOT_FOUND` | Requested resource does not exist |
| `#CONFLICT` | State conflict (e.g. duplicate write) |
| `#INVALID_INPUT` | Input failed validation; also: `sort` key extractor returns a vacant value; negative `n` for `take`/`skip`; `n <= 0` for `batch`/`window`; `step <= 0` for `window`; negative or non-integer count for `repeat()`, `.repeat`, `.pad_start` and `.pad_end`; non-positive or non-integer `concurrency` for `fan`/`filter`; unknown option key for `fan`/`filter`; zero `step` for `range`; non-integer index for `[]`, `.(n)`, `.at`, or list dispatch; zero `step` for `slice<>`; negative `.subtract` result, negative `.multiply` factor, non-finite or fractional-month `.multiply` result, and `.total_ms` on a calendar duration; vector dimension mismatch for `.similarity`/`.dot`/`.distance` |
| `#PROTOCOL` | Response shape violates documented contract (parse failure, schema mismatch) |
| `#DISPOSED` | Extension was called after disposal |
| `#TYPE_MISMATCH` | Failed `:type` assertion or conversion; also: `sort` key extractor produces mixed types across elements, `sort` `key_fn` argument is non-callable, tuple comparison receives different-length or differently-typed tuples, or `start_when`/`stop_when` predicate returns a non-bool value; wrong-typed argument to `duration()`/`datetime()` or to datetime/duration methods such as `.add`, `.subtract`, `.multiply`, `.diff`; non-vector argument to `.similarity`/`.dot`/`.distance`; non-dict options for `fan`/`filter`; non-number `concurrency` for `fan`/`filter`; `filter` predicate returns a non-bool value |
| `#IGNORE` | Not an error code. Marker for `pass<on_error: #IGNORE> { body }` to suppress catchable halts in the body |

`#ok` is lowercase because it is a reserved sentinel, not a user-visible error. Scripts and hosts cannot produce `#ok` as an error code. You can write `#ok` as a literal to compare against a sidecar code, or build the value with `"ok" -> atom`.

```rill
("hello".!code == #ok)
# Result: true
```

Hosts cannot add error codes. A host reports a domain failure with the nearest core code and carries the detail in `raw`. See [Extension Authoring](#extension-authoring).

The core error set is the type `error_code`. A recovered halt carries a member of it:

```rill
guard { 1 / 0 } => $r
$r.!code -> :?error_code
# Result: true
```

A valid value's code is `#ok`, which is not a member:

```rill
"hi".!code -> :?error_code
# Result: false
```

Every `.!code` value is a member of `union(#ok, error_code)`, and `.^type` reports that union. `.^effective` reports the own type:

```rill
("hi".!code.^type == union(#ok, error_code))
# Result: true
```

```rill
"hi".!code.^effective.name
# Result: "atom"
```

---

## Guard Recovery

`guard` runs a body once. If the body halts with a catchable signal, `guard` returns the invalid value instead of propagating the halt.

```rill
"ok" => $result
guard { $result.upper }
# Result: "OK"
```

When the body halts:

```rill
guard { 1 / 0 } => $r
$r.!code
# Result: #RILL_R002
```

Use `.!` to check whether `guard` caught a halt:

```rill
"hello" => $val
guard { $val.upper } => $out
$out.!
# Result: false
```

### Filtered Guard

Add `<on: #CODE>` or `<on: list[#CODE, ...]>` to catch only specific codes. Halts with non-matching codes propagate:

```rill
guard<on: #RILL_R002> { 1 / 0 } ?? 9
# Result: 9
```

```text
use<ext:app> => $app
guard<on: list[#TIMEOUT, #UNAVAILABLE]> {
  $app.fetch("https://api.example.com")
}
```

Every name must belong to the core error set (see [Built-in Atoms and the Core Error Set](#built-in-atoms-and-the-core-error-set)). A name outside it is a parse error, so a misspelled code fails before the script runs:

```rill
guard<on: #CARD_DECLINED> { 1 }
# Error: '#CARD_DECLINED' is not a core error code
```

`on: list[]` is also a parse error. It does not mean catch everything:

```rill
guard<on: list[]> { 1 / 0 }
# Error: on: list[] is empty
```

Omit `on:` and write `guard { ... }` to catch every catchable halt.

`guard` does **not** catch halts from `error "..."` or `assert`. Those are non-catchable and always propagate.

```text
# Error: non-catchable — 'error' propagates through guard
guard { error "fatal" }
```

---

## Side-Effect Suppression with `pass<on_error: #IGNORE>`

The `pass` keyword has three distinct forms. Two of them, the body forms, interact with halts.

| Form | Suppresses catchable halts? |
|------|----------------------------|
| Bare `pass` | N/A — references current `$`; halts `#RILL_R005` if `$` is unbound |
| `pass { body }` | No — runs body for side effects; pipe value flows through; halts in body propagate |
| `pass<on_error: #IGNORE> { body }` | Yes — runs body; suppresses catchable halts in body; pipe value flows through |

Use `pass<on_error: #IGNORE>` when a side-effect block (logging, metrics, audit calls) may halt and you do not want the halt to break the surrounding pipeline:

```rill
10 -> pass<on_error: #IGNORE> { 1 / 0 }
# Result: 10 (the body halt is suppressed; pipe value is unchanged)
```

Without `on_error: #IGNORE`, halts in the body propagate normally:

```text
# Error: #RILL_R002 — body halt propagates
10 -> pass { 1 / 0 }
```

`on_error` accepts only `#IGNORE`. Empty `pass<>`, unknown option keys, and any other `on_error` value are parse errors (`RILL-P004`).

### What Is and Is Not Suppressed

`pass<on_error: #IGNORE>` matches `guard`'s catchable-halt rule. Two categories always propagate out of the body:

| Signal | Behavior |
|--------|----------|
| Non-catchable halts (`error "..."`, `assert`) | Propagate; the pipeline halts |
| `ControlSignal` (`break`, `return`) | Propagate to the enclosing construct |

See [Collection Slicing](topic-collection-slicing.md#pass-body-forms) for the full reference of all three `pass` forms.

---

## Timeout Recovery

`timeout<total:>` and `timeout<idle:>` blocks produce catchable halts on expiry. The expiry halt propagates like any other catchable halt: it must be caught by `guard` before `??` can supply a fallback.

| Timeout kind | Expiry atom | Recovery pattern |
|-------------|-------------|-----------------|
| `timeout<total: duration>` | `#RILL_R082` | `guard { timeout<total: d> { body } }` |
| `timeout<idle: duration>` | `#RILL_R083` | `guard { timeout<idle: d> { body } }` |

Wrap the timeout block in `guard` to prevent the halt from stopping execution:

```text
use<ext:app> => $app
guard {
  timeout<total: duration(0, 0, 0, 0, 0, 0, 500)> {
    $app.fetch("https://api.example.com/slow")
  }
} ?? "fallback"
```

The `??` operator after `guard` supplies the fallback when guard catches the expiry.

Branch on the specific atom to handle timeout distinctly from other errors:

```text
use<ext:app> => $app
guard {
  timeout<total: duration(0, 0, 0, 0, 0, 0, 500)> {
    $app.fetch("https://api.example.com/slow")
  }
} => $result
$result.! ? {
  ($result.!code -> .eq(#RILL_R082)) ? "timed out"
  ! "other error: {$result.!message}"
} ! $result
```

See [Control Flow](topic-control-flow.md#timeout-blocks) for the full timeout block reference, including nesting semantics and cancellation behavior.

---

## Retry

`retry<limit: N>` re-enters its body up to N times. Each failed attempt appends a `guard-caught` trace frame. On success, the body result is returned. If all N attempts fail, the final invalid value is returned with N trace frames.

```text
use<ext:app> => $app
retry<limit: 3> {
  $app.fetch("https://api.example.com")
}
```

Attempt count rules:

| N | Behavior |
|---|----------|
| `>= 1` | Body runs up to N times |
| `0` | Parse error: `retry<limit: 0>` is rejected by the parser |

`retry<limit: N>` accepts the same `on:` forms as `guard` (`on: #CODE` or `on: list[#CODE, ...]`) and the same core error set. Non-matching halts propagate immediately.

```text
use<ext:app> => $app
retry<limit: 3, on: #UNAVAILABLE> {
  $app.fetch("https://api.example.com")
}
```

After all attempts fail, read the trace to see how many attempts ran:

```text
use<ext:app> => $app
retry<limit: 3> {
  $app.fetch("https://api.example.com")
} => $result
$result.!trace -> .len      # up to 3 guard-caught frames
```

---

## Vacancy and `??`

A value is **vacant** when it is empty or invalid. `isVacant` (host API) covers both cases.

Empty values are: `""`, `0`, `false`, `[]`, `[:]`.

The `??` operator provides a fallback when a value is vacant:

```rill
[:] => $empty
$empty.name ?? "unknown"
# Result: "unknown"
```

```rill
[name: "alice"] => $user
$user.name ?? "unknown"
# Result: "alice"
```

`??` does not halt. It reads the left-hand side and returns the fallback when the result is missing or vacant.

### Presence Check `.?field`

`.?field` checks whether a field exists without halting:

```rill
[name: "alice"] => $user
$user.?name
# Result: true
```

```rill
[name: "alice"] => $user
$user.?age
# Result: false
```

Combine `.?field` with `??` to inspect and fall back:

```rill
[name: "alice"] => $user
$user.?age ? ($user.age) ! ($user.name ?? "no name")
# Result: "alice"
```

---

## Trace Model

Every access on an invalid value appends an `access` frame to the sidecar trace. `guard` and `retry<limit: N>` append a `guard-caught` frame when they intercept a halt.

Frames accumulate in append order. Prior frames are never copied; only the new frame is added (O(1) per append).

Frame fields:

| Field | Type | Meaning |
|-------|------|---------|
| `site` | string | Source location (`file.rill:line`) |
| `kind` | string | One of six kinds; see table below |
| `fn` | string | Host fn name, operator, or type op; `""` when not applicable |
| `wrapped` | dict | Prior status dict; empty except on `wrap` frames |

Frame kinds:

| Kind | Appended when |
|------|--------------|
| `host` | Extension calls `ctx.invalidate`. First frame on a new invalid value. |
| `type` | A type assertion or conversion fails. |
| `access` | An invalid value is accessed (pipe, method, arithmetic, etc.). |
| `guard-caught` | A `guard` or `retry<limit: N>` block catches a halt. |
| `guard-rethrow` | A caught invalid value is re-accessed and halts again. |
| `wrap` | `error "..."` wraps an invalid value; `wrapped` carries the prior status. |

Read the trace with `.!trace`:

```text
use<ext:app> => $app
guard { $app.fetch("https://api.example.com") } => $result
$result.!trace -> seq({
  "{$.kind} at {$.site}"
})
```

A trace with 3 frames from `retry<limit: 3>` exhaustion looks like:

```text
[
  [kind: "access", site: "script:2", fn: "pipe"],
  [kind: "guard-caught", site: "script:1", fn: "retry"],
  [kind: "guard-caught", site: "script:1", fn: "retry"],
  [kind: "guard-caught", site: "script:1", fn: "retry"]
]
```

Each `retry<limit: N>` exhaustion adds one `guard-caught` frame per attempt.

---

## Composition Patterns

### Check Before Access

Test validity before accessing fields on a potentially invalid value:

```rill
"hello" => $val
$val.! ? "invalid" ! $val.upper
# Result: "HELLO"
```

### Guard Then Inspect

Use `guard` to contain a halt, then inspect the result:

```rill
"hello" => $val
guard { $val.upper } => $out
$out.! ? "failed: {$out.!message}" ! $out
# Result: "HELLO"
```

### Retry With Fallback

Combine `retry<limit: N>` and `??` for resilient access:

```text
use<ext:app> => $app
retry<limit: 3> {
  $app.fetch("https://api.example.com")
} => $result
$result ?? "fallback response"
```

### Filter by Code

Handle specific errors differently using filtered guard:

```text
use<ext:app> => $app
guard<on: #TIMEOUT> {
  $app.fetch("https://api.example.com/slow")
} => $timeout_result

guard<on: #AUTH> {
  $app.fetch("https://api.example.com/secure")
} => $auth_result
```

### Read Error Code

Branch on the specific error atom:

```text
use<ext:app> => $app
guard { $app.fetch("https://api.example.com") } => $result
$result.! ? {
  ($result.!code -> .eq(#TIMEOUT)) ? "timed out"
  ! ($result.!code -> .eq(#AUTH)) ? "auth failed"
  ! "unknown error: {$result.!message}"
} ! $result
```

---

## Extension Authoring

Extensions produce invalid values using `ctx.invalidate` at call time. They cannot add error codes.

The factory receives an `ExtensionFactoryCtx`:

```typescript
interface ExtensionFactoryCtx {
  readonly signal: AbortSignal;
}
```

### Report a Domain Failure

Inside a callable's `fn`, use `ctx.invalidate(error, meta)` to return an invalid value instead of throwing. `meta.code` must belong to the core error set. Pick the nearest code and carry the domain detail in `raw`:

```typescript
fn: async (args, ctx) => {
  const result = await charge(args.card);
  if (result.declined) {
    return ctx.invalidate(result, {
      code: 'INVALID_INPUT',
      provider: 'payment',
      raw: { message: 'Card declined', reason: 'CARD_DECLINED' },
    });
  }
  return result.id;
}
```

`ctx.invalidate` throws `RILL-R084` at the call when `meta.code` is `ok` or outside the core error set. The script reads the detail from the sidecar:

```text
use<ext:payment> => $pay
guard { $pay.charge("4111") } => $r
$r.!reason
```

When a domain value is a valid result rather than a failure, return it as a string and convert it with `-> atom` in the script.

### Produce Invalid Values

`ctx.invalidate` takes the same shape for any failure that fits a core code:

```typescript
fn: async (args, ctx) => {
  if (!args.url.startsWith('https://')) {
    return ctx.invalidate(args.url, {
      code: 'INVALID_INPUT',
      provider: 'my-ext',
      raw: { message: 'URL must use HTTPS' },
    });
  }
  return await fetch(args.url).then(r => r.text());
}
```

### Catch Extension Throws

Use `ctx.catch(thunk, detector)` to reshape uncaught throws into invalid values:

```typescript
fn: async (args, ctx) => {
  return ctx.catch(
    () => riskyOperation(args.input),
    (err) => err instanceof NetworkError
      ? { code: 'UNAVAILABLE', provider: 'my-ext', raw: { message: err.message } }
      : null
  );
}
```

`ctx.catch` returns the thunk's result on success. On a matching throw, it returns an invalid `RillValue`. A detector that returns `null` yields an invalid `#R999` value.

Unhandled throws are reshaped to `#R999` at the extension boundary automatically.

### Disposal

Disposing the runtime context with `ctx.dispose()` aborts its signal. A call made after that halts with a non-catchable `RuntimeHaltSignal` carrying `#DISPOSED`, so `guard` and `retry` cannot recover it. See [Cancellation](integration-host.md#cancellation) in the host integration guide.

An extension's own `dispose()` releases its resources. It lives on `ExtensionFactoryResult`, and the host calls it:

```typescript
const ext = createMyExtension(config, ctx);
// ... use ext ...
await ext.dispose?.();
```

---

## See Also

| Document | Description |
|----------|-------------|
| [Control Flow](topic-control-flow.md) | Conditionals, loops, `error`, and `assert` |
| [Operators](topic-operators.md) | `??`, `.?field`, type assertions |
| [Types](topic-types.md) | Primitives and value types |
| [Type System](topic-type-system.md) | Type checking and assertions |
| [Error Reference](ref-errors.md) | All error codes with causes and resolutions |
| [Host API](ref-host-api.md) | TypeScript embedding API |
| [Developing Extensions](integration-extensions.md) | Writing reusable host function packages |
| [Reference](ref-language.md) | Complete syntax and semantics |
