---
type: feedback
last-modified: 2026-02-25
status: active
source-plan: conduct/initiatives/ops-dependency-inversion/plan.md
source-spec: conduct/initiatives/ops-dependency-inversion/specification.md
---

# Dependency Inversion (compose -> host) Implementation Feedback

## Source Documents

- **Plan**: conduct/initiatives/ops-dependency-inversion/plan.md
- **Spec**: conduct/initiatives/ops-dependency-inversion/specification.md

---

## Implementation Summary

### Quality Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Clean implementation rate | 43% (9/21) | >80% | ✗ |
| Process friction rate | 0% (0/21) | <10% | ✓ |
| Scope accuracy rate | 71% (15/21) | >90% | ✗ |
| Security finding rate | 0% (0/21) | <5% | ✓ |

### Findings Overview

| Category | Count |
|----------|-------|
| Documentation Updates (REV-*) | 1 |
| Process Improvements (TPL-*, POL-*, DEL-*) | 1 |
| Backlog Items (BUG-*, DEBT-*, SEC-*, VAL-*) | 2 |
| Enhancements (ENH-*) | 0 |

### Task Notes

| Task ID | Domain | Description | Review Cycles | Notes |
|---------|--------|-------------|---------------|-------|
| 1.1 | NOD | Invert `createAgentHost` signature, add local interfaces | 2 | [ISSUE] spec typo `../host.js` → `./host.js`; phase===init guards missed in first pass |
| 1.2 | NOD | Remove `@rcrsr/rill-compose` from `host/package.json` | 1 | Clean implementation |
| 1.3 | NOD | Update test helper to use `mockComposedAgent` | 1 | Clean implementation; added `@rcrsr/rill-compose` to devDependencies |
| 1.4 | NOD | Update lifecycle, session, and route test files | 2 | `routes.test.ts` `AgentCard` import missed in first pass |
| 1.5 | NOD | Phase 1 build + test verification | 1 | [DEBT] AC-18 port fallback not implemented (addressed in Phase 4); [ASSUMPTION] devDependency coupling acceptable |
| 2.1 | NOD | Create `handler.ts` implementing `createAgentHandler` | 1 | [ASSUMPTION] registry singleton reuse via metrics.ts; [ASSUMPTION] buildRunRequest body mapping; [DEVIATION] exactOptionalPropertyTypes casts |
| 2.2 | NOD | Create `handler.test.ts` | 1 | [ASSUMPTION] EC-5 uses `undefined_fn`; [ASSUMPTION] AC-7 via metrics singleton |
| 2.3 | NOD | Add `@rcrsr/rill-host` to `compose/package.json` | 1 | Clean implementation |
| 2.4 | NOD | Update `local.ts` `generateHostEntry` | 1 | [DEVIATION] call moved to top of `build()` for fail-fast; [ASSUMPTION] uses `validateManifest` from rill-compose |
| 2.5 | NOD | Update container and lambda build targets | 1 | Clean implementation; TypeScript compiles clean |
| 3.1 | NOD | Add EC-6/EC-7 tests for `generateHostEntry` | 2 | [DEVIATION] tests added inside existing describe block; duplicate EC-6 test removed in fix cycle |
| 3.2 | NOD | Full workspace build + test verification | 1 | Clean; 5 compose failures initially mis-classified as pre-existing (were regressions from 2.5, fixed in Phase 5) |
| 3.3 | DOC | Update `docs/integration-agent-host.md` | 1 | [ASSUMPTION] Quick Start uses `composeAgent('./agent.json')` — incorrect signature (HIGH, see REV-1) |
| 3.4 | NOD | `pnpm run -r check` across workspace | 1 | [ISSUE] 3 pre-existing core `test:examples` failures from commit bb437ff (Feb 16) |
| 3.5 | NOD | Final coverage audit | 1 | [ISSUE] EC-2 EADDRINUSE test missing — found and fixed; [ISSUE] IR-8 not exported — dismissed |
| 4.1 | NOD | Fix port fallback chain in `host.ts` | 1 | Clean implementation |
| 4.2 | NOD | Add AC-18 card.port test | 1 | [ASSUMPTION] port 8080; potential CI flakiness |
| 4.3 | NOD | AC-18 verification re-run | 1 | Clean; 114/114 host tests pass |
| 5.1 | NOD | Restore extension import generation in `container.ts` | 1 | [DEVIATION] builtin uses `ext.alias` (correct per esbuild config); [ASSUMPTION] `context` variable name safe |
| 5.2 | NOD | Restore extension require generation in `lambda.ts` | 1 | Clean; 278/278 compose tests pass |
| 5.3 | NOD | Final verification re-run | 1 | Clean; 278/278 compose, 114/114 host pass |

---

## Retrospective: Documentation Updates

- [ ] **REV-1**: Quick Start in `docs/integration-agent-host.md` uses incorrect `composeAgent` signature (from task 3.3)
      → The Quick Start calls `composeAgent('./agent.json')` (string), but `composeAgent` requires an `AgentManifest` object.
        Missing steps: `readFileSync` → `JSON.parse` → `validateManifest` → `composeAgent(manifest)`.
        Installation section omits `@rcrsr/rill-compose` but Quick Start imports from it.
      → Action: Rewrite Quick Start to show full compose-then-host pipeline with correct manifest loading.
        Install command: `npm install @rcrsr/rill-host @rcrsr/rill-compose`

---

## Prospective: Process Improvements

- [ ] **TPL-1**: Build target rewrite tasks need explicit esbuild regression verification step
      → Phase 5 was required because task 2.5 rewrote `generateHostEntry`/`generateLambdaHostEntry` without
        verifying esbuild error-propagation tests still passed. 3 container + 2 lambda tests regressed.
      → Action: Add checklist item to plan template for tasks that replace build-time import generation:
        "Verify esbuild error-propagation and sentinel-string tests after entry generator changes."

---

## Backlog: Code Issues

- [ ] **DEBT-1**: Pre-existing `test:examples` failures — 3 tests in `extension-llm-*.md` files (MEDIUM)
      → Commit bb437ff (Feb 16) introduced failures in `packages/core/tests/language/examples/`.
        Not caused by this initiative but normalization is a risk.
      → Action: Investigate and fix in a separate initiative before next release.

- [ ] **DEBT-2**: `host-lifecycle.test.ts` AC-18 test hardcodes port 8080 — CI flakiness risk (LOW)
      → `packages/host/tests/host-lifecycle.test.ts` uses port 8080 for the card-port fallback test.
        If occupied in CI, the test fails with a misleading error.
      → Action: Replace with a dynamic port (bind to 0, read assigned port) when the `listen()` API supports it.

---

## Recommended Next Steps

→ Fix documentation per REV-1: update Quick Start in `docs/integration-agent-host.md`
→ Run `pnpm sync-docs` from `packages/web/` after updating `docs/integration-agent-host.md`
→ Investigate DEBT-1 pre-existing core LLM test failures before next release
→ Run `/archive-initiative ops-dependency-inversion` to archive completed initiative

---

## Disposition Log

| ID | Disposition | Target | Date |
|----|-------------|--------|------|
|    |             |        |      |
