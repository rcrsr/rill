# Error Handling in Rill Core: Phased Design

Grounded core-only design distilled from `ERROR_HANDLING.md`. Scope is `packages/core`. Each phase is independently landable and depends only on earlier phases.

## Scope

| In scope | Out of scope |
|---|---|
| Parser, lexer, grammar | Extension authoring helpers (`rill-ext`) |
| Runtime values, evaluator | `ctx.invalidate`, `ctx.catch` wrappers |
| Error registry, `RuntimeError` | `tool_loop` semantics |
| Core probes, coerce operator | Provider error mappers |
| `guard`, `retry` operators | Domain-specific code registration |
| Core code atoms, trace frames | Per-extension testing helpers |

The extension-facing API ships in `rill-ext`. Core exposes the primitive `invalidate` operation that extension helpers wrap.

## Current state (2026-04-18)

Verified against `packages/core/src`:

- `RuntimeError` class at `error-classes.ts:203`. Single class.
- Registry has 73 R-codes and 98 codes total across L/P/R categories (`error-registry.ts`).
- `RILL-R004` appears 56 times across 10 files. Overloaded as type-conversion catch-all.
- No `try`, `catch`, `guard`, or `retry` keyword reserved (`lexer/operators.ts:51-64`).
- `.?` tokenizes as `DOT_QUESTION` (`lexer/operators.ts:19`). Parses to `ExistenceCheck` at `parser-variables.ts:115-175`. Parser rejects `.?` combined with `??` at `parser-variables.ts:97`.
- `.!` is not tokenized.
- `.^` exists for annotation reflection only. `.^type` and `.^input` wire up. `.^signature` is absent.
- `??` tokenizes as `NULLISH_COALESCE` (`token-types.ts:39`). Current semantics: default on empty access chain.
- No atom primitive. `#` is not a sigil.
- No status sidecar on values. Values are primitives and frozen objects (`runtime/core/values.ts`).
- `error` and `assert` halt by throwing; no catch exists (`eval/mixins/control-flow.ts:412`).
- `AbortSignal` lives on `RuntimeContext.signal` (`runtime/core/types/runtime.ts:150`). `TimeoutError` is defined (`error-classes.ts:252`) with narrow use.
- Extension disposal is flag-based. In-flight calls are not cancelled (`runtime/ext/extensions.ts:23`).
- Value semantics use `Object.freeze` (33 hits across 10 files).

## Principles (core)

1. Rill has no exceptions. The language defines no `try` or `catch`. `error` and `assert` halt.
2. Operational failures become invalid values. A value whose fixed-shape status is populated is invalid.
3. The valid path stays ceremony-free. If no resolver catches, access of an invalid value halts.
4. `guard` converts a halt into an invalid return. `retry<N>` loops on caught halts.
5. `assert` and `error` are never catchable. Only operational halts are.
6. Status rides as a sidecar on each value. Status, type, and data are orthogonal.
7. Probes `.!`, `.?`, and `.^` are always safe. They never halt, even on invalid input.

## Phase sequence

Each phase lists prerequisites, touchpoints, scope, and exit criteria.

---

### Phase 0: Grammar reservations

Cheap prereq. Reserves tokens so later phases do not break parsing.

**Prereqs**: none.

**Touchpoints**:
- `packages/core/src/lexer/operators.ts`
- `packages/core/src/lexer/token-types.ts`
- `packages/core/src/parser/parser-variables.ts:97`

**Scope**:
- Reserve `guard` and `retry` as operator keywords in `KEYWORDS`.
- Tokenize `.!` as `DOT_BANG`.
- Tokenize `#NAME` as `ATOM_LITERAL` (`#` followed by an identifier).
- Lift the parser restriction that rejects `.?` combined with `??`.

**Exit**: existing tests pass. New tokens parse but have no consumer yet.

---

### Phase 1: `:code` atom primitive

Introduces atoms as a dedicated primitive type. No error-registry integration yet.

**Prereqs**: Phase 0.

**Touchpoints**:
- `packages/core/src/runtime/core/values.ts` (new `AtomValue`)
- `packages/core/src/error-registry.ts` (atom-backed lookups)
- New atom interning table in core runtime

**Scope**:
- Add `:code` type. Atoms are interned identity values, not strings.
- `#NAME` constructs or resolves an atom.
- Pre-register `#ok`, `#R001`, `#R999`, and the generic operational set: `#TIMEOUT`, `#AUTH`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#NOT_FOUND`, `#CONFLICT`, `#INVALID_INPUT`, `#DISPOSED`.
- Conversions: `$atom -> name` returns the string. `:code(name)` returns the atom, or `#R001` if unregistered.
- Unknown `#NAME` references raise `#R001` at parse or link time.
- Atoms do not serialize. Conversion happens at the encode boundary.

**Exit**: tests cover atom identity, conversion round-trips, and unknown-atom detection.

---

### Phase 2: Status sidecar on values

Adds the status layer. Script-level probes come in Phase 3.

**Prereqs**: Phase 1.

**Touchpoints**:
- `packages/core/src/runtime/core/values.ts`
- Value constructors and copy paths

