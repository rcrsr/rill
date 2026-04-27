# rill Error Handling

*Invalid values halt; recover with guard, retry, and status probes*

## Overview

rill has no exceptions and no try/catch. Errors are values.

When a computation fails, the result becomes an **invalid value**. Invalid values carry a status sidecar with an error code, message, and trace. Any access on an invalid value halts execution. Recovery requires explicit `guard` or `retry<N>` blocks.

| Concept | Syntax | Purpose |
|---------|--------|---------|
| Status probe | `$x.!` | Test whether a value is invalid |
| Status field | `$x.!code` | Read the error atom from the sidecar |
| Guard recovery | `guard { body }` | Catch a halt; return the invalid value |
| Filtered guard | `guard<on: list[#AUTH]> { body }` | Catch only specific error atoms |
| Retry | `retry<3> { body }` | Re-enter the body up to N times |
| Vacancy default | `$x ?? fallback` | Replace a vacant or missing value |
| Presence check | `$x.?field` | Test field existence without halting |

---

## Status Sidecar

Every rill value logically carries a status sidecar. Valid values share one frozen singleton (zero allocations). Invalid values carry a populated clone.

The sidecar has a fixed shape:

| Field | Type | Meaning |
|-------|------|---------|
| `code` | atom | Error atom, e.g. `#TIMEOUT` |
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
| `guard` / `retry<N>` wrapping | `guard { $x.name }` |

Access halts are **catchable** by `guard` and `retry<N>`. Halts from `error` and `assert` are **non-catchable** and propagate through any recovery block.

```rill
"valid" => $v
$v.upper
# Result: "VALID"
```

```text
# Error: access halt — $x is invalid
#AB0x => $x
$x.upper
```

---

## Error Atoms (`:atom`)

Error codes are atoms. Atoms are capitalized identifiers prefixed with `#`. They are interned at startup; identity comparison is O(1).

Read the code from any value's sidecar:

```rill
"ok".!code
# Result: #ok
```

A valid value's code is always `#ok`. An invalid value's code is the atom set at invalidation time.

`:atom` is the 16th primitive type in rill. Atoms are interned at registry init time; two atoms with the same name are the same identity.

Convert between atoms and strings with the built-in forms:

| Operation | Syntax | Result |
|-----------|--------|--------|
| Atom to string | `#TIMEOUT -> string` | `"TIMEOUT"` (no `#` sigil) |
| String to atom | `"TIMEOUT" -> atom` | `#TIMEOUT` atom identity |
| Unknown string to atom | `"BOGUS" -> atom` | `#R001` |

The `.!code` probe returns the atom value. Pass atoms in option lists as `#CODE` literals.

Unregistered atom names in `"NAME" -> atom` resolve to `#R001`. The conversion never throws.

---

## Pre-Registered Atoms

These atoms are available in every rill runtime without registration:

| Atom | Kind | Meaning |
|------|------|---------|
| `#ok` | sentinel | Code on every valid value; never appears on invalid values |
| `#R001` | registry | Unknown atom at parse or link time; default fallback |
| `#R999` | registry | Unhandled extension throw reshaped at the extension boundary |
| `#TIMEOUT` | generic | Operation exceeded its time limit |
| `#AUTH` | generic | Authentication failure (HTTP 401) |
| `#FORBIDDEN` | generic | Authorization failure after authentication (HTTP 403, scope mismatch, content-filter block) |
| `#RATE_LIMIT` | generic | Temporal throttling (HTTP 429); recover via retry-after |
| `#QUOTA_EXCEEDED` | generic | Account-level resource exhaustion (billing credits, plan limit) |
| `#UNAVAILABLE` | generic | Service or resource not available |
| `#NOT_FOUND` | generic | Requested resource does not exist |
| `#CONFLICT` | generic | State conflict (e.g. duplicate write) |
| `#INVALID_INPUT` | generic | Input failed validation |
| `#PROTOCOL` | generic | Response shape violates documented contract (parse failure, schema mismatch) |
| `#DISPOSED` | generic | Extension was called after disposal |
| `#TYPE_MISMATCH` | generic | Failed `:type` assertion or conversion |

`#ok` is lowercase because it is a reserved sentinel, not a user-visible error. Scripts cannot produce `#ok` as an error code.

