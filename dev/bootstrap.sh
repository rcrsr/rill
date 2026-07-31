#!/usr/bin/env bash
#
# Bring a fresh clone to build-ready, and fail loudly with the fix when the
# toolchain cannot support it.
#
#   pnpm bootstrap
#
# Wire it up with `"bootstrap": "bash dev/bootstrap.sh"` in the root
# package.json. The command is the same in every repository in the ecosystem,
# which is the whole point: a contributor never has to ask which repository
# needs what. See dev/REPO-STANDARDS.md STD-SCRIPT-5.
#
# This deliberately does NOT install git hooks. `prepare` already does that on
# every install, so duplicating it here would give two places to keep in sync.
# What install cannot do is assert the preconditions, which is this script's
# job.
#
# Idempotent: safe to run on a clean tree, a stale tree, or twice in a row.
#
# Repository-agnostic. Everything it enforces is read from the root
# package.json, so the copy in each repository is byte-identical.
#
# Exit codes: 0 ready, 1 precondition unmet.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "" >&2
  echo "bootstrap: $1" >&2
  [ $# -gt 1 ] && { echo "" >&2; echo "  fix: $2" >&2; }
  echo "" >&2
  exit 1
}

step() { echo "==> $1"; }

# --- node ------------------------------------------------------------------
# Checked with `command -v` before being used to parse anything, because every
# check below this point is written in node.

command -v node >/dev/null 2>&1 ||
  fail "node is not on PATH." \
    "Install the version in .nvmrc, or run 'nvm use' if you have nvm."

[ -f package.json ] || fail "no package.json at $ROOT."

# Compares against engines.node rather than a literal, so this script does not
# go stale when the supported floor moves.
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const want = (pkg.engines || {}).node;
  if (!want) process.exit(0);
  const min = want.replace(/^[^0-9]*/, "").split(".").map(Number);
  const got = process.versions.node.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const a = got[i] || 0, b = min[i] || 0;
    if (a > b) process.exit(0);
    if (a < b) {
      console.error(`node ${process.versions.node} is below engines.node ${want}`);
      process.exit(1);
    }
  }
' || fail "node is older than this repository supports." \
  "Install the version in .nvmrc, then re-run 'pnpm bootstrap'."

step "node $(node --version)"

# --- pnpm ------------------------------------------------------------------
# corepack reads packageManager, so it is the supported way to land on the
# pinned version. engines.pnpm is the guard for anyone bypassing corepack.

command -v pnpm >/dev/null 2>&1 ||
  fail "pnpm is not on PATH." \
    "Run 'corepack enable', which reads packageManager from package.json."

node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const want = (pkg.engines || {}).pnpm;
  if (!want) process.exit(0);
  const min = Number(want.replace(/^[^0-9]*/, "").split(".")[0]);
  const got = Number(process.argv[1].split(".")[0]);
  if (got < min) {
    console.error(`pnpm ${process.argv[1]} is below engines.pnpm ${want}`);
    process.exit(1);
  }
' "$(pnpm --version)" || fail "pnpm major is below what this repository requires." \
  "Run 'corepack enable && corepack install', then re-run 'pnpm bootstrap'."

step "pnpm $(pnpm --version)"

# --- install ---------------------------------------------------------------
# --frozen-lockfile so bootstrap never silently rewrites the lockfile. A
# lockfile that does not match the manifests is a real problem and should
# surface here rather than as a mystery diff later.

step "installing dependencies"
pnpm install --frozen-lockfile ||
  fail "install failed against the committed lockfile." \
    "If you just changed a manifest, run 'pnpm install' to update pnpm-lock.yaml."

# --- build -----------------------------------------------------------------
# "build-ready" in STD-SCRIPT-5 means the tree is usable, not merely installed.
# Packages that consume each other's dist/ need this before typecheck or tests
# will run at all.

if node -e 'process.exit(((require("./package.json").scripts)||{}).build ? 0 : 1)'; then
  step "building"
  pnpm run build || fail "build failed." "Fix the build, then re-run 'pnpm bootstrap'."
fi

echo ""
echo "bootstrap: ready. Run 'pnpm check' to validate."