**Scope**:
- Each rill value gains a `status` field. Valid values share a frozen empty-status singleton (one pointer, zero allocations on the valid path).
- Status shape: `dict[code: :code, message: string, provider: string, raw: dict[], trace: list[dict[]]]`.
- Empty status: `code = #ok`, other fields empty.
- Core exposes `invalidate(value, { code, message, provider, raw })`. Produces an invalid copy via copy-on-write.
- Value semantics hold. Copies carry their own status pointer.
- Runtime owns `trace`. Callers of `invalidate` cannot write it.

**Exit**: microbenchmarks confirm flat valid-path overhead on arithmetic and `list -> map`. Status propagates across `=>` rebind and container inclusion.

---

### Phase 3: Probes on status and reflection

Exposes status and lifts reflection. All probes are non-access.

**Prereqs**: Phase 2.

**Touchpoints**:
- `packages/core/src/parser/parser-expr.ts`
- `packages/core/src/parser/parser-variables.ts`
- `packages/core/src/runtime/core/eval/mixins/*`

**Scope**:
- `.!` on any value returns bool. True iff `.!code != #ok`.
- `.!code`, `.!message`, `.!provider`, `.!raw`, `.!trace` read status fields.
- Unknown `.!<name>` raises `#R001`.
- Lift `.^type` and `.^input` to work on invalid values without halting.
- Defer `.^signature` until a grammar owner ships the underlying reflection.

**Exit**: tests cover probes on valid and invalid values. No probe halts, even on invalid input.

---

### Phase 4: Vacancy and `??` coerce

Formalizes `vacant = empty OR invalid`. Broadens `??`.

**Prereqs**: Phase 3.

**Touchpoints**:
- `packages/core/src/parser/parser-variables.ts`
- `packages/core/src/runtime/core/eval/mixins/*` (coerce evaluator)

**Scope**:
- A value is vacant when its data is empty or its status is invalid.
- `$x.?` returns true when `$x` is non-vacant.
- `$x.?field` returns true when `field` exists on `$x` and the field value is non-vacant.
- `$x ?? default` substitutes `default` when `$x` is vacant. This broadens current empty-only semantics.
- `$x.?field ?? fallback` parses as a composable chain (Phase 0 lifted the restriction).

**Exit**: `??` handles both empty and invalid cases uniformly. Tests lock the partition of vacant values.

---

### Phase 5: Access rules (halt contract)

Defines which operations halt on invalid values. Enforced by the evaluator.

**Prereqs**: Phases 2, 3, 4.

**Touchpoints**:
- `packages/core/src/runtime/core/eval/base.ts`
- Each evaluator mixin

**Scope**:

Access (halts when the operand is invalid):
- Field or index read, method call, pipe target.
- Arithmetic, comparison, logic, spread.
- Destructuring bind, argument to call, script return.
- Type assertion and conversion (`:`, `:?`, `:>`).
- `assert $x ...`, `error "...{$x}"`.

Non-access (never halts):
- Whole-value rebind `$x => $y`.
- `.!*`, `.^*`, `.?*` probes.
- `$x ?? default` coerce.
- Container inclusion: `list[$x]`, `dict[k: $x]` (stored by reference).
- Atom identity compare: `$x.!code == #TIMEOUT`.

**Exit**: evaluator halts at documented sites and nowhere else. Golden tests lock the partition.

---

### Phase 6: Trace frames

Append-only trace list on status. Runtime-owned.

**Prereqs**: Phases 2, 5.

**Touchpoints**:
- Status type (Phase 2)
- `invalidate`, access-halt, and wrap sites

**Scope**:
- Frame shape: `dict[site: string, kind: string, fn: string, wrapped: dict[]]`.
- Kinds: `host`, `type`, `access`, `guard-caught`, `guard-rethrow`, `wrap`.
- First frame comes from the `invalidate` call site or the type operation site.
- Access appends an `access` frame at the halt site before the evaluator halts.
- `error "..."` wrapping an invalid value appends a `wrap` frame whose `wrapped` field embeds the prior status.
- Trace survives `=>` rebind and container inclusion.
- Extensions cannot mutate `trace`.

**Exit**: tests reconstruct nested halt paths from the trace list without string-matching.

---

### Phase 7: `guard` operator

Catch boundary for operational halts.

**Prereqs**: Phases 0, 5, 6.

**Touchpoints**:
- Parser (new statement form)
- `packages/core/src/runtime/core/eval/mixins/*` (new evaluator mixin)

**Scope**:
- Grammar: `guard { body }` with optional `<on: list[#CODE, ...]>` config.
- Evaluate the block. Captures rebind invalid values without halting; access halts.
- On catchable halt: append `guard-caught` frame, return the halting invalid value as the block result.
- On completion: return the block's final value.
- Catchable sources: host invalid return, type assertion failure, type conversion failure.
- Not catchable: `assert`, `error`.
- `on:` filters by atom identity. Non-match re-raises.

**Exit**: `guard { call } => $r; $r.! ? ... ! ...` pattern works. Nested guards preserve inner frames.

---

### Phase 8: `retry<N>` operator

