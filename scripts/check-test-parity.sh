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
# Usage: scripts/check-test-parity.sh [base-ref]   (default: main)

set -euo pipefail
cd "$(dirname "$0")/.."

BASE_REF="${1:-main}"
BASELINE_TESTS=5720 # recorded 2026-07-15 on main @ 20ebc8c

MERGE_BASE=$(git merge-base "$BASE_REF" HEAD)
echo "Comparing tests against ${BASE_REF} (merge-base ${MERGE_BASE:0:7})"

# 1. Tracked test files must be byte-identical to the base ref.
if ! git diff --quiet "$MERGE_BASE" -- packages/core/tests/language/; then
  echo "FAIL: test files differ from ${BASE_REF}:"
  git diff --stat "$MERGE_BASE" -- packages/core/tests/language/
  exit 1
fi

# 2. No untracked files may appear inside the test tree.
UNTRACKED=$(git ls-files --others --exclude-standard packages/core/tests/language/)
if [ -n "$UNTRACKED" ]; then
  echo "FAIL: untracked files inside packages/core/tests/language/:"
  echo "$UNTRACKED"
  exit 1
fi
echo "OK: packages/core/tests/language/ identical to ${BASE_REF}"

# 3. Full suite: everything passes, nothing skipped, count at or above baseline.
SUITE_OUT=$(cd packages/core && npx vitest run 2>&1) || {
  echo "$SUITE_OUT" | tail -30
  echo "FAIL: test suite failed"
  exit 1
}
SUMMARY=$(echo "$SUITE_OUT" | grep -E "^\s*Tests\s" | tail -1)
PASSED=$(echo "$SUMMARY" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+")
TOTAL=$(echo "$SUMMARY" | grep -oE "\([0-9]+\)" | grep -oE "[0-9]+")
echo "Suite: ${PASSED} passed of ${TOTAL} total"
if [ -z "$PASSED" ] || [ -z "$TOTAL" ] || [ "$PASSED" != "$TOTAL" ]; then
  echo "FAIL: not every test passed (skipped or todo tests present)"
  exit 1
fi
if [ "$PASSED" -lt "$BASELINE_TESTS" ]; then
  echo "FAIL: test count ${PASSED} fell below baseline ${BASELINE_TESTS}"
  exit 1
fi
echo "OK: ${PASSED} tests passed, zero skipped, baseline ${BASELINE_TESTS} held"

# Informational counters for the PR description.
CASTS=$(grep -rn "as unknown as EvaluatorInterface" packages/core/src | wc -l)
AS_ANY=$(grep -rn "as any" packages/core/src/runtime/core/eval/mixins packages/core/src/runtime/core/eval/invocation 2>/dev/null | grep -c "Mixin =" || true)
echo "Info: cast count ${CASTS} (baseline 214), as-any factory exports ${AS_ANY} (baseline 15)"

echo "PASS: test parity lock holds"
