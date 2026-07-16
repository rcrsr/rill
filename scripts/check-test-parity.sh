#!/usr/bin/env bash
# Test parity lock for the evaluator refactor branches.
#
# Guarantees the branch cannot redefine its own acceptance criteria:
#   1. No test file under packages/core/tests/language/ differs from the base
#      ref (merge-base with main by default). tests/language/ is the arbiter;
#      the branch must never touch it. tests/runtime/ is normal maintenance.
#   2. No untracked files inside packages/core/tests/language/ (a new test
#      file would change the arbiter just as much as an edit).
#   3. The full suite passes with zero skips: "N passed (N)" must match,
#      and N must not drop below the recorded baseline.
#
# Also prints the cross-mixin cast count and `as any` factory-export count
# for inclusion in PR descriptions (informational, not enforced here).
#
# Checks 1 and 2 are the arbiter lock. Check 3 is a local ratchet against
# further erosion from today's count; it is not parity with main. CI passes
# --diff-only because its `check` job already runs the suite on Node 22/24/25
# with a real build, and because check 2 can only fire in a working tree (a
# fresh CI checkout has no untracked files by construction).
#
# Usage: scripts/check-test-parity.sh [--diff-only] [base-ref]
#        --diff-only  run checks 1 and 2, skip the suite re-run
#        base-ref     default: main, falling back to origin/main when no local
#                     main branch exists, e.g. in a CI PR checkout

set -euo pipefail
# Without this, a set -e abort inside a $(...) assignment (e.g. a grep that
# matches nothing under pipefail) exits 1 printing nothing at all.
trap 'echo "FAIL: unexpected abort at line ${LINENO} (exit $?)" >&2' ERR
cd "$(dirname "$0")/.."

DIFF_ONLY=0
BASE_REF=""
for arg in "$@"; do
  case "$arg" in
    --diff-only) DIFF_ONLY=1 ;;
    -*)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
    *) BASE_REF="$arg" ;;
  esac
done
if [ -z "$BASE_REF" ]; then
  if git rev-parse --verify --quiet main >/dev/null; then
    BASE_REF=main
  else
    BASE_REF=origin/main
  fi
fi
BASELINE_TESTS=5732 # recorded 2026-07-15 on refactor/evaluator-migration after adding eval-state.test.ts (main @ 20ebc8c unchanged at 5752)

MERGE_BASE=$(git merge-base "$BASE_REF" HEAD)
echo "Comparing tests against ${BASE_REF} (merge-base ${MERGE_BASE:0:7})"

# 1. Tracked test files must be byte-identical to the base ref.
#
# Documented exception (2026-07-15, Phase 6 of the evaluator migration):
# three files imported RuntimeHaltSignal via eval/mixins/access.js, a path
# retired by the mixins -> handlers rename. They are re-pointed at the
# canonical types/halt.js. For these files ONLY that single import line may
# differ from the base ref; any other change still fails.
EXEMPT_FILES=(
  packages/core/tests/language/guard-retry.test.ts
  packages/core/tests/language/pass-async.test.ts
  packages/core/tests/language/typed-atom-migration.test.ts
)
EXCLUDE_SPECS=()
for f in "${EXEMPT_FILES[@]}"; do
  EXCLUDE_SPECS+=(":(exclude)$f")
done
if ! git diff --quiet "$MERGE_BASE" -- packages/core/tests/language/ "${EXCLUDE_SPECS[@]}"; then
  echo "FAIL: test files differ from ${BASE_REF}:"
  git diff --stat "$MERGE_BASE" -- packages/core/tests/language/ "${EXCLUDE_SPECS[@]}"
  exit 1
fi
for f in "${EXEMPT_FILES[@]}"; do
  CHANGED=$(git diff -U0 "$MERGE_BASE" -- "$f" | grep -E '^[+-][^+-]' || true)
  if [ -z "$CHANGED" ]; then
    continue # file identical to base ref; exemption unused
  fi
  EXPECTED_REMOVED="-import { RuntimeHaltSignal } from '../../src/runtime/core/eval/mixins/access.js';"
  EXPECTED_ADDED="+import { RuntimeHaltSignal } from '../../src/runtime/core/types/halt.js';"
  if [ "$CHANGED" != "$EXPECTED_REMOVED"$'\n'"$EXPECTED_ADDED" ]; then
    echo "FAIL: $f diff exceeds the documented RuntimeHaltSignal import exemption:"
    echo "$CHANGED"
    exit 1
  fi
done

# 2. No untracked files may appear inside the test tree.
UNTRACKED=$(git ls-files --others --exclude-standard packages/core/tests/language/)
if [ -n "$UNTRACKED" ]; then
  echo "FAIL: untracked files inside packages/core/tests/language/:"
  echo "$UNTRACKED"
  exit 1
fi
echo "OK: packages/core/tests/language/ matches ${BASE_REF} (RuntimeHaltSignal import exemption only)"

if [ "$DIFF_ONLY" -eq 1 ]; then
  echo "PASS: arbiter lock holds (suite covered by the CI check job)"
  exit 0
fi

# 3. Full suite: everything passes, nothing skipped, count at or above baseline.
# Regenerate both git-ignored generated files for fresh checkouts: the
# docs-bundle generator emits src/generated/introspection-data.ts (normally a
# build step), and `pnpm test`'s pretest hook emits src/generated/version-data.ts.
(cd packages/core && pnpm exec tsx scripts/generate-docs-bundle.ts >/dev/null)
SUITE_OUT=$(cd packages/core && pnpm test 2>&1) || {
  echo "$SUITE_OUT" | tail -30
  echo "FAIL: test suite failed"
  exit 1
}
# These parse vitest's human-readable summary, so a reporter format change
# breaks them. Fail loudly with the output rather than aborting silently.
SUMMARY=$(echo "$SUITE_OUT" | grep -E "^\s*Tests\s" | tail -1 || true)
if [ -z "$SUMMARY" ]; then
  echo "FAIL: no vitest 'Tests' summary line found. The suite exited 0, so this"
  echo "      is a reporter format change, not a test failure. Last 30 lines:"
  echo "$SUITE_OUT" | tail -30
  exit 1
fi
PASSED=$(echo "$SUMMARY" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" || true)
TOTAL=$(echo "$SUMMARY" | grep -oE "\([0-9]+\)" | grep -oE "[0-9]+" || true)
if [ -z "$PASSED" ] || [ -z "$TOTAL" ]; then
  echo "FAIL: could not parse passed/total from the summary line: ${SUMMARY}"
  exit 1
fi
echo "Suite: ${PASSED} passed of ${TOTAL} total"
if [ "$PASSED" != "$TOTAL" ]; then
  echo "FAIL: not every test passed (skipped or todo tests present)"
  exit 1
fi
if [ "$PASSED" -lt "$BASELINE_TESTS" ]; then
  echo "FAIL: test count ${PASSED} fell below baseline ${BASELINE_TESTS}"
  exit 1
fi
echo "OK: ${PASSED} tests passed, zero skipped, baseline ${BASELINE_TESTS} held"

# Informational counters for the PR description.
CASTS=$(grep -rn "as unknown as EvaluatorInterface" packages/core/src | wc -l || true)
AS_ANY=$(grep -rn "as any" packages/core/src/runtime/core/eval/handlers packages/core/src/runtime/core/eval/invocation 2>/dev/null | grep -c "Mixin =" || true)
echo "Info: cast count ${CASTS} (baseline 214), as-any factory exports ${AS_ANY} (baseline 15)"

echo "PASS: test parity lock holds"