Loop built on `guard`. Halt-to-loop, complete-to-exit.

**Prereqs**: Phase 7.

**Touchpoints**:
- Parser, evaluator

**Scope**:
- Grammar: `retry<N> { body }` with optional `backoff`, `delay_ms`, `on:`.
- Internally wraps the body in `guard` and loops up to `N` attempts on caught halts.
- A block that completes exits retry with that value, valid or invalid.
- A block that halts and is caught loops after backoff.
- Each failed attempt appends one `guard-caught` frame.
- `on:` filters by atom identity. Non-match returns the invalid value immediately.
- Defaults: no filter, fixed backoff, `delay_ms: 0`.

**Exit**: `retry<3> { call }` pattern works. Block-internal predicates control selective retry.

---

### Phase 9: Migrate `RILL-R004` sites

Rewrite existing overloaded sites to specific atoms.

**Prereqs**: Phases 1, 2.

**Touchpoints**:
- 10 files, 56 references (notably `runtime/ext/builtins.ts`, `types/registrations.ts`, `eval/mixins/types.ts`)
- `error-registry.ts`

**Scope**:
- Map each R004 site to a kind atom. Most become `#INVALID_INPUT`. Some become `#NOT_FOUND` or a newly registered atom.
- Replace `throw new RuntimeError('RILL-R004', ...)` with `invalidate(...)` or a specific atom halt.
- Retire `RILL-R004` from the registry.
- Update error documentation to reference atoms.

**Exit**: zero remaining R004 references. Scripts can branch on atom identity instead of message strings.

---

### Phase 10: Disposal semantics

Align `dispose()` with cancellation. Surface post-dispose calls as `#DISPOSED`.

**Prereqs**: Phases 1, 2.

**Touchpoints**:
- `packages/core/src/runtime/ext/extensions.ts`
- `packages/core/src/error-registry.ts`

**Scope**:
- `dispose()` aborts `ctx.signal`, awaits in-flight completion with a timeout, then flips the disposed flag.
- Post-dispose operations return an invalid value with code `#DISPOSED`.
- Retire the current disposal error code in favor of `#DISPOSED`.

**Exit**: in-flight operations cancel on dispose. Post-dispose calls surface `#DISPOSED` via `.!code`.

---

### Phase 11: Serialization boundary

Invalid values do not cross the wire. `encode()` halts on invalid input.

**Prereqs**: Phases 1, 5, 6.

**Touchpoints**:
- `packages/core/src/runtime/ext/builtins.ts`
- Atom-to-string conversion (Phase 1)

**Scope**:
- `encode($x)` is access. Halt at the call site when `$x` is invalid.
- The halt appends an `access` frame pointing at the encode call.
- Scripts opt in to a wire shape: `$x.! ? encode(dict[code: $x.!code, message: $x.!message]) ! encode($x)`.
- Atoms convert to name strings via `-> name` at the encode boundary.

**Exit**: status does not round-trip through `encode` or JSON. Failure location is visible in the halt trace.

---

### Phase 12: Test harness

Core helpers for asserting on invalid values and traces.

**Prereqs**: Phases 3, 6.

**Touchpoints**:
- New subpath in `packages/core` (e.g. `packages/core/src/testing/`)

**Scope**:
- `assertInvalid(value, code)`: checks `value.! && value.!code == code`.
- `assertTraceFrames(value, expected)`: subsequence match, partial field match per frame, order-strict.
- `assertTraceFramesExact(value, expected)`: length and per-frame equality, ordered, partial field match.

**Exit**: core tests use the harness. Extensions reuse it from the public `@rcrsr/rill` testing subpath.

---

## Invariants audit

| Rill principle | Phase that upholds it |
|---|---|
| No exceptions, no try/catch | 7, 8 |
| No hidden control flow | 5, 7 |
| No null, no undefined | 2, 4 |
| No truthiness | 3 |
| Type lock | 2 |
| Value semantics, deep copy | 2 |
| Empty values, no "no value" | 4 |

## Open questions

1. Valid-path allocation cost. Phase 2 needs microbenchmark confirmation on arithmetic hot loop and `list -> map` before locking the status representation.
2. Equality on invalid. `$x == $y` is classified as access. Confirm atom compare on `.!code` falls out of operand resolution without a special case.
3. Diagnostic plumbing. Unknown `#NAME` at parse or link time must report `#R001` with source location. Verify current diagnostic paths can carry atom ids.
4. Disposal timeout. Behavior when `dispose()` cannot cancel in-flight calls within the timeout needs a decision: escalate, force-flag, or surface a separate atom.
5. `.^signature`. Not wired today. Decide whether a separate phase adds it or whether the probe remains limited to `.^type` and `.^input`.

## Cross-repo references

These items appear in the brainstorm but ship outside core:

- `ctx.invalidate`, `ctx.catch`, `ctx.registerErrorCode`: extension authoring API in `rill-ext`.
- `tool_loop` per-dispatch guard contract: `rill-ext`.
- Provider error mappers (`mapProviderError`, `mapSearchError`): individual extensions.
- Per-extension testing helpers: extension repos.
