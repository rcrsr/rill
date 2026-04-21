# Error Handling Strategy — Brainstorm

Living design document. Goal: idiomatic rill error handling that keeps the common path ceremony-free while giving developers structure to detect, classify, and handle failures.

Scope: `rill` (core runtime, error registry, callable dispatch) and `rill-ext` (extensions, shared packages).

---

## Principles

1. Rill has no exceptions and no `try`/`catch`. `error` and `assert` halt execution.
2. Operational failures are **invalid values**: a rill value whose status is populated. Valid values have an empty status.
3. The common path is unchanged: `foo::bar($x) => $y`. If nothing resolves an invalid value, the script halts the first time the value's data is **accessed** (read, piped, computed on). Capture (`=>`) is not access — invalid status propagates silently through rebinds until a real access fires the halt.
4. Resolvers are built on one primitive, `guard`: a block-scoped catch boundary that converts a halt into an invalid return value. `retry<N>` is `guard` plus a conditional re-run loop. Handle (`.!` branching) and coerce (`??`) operate on the invalid value that `guard` produces.
5. Programmer-initiated halts (`error`, `assert`) are never catchable. `guard` and `retry` catch operational halts only.
6. Error information (code, provider, cause) survives from SDK to script via the fixed-shape status.
7. Compliance is enforced by types and lint at the extension boundary, not by convention.

---

## Invalid values: semantic model

### What an invalid value is

A rill value of any type (`string`, `number`, `dict`, etc.) whose **status** marks it as invalid. Every value has two orthogonal layers:

    data    → the payload (e.g. the string "hello")
    status  → error metadata, always present, fixed shape

Valid values carry an empty status; invalid values carry a populated one. Data and status are independent: invalid status does not change the value's declared type, and a status probe never reads the data.

### Codes as atoms