Extensions can register additional atoms at factory init time using `ctx.registerErrorCode(name, kind)`. See [Extension Authoring](#extension-authoring).

---

## Guard Recovery

`guard` runs a body once. If the body halts with a catchable signal, `guard` returns the invalid value instead of propagating the halt.

```rill
"ok" => $result
guard { $result.upper }
# Result: "OK"
```

When the body halts:

```text
# guard catches the halt; script continues with invalid value
guard { #AB0x.field }
# returns invalid #R001
```

Use `.!` to check whether `guard` caught a halt:

```rill
"hello" => $val
guard { $val.upper } => $out
$out.!
# Result: false
```

### Filtered Guard

Add `<on: list[#CODE, ...]>` to catch only specific atoms. Halts with non-matching codes propagate:

```text
guard<on: list[#TIMEOUT]> {
  app::fetch("https://api.example.com")
}
```

Without a filter, `guard` catches every catchable halt.

`guard` does **not** catch halts from `error "..."` or `assert`. Those are non-catchable and always propagate.

```text
# Error: non-catchable — 'error' propagates through guard
guard { error "fatal" }
```

---

## Retry

`retry<N>` re-enters its body up to N times. Each failed attempt appends a `guard-caught` trace frame. On success, the body result is returned. If all N attempts fail, the final invalid value is returned with N trace frames.

```text
retry<3> {
  app::fetch("https://api.example.com")
}
```

Attempt count rules:

| N | Behavior |
|---|----------|
| `>= 1` | Body runs up to N times |
| `0` | Parse error: `retry<0>` is rejected by the parser |

`retry<N>` with a filtered `on:` list behaves like `guard`: non-matching halts propagate immediately.

```text
retry<3, on: list[#UNAVAILABLE]> {
  app::fetch("https://api.example.com")
}
```

After all attempts fail, read the trace to see how many attempts ran:

```text
retry<3> {
  app::fetch("https://api.example.com")
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

Every access on an invalid value appends an `access` frame to the sidecar trace. `guard` and `retry<N>` append a `guard-caught` frame when they intercept a halt.

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
| `guard-caught` | A `guard` or `retry<N>` block catches a halt. |
| `guard-rethrow` | A caught invalid value is re-accessed and halts again. |
| `wrap` | `error "..."` wraps an invalid value; `wrapped` carries the prior status. |

Read the trace with `.!trace`:

```text
guard { app::fetch("https://api.example.com") } => $result
$result.!trace -> seq({
  "{$.kind} at {$.site}"
})
```

A trace with 3 frames from `retry<3>` exhaustion looks like:

```text
[
  [kind: "access", site: "script:2", fn: "pipe"],
  [kind: "guard-caught", site: "script:1", fn: "retry"],
  [kind: "guard-caught", site: "script:1", fn: "retry"],
  [kind: "guard-caught", site: "script:1", fn: "retry"]
]
```

Each `retry<N>` exhaustion adds one `guard-caught` frame per attempt.

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

Combine `retry<N>` and `??` for resilient access:

```text
retry<3> {
  app::fetch("https://api.example.com")
} => $result
$result ?? "fallback response"
```

### Filter by Code

Handle specific errors differently using filtered guard:

```text
guard<on: list[#TIMEOUT]> {
  app::fetch("https://api.example.com/slow")
} => $timeout_result

guard<on: list[#AUTH]> {
  app::fetch("https://api.example.com/secure")
} => $auth_result
```

### Read Error Code

Branch on the specific error atom:

```text
guard { app::fetch("https://api.example.com") } => $result
$result.! ? {
  ($result.!code -> .eq(#TIMEOUT)) ? "timed out"
  ! ($result.!code -> .eq(#AUTH)) ? "auth failed"
  ! "unknown error: {$result.!message}"
} ! $result
```

---

## Extension Authoring

Extensions register error codes and produce invalid values using the `ExtensionFactoryCtx`.

### Register Error Codes

Call `ctx.registerErrorCode(name, kind)` at factory init time:

```typescript
import type { ExtensionFactoryCtx, ExtensionFactoryResult } from '@rcrsr/rill';

function createMyExtension(
  config: MyConfig,
  ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  ctx.registerErrorCode('MY_ERROR', 'generic');
  // ...
}
```

`ExtensionFactoryCtx` shape:

```typescript
interface ExtensionFactoryCtx {
  registerErrorCode(name: string, kind: string): void;
  readonly signal: AbortSignal;
}
```

### Produce Invalid Values

Inside a callable's `fn`, use `ctx.invalidate(error, meta)` to return an invalid value instead of throwing:

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

`ctx.catch` returns the thunk's result on success. On a matching throw, it returns an invalid `RillValue`. Non-matching throws propagate.

Unhandled throws are reshaped to `#R999` at the extension boundary automatically.

### Disposal

After `dispose()` is called, any extension invocation returns an invalid value with code `#DISPOSED`. The `dispose()` method is on `ExtensionFactoryResult`:

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
