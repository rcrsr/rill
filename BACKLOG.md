# Deferred Backlog

Consolidated from completed initiative feedback documents. Each item includes its origin initiative and priority.

## Bugs

- [x] **BUG-1**: Pre-existing TypeScript type error in `packages/shared/ext-llm/src/schema.ts` — `isShape()` receives `Record<string, unknown>` but expects `RillValue`. Fix by widening `isShape` parameter or adding type assertion. (LOW)
  - Origin: structural-type-identity
  - File: `packages/shared/ext-llm/src/schema.ts`
  - Resolution: shape-to-structural migration removed `isShape()` entirely; typecheck passes clean.

- [x] **BUG-2**: Pre-existing broken import in `packages/ext/kv-redis/tests/integration.test.ts:30` — `createKvExtension` imported from `@rcrsr/rill` (main entry) but only exported from `@rcrsr/rill/ext/kv` subpath. Fix import path and add Redis availability guard. (LOW)
  - Origin: shape-migration (DEBT-1)
  - File: `packages/ext/kv-redis/tests/integration.test.ts`
  - Resolution: Fixed import to `@rcrsr/rill/ext/kv`; Redis availability guard was already present (lines 36–66). Typecheck passes clean.

## Technical Debt

- [x] **DEBT-1**: Migrate `ScriptCallable.inputShape` from `RillShape` to structural types — removes last internal shape dependency. Updates `packages/agent/shared/src/schema.ts` and `packages/shared/ext-llm/src/schema.ts`. Enables clean barrel export removal. Requires dedicated initiative. (MEDIUM)
  - Origin: structural-type-identity (DEBT-2)
  - Files: `packages/core/src/runtime/core/callable.ts:42-90`, `packages/agent/shared/src/schema.ts`, `packages/shared/ext-llm/src/schema.ts`
  - Resolution: shape-to-structural migration (commit 8103f01) completed the full migration; `inputShape` is `RillStructuralType`, `RillShape` removed entirely, barrel exports cleaned.

- [x] **DEBT-2**: 38 pre-existing doc example failures across 15 files. Run `npx tsx scripts/test-examples.ts docs/` to triage. Prioritize guide and cookbook files. Violates §DOC.1.4 accuracy requirement. (MEDIUM)
  - Origin: shape-migration (DEBT-2)
  - Note: structural-type-identity reduced failures from 79 to 42; shape-migration reported 38. Current count may differ.
  - Resolution: Fixed all 38 failures (505 passing, 0 failing). Categories: closure/iterator/vector returns (add `true`/call closure), bare `{...}` blocks inlined, mixed-type lists converted to dicts, positional spread changed to named, complex fold fixed.

## Validation Gaps

- [ ] **VAL-1**: No test for `$fn.^input` on a Rill-defined closure returning `{ kind: 'closure', ... }`. All existing `^input` tests use `ApplicationCallable`. The `ScriptCallable` path at `closures.ts:1010-1015` is correct by inspection but untested. (MEDIUM)
  - Origin: shape-migration (VAL-3)
  - File: `packages/core/tests/language/annotations.test.ts`
  - Action: Define closure with typed params, store, assert `^input` returns `{ kind: 'closure', params: [['x', { kind: 'primitive', name: 'Int' }]], ret: { kind: 'any' } }`

- [ ] **VAL-2**: Ordered `^type` inference gap — `*[a:1,b:2].^type` does not produce a comparable `ordered(a:number, b:string)` structural type. Affects AC-10, AC-12, AC-36, AC-38, AC-49 (all skipped). (MEDIUM)
  - Origin: structural-type-identity (VAL-1)

- [ ] **VAL-3**: No direct unit test for `paramsToStructuralType` with typed param asserting `{ kind: 'primitive', name }`. Covered indirectly via AC-7/AC-23 tests. (LOW)
  - Origin: shape-migration (VAL-1)

- [ ] **VAL-4**: No dedicated test for untyped param (`typeName: null`) asserting `{ kind: 'any' }`. Implementation correct by inspection; direct import from internal module would violate §NOD.2.1. (LOW)
  - Origin: shape-migration (VAL-2)