Codes are a dedicated primitive type `:code`, not strings. Authored as `#NAME` (e.g. `#TIMEOUT`, `#RATE_LIMIT`, `#R001`). Every code the runtime handles is registered; comparison is identity on interned tokens, not string equality.

    $x.!code == #TIMEOUT              # identity compare on atoms
    guard<on: list[#AUTH, #TIMEOUT]>  # list of atoms
    dict[#RATE_LIMIT: "retry", #AUTH: error "check key"]   # atom keys

Unknown atom references (in `on:`, match dicts, comparisons, `ctx.invalidate`) produce `#R001` at parse/link time. A typo fails loudly, not silently. The registry is seeded by core with the generic operational set and grows when extensions register their own codes at factory init.

Atoms are in-process identity values. They do not serialize. Scripts that need to persist a code convert to the name string at the encode boundary: `$x.!code -> name` returns `"TIMEOUT"`. Atoms rehydrate through the registry (`:code("TIMEOUT")` returns `#TIMEOUT`, or `#R001` if unregistered).

### The status

The status shape is fixed to preserve "no null, no undefined":

    dict[
      code:       :code,         # #ok when valid; any registered atom otherwise
      message:    string,        # "" when valid
      provider:   string,        # "" when valid; names the origin ("anthropic-sdk", "node:fs")
      raw:        dict[],        # empty when valid; extension-populated provider specifics
      trace:      list[dict[]]   # empty when valid; grows as halt crosses boundaries
    ]

Each field has one job. `code` identifies the failure kind. `message` is the surface text, `provider` names the origin, `raw` is the opaque provider bag (rate-limit headers, HTTP status, SDK codes) for scripts that want detail. Error wrapping rides on `trace`, not on a nested status field. There is no separate `ok` field; `code == #ok` defines validity, and the `.!` probe is sugar for `code != #ok`.

Retryability is **not** a status field. Whether a failure can succeed on retry is implicit in the code (`#RATE_LIMIT` yes, `#AUTH` no), and whether it's **safe** to retry a given block is a scope question only the script author can answer. The status reports what failed; the script decides what to do.

### Status access

Script reads the status via the `.!` namespace (parallel to `.^` reflection and `.?` presence, see §Vacancy). Two forms:

    $x.!              # bool — true when invalid (sugar for .!code != #ok)
    $x.!code          # :code atom
    $x.!message       # string
    $x.!provider      # string
    $x.!raw           # extension-populated provider dict
    $x.!trace         # ordered list of frames (origin first, latest last)

`.!` is the boolean-error probe. `.!<name>` is a predefined-accessor probe; the accessor set is fixed (`code`, `message`, `provider`, `raw`, `trace`) and unknown names produce a programmer error (`#R001`). There is no whole-status probe; scripts that need the dict build it from accessors or encode it explicitly.

All status probes are **always safe**. They never halt, even on invalid values.

### Access rules (the halt contract)

**Access is resolving or attempting to use the value.** Resolving means the runtime has to fetch the data (read a field, compute an arithmetic result, dispatch a method). Attempting to use means the operation is defined only on the data (pipe target, argument binding, type assertion). If either happens on an invalid value, the script halts.

Non-access is the complement: the runtime moves the value without fetching or using its data. Capture rebinds. Probes read the sidecar status, not the data. Container inclusion stores a reference. None of these resolve or use the value.

Restated by layer: accessing the **data** of an invalid value halts; accessing the **status** never does.

**Access (halts when invalid):**

| Form | Example |
|---|---|
| Field / index read | `$x.field`, `$x[0]` |
| Method call | `$x.upper`, `$x.len` |
| Pipe target | `$x -> anything` |
| Type operations | `$x : type`, `$x :? type`, `$x :> type` |
| Arithmetic, comparison, logic | `$x + 1`, `$x == $y`, `$x != $y`, `!$x` |
| Spread | `list[...$x]`, `dict[...$x, k: 1]` |
| Destructuring bind | `[$a, $b] => $x`, `{k: $v} => $d` |
| Argument to call | `fn($x)` |
| Script return, `assert $x ...`, `error "...{$x}"` | halt keywords |

**Non-access (never halts):**

| Form | Example | Effect |
|---|---|---|
| Capture | `$x => $y` | Rebind; invalid status flows to `$y` |
| Status probe | `$x.!`, `$x.!code`, `$x.!trace` | Reads status |
| Reflection probe | `$x.^type`, `$x.^signature` | Reads structural metadata |
| Presence probe | `$x.?`, `$x.?field` | Reads vacancy (see §Vacancy) |
| Coerce | `$x ?? default` | Substitutes on vacancy |
| Container inclusion | `list[$x]`, `dict[k: $x]` | Stores by reference; element stays invalid |
| Atom identity compare | `$x.!code == #TIMEOUT` | Compares atoms on the status; no data fetch |

Spread (`...$x`) is access because it reads `$x`'s data into the outer container. Plain inclusion stores the value as an element without reading it.

**Why atom compare is non-access while `$x == $y` is access.** The operand decides, not the operator. `$x.!code` returns an atom pulled from the status sidecar, which always exists; comparing two atoms is identity on interned tokens. `$x == $y` asks about data, which may be absent. Same `==` token, different operands, different resolution path.

**Access is about execution, not byte-level copying.** `=>` may internally deep-copy the value (rill has value semantics), but no user code runs and no operation inspects the data. Contrast with `$x -> $some_closure`, which invokes user code with `$x` bound as `$`. Even if the closure body ignores its input, the language treats invocation as access — it does not look inside bodies to decide.

**Parameter binding inside a call is access, distinct from `=>` capture.** `fn($x)` binds `$x` to the callee's parameter slot, which is an execution step the callee controls. `$x => $y` is a system rebind the runtime implements directly. The rule: whole-value rebind (`=>` on a bare name) is non-access; any binding that reaches into structure is access. Destructuring (`[$a, $b] => $x`, `{name: $n} => $d`), spread, function parameters, closure invocation, and pipe targets all qualify.

**Equality and comparison are access, not status checks.** You can't compare something that isn't there. Equality is a question about data, and an invalid value has no data to answer with, so `$x == $y` halts when either side is invalid. Use `.!` per value to check validity; `==` is the wrong tool. Cross-value code equality (`$x.!code == $y.!code`) is a smell: two captures with shared recovery logic indicates a missing per-site handler upstream. Handle each call where it's made.

The non-access list is therefore short and **fixed**: a handful of system operators (`=>`, `.!*`, `.^*`, `??`, container inclusion) that the runtime implements directly. Everything else — methods, closures, built-ins, arithmetic — executes and is access.

### Propagation

Invalid status rides on the value, not on the variable. `$x => $y` makes `$y` invalid if `$x` was. Copies carry their own status (rill value semantics).

Invalid values survive through captures and container inclusion indefinitely. They are destroyed only by the resolvers (next section), or by access (which halts the script or is caught by a `guard`).

**Example walkthrough.** One value threading through every non-access form before an access fires:

    anthropic::message("hi") => $reply      # [capture]   may be invalid; no halt
    $reply => $copy                          # [capture]   invalid flows to $copy; no halt
    list[$reply] => $batch                   # [container] stored by reference; no halt
    $reply.!code == #TIMEOUT => $was_slow    # [probe]     atom compare on status; no halt
    $reply ?? "fallback" => $text            # [coerce]    vacant → "fallback"; $text always valid
    $reply -> log                            # [access]    pipe target; HALT if $reply invalid

The halt fires on the last line. Every line above it is non-access: the value moves and the status is readable, but no operation fetches the data. A `??` on line 5 is the last chance to resolve; omit it and the pipe on line 6 halts.

### Creation and destruction

Invalid values enter the system from four sources:

- Host fn returns an invalid value (extension calls `ctx.invalidate(e, meta)`).
- Type assertion fails (`$x -> :dict(...)` produces an invalid value when shape mismatches).
- `ctx.invalidate` from within any extension code path.
- Extension throws an unexpected exception. The runtime wrapper catches it, reshapes to an invalid value with code `#R999`, and sets `provider` to the extension name and `raw.thrown` to the original error message. Authors should never rely on this path; it exists so that a missed try/catch fails loudly on `.!code == #R999` instead of crashing the script.

They leave it through four resolvers, detailed in §Resolvers:

- **Handle:** branch on `.!` / `.!code`; take a valid-only path.
- **Coerce:** `$x ?? default` substitutes a valid default.
- **Retry:** `retry<N>` re-runs the producing block; on success the result is valid.
- **Guard returns it:** `guard { body } => $r` materializes the halt into `$r`, which can then be handled, coerced, or propagated.

Unresolved invalid values are destroyed by access — the script halts at the access site (the **Propagate** path).

### Source attribution

`trace` answers "where did this come from, and who caught it." Devs should never need to guess the root cause across nested guards.

Each trace frame records one hop:

    dict[
      site:     string,   # "file.rill:42" source location
      kind:     string,   # "host" | "type" | "access" | "guard-caught" | "guard-rethrow" | "wrap"
      fn:       string,   # call site label: host fn ("anthropic::message"), operator ("->", "=>", "guard"), or type op (":dict")
      wrapped:  dict[]    # empty except on "wrap" frames, where it carries the prior status
    ]

Frame semantics:

| Kind | Appended when |
|---|---|
| `host` | Extension calls `ctx.invalidate`. First frame. Carries host fn name and call site. |
| `type` | Type assertion or conversion fails. Records the type op's site. |
| `access` | Invalid value is accessed. Records the access site (pipe, method, etc.). |
| `guard-caught` | A `guard` block catches the halt. Records the guard's site. |
| `guard-rethrow` | A caught invalid is re-accessed and halts again. Records the new access site. |
| `wrap` | `error "..."` wraps an invalid value. The frame's `wrapped` field carries the prior status. |

Rules:

1. Trace is **append-only**. Guards never erase or rewrite prior frames.
2. Frames survive `=>` capture and container inclusion (they ride on the value).
3. When `error "..."` wraps an invalid value, a `wrap` frame is appended whose `wrapped` field embeds the prior status (including its full trace). Chain reconstruction is a trace walk, not a nested-dict descent.
4. `retry<N>` appends one `guard-caught` frame per failed attempt. The final returned invalid value shows every attempt's origin in order.

**Nested guards:** an outer guard catching a re-raised inner-caught invalid sees both guard frames in order. Script can read `$r.!trace` to reconstruct the path without string-matching messages.

Example:

    guard {
      guard { anthropic::message($p) } => $inner   # inner halt here
      $inner -> log                                 # access re-halts
    } => $outer

On failure, `$outer.!trace` reads:

    [
      {site: "llm.rill:2",  kind: "host",          fn: "anthropic::message"},
      {site: "llm.rill:2",  kind: "guard-caught",  fn: "guard"},
      {site: "llm.rill:3",  kind: "access",        fn: "->"},
      {site: "llm.rill:3",  kind: "guard-rethrow", fn: "->"},
      {site: "llm.rill:1",  kind: "guard-caught",  fn: "guard"}
    ]

---

## Vacancy

`??` and presence checks need one predicate for "the script can't use this value." That predicate is **vacancy**:

    vacant = empty OR invalid

Empty is the data's zero value (`""`, `dict[]`, `list[]`, `0`). Invalid is a populated status. Both mean "don't proceed with this value." Naming the union lets operators and probes reference one rule instead of re-inventing it.

### The probes

    $x.?           # bool, true when $x is non-vacant (usable)
    $x.?field      # bool, true when $x.field exists AND is non-vacant
    $x.!           # bool, true when $x is invalid

`.?` is the positive probe (presence). `.!` is the negative probe (error). Both are always safe: they never halt, even on invalid values.

| Family | Asks | True when | Resolver |
|---|---|---|---|
| `.?` | presence | non-vacant | `??` |
| `.!` | error | invalid | `guard` / `retry` |
| `.^` | reflection | always (metadata) | (none) |

### The operator

`??` substitutes when vacant:

    $x ?? default         # substitute when $x is empty or invalid

One rule covers both missing-data and operational-failure cases. Rill does not need a separate null-coalesce and error-coalesce.

### Why it matters

Rill has no null, no undefined, no truthiness. The language still needs to answer "is there something here?" at boundaries (optional fields, defaults, short-circuits). Without a named concept every construct re-invents its own rule. Vacancy is the single predicate.

### Invariants

1. Vacancy is observable without access. `.?` is non-access, same as `.!` and `.^`. Probing vacancy on an invalid value never halts.
2. Empty and invalid remain distinguishable. `.!` isolates invalid; direct empty-check (`$x == ""`, `$x -> len == 0`) isolates empty. Vacancy is their union, not a replacement.
3. Vacancy is per-value. A container is vacant iff empty; its elements' vacancy is independent.

### Interaction with invalid values

Invalid values are always vacant (populated status implies vacant). Empty values may or may not be invalid. Most are valid with empty data, but an extension may return an invalid value whose data happens to be empty. `.!` and empty-check stay orthogonal; `.?` unions them.

---

## Resolvers

### `guard` — catch boundary

Reserved operator keyword. Prefix grammar, trailing block, optional `<...>` config.

    guard { body }                         # catch any operational halt
    guard<on: list[#AUTH]> { }             # catch only matching codes

Bare form needs no brackets (parser recognizes `guard` as an operator, like `each` or `map`). Config uses `<...>` consistent with `slice<>`, `destruct<>`.

**Evaluation:**

1. Execute block statements. Captures bind invalid values without halting; access halts.
2. If a statement halts from a catchable source, catch. Record the halting invalid value as `$t`.
3. If block completes: return its final value.
4. On caught halt: append a `guard-caught` frame to `$t.!trace` with the guard's source site, then return `$t` as the block's invalid result.

Guards append, never rewrite. Nested guards preserve inner frames so root cause stays visible at the outermost handler.

**What is catchable:**

| Halt source | Catchable |
|---|---|
| Host fn invalid return | yes |
| Type assertion failure (`:dict(...)`) | yes |
| Type conversion failure (`:>`) | yes |
| `assert cond "msg"` | **no** |
| `error "msg"` keyword | **no** |

`assert` and `error` are programmer-initiated and always halt. Guard/retry are for operational recovery.

### `retry<N>` — guard plus re-run

Same grammar. Requires a count.

    retry<3> { body }
    retry<3, backoff: "exponential", delay_ms: 100> { }
    retry<3, on: list[#TIMEOUT]> { }

**Evaluation:**

1. Attempt counter `$n = 0`.
2. `guard` the block → get `$r`.
3. **Block completed without halting** → return `$r` as-is. Valid or invalid, the block's own logic decided; retry does not second-guess.
4. **Block halted, caught by guard** → `$r` is the caught invalid.
   a. If `on:` is set and `$r.!code` is not in the list → return `$r` (not a match).
   b. If `$n + 1 >= count` → return `$r` (exhausted).
   c. Sleep per backoff, `$n += 1`, go to 2.

**Halt to loop, complete to exit.** Retry only re-runs when the block halts. A block that completes — even with an invalid value as its final expression — exits retry with that value. Scripts that want conditional retry beyond `on:`'s code list use block-internal logic to decide whether to halt (access the invalid, let retry catch again) or complete (return the invalid as the block's value):

    retry<5> {
      guard { call } => $r
      $r.! && $r.!code == #TIMEOUT && $attempt_cheap_enough
        ? $r -> identity    # access → halt → retry catches and loops
        ! $r                # block completes with invalid → retry exits
    }

This puts the predicate in script space, where it can see surrounding state and compose with nested `guard`s, instead of in a closure parameter that can only see the caught error.

**Defaults:** no `on:` filter (retry any caught halt up to N); backoff is `fixed` with `delay_ms: 0`.

**Compound failures:** retry catches both the producing call and any downstream assertions in the same block.

    retry<3> {
      anthropic::message($prompt) => $reply
      $reply -> :dict(answer: string, confidence: number)
    } => $answer

If the LLM succeeds but the schema check fails, retry re-runs the whole block.

**Side effects are the script author's problem, not the extension's.** Retry re-runs the whole block from the top. A write between two LLM calls inside `retry<3> { llm(); kv::write(); llm() }` re-fires every attempt — that's on the author to scope correctly. Non-idempotent ops belong outside the retry, or behind a nested `guard { write } => $_` that stops propagation.

Extensions do not flag themselves as "safe to retry." Whether the failure kind can succeed on retry is implicit in the code; whether the block is safe to retry is a scope judgment the script owns.

### `.!` branching — handle

    guard { anthropic::message($p) } => $res
    $res.!
      ? $res.!code -> dict[
          #RATE_LIMIT: "will back off",
          #AUTH:       error "check api key"
        ] ?? error "{$res.!message}"
      ! $res.answer -> use

### `??` — coerce

`??` substitutes the RHS when the LHS is vacant (see §Vacancy):

    $x ?? default                                     # empty or invalid → default

    anthropic::message($p) ?? "default" => $reply     # invalid host value → default
    $name ?? "anonymous"                              # empty string → default
    $cache[$key] ?? fetch($key)                       # missing entry → compute
    guard { compound_call() } ?? fallback => $result  # compound halt, guard first

`??` operates on values, not halts. A bare host call produces one value that `??` inspects directly. A compound block may halt on an intermediate access before a final value exists, so `guard` is needed to materialize the halt into an invalid value that `??` can then coerce.

### Propagate

No resolver → at first access the script halts. Standard rill behavior.

---

## Composition patterns

    # pure catch
    guard { call } => $r
    $r.! ? ... ! ...

    # catch + coerce
    guard { call } ?? "default" => $r

    # catch + re-raise with context
    guard { call } => $r
    $r.! ? error "failed: {$r.!code}" ! $r

    # retry then coerce on exhaustion
    retry<3> { call } ?? fallback => $r

    # nested: inner guard, outer retry
    retry<3> {
      guard { cheap_op() } => $a
      $a.! ? error "cheap_op failed" ! $a
      expensive_op($a)
    }

    # collection: outer retry is all-or-nothing
    # one flaky item retries the whole batch, which is rarely what you want
    retry<3> {
      $urls -> each |url|{ fetch($url) }
    }

    # collection: per-item retry, one bad item does not re-fire the others
    $urls -> each |url|{
      retry<3> { fetch($url) }
    } => $responses

    # collection: per-item guard so the output list is always valid
    # invalid items become captured status values the caller can inspect
    $urls -> each |url|{
      guard { fetch($url) } => $r
      $r.! ? dict[failed: $url, code: $r.!code] ! $r.body
    } => $results

No control flow primitive beyond `guard` is needed. Everything else composes on existing rill constructs.

---

## Extension author model

Extensions return a valid value directly, or mark a value invalid via `ctx.invalidate`:

```typescript
message: {
  fn: async (args, ctx) => {
    const key = validateApiKey(...)        // halts on programmer error (#R001)
    try {
      return await client.messages.create(...)
    } catch (e) {
      return ctx.invalidate(e, {
        code: 'RATE_LIMIT',     // interned to #RATE_LIMIT via registry
        provider: 'anthropic',
      })
    }
  },
  params: [...],
}
```

Or via the shared catch helper, which maps SDK errors to codes automatically:

```typescript
fn: async (args, ctx) =>
  ctx.catch(() => client.messages.create(...), mapAnthropicError)
```

`ctx.catch` wraps the call, runs the provider error detector, and returns an invalid value with the matching code. Existing `mapProviderError` / `mapSearchError` become invalid-value factories instead of throwing.

**`ctx.catch` (TS) and `guard { }` (rill) — opposite sides of the host boundary.** Different names for different mechanisms:

| Name | Side | Catches | Shape |
|---|---|---|---|
| `guard { body } => $r` | Rill script | operational halts (host invalid, type failure) | reserved operator keyword |
| `ctx.catch(thunk, detector)` | TypeScript extension | thrown SDK exceptions | runtime-provided helper fn |

An extension's `ctx.catch` produces the invalid value that a script's `guard` block later catches on access. The split naming keeps the mental model clean: TypeScript has exceptions to catch, rill has halts to guard against.

**Cancellation.** Extensions pass `ctx.signal` (AbortSignal) to SDK calls. `dispose()` aborts the signal, awaits in-flight completion with timeout, then sets the disposed flag. Post-dispose ops return an invalid value with code `#DISPOSED`.

**Domain codes.** Rill core pre-registers a small set of generic operational kinds: `#TIMEOUT`, `#AUTH`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#NOT_FOUND`, `#CONFLICT`, `#INVALID_INPUT`, `#DISPOSED`. These are cross-domain (an HTTP 429, an SDK rate-limit error, and a database throttle all map to `#RATE_LIMIT`). Extensions register additional domain-specific codes at factory init via `ctx.registerErrorCode(name, kind)` when a generic kind loses necessary detail. Unknown codes produce a programmer error (`#R001`). Core also pre-registers the runtime codes `#R001` (unknown code / bad accessor) and `#R999` (unexpected thrown exception from an extension). The legacy `#R004` is not pre-registered; the migration (see §Migration map) converts all existing `RILL-R004` sites to specific kind atoms.

**Tool loop.** See §Tool loop semantics — `tool_loop` has its own contract around an implicit per-dispatch guard, and is documented separately.

**Ownership boundary.** Extensions populate `code`, `message`, `provider`, and `raw` via `ctx.invalidate`. The runtime owns `trace`, appends frames at every kind boundary, and never lets extensions write it. Keeps origin attribution tamper-free.

**Telemetry vs invalid values.** Two channels, different audiences:

- Invalid values: the script's channel (structured, value-level).
- Ctx event bus: operator/monitoring channel (metrics, traces, logs).

Extensions emit events AND return invalid values on failure.

**Serialization.** The status does not round-trip through `rill-encode` / JSON. Invalid values are an in-process runtime concern, not a wire format. `encode($x)` on an invalid `$x` is access, so it halts: the encode call never emits output, and the script terminates at the call site with `$x`'s status intact in the halt. The trace gains an `access` frame pointing at the encode call, which makes the failure location obvious in logs. Scripts that want to persist failure state instead of halting probe first: `$x.! ? encode(dict[code: $x.!code, message: $x.!message]) ! encode($x)`. This keeps the wire schema the script author's choice and prevents status-shape changes from breaking stored data.

**Testing invalid values.** Extension authors assert failure kinds by reading the status, not by catching exceptions. A test harness helper `assertInvalid(value, code)` checks `value.! && value.!code == code`. For testing the trace, `assertTraceFrames(value, expected)` matches frames against the `.!trace` list.

Match semantics for `assertTraceFrames`:

- **Subsequence, not subset.** Expected frames must appear in the actual trace in the given order, but other frames may sit between them. This lets tests pin the frames they care about without having to enumerate every intermediate hop.
- **Partial field match per frame.** Only the fields present in the expected frame are compared; missing fields are wildcards. `{kind: "host"}` matches any host frame regardless of `fn` or `site`.
- **Order-strict.** `[a, b]` requires `a` to appear before `b`. Reversing the expected list is a different assertion.
- **Strict variant.** `assertTraceFramesExact(value, expected)` requires length and per-frame equality (still partial per field, still ordered). Use when the test pins the full hop sequence.

Extensions ship these helpers in a `testing` subpath (e.g. `@rcrsr/rill-ext-anthropic/testing`) so scripts and unit tests share the same assertions.

---

## Tool loop semantics

**A tool dispatch is an execution context.** Same category as the script itself. Every execution context has a boundary, and every boundary converts unresolved halts into outcomes the next layer consumes. The script's boundary emits process exit with the halt's status; a tool dispatch's boundary emits a tool-result message the model can read. Neither catch is hidden control flow — both are the defining edge of their context. `tool_loop` doesn't add an implicit `guard`; it establishes a context whose boundary behaves the way all boundaries do.

**Why this boundary exists.** The LLM is an opaque consumer of tools. It does not read rill source, does not see halts, and cannot distinguish a `.!` probe from a data read. From the model's point of view, a tool either returns a result or reports a failure **as content**. The loop's job is to translate between two worlds: rill invalid values on one side, JSON tool-result messages on the other. Without the per-dispatch context, a tool failure would halt the script, leaving the conversation inconsistent (the model sent a `tool_use`, no `tool_result` came back) and forcing every `tool_loop` caller to wrap the whole loop in their own `guard`. The boundary is how the loop honors its interface.

**Not configurable.** There is no `auto_guard: false` option. Removing the per-dispatch boundary would collapse the conversation mid-stream and break the loop's contract. Callers with different needs compose at the appropriate layer:

- **Halt-on-failure at the script level:** capture the loop's result, then access it. `tool_loop(...) => $r` followed by `$r -> use` halts the script if the loop itself returned invalid.
- **Per-tool policy:** put `guard` / `retry<N>` inside the tool body. Tools are free to decide their own recovery; the loop stays neutral and forwards whatever invalid value the tool chooses to return.

**Contract:**

1. Each tool dispatch runs as its own execution context. A tool returning invalid (or halting on access within its body) is converted at the dispatch boundary, never reaching the script.
2. The caught status is serialized into the tool-result message sent back to the model, using name strings (not atoms) since this is a wire boundary:

        {
          ok: false,
          code: "TIMEOUT",
          message: "...",
          provider: "..."
        }

    The model branches on `code` as data, decides whether to retry the same tool, pick a different tool, ask the user, or give up.
3. Tools remain free to be authored with internal `guard` / `retry<N>` for per-call policy. The loop does not second-guess tool-level decisions.
4. `tool_loop` itself returns invalid only when something outside the tool-call substrate fails: the LLM call exhausts its own retries, auth fails, or `dispose()` fires mid-loop. Those follow normal script rules and are the script author's to handle.

The model sees failure as content. The script sees a completed conversation or a loop-level invalid. The two audiences never cross.

---

## Rill invariants audit

| Rill principle | Status |
|---|---|
| No exceptions, no try/catch | Upheld. `guard`/`retry` are scoped catches, not general. `error`/`assert` never caught. |
| No hidden control flow | Upheld. Keywords explicit; halt points are access sites. Capture propagation is the one subtle flow; mitigated by always-safe probes and visible `guard` boundaries. `tool_loop` establishes a per-dispatch execution context; its boundary converts halt to tool-result message, the same category as the script's boundary converting halt to process exit. |
| No null, no undefined | Upheld. Fixed-shape status; probes return typed defaults on valid values. |
| No truthiness | Upheld. `.!` is bool; strings require explicit comparison. |
| Type lock | Upheld. Invalid status is a sidecar, not a type change. |
| Value semantics, deep copy | Upheld. Status travels with each copy. |
| Empty values, no "no value" | Upheld. Valid status = all-empty fields, never absent. |

---

## Migration map

Today's pain points (left) and the target mechanism that replaces them (right). All "today" entries reflect the codebase as of 2026-04-18.

| Area | Today | Target |
|---|---|---|
| Surface model | Extensions throw; scripts observe exceptions | Intrinsic invalid values with `.!` status |
| Error type | Single `RuntimeError`, 77 codes | Same codes, carried on status; no exception for operational failures |
| Overloading | Most operational failures funnel to `RILL-R004` | Generic kind atoms (`#RATE_LIMIT`, `#TIMEOUT`, `#AUTH`, ...) on `.!code`; extensions register additional atoms when generics lose detail |
| Cause chain | Dropped during `mapProviderError` / `mapSearchError` | `trace` list with `wrap` frames; `raw` dict for provider specifics |
| Grammar | No catch construct; `try`/`catch` forbidden | `guard { body }` and `retry<N> { body }` as reserved operator keywords |
| Compliance | Convention only | `satisfies ExtensionResult` contract + runtime wrapper reshaping unexpected throws to `#R999` |
| Retry | Only in `ext/fetch`; no shared policy | `retry<N>` built on `guard` + loop; `on:` for code-list selectivity, block-internal logic for predicates |
| Timeout / cancel | `AbortSignal` between tool-loop turns; `TimeoutError` barely used | `ctx.signal` threaded through SDK calls; `dispose()` aborts in-flight |
| Disposal | Flag + R004 on further calls; in-flight not cancelled | `dispose()` cancels via signal, then flips flag; post-dispose → `#DISPOSED` |
| Domain codes | Fixed enum in core | Hybrid: core pre-registers generic operational kinds; extensions register domain specifics at init when generics lose detail |
| Batch IO | Halt-on-first-failure; no idempotency, no rollback | Explicit partial-failure contract: `{succeeded, failed: [{index, key, error}]}` |
| Reversibility | None | Published "at-least-once, no undo"; retry scope is the script author's responsibility; non-idempotent ops stay outside `retry<N>` |
| Runtime rep | (new) | B3: status as first-class field. Frozen singleton on valid path; copy-on-write on invalidate. Trace append-only across guard boundaries |

`RILL-R004` is opaque, scripts cannot branch on failure kind without string-matching messages, extension authors get no compile-time feedback on throws, and partial batch writes leave inconsistent state. The target column resolves all four.

`RILL-*` string codes become `#*` atoms during the migration. `RILL-R004` retires in favor of specific kind atoms; the few remaining R-codes (`#R001`, `#R999`) become pre-registered atoms alongside the generic set.

---

## Open questions

Resolved decisions live in the body and changelog. Questions below are still open or carry rationale not duplicated elsewhere.

1. **`on:` matches by atom identity only** — no glob, no prefix patterns. `on:` is the only retry selector; it takes a list of atoms and is exact-match. Anything beyond that (unions of known kinds, attempt-aware conditions, prefix families) is expressed as block-internal script using the halt-to-loop / complete-to-exit semantic. Keeps the config surface minimal and the predicate in script space, where it composes with surrounding state.
2. **Predicate retry selection is block-internal, not a `retry<>` parameter.** An earlier draft offered `retry<while: |err|{...}>`. Dropped: the same logic is expressible inside the block (guard the call, inspect `$r.!code`, access to halt-and-loop or return to exit), and it then composes with nested guards, surrounding state, and attempt counters without needing a closure signature. `on:` stays as a declarative shortcut for the common "retry these codes" case.
3. **`.^*` reflection lifts into non-access**, symmetric with `.!*`. Scripts need type/signature introspection on invalid values for debugging.
4. **`.!*` on a closure reads the closure's own status**, never its invocation history. Closures are values, not sessions.
5. **Capture-less guard is legal but lint-discouraged** (unused guard result implies a missed handler). Silence with `=> _`.
6. **Lazy propagation rejected.** Pure transforms (`$x -> .upper`) halt immediately. Non-local halts are hard to reason about.
7. **TS helper is `ctx.catch`, rill operator is `guard`.** Earlier drafts named both `guard`. Split because the mechanisms differ: `ctx.catch` converts thrown SDK exceptions into invalid values on the TypeScript side of the host boundary; `guard { }` catches halts in rill script space. Matching names made the collision feel intentional but hid that one is a language operator and the other is a runtime helper method. Separate names keep the mental model: TypeScript has exceptions to catch, rill has halts to guard against.
8. **`tool_loop`'s implicit per-dispatch guard is not configurable.** No `auto_guard` option. The LLM is an opaque consumer of tool results and cannot honor rill's halt semantics; catching at dispatch is the loop's contract, not a tunable default. Scripts that want halt-on-failure compose it outside the loop; tools that want per-call policy use `guard` / `retry<N>` internally.

---

## Changelog

- **2026-04-18 — §Vacancy introduced.** `??` was previously defined ad hoc as "treats invalid values like empty values." That obligation is now a named concept: **vacant = empty OR invalid**, probed by `.?` (positive, true when non-vacant) and resolved by `??`. One predicate covers missing-data and operational-failure cases; no separate null-coalesce vs error-coalesce operator. `$x.?field` moves from access (field read) to non-access (presence probe). Destructuring bind is now classified as access because it reaches into structure, distinct from bare `=>` whole-value rebind. §Status access, §Access rules, and §`??` cross-reference the new section.
- **2026-04-18 — B3 runtime representation.** Status as first-class field alongside `type`. Valid values share a frozen singleton empty status (one pointer field, zero allocations on the valid path). Invalid values allocate; copies share the pointer and allocate on mutation. B1 (WeakMap side-table) was rejected because primitives cannot key a WeakMap and deep copy loses identity. B2 (wrapper box) collapses into B3 once wrapping is uniform. **Caveat:** spike microbenchmarks (arithmetic hot loop, `list -> map`) before locking in; if the current interpreter unboxes primitives, measure the regression first.
- **2026-04-18 — Status shape: `cause` dropped, fields redistributed.** Earlier `cause: dict[message, source, raw]` packed three jobs (restate SDK error, carry provider detail, chain wrapped errors), duplicated top-level `message`/`provider`, and conflated provider dicts with recursive statuses. Now: `message` and `provider` stay top level, `raw: dict[]` is the extension-populated provider bag, and error wrapping appends a `wrap` trace frame whose `wrapped` field embeds the prior status. One field per job. Extension authors fill `raw` via `ctx.invalidate`; the runtime owns `trace`.
- **2026-04-18 — Status carries `trace`; no `retryable` flag.** Trace is append-only across host, type, access, guard, and wrap frames; reconstructs root cause without string-matching. The proposed `retryable` flag conflated "this code can succeed on retry" (extension's view) with "this block is safe to retry" (scope — only the script knows). Using the first as authorization for the second is unsafe: a retryable LLM failure re-fires any non-idempotent write executed between two LLM calls in the same `retry<3>` block. Scope stays the script author's responsibility; `retry<N>` defaults to unconditional catch-up-to-N with explicit `on:` for code-list selectivity.
- **2026-04-18 — `retry<while: ...>` dropped; predicate selection moves into the block.** Earlier draft had two selectors (`on:` for code lists, `while:` for closure predicates). `while:` removed: the same logic is expressible inside the block using **halt to loop, complete to exit** semantics — access the invalid to let retry catch and loop, return it as the block's value to exit retry with the invalid. Retry evaluation reworded to make "block completed" a first-class exit path instead of implying completion only for valid values. `on:` stays as the declarative shortcut.
- **2026-04-18 — Codes are atoms, not strings.** Error codes become a dedicated `:code` primitive authored as `#NAME` (`#TIMEOUT`, `#RATE_LIMIT`, `#R001`). Registry-backed: core pre-registers the generic operational set and the runtime codes; extensions register more at factory init. Unknown atoms referenced in `on:`, match dicts, comparisons, or `ctx.invalidate` produce `#R001` at parse/link time instead of silently never matching. Closes the typo gap without introducing typed error *values* (which would re-import exception hierarchies). Atoms do not serialize; scripts convert via `-> name` / `:code(name)` at the encode boundary.
- **2026-04-18 — Friction pass.** `ctx.guard` renamed to `ctx.catch` to keep the TS helper distinct from the rill `guard` operator; §Extension author model's table and prose updated to reflect the split. Tool-loop contract promoted from a bullet under §Extension author model to its own top-level **§Tool loop semantics**, with the "opaque consumer" justification made explicit and the non-configurability of the implicit guard called out directly. §Access rules walkthrough extended to thread one value through capture, container inclusion, probe, and coerce before the halting access. `#R004` dropped from the pre-registered runtime codes (only `#R001` and `#R999` remain); the legacy code is handled exclusively by the migration rewrite. §Serialization now specifies the encode-of-invalid failure shape (halts at call site, `access` trace frame appended, `$x`'s status intact). Two new open-questions entries record the `ctx.catch` rename rationale and the tool-loop non-configurability decision.
- **2026-04-18 — Renamed "shadow" to "status".** The sidecar metadata field is now called the **status**. "Shadow" was evocative but jargony and didn't read naturally in compounds (`status access`, `status probe`, `status shape` all read better than the shadow equivalents). The data/status split replaces data/shadow throughout. Concept order within §Invalid values reshuffled so `:code` is introduced before the status shape diagram that uses it, and creation/destruction are colocated before the detailed resolver section.

---

## Next steps

Ordered by implementation dependency: each item assumes the ones above it.

- [ ] Reserve `guard` and `retry` as operator keywords (grammar prereq, cheap)
- [ ] Specify `:code` atom primitive: syntax, registry lookup, `-> name` and `:code(name)` conversions, collision rules for extension-registered atoms
- [ ] Draft domain-code registry (core pre-registered generics + extension-registered specifics)
- [ ] Spike B3 microbenchmarks: arithmetic hot loop and `list -> map` iteration; confirm valid-path overhead is flat
- [ ] Prototype `ctx.invalidate` and `.!` status probes in rill core
- [ ] Prototype trace append at each frame kind; verify nested guard and retry cases produce the documented frame order
- [ ] Prototype `guard` as the catch primitive in rill core; express `retry<N>` as guard + loop
- [ ] Prototype `ctx.catch` in `llm-anthropic` to feel the extension DX
- [ ] Draft `ctx.signal` + `dispose()` cancellation contract for extension authors
- [ ] Write migration note for existing `RILL-R004` sites, including string-code → atom conversion
