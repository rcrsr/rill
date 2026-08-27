#!/usr/bin/env bash
#
# Mechanically enforce the elements of REPO-STANDARDS.md that a script can
# decide from the repository itself.
#
#   rill-check-standards            check the repository in the working directory
#   rill-check-standards --list     print every element this script covers
#   rill-check-standards --remote   also check host settings, needs gh auth
#
# Ships in @rcrsr/rill-dev. Wire it up with `"check:standards":
# "rill-check-standards"` and call it from the root `check` script.
#
# Scope, deliberately narrow. This covers the elements with a deterministic
# answer readable from the tree. Elements needing judgement are NOT checked and
# are not silently treated as passing: --list marks them, and the summary counts
# them, so a green run never reads as full conformance.
#
# Host settings (§1, §13) need an authenticated API call, so they run only under
# --remote. Without it they are reported as unchecked, never as passing.
#
# Repository-agnostic: everything is derived from the tree under test, so every
# consumer runs the same published script.
#
# Exit codes: 0 all checked elements pass, 1 at least one fails, 2 usage error.

set -uo pipefail

# The repository under test is the working directory, never the directory this
# script lives in. Deriving it from BASH_SOURCE was safe only while the script
# was copied to `<repo>/dev/`; from `node_modules/@rcrsr/rill-dev/` the same
# expression resolves to `node_modules/@rcrsr`, and every probe below would then
# read a tree with no manifest and no workflows. Absent inputs are decidable
# here, so that does not error out -- it reports a page of confident results
# about a directory that was never the subject.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# This script's own directory, which is the one thing BASH_SOURCE is right for:
# the version stamped on the summary line, and the baseline shipped beside it.
# Resolved before the cd below, because BASH_SOURCE may be relative.
# realpath/readlink -f resolves a symlinked entry point (e.g. an npm/yarn
# .bin shim) to the real file before taking its directory; without that, a
# symlink installed at node_modules/.bin resolves SELF_DIR to the .bin
# directory itself, and every require() below a sibling path fails silently.
SELF_SCRIPT="${BASH_SOURCE[0]}"
if command -v realpath >/dev/null 2>&1; then
  SELF_SCRIPT="$(realpath "$SELF_SCRIPT")"
elif command -v readlink >/dev/null 2>&1 && readlink -f "$SELF_SCRIPT" >/dev/null 2>&1; then
  SELF_SCRIPT="$(readlink -f "$SELF_SCRIPT")"
fi
SELF_DIR="$(cd "$(dirname "$SELF_SCRIPT")" && pwd)"
# The version of the checker producing the report, not of the repository under
# test. Without it, "CONFORMANT 56 checked" from one repository and
# "CONFORMANT 52 checked" from another give no indication that two different
# checkers produced them, and the difference reads as a conformance gap rather
# than as version skew. Empty rather than fatal when unreadable: a missing
# sibling manifest costs a label, not a run.
SELF_VERSION="$(node -e 'try {
  process.stdout.write(String(require(process.argv[1] + "/package.json").version || ""));
} catch (e) { /* unstamped */ }' "$SELF_DIR" 2>/dev/null)"

# No `set -e` here, deliberately, so a failing cd would otherwise run every
# relative-path check against the caller's directory and print a page of
# misleading results instead of one error.
cd "$ROOT" || { echo "cannot cd to $ROOT" >&2; exit 2; }
# The manifest is the one file every element set assumes. Requiring it converts
# "invoked outside a repository" from dozens of misleading passes into a single
# usage error, which is the same reason the cd above is guarded.
[ -f package.json ] || {
  echo "no package.json in $ROOT; run this from the repository you want checked" >&2
  exit 2
}

REMOTE=0
LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --remote) REMOTE=1; shift ;;
    --list) LIST=1; shift ;;
    -h | --help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^#\s\?//'; exit 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

PASS=0
FAIL=0
SKIP=0
FAILED_IDS=()

green() { printf '\033[32m%s\033[0m' "$1"; }
red() { printf '\033[31m%s\033[0m' "$1"; }
dim() { printf '\033[2m%s\033[0m' "$1"; }

# ok <id> <description> — record a pass. Printed unconditionally, the same as
# bad() and skip() below: --list promises "every element this script covers",
# and a pass that prints nothing under --list is an element missing from that
# catalogue, not one that is merely quiet about succeeding.
ok() {
  PASS=$((PASS + 1))
  printf '  %s %-14s %s\n' "$(green ok)" "$1" "$2"
}

# bad <id> <description> <detail> — record a failure.
bad() {
  FAIL=$((FAIL + 1))
  FAILED_IDS+=("$1")
  printf '  %s %-14s %s\n' "$(red FAIL)" "$1" "$2"
  [ -n "${3:-}" ] && printf '       %s\n' "$(dim "$3")"
}

# skip <id> <description> <why> — record an element this script cannot decide.
skip() {
  SKIP=$((SKIP + 1))
  printf '  %s %-14s %s\n' "$(dim '--')" "$1" "$(dim "$2 — $3")"
}

# check <id> <description> <detail-on-failure>; reads the predicate's exit code
# from the caller running it first. Kept explicit at each call site instead, so
# the predicate and its failure message stay adjacent.

section() { printf '\n%s\n' "$1"; }

# Both extensions GitHub Actions accepts, not just .yml: a repository that
# spells its workflows .yaml had every element in this section read the tree
# as holding no workflows at all, the same false "nothing to check" the
# `[ -e "${WORKFLOWS[0]}" ]` guard below exists to prevent for the glob that
# matches nothing.
WORKFLOWS=(.github/workflows/*.yml .github/workflows/*.yaml)
PRUNED_WORKFLOWS=()
for w in "${WORKFLOWS[@]}"; do
  [ -e "$w" ] && PRUNED_WORKFLOWS+=("$w")
done
WORKFLOWS=("${PRUNED_WORKFLOWS[@]}")

# pkg_field <dot-path> — the value at that path in the root manifest as JSON,
# or the string null when the path is absent, when any parent of it is absent,
# or when the value is falsy. Collapsing "" onto null is load-bearing and not
# incidental: `engines.node: ""` declares no floor, and every caller tests the
# result rather than the distinction. Walked a segment at a time rather than
# spliced into the expression: `.engines.node` threw on a manifest carrying no
# `engines` at all, and with stderr suppressed the empty substitution compared
# unequal to "null", so both elements that read one reported ok for a manifest
# that declares neither.
pkg_field() {
  node -e 'const fs = require("fs");
    let v;
    try { v = JSON.parse(fs.readFileSync("package.json", "utf8")); } catch (e) { v = undefined; }
    for (const k of process.argv[1].split(".").filter(Boolean)) {
      v = v === null || v === undefined ? undefined : v[k];
    }
    process.stdout.write(JSON.stringify(v || null));' "$1"
}

# pkg_has <dot-path> — is a non-empty value declared there? Tested positively,
# because an empty substitution is what a probe that could not run at all
# produces, and `!= null` alone reads that as the element passing.
pkg_has() {
  local v
  v="$(pkg_field "$1")"
  [ -n "$v" ] && [ "$v" != "null" ]
}

has_script() { node -e "process.exit(((require('./package.json').scripts)||{})['$1']?0:1)" 2>/dev/null; }

# has_ts <dir> — does the directory hold TypeScript of its own? Read find to
# completion into a variable rather than piping it into `grep -q`: grep exits at
# the first line it needs, find dies of SIGPIPE, and under `pipefail` that
# becomes the pipeline's status, so a large package reads as having no
# TypeScript and silently skips every element that tests one. Pruning
# node_modules keeps the walk off the dependency tree.
has_ts() {
  local found
  found="$(find "$1" \( -name node_modules -prune \) -o \
    \( -name '*.ts' -o -name '*.tsx' \) -print 2>/dev/null)"
  [ -n "$found" ]
}

# Workspace globs, parsed once, from the `packages:` block alone. Two different
# questions ride on this file and answering both from one grep gets both wrong:
# STD-PM-7 asks whether the declared globs match anything, which only a
# declaration can answer, while every other element asks what the tree holds.
# WS_DECLARED answers the first and nothing else.
WS_GLOBS=()
if [ -f pnpm-workspace.yaml ]; then
  while IFS= read -r g; do
    [ -n "$g" ] && WS_GLOBS+=("$g")
  done < <(awk -v q="\"'" '
    # Trim, then strip one matched pair of quotes. Trimming also drops the \r
    # of a CRLF checkout, which [[:space:]] covers.
    function emit(s,   c) {
      sub(/^[[:space:]]+/, "", s)
      sub(/[[:space:]]+$/, "", s)
      c = substr(s, 1, 1)
      if (length(s) > 1 && index(q, c) && substr(s, length(s), 1) == c)
        s = substr(s, 2, length(s) - 2)
      if (s != "") print s
    }
    /^packages:/ {
      in_b = 1
      rest = $0
      sub(/^packages:[[:space:]]*/, "", rest)
      sub(/(^|[[:space:]])#.*$/, "", rest)
      # A flow sequence carries the whole list on this line, so consuming the
      # line unconditionally dropped every glob a repository spelled that way.
      if (rest ~ /^\[/) {
        sub(/^\[/, "", rest)
        sub(/\][[:space:]]*$/, "", rest)
        n = split(rest, parts, ",")
        for (i = 1; i <= n; i++) emit(parts[i])
        in_b = 0
      }
      next
    }
    # A column-0 comment is not the next top-level key. Reading it as one
    # truncated the sequence, and killed it outright when it came first.
    in_b && /^[^[:space:]#-]/ { in_b = 0 }
    in_b && /^[[:space:]]*-[[:space:]]*/ {
      line = $0
      sub(/^[[:space:]]*-[[:space:]]*/, "", line)
      sub(/[[:space:]]+#.*$/, "", line)
      emit(line)
    }' pnpm-workspace.yaml)
fi
WS_DECLARED=0
[ ${#WS_GLOBS[@]} -gt 0 ] && WS_DECLARED=1

# Every package manifest the repository owns, root included, expanded from the
# declared globs rather than a hardcoded packages/. A workspace declaring
# `apps/*` had its globs confirmed live by STD-PM-7 while its packages stayed
# invisible to every element below. The packages/ pair is the fallback for a
# repository that declares nothing, which also covers a misspelled stanza: the
# layout has to follow what the tree holds, not what a header says.
MANIFESTS=(package.json)
MAN_GLOBS=("packages/*" "packages/*/*")
[ "$WS_DECLARED" -eq 1 ] && MAN_GLOBS=("${WS_GLOBS[@]}")
for g in "${MAN_GLOBS[@]}"; do
  case "$g" in '!'* | '') continue ;; esac
  # Each glob is expanded at its own depth and one below it. `**` is pnpm's
  # canonical spelling and bash expands it as a plain `*` unless globstar is
  # set, so `packages/**` alone reached depth 1 and a nested package went
  # missing — taking the whole workspace with it, since the layout is read from
  # what this loop finds. Enabling globstar instead would walk the dependency
  # tree. The extra level restores the reach of the packages/*/* pair below.
  # shellcheck disable=SC2086,SC2231
  for d in $g $g/*; do
    # A glob may be written `./apps/*`, and `.` is how a repository declares
    # its own root. Both have to normalise onto the paths every other loop
    # compares against, or a scope is compared to one spelled differently.
    d="${d#./}"
    case "$d" in node_modules | */node_modules | */node_modules/*) continue ;; esac
    [ "$d" = "." ] && m=package.json || m="$d/package.json"
    [ -f "$m" ] || continue
    case " ${MANIFESTS[*]} " in *" $m "*) continue ;; esac
    MANIFESTS+=("$m")
  done
done

# Layout, decided by what was found. A repository whose only manifest is the
# root publishes from the root and has no package tree to walk, so an element
# derived from a packages/ glob passes having checked nothing. Every loop and
# every script walk below reads MANIFESTS or PKG_DIRS, so no two can disagree.
WORKSPACE=0
[ ${#MANIFESTS[@]} -gt 1 ] && WORKSPACE=1

PKG_DIRS=()
for f in "${MANIFESTS[@]}"; do
  [ "$f" = package.json ] || PKG_DIRS+=("$(dirname "$f")")
done

# Publishable package count. Several elements are N/A for a repository that
# publishes one package and so has no root-versus-package split to reconcile,
# so count once here rather than assuming either way. The workspace root drops
# out by layout, not by its `private` flag: no element requires a root to
# declare one, and keying on it flipped STD-SCRIPT-3, STD-CHK-7 and STD-REL-3 to
# FAIL on a repository whose stated N/A condition still held.
PUBLISHABLE=0
for f in "${MANIFESTS[@]}"; do
  [ "$WORKSPACE" -eq 1 ] && [ "$f" = package.json ] && continue
  node -e 'const fs = require("fs");
    process.exit(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).private ? 1 : 0)' \
    "$f" 2>/dev/null && PUBLISHABLE=$((PUBLISHABLE + 1))
done

# The cross-repository baseline. REPO-STANDARDS.md §10 names rill's root
# package.json and pnpm-workspace.yaml as the canonical pins, which a
# consuming repository cannot read — it has neither file. The baseline ships
# instead: generated from rill's tree by gen-baseline.cjs, committed to
# packages/dev/baseline.json, and published in the @rcrsr/rill-dev tarball, so
# it travels with the checker into every consumer's node_modules.
#
# Ownership is decided by which of those two files a tree holds, not by a
# hostname or a repository name: a tracked packages/dev/baseline.json is
# rill's own tree, checked out anywhere. A consumer has no such file at that
# path — its baseline lives one level further in, at
# node_modules/@rcrsr/rill-dev/baseline.json — so the two cases cannot collide.
OWNS_BASELINE=0
BASELINE_PATH=""
[ -f packages/dev/baseline.json ] && OWNS_BASELINE=1 && BASELINE_PATH="packages/dev/baseline.json"
if [ "$OWNS_BASELINE" -eq 0 ]; then
  BASELINE_PATH="$(node -e 'try {
    process.stdout.write(require.resolve("@rcrsr/rill-dev/baseline.json"));
  } catch (e) { /* not installed, or too old to export it */ }' 2>/dev/null)"
fi
BASELINE_JSON=""
[ -n "$BASELINE_PATH" ] && BASELINE_JSON="$(cat "$BASELINE_PATH" 2>/dev/null)"

# rill verifies its own baseline is fresh rather than trusting the committed
# file: it regenerates in memory from the tree under test and requires the two
# to agree byte-for-byte (as JSON values, not as text, so key order from a
# stable generator is the only thing that can differ and still counts as
# equal). Skipping this and trusting the committed file would let a pin bump
# ship a stale baseline to every consumer with nothing here to catch it before
# publish. A consuming repository has no tree to regenerate from — its
# baseline IS the pin, read from node_modules — so this only runs for the
# owner.
BASELINE_FRESH=1
if [ "$OWNS_BASELINE" -eq 1 ]; then
  BASELINE_FRESH=0
  LIVE_BASELINE="$(node "$SELF_DIR/gen-baseline.cjs" 2>/dev/null)"
  if [ -n "$LIVE_BASELINE" ]; then
    node -e 'try {
      const live = JSON.parse(process.argv[1]);
      const committed = JSON.parse(process.argv[2]);
      const canon = (v) => {
        if (Array.isArray(v)) return v.map(canon);
        if (v !== null && typeof v === "object") {
          const out = {};
          for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
          return out;
        }
        return v;
      };
      process.exit(JSON.stringify(canon(live)) === JSON.stringify(canon(committed)) ? 0 : 1);
    } catch (e) { process.exit(1); }' "$LIVE_BASELINE" "$BASELINE_JSON" 2>/dev/null &&
      BASELINE_FRESH=1
  fi
fi

# baseline_str <dot-path> — the string value at that path in the baseline, or
# empty if the path is absent or not a string.
baseline_str() {
  node -e 'let v; try { v = JSON.parse(process.argv[2] || "null"); } catch (e) { v = null; }
    for (const k of process.argv[1].split(".").filter(Boolean)) {
      v = v === null || v === undefined ? undefined : v[k];
    }
    process.stdout.write(typeof v === "string" ? v : "");' "$1" "$BASELINE_JSON"
}

# baseline_json <dot-path> — the value at that path, JSON-encoded, or the
# string null if absent. For arrays and objects, where baseline_str would
# discard structure.
baseline_json() {
  node -e 'let v; try { v = JSON.parse(process.argv[2] || "null"); } catch (e) { v = null; }
    for (const k of process.argv[1].split(".").filter(Boolean)) {
      v = v === null || v === undefined ? undefined : v[k];
    }
    process.stdout.write(v === undefined ? "null" : JSON.stringify(v));' "$1" "$BASELINE_JSON"
}

# baseline_gate <id> <label> — the skip/bad wrapper every baseline-derived
# element opens with (STD-LINT-1/5/9, STD-PM-2, STD-DEP-1/2/5): no baseline at
# all is a skip, and a stale committed baseline in the owning repository is a
# bad. Emits the line and returns non-zero when it already handled the
# element; returns 0 when the caller should run its own check.
baseline_gate() {
  local id="$1" label="$2"
  if [ -z "$BASELINE_JSON" ]; then
    skip "$id" "$label" "no baseline available; install or update @rcrsr/rill-dev"
    return 1
  elif [ "$OWNS_BASELINE" -eq 1 ] && [ "$BASELINE_FRESH" -eq 0 ]; then
    bad "$id" "$label" "packages/dev/baseline.json is stale; run pnpm fix:baseline"
    return 1
  fi
  return 0
}

# has_dep <name> — is it declared, at any version, in any dependency field of
# the root manifest?
has_dep() {
  node -e 'const fs = require("fs");
    let p; try { p = JSON.parse(fs.readFileSync("package.json", "utf8")); } catch (e) { process.exit(1); }
    const name = process.argv[1];
    for (const f of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      if (p[f] && p[f][name]) process.exit(0);
    }
    process.exit(1);' "$1"
}

# ---------------------------------------------------------------------------
section "§1 Merge gates, §13 Repository settings"

if [ "$REMOTE" -eq 1 ]; then
  # Strip the .git suffix before taking the last two path segments; doing it in
  # one expression lets the optional group match inside the slug.
  SLUG="$(git remote get-url origin 2>/dev/null |
    sed -E 's#\.git$##' | sed -E 's#.*[:/]([^/]+/[^/]+)$#\1#')"
  SETTINGS=""
  PROT=""
  PROT_STATE=unreadable
  if [ -n "$SLUG" ] && command -v gh >/dev/null 2>&1; then
    SETTINGS="$(gh api "repos/$SLUG" 2>/dev/null)"
    PROT="$(gh api "repos/$SLUG/branches/main/protection" 2>/dev/null)"
    # A 404 still returns a body, so emptiness is not the test. Require the
    # response to carry the field every repository object has.
    node -p "try{JSON.parse(process.argv[1]).full_name?0:1}catch(e){1}" "$SETTINGS" 2>/dev/null |
      grep -q '^0$' || SETTINGS=""
    # Three states, not two. `.url` is present exactly when the branch is
    # protected, and the API answers an unprotected branch with a body carrying
    # no `.url` at all — so testing only that field reported the dominant
    # failure, a branch with no protection whatsoever, as "unreadable" and let
    # it exit green. That body's message is unambiguous, so it is decided here
    # and separated from a genuine auth or network failure, which is not.
    PROT_STATE="$(node -p 'try{const o=JSON.parse(process.argv[1]);
      o.url?"protected":(o.message==="Branch not protected"?"unprotected":"unreadable")}
      catch(e){"unreadable"}' "$PROT" 2>/dev/null)"
    case "$PROT_STATE" in
      protected | unprotected) ;;
      *) PROT_STATE=unreadable ;;
    esac
    [ "$PROT_STATE" = protected ] || PROT=""
  fi

  # An unreachable API is not a failing element. Reporting it as one trains the
  # reader to ignore this section, which is worse than not checking it.
  if [ -z "$SETTINGS" ]; then
    skip "STD-GATE-1..6" "merge gates" "cannot read repos/$SLUG; check gh auth"
    skip "STD-SET-1..3" "repo settings" "cannot read repos/$SLUG; check gh auth"
  else
    j() { node -p "try{JSON.parse(process.argv[1])$2}catch(e){'?'}" "$1" 2>/dev/null; }

    # A token without admin scope gets a repository object with the
    # administrative fields omitted entirely, so the value comes back
    # `undefined`. That is "not visible", not "false", and reporting it as a
    # failure is the exact false negative this script must not produce.
    # CI's GITHUB_TOKEN is such a token.
    visible() { [ "$1" != "undefined" ] && [ "$1" != "?" ] && [ -n "$1" ]; }

    if [ "$PROT_STATE" = protected ]; then
      [ "$(j "$PROT" '.enforce_admins.enabled')" = "true" ] &&
        [ "$(j "$PROT" '.allow_force_pushes.enabled')" = "false" ] &&
        ok "STD-GATE-1" "main protected, force push off, admins included" ||
        bad "STD-GATE-1" "main protected, force push off, admins included" \
          "enforce_admins=$(j "$PROT" '.enforce_admins.enabled') force_pushes=$(j "$PROT" '.allow_force_pushes.enabled')"

      [ "$(j "$PROT" '.required_status_checks.strict')" = "true" ] &&
        ok "STD-GATE-4" "strict status checks" ||
        bad "STD-GATE-4" "strict status checks" "strict=$(j "$PROT" '.required_status_checks.strict')"

      [ "$(j "$PROT" '.required_linear_history.enabled')" = "true" ] &&
        LINEAR=1 || LINEAR=0
    elif [ "$PROT_STATE" = unprotected ]; then
      bad "STD-GATE-1" "main protected, force push off, admins included" \
        "main carries no branch protection at all"
      bad "STD-GATE-4" "strict status checks" "main carries no branch protection at all"
      # An unprotected branch has linear history off, which is a term the
      # pairing below can judge against the merge settings. Blanking it instead
      # skipped STD-GATE-5 on the one repository state it most needs to report.
      LINEAR=0
    else
      skip "STD-GATE-1" "main protected" "branch protection unreadable"
      skip "STD-GATE-4" "strict status checks" "branch protection unreadable"
      LINEAR=""
    fi

    MC="$(j "$SETTINGS" '.allow_merge_commit')"
    RB="$(j "$SETTINGS" '.allow_rebase_merge')"
    SQ="$(j "$SETTINGS" '.allow_squash_merge')"
    if [ -z "$LINEAR" ]; then
      skip "STD-GATE-5" "linear history, squash the only merge path" \
        "branch protection unreadable, so the pairing cannot be judged"
    elif ! visible "$MC" || ! visible "$RB" || ! visible "$SQ"; then
      skip "STD-GATE-5" "linear history, squash the only merge path" \
        "merge settings not visible to this token; needs admin scope"
    elif [ "$LINEAR" = "1" ] && [ "$MC" = "false" ] && [ "$RB" = "false" ] && [ "$SQ" = "true" ]; then
      ok "STD-GATE-5" "linear history, squash the only merge path"
    else
      bad "STD-GATE-5" "linear history, squash the only merge path" \
        "linear=$LINEAR merge_commit=$MC rebase=$RB squash=$SQ"
    fi

    DBM="$(j "$SETTINGS" '.delete_branch_on_merge')"
    if ! visible "$DBM"; then
      skip "STD-GATE-6" "delete_branch_on_merge" "not visible to this token; needs admin scope"
    elif [ "$DBM" = "true" ]; then
      ok "STD-GATE-6" "delete_branch_on_merge"
    else
      bad "STD-GATE-6" "delete_branch_on_merge" "delete_branch_on_merge is false"
    fi

    WIKI="$(j "$SETTINGS" '.has_wiki')"
    if ! visible "$WIKI"; then
      skip "STD-SET-2" "wiki disabled" "not visible to this token"
    elif [ "$WIKI" = "false" ]; then
      ok "STD-SET-2" "wiki disabled"
    else
      bad "STD-SET-2" "wiki disabled" "has_wiki is true and the wiki is presumed unused"
    fi

    # STD-SUP-6's dependency-review half needs the dependency graph enabled on
    # the repository, which is a host feature the workflow file cannot turn on.
    # Without it the workflow runs and fails on every pull request, so checking
    # only that the file exists reports conformance that does not hold.
    if gh api "repos/$SLUG/dependency-graph/sbom" >/dev/null 2>&1; then
      ok "STD-SUP-6" "dependency graph enabled, so dependency review can run"
    else
      bad "STD-SUP-6" "dependency graph enabled, so dependency review can run" \
        "repos/$SLUG/dependency-graph/sbom is unreadable; enable Dependency graph in Settings > Security"
    fi
    # Whether the listed contexts cover every matrix leg needs the workflow's
    # matrix parsed, so completeness stays unchecked. An empty list does not:
    # zero required contexts is a decidable failure of STD-GATE-2, and reporting
    # the whole element as unchecked hid a branch that gates on nothing.
    #
    # `required_status_checks` is null when a protected branch requires none.
    # `visible` passes the literal string null, and the length probe throws on
    # it and answers '?', so both spellings of "nothing is required" fell
    # through to the skip this arm exists to replace. Tested here rather than in
    # `visible`, which serves boolean fields where null means something else.
    RSC="$(j "$PROT" '.required_status_checks')"
    NCTX="$(j "$PROT" '.required_status_checks.contexts.length')"
    if [ "$PROT_STATE" = unreadable ]; then
      skip "STD-GATE-2" "required contexts cover the matrix" "branch protection unreadable"
    elif [ "$PROT_STATE" = unprotected ]; then
      bad "STD-GATE-2" "required contexts cover the matrix" \
        "main carries no branch protection, so nothing is required"
    elif ! visible "$RSC" || [ "$RSC" = "null" ] ||
      [ "$NCTX" = "0" ] || [ "$NCTX" = "?" ]; then
      bad "STD-GATE-2" "required contexts cover the matrix" \
        "no required status checks at all, so main merges with nothing gating it"
    else
      skip "STD-GATE-2" "required contexts cover the matrix" "matrix legs are named per repository"
    fi
    skip "STD-GATE-3" "required context runs the suite" "needs judgement about what a job does"
    skip "STD-SET-1" "merge strategy identical across repos" "cross-repository, not decidable here"
    skip "STD-SET-3" "issues enabled" "depends on whether the repo files issues elsewhere"
  fi
else
  skip "STD-GATE-1..6" "merge gates" "host settings, re-run with --remote"
  skip "STD-SET-1..3" "repository settings" "host settings, re-run with --remote"
fi

# ---------------------------------------------------------------------------
section "§2 CI workflow"

if [ ${#WORKFLOWS[@]} -eq 0 ]; then
  bad "STD-CI-1" "ci.yml present" "no .github/workflows/*.yml found"
else
  [ -f .github/workflows/ci.yml ] &&
    ok "STD-CI-1" "ci.yml present" ||
    bad "STD-CI-1" "ci.yml present" "no .github/workflows/ci.yml"

  MISSING_PERMS="$(grep -L '^permissions:' "${WORKFLOWS[@]}" 2>/dev/null | tr '\n' ' ')"
  [ -z "$MISSING_PERMS" ] &&
    ok "STD-CI-5" "top-level permissions on every workflow" ||
    bad "STD-CI-5" "top-level permissions on every workflow" "missing in: $MISSING_PERMS"

  MISSING_CONC="$(grep -L '^concurrency:' "${WORKFLOWS[@]}" 2>/dev/null | tr '\n' ' ')"
  [ -z "$MISSING_CONC" ] &&
    ok "STD-CI-6" "concurrency group on every workflow" ||
    bad "STD-CI-6" "concurrency group on every workflow" "missing in: $MISSING_CONC"

  # A release workflow must not cancel: an interrupted publish leaves the
  # registry holding half a release.
  REL=.github/workflows/release.yml
  if [ -f "$REL" ]; then
    if grep -q 'cancel-in-progress: *true' "$REL"; then
      bad "STD-CI-6" "release workflow does not cancel in progress" \
        "$REL sets cancel-in-progress: true"
    else
      ok "STD-CI-6" "release workflow does not cancel in progress"
    fi
  fi

  FILTERED="$(grep -ln 'paths-ignore:\|^ *paths:' "${WORKFLOWS[@]}" 2>/dev/null | tr '\n' ' ')"
  [ -z "$FILTERED" ] &&
    ok "STD-CI-7" "no path filtering" ||
    bad "STD-CI-7" "no path filtering" "path filter in: $FILTERED"

  # Every `uses:` needs a 40-char SHA. A local action (./path) is exempt: it is
  # in this repository and versioned with it. This repository never quotes a
  # `uses:` value, but a consumer's workflow can spell `uses: "org/action@sha"`
  # and the extracted value then carries the closing quote, which the
  # `@[0-9a-f]{40}$` test never matches — every quoted pin in a consumer repo
  # read as unpinned. Stripped here, once, before the test runs.
  UNPINNED="$(grep -hoE '^ *-? *uses: *[^ ]+' "${WORKFLOWS[@]}" 2>/dev/null |
    sed -E 's/.*uses: *//' | sed -E "s/^['\"]//; s/['\"]\$//" |
    grep -v '^\./' | grep -vE '@[0-9a-f]{40}$' | sort -u | tr '\n' ' ')"
  [ -z "$UNPINNED" ] &&
    ok "STD-CI-8" "every action pinned to a SHA" ||
    bad "STD-CI-8" "every action pinned to a SHA" "unpinned: $UNPINNED"

  # The trailing comment is what dependabot reads to offer an upgrade. `-H`
  # forces the `file:line:` prefix unconditionally, since grep drops it by
  # default whenever exactly one file is passed — dropping only `-h` still
  # printed a bare `line:` for the common case of a single-workflow repository.
  NOCOMMENT="$(grep -HnE 'uses: *"?'"'"'?[^ ]+@[0-9a-f]{40}["'"'"']? *$' "${WORKFLOWS[@]}" 2>/dev/null | tr '\n' ' ')"
  [ -z "$NOCOMMENT" ] &&
    ok "STD-CI-8" "every pin carries its version comment" ||
    bad "STD-CI-8" "every pin carries its version comment" "bare SHA, no # comment: $NOCOMMENT"

  grep -q 'frozen-lockfile' .github/workflows/ci.yml 2>/dev/null &&
    ok "STD-CI-4" "install uses --frozen-lockfile" ||
    bad "STD-CI-4" "install uses --frozen-lockfile" "not found in ci.yml"

  # Both halves of the element. Reordering the two steps keeps `cache: 'pnpm'`
  # in the file and breaks the install: setup-node resolves the pnpm cache by
  # running pnpm, which corepack is what puts on PATH.
  COREPACK_LINE="$(grep -n 'corepack enable' .github/workflows/ci.yml 2>/dev/null | head -1 | cut -d: -f1)"
  SETUPNODE_LINE="$(grep -n 'uses: *actions/setup-node' .github/workflows/ci.yml 2>/dev/null | head -1 | cut -d: -f1)"
  { grep -q "cache: *'pnpm'" .github/workflows/ci.yml 2>/dev/null &&
    [ -n "$COREPACK_LINE" ] && [ -n "$SETUPNODE_LINE" ] &&
    [ "$COREPACK_LINE" -lt "$SETUPNODE_LINE" ]; } &&
    ok "STD-CI-3" "corepack enabled before setup-node, which caches pnpm" ||
    bad "STD-CI-3" "corepack enabled before setup-node, which caches pnpm" \
      "corepack line=${COREPACK_LINE:-none} setup-node line=${SETUPNODE_LINE:-none}, cache: 'pnpm' must also be set"
fi
skip "STD-CI-2" "node matrix covers supported majors" "the supported set is an ecosystem decision"
# STD-CI-9's N/A is "the repository consumes no ecosystem package, i.e. it is
# the upstream root", which is decidable: an @rcrsr/* dependency resolved from
# the registry is a consumed ecosystem package, while `workspace:*` never
# reaches the registry and so is the root consuming itself. This was hardcoded
# to the root's own answer, and that file is copied verbatim into every sibling,
# so each one claimed an N/A it does not meet.
#
# Read the value as well as the key: an `npm:` alias hides the real package name
# in the value, so `"rill": "npm:@rcrsr/rill@^0.20.0"` consumes an ecosystem
# package under a name that does not look like one. `optionalDependencies`
# counts for the same reason the other three do. `catalog:` and git URLs stay
# consumed; only `workspace:` is the root consuming itself.
CONSUMES="$(node -e '
  const fs = require("fs");
  const names = new Set();
  for (const f of process.argv.slice(1)) {
    let p; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { continue; }
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [n, v] of Object.entries(p[field] || {})) {
        const s = String(v);
        if (s.startsWith("workspace:")) continue;
        const alias = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@|$)/.exec(s);
        const name = alias ? alias[1] : n;
        if (name.startsWith("@rcrsr/")) names.add(name);
      }
    }
  }
  process.stdout.write([...names].join(" "));' "${MANIFESTS[@]}" 2>/dev/null)"

if [ -z "$CONSUMES" ]; then
  skip "STD-CI-9" "scheduled compatibility workflow" \
    "N/A: consumes no ecosystem package from the registry, i.e. the upstream root"
else
  # A scheduled workflow naming each consumed package, one verdict per name: the
  # element reads "the packages the repository consumes", plural, and breaking
  # out of both loops on the first hit reported coverage of a set after matching
  # one member of it.
  #
  # The name is anchored, not matched as a substring. Every sibling of
  # @rcrsr/rill is itself named @rcrsr/rill-<something>, so a bare `grep -F`
  # for the consumed package is satisfied by any workflow mentioning the
  # repository's own name — a nightly stale-issue bot passed.
  #
  # Not decidable from the tree, and so not checked: whether that job resolves
  # the *latest* published version rather than the one the lockfile pins.
  UNCOVERED=""
  for n in $CONSUMES; do
    HIT=""
    NRE="$(printf %s "$n" | sed 's/[.[]/\\&/g')"
    [ ${#WORKFLOWS[@]} -eq 0 ] || for f in "${WORKFLOWS[@]}"; do
      grep -q '^ *schedule:' "$f" 2>/dev/null &&
        grep -qE "$NRE([^A-Za-z0-9._-]|\$)" "$f" 2>/dev/null && HIT=1 && break
    done
    [ -n "$HIT" ] || UNCOVERED="$UNCOVERED$n "
  done
  [ -z "$UNCOVERED" ] &&
    ok "STD-CI-9" "scheduled compatibility workflow covers $CONSUMES" ||
    bad "STD-CI-9" "scheduled compatibility workflow covers $CONSUMES" \
      "no scheduled workflow builds and tests against: $UNCOVERED"
fi

# ---------------------------------------------------------------------------
section "§3 Check coverage"

# §3 is about reachability, not presence: a check defined only in a script no
# workflow calls is non-conformant. ci.yml names none of build, test, lint, or
# typecheck, because the check job runs `pnpm -r run check`, so grepping the
# workflow decides nothing. Expand the script graph from what the workflow
# actually invokes and decide each element against that.
CIYML=.github/workflows/ci.yml
if [ ! -f "$CIYML" ]; then
  skip "STD-CHK-1..7" "check coverage" "no $CIYML to expand; STD-CI-1 reports its absence"
else
  # One `<scope> <script> <command>` line per script the workflow reaches,
  # scope `.` for the root package. Comment lines are stripped first, so a
  # command quoted in a comment does not count as reached.
  CI_REACHED="$(node -e '
    const fs = require("fs");
    const load = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return {}; } };
    // The package set arrives as arguments rather than being rediscovered here.
    // Walking packages/ again meant a repository declaring apps/* had `pnpm -r`
    // fan out to nothing, so build, test and lint read as unreachable from a
    // workflow that runs them.
    const dirs = ["."].concat(process.argv.slice(1))
      .filter((d) => fs.existsSync(d + "/package.json"));
    const man = {};
    const byName = {};
    for (const d of dirs) { man[d] = load(d + "/package.json"); if (man[d].name) byName[man[d].name] = d; }
    const pkgs = dirs.filter((d) => d !== ".");
    const seen = new Set();
    const out = [];
    const walk = (scope, name) => {
      const cmd = ((man[scope] || {}).scripts || {})[name];
      const key = scope + " " + name;
      if (cmd === undefined || seen.has(key)) return;
      seen.add(key);
      out.push(key + " " + cmd.replace(/\s+/g, " "));
      scan(scope, cmd);
    };
    const scan = (scope, text) => {
      // Expands `pnpm [flags] [run] <script>`, with -r or --recursive fanning
      // out to every workspace package and --filter <name> or --filter=<name>
      // selecting one. Not expanded: pnpm exec and pnpm dlx, which parse as a
      // script named exec or dlx, and an invocation split across a YAML line
      // continuation. Both fail in the conservative direction, reading as
      // unreached, so an element FAILs rather than passing on no evidence.
      const re = /pnpm ((?:--filter[= ]\S+ |--?[\w-]+ )*)(?:run )?([\w:.-]+)/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const flags = m[1] || "";
        let targets = [scope];
        if (/(^| )(-r|--recursive)( |$)/.test(flags)) targets = pkgs;
        else {
          const f = /--filter[= ](\S+)/.exec(flags);
          if (f) targets = byName[f[1]] ? [byName[f[1]]] : [];
        }
        for (const t of targets) walk(t, m[2]);
      }
    };
    scan(".", fs.readFileSync(".github/workflows/ci.yml", "utf8")
      .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"));
    console.log(out.join("\n"));
  ' ${PKG_DIRS[@]+"${PKG_DIRS[@]}"} 2>/dev/null)"

  # A here-string, not a pipe: `something | grep -q` closes the pipe early and
  # under pipefail the SIGPIPE becomes the predicate's answer.
  reaches() { grep -qE '^[^ ]+ ('"$1"')( |$)' <<<"$CI_REACHED"; }

  reaches 'build' &&
    ok "STD-CHK-1" "CI reaches build" ||
    bad "STD-CHK-1" "CI reaches build" "no build script is reachable from $CIYML"

  reaches 'test' &&
    ok "STD-CHK-2" "CI reaches the test suite" ||
    bad "STD-CHK-2" "CI reaches the test suite" "no test script is reachable from $CIYML"

  reaches 'lint|check:lint' &&
    ok "STD-CHK-3" "CI reaches lint" ||
    bad "STD-CHK-3" "CI reaches lint" "no lint script is reachable from $CIYML"

  # `check:format` only. `format` is the writer's name in the STD-SCRIPT-1
  # vocabulary, and a script that rewrites files is not a check.
  reaches 'check:format' &&
    ok "STD-CHK-4" "CI reaches the format check" ||
    bad "STD-CHK-4" "CI reaches the format check" \
      "no check:format is reachable from $CIYML; a root-only script is skipped by pnpm -r"

  # Every package under packages/, and a build is not evidence: esbuild and Vite
  # do not typecheck, so those packages need typecheck reached explicitly. A
  # `tsc` build does typecheck, and counts, in whatever form it is written:
  # bare, with flags, or behind a preceding command.
  #
  # awk, not grep, so the directory name is compared as a field rather than
  # interpolated into a pattern where its dots would match anything.
  # In a single-package repository the one package IS the root, so a walk that
  # starts at packages/ finds nothing and the element passes having checked
  # nothing. STD-CHK-5 admits no N/A, so the root is checked in that layout.
  # It is not checked in a workspace: has_ts recurses, so the root would match
  # on its packages' sources and be judged against the aggregator's scripts.
  #
  # That layout also changes which script name counts. §4 splits the two
  # vocabularies, so the root spells this check:types where a package spells it
  # typecheck, and accepting only the package name failed a conformant
  # single-package repo. The root name is added rather than substituted: this
  # element asks whether a typecheck is reachable, and which name the root is
  # allowed to use is STD-SCRIPT-1's to report. Rejecting bare typecheck here
  # would bill one defect to two elements, and to the one that is not about it.
  CHK5_DIRS=()
  CHK5_ROOT=0
  if [ "$WORKSPACE" -eq 1 ]; then
    CHK5_DIRS=("${PKG_DIRS[@]}")
  else
    CHK5_DIRS=(.)
    CHK5_ROOT=1
  fi

  UNTYPED=""
  for d in "${CHK5_DIRS[@]}"; do
    [ -f "$d/package.json" ] || continue
    has_ts "$d" || continue
    awk -v d="$d" -v root="$CHK5_ROOT" '
      $1 == d && ($2 == "typecheck" || (root == 1 && $2 == "check:types") ||
        $0 ~ / tsc( |$)/) { hit = 1 }
      END { exit hit ? 0 : 1 }' <<<"$CI_REACHED" || UNTYPED="$UNTYPED$d "
  done
  [ -z "$UNTYPED" ] &&
    ok "STD-CHK-5" "every TypeScript package is typechecked in CI" ||
    bad "STD-CHK-5" "every TypeScript package is typechecked in CI" \
      "CI reaches no typecheck for: $UNTYPED"

  reaches 'check:deps' &&
    ok "STD-CHK-6" "CI reaches the unused dependency and export check" ||
    bad "STD-CHK-6" "CI reaches the unused dependency and export check" \
      "no check:deps is reachable from $CIYML"

  # The version gate belongs in the CI check job, not only in the release
  # workflow. Reaching it at tag push alone means a split is found when the fix
  # costs another release commit.
  if [ "$PUBLISHABLE" -le 1 ]; then
    skip "STD-CHK-7" "version gate in CI" \
      "N/A: $PUBLISHABLE publishable package, no version split to reconcile"
  else
    grep -q 'check:versions\|check-versions' "$CIYML" 2>/dev/null &&
      ok "STD-CHK-7" "version gate runs in CI, not only at release" ||
      bad "STD-CHK-7" "version gate runs in CI, not only at release" \
        "ci.yml never runs check:versions; drift surfaces at the tag push instead"
  fi
fi

# ---------------------------------------------------------------------------
section "§4 Script vocabulary"

for s in build test check check:types check:lint check:format check:deps check:standards fix:lint fix:format; do
  has_script "$s" || MISSING_SCRIPTS="${MISSING_SCRIPTS:-}$s "
done
[ -z "${MISSING_SCRIPTS:-}" ] &&
  ok "STD-SCRIPT-1" "root vocabulary complete" ||
  bad "STD-SCRIPT-1" "root vocabulary complete" "missing: ${MISSING_SCRIPTS:-}"

# Root check must not delegate solely to a recursive run: `-r` skips the root.
CHECK_CMD="$(node -p "((require('./package.json').scripts)||{}).check||''" 2>/dev/null)"
ROOT_ONLY_MISSED=""
for s in check:format check:deps; do
  has_script "$s" || continue
  case "$CHECK_CMD" in *"$s"*) ;; *) ROOT_ONLY_MISSED="$ROOT_ONLY_MISSED$s " ;; esac
done
[ -z "$ROOT_ONLY_MISSED" ] &&
  ok "STD-SCRIPT-2" "root check reaches the root-only checks" ||
  bad "STD-SCRIPT-2" "root check reaches the root-only checks" \
    "check does not invoke: $ROOT_ONLY_MISSED(pnpm -r run check cannot reach these)"

has_script prepare &&
  ok "STD-SCRIPT-4" "prepare installs hooks" ||
  bad "STD-SCRIPT-4" "prepare installs hooks" "no prepare script"

has_script bootstrap &&
  ok "STD-SCRIPT-5" "bootstrap present" ||
  bad "STD-SCRIPT-5" "bootstrap present" "no bootstrap script"

# One name per task.
DUPES="$(node -p "
  const s=(require('./package.json').scripts)||{}, seen={}, out=[];
  for (const [k,v] of Object.entries(s)) { (seen[v]=seen[v]||[]).push(k); }
  for (const [v,ks] of Object.entries(seen)) if (ks.length>1) out.push(ks.join(' = '));
  out.join('; ')" 2>/dev/null)"
[ -z "$DUPES" ] &&
  ok "STD-SCRIPT-6" "no duplicate script aliases" ||
  bad "STD-SCRIPT-6" "no duplicate script aliases" "$DUPES"

# Package vocabulary. A package with no TypeScript is exempt per STD-SCRIPT-7.
# Report the single-package case as N/A rather than printing nothing: an element
# that is neither ok, FAIL, nor -- leaves the summary understating what is
# unverified, which is worse than an unimplemented check.
if [ "$WORKSPACE" -eq 1 ]; then
  for d in "${PKG_DIRS[@]}"; do
    has_ts "$d" || continue
    for s in build typecheck lint check; do
      node -e 'const fs = require("fs");
        const scripts = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).scripts || {};
        process.exit(scripts[process.argv[2]] ? 0 : 1)' \
        "$d/package.json" "$s" 2>/dev/null || PKG_MISSING="${PKG_MISSING:-}$d:$s "
    done
  done
  [ -z "${PKG_MISSING:-}" ] &&
    ok "STD-SCRIPT-7" "every TypeScript package has the atomic scripts" ||
    bad "STD-SCRIPT-7" "every TypeScript package has the atomic scripts" "missing: ${PKG_MISSING:-}"
else
  skip "STD-SCRIPT-7" "every TypeScript package has the atomic scripts" \
    "N/A: the repository is a single package"
fi
if [ "$PUBLISHABLE" -le 1 ]; then
  skip "STD-SCRIPT-3" "check:versions / fix:versions" \
    "N/A: $PUBLISHABLE publishable package, no version split to reconcile"
else
  { has_script check:versions && has_script fix:versions; } &&
    ok "STD-SCRIPT-3" "check:versions / fix:versions" ||
    bad "STD-SCRIPT-3" "check:versions / fix:versions" \
      "$PUBLISHABLE publishable packages, so the version gate is required"
fi
skip "STD-SCRIPT-8" "canonical names not reused" "needs judgement about intent"

# ---------------------------------------------------------------------------
section "§5 Lint configuration"

LINTRC=.oxlintrc.json
if [ -f "$LINTRC" ]; then
  grep -q '"\$schema"' "$LINTRC" &&
    ok "STD-LINT-7" "lint config declares \$schema" ||
    bad "STD-LINT-7" "lint config declares \$schema" "no \$schema in $LINTRC"

  grep -q '"correctness": *"error"' "$LINTRC" &&
    ok "STD-LINT-2" "correctness set to error" ||
    bad "STD-LINT-2" "correctness set to error" "correctness is not error in $LINTRC"

  # Checked unconditionally, and deliberately not gated on the planning
  # directory the element's N/A condition names. That directory is gitignored
  # in every repository that has one - which is the point of it - so a probe
  # answers "applicable" on a laptop and "N/A" in CI for the same commit, and
  # nothing in the output says which run you are reading. The privacy that
  # makes the rule necessary is what hides its N/A condition from CI.
  #
  # So don't resolve the condition. A repository with nothing to leak that
  # enables the rule reports zero findings and is conformant, which is
  # STD-LINT-5's own logic one row down: a plugin reporting zero findings is
  # enabled, not omitted.
  #
  # `error` rather than any severity: the element bans these identifiers, and
  # a warning bans nothing. STD-LINT-9 requires the same severity as the
  # reference config in any case, so `warn` fails there too.
  #
  # Parsed with jsonc.cjs rather than grepped, which closes the hole this
  # predicate used to carry: confirming the rule is `error` somewhere in the
  # file is not confirming the override whose glob actually matches `src/` is
  # the one that sets it. A rule enabled at `error` under a glob scoped
  # elsewhere used to read as conformant; this walks `overrides[]` and checks
  # the glob on the override that sets the rule, the same way STD-LINT-4 reads
  # a lint command's own scope rather than trusting the rule's presence.
  LINT3_RESULT="$(node -e '
    let cfg;
    try {
      const { readJSONC } = require(process.argv[1]);
      cfg = readJSONC(process.argv[2]);
    } catch (e) { console.log("parse-error"); process.exit(0); }
    const loaded = (cfg.jsPlugins || []).some((p) => String(p).includes("rill-dev/lint-rules"));
    if (!loaded) { console.log("not-loaded"); process.exit(0); }
    const covering = (cfg.overrides || []).filter((o) => {
      const r = (o.rules || {})["rill/no-spec-id-reference"];
      return (Array.isArray(r) ? r[0] : r) === "error";
    });
    if (covering.length === 0) { console.log("not-error"); process.exit(0); }
    const toArray = (x) => (Array.isArray(x) ? x : x === undefined || x === null ? [] : [x]);
    const coversSrc = covering.some((o) => toArray(o.files).some((f) => String(f).includes("src")));
    console.log(coversSrc ? "ok" : "glob-gap");
  ' "$SELF_DIR/jsonc.cjs" "$LINTRC" 2>/dev/null)"

  case "$LINT3_RESULT" in
    ok)
      ok "STD-LINT-3" "workflow-artifact rule enabled, glob covers src/" ;;
    glob-gap)
      bad "STD-LINT-3" "workflow-artifact rule enabled, glob covers src/" \
        "rill/no-spec-id-reference is error, but no override setting it lists a files glob containing src" ;;
    not-loaded)
      bad "STD-LINT-3" "workflow-artifact rule enabled" "rill-dev/lint-rules plugin not loaded" ;;
    not-error)
      bad "STD-LINT-3" "workflow-artifact rule enabled" "rill/no-spec-id-reference is not error in $LINTRC" ;;
    *)
      bad "STD-LINT-3" "workflow-artifact rule enabled" "could not parse $LINTRC as JSONC" ;;
  esac

  # Naming a plugins array replaces the tool defaults, so unicorn is off unless
  # relisted. Its absence is the silent case STD-LINT-8 exists to catch.
  if grep -q '"plugins"' "$LINTRC"; then
    grep -A2 '"plugins"' "$LINTRC" | grep -q 'unicorn' &&
      ok "STD-LINT-8" "default-on plugins relisted explicitly" ||
      bad "STD-LINT-8" "default-on plugins relisted explicitly" \
        "plugins array does not list unicorn, which the CLI enables by default"
  fi

  # Lint scope must include tests/, checked at the call sites that run it. The
  # root is that call site in a single-package repository, under the name §4
  # gives it there; walking only the package list meant the element reported ok
  # having read nothing in exactly the layout this file exists to decide.
  # §4 gives the root check:lint and a package the bare name, so the candidates
  # differ by layout. The root is offered both, because it is the one place the
  # two vocabularies meet and reading only one name reports nothing.
  LINT4_DIRS=(.)
  LINT4_NAMES=(check:lint lint)
  if [ "$WORKSPACE" -eq 1 ]; then
    LINT4_DIRS=("${PKG_DIRS[@]}")
    LINT4_NAMES=(lint)
  fi

  UNSCOPED=""
  for d in "${LINT4_DIRS[@]}"; do
    [ -d "$d/tests" ] || continue
    L="$(node -e 'const fs = require("fs");
      const scripts = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).scripts || {};
      const hit = process.argv.slice(2).find((n) => scripts[n]);
      process.stdout.write(hit ? scripts[hit] : "")' \
      "$d/package.json" "${LINT4_NAMES[@]}" 2>/dev/null)"
    [ -z "$L" ] && continue
    # Only a command naming an explicit scope can leave tests/ out of it. A bare
    # invocation lints the working directory and covers both, so reading its
    # silence as a missing scope would report a repository that has none.
    case "$L" in *src*) ;; *) continue ;; esac
    case "$L" in *tests*) ;; *) UNSCOPED="$UNSCOPED$d " ;; esac
  done
  [ -z "$UNSCOPED" ] &&
    ok "STD-LINT-4" "lint scope covers src/ and tests/" ||
    bad "STD-LINT-4" "lint scope covers src/ and tests/" "tests/ not linted in: $UNSCOPED"
else
  skip "STD-LINT-2,3,4,7,8" "lint configuration" "no $LINTRC in this repository"
fi

# STD-LINT-1: shared linter and formatter. The baseline names the two package
# names rill runs; a repository that declares both, at any version, runs the
# same pair. The version itself is not this element's claim — STD-DEP-1 covers
# range agreement — only that the tool choice has not diverged.
if baseline_gate "STD-LINT-1" "shared linter and formatter"; then
  EXP_LINTER="$(baseline_str linter)"
  EXP_FMT="$(baseline_str formatter)"
  if has_dep "$EXP_LINTER" && has_dep "$EXP_FMT"; then
    ok "STD-LINT-1" "shared linter and formatter ($EXP_LINTER, $EXP_FMT)"
  else
    bad "STD-LINT-1" "shared linter and formatter" \
      "expected $EXP_LINTER and $EXP_FMT declared in package.json"
  fi
fi

# STD-LINT-5: same plugin set. Compared as sets, not as ordered lists — the
# element names the set, not a spelling order, and neither config here treats
# order as meaningful.
if [ ! -f "$LINTRC" ]; then
  skip "STD-LINT-5" "same plugin set as rill" "no $LINTRC in this repository"
elif baseline_gate "STD-LINT-5" "same plugin set as rill"; then
  EXP_PLUGINS="$(baseline_json lintPlugins)"
  HAVE_PLUGINS="$(node -e '
    let cfg = {};
    try {
      const { readJSONC } = require(process.argv[1]);
      cfg = readJSONC(process.argv[2]);
    } catch (e) { cfg = {}; }
    const raw = cfg.plugins;
    const arr = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    process.stdout.write(JSON.stringify(arr.slice().sort()));
  ' "$SELF_DIR/jsonc.cjs" "$LINTRC" 2>/dev/null)"
  DIFF_PLUGINS="$(node -e '
    const have = new Set(JSON.parse(process.argv[1] || "[]") ?? []);
    const want = new Set(JSON.parse(process.argv[2] || "[]") ?? []);
    const missing = [...want].filter((p) => !have.has(p));
    const extra = [...have].filter((p) => !want.has(p));
    const out = [];
    if (missing.length) out.push("missing: " + missing.join(","));
    if (extra.length) out.push("extra: " + extra.join(","));
    process.stdout.write(out.join(" "));
  ' "$HAVE_PLUGINS" "$EXP_PLUGINS")"
  [ -z "$DIFF_PLUGINS" ] &&
    ok "STD-LINT-5" "same plugin set as rill" ||
    bad "STD-LINT-5" "same plugin set as rill" "$DIFF_PLUGINS"
fi

skip "STD-LINT-6" "disabled rules carry counts" "the comment is prose, not machine-checkable"

# STD-LINT-9: rules shared with the reference config carry the same severity.
# Read only rules present in BOTH configs — the element compares the
# intersection, not rill's full set against a consumer that legitimately
# carries fewer rules (rill ~40, rill-config ~26, 25 shared today). A rule the
# baseline does not carry at all says nothing about this element.
if [ ! -f "$LINTRC" ]; then
  skip "STD-LINT-9" "shared rules carry the same severity" "no $LINTRC in this repository"
elif baseline_gate "STD-LINT-9" "shared rules carry the same severity"; then
  EXP_RULES="$(baseline_json lintRules)"
  # A load/parse failure prints the PARSE_ERROR sentinel rather than falling
  # back to `cfg = {}`. An empty `have` is indistinguishable from "legitimately
  # no overlapping rules" once it reaches the intersection diff below — the
  # diff only flags keys present in both objects, so an empty `have` always
  # reports zero mismatches and STD-LINT-9 would read `ok` on a broken or
  # partial jsonc.cjs install, exactly the silent false-conformance this
  # element must not produce. Checked before the diff runs, mirroring
  # STD-LINT-3's parse-error handling above.
  HAVE_RULES="$(node -e '
    let cfg;
    try {
      const { readJSONC } = require(process.argv[1]);
      cfg = readJSONC(process.argv[2]);
    } catch (e) { console.log("PARSE_ERROR"); process.exit(0); }
    const out = {};
    for (const [k, v] of Object.entries(cfg.rules || {})) out[k] = Array.isArray(v) ? v[0] : v;
    process.stdout.write(JSON.stringify(out));
  ' "$SELF_DIR/jsonc.cjs" "$LINTRC" 2>/dev/null)"
  if [ "$HAVE_RULES" = "PARSE_ERROR" ] || [ -z "$HAVE_RULES" ]; then
    bad "STD-LINT-9" "shared rules carry the same severity" \
      "could not parse $LINTRC as JSONC"
  else
    MISMATCH="$(node -e '
      const have = JSON.parse(process.argv[1] || "{}") ?? {};
      const want = JSON.parse(process.argv[2] || "{}") ?? {};
      const out = [];
      for (const k of Object.keys(want)) {
        if (Object.prototype.hasOwnProperty.call(have, k) && have[k] !== want[k]) {
          out.push(k + ": " + have[k] + " vs " + want[k]);
        }
      }
      process.stdout.write(out.join("; "));
    ' "$HAVE_RULES" "$EXP_RULES")"
    [ -z "$MISMATCH" ] &&
      ok "STD-LINT-9" "shared rules carry the same severity" ||
      bad "STD-LINT-9" "shared rules carry the same severity" "$MISMATCH"
  fi
fi

# ---------------------------------------------------------------------------
section "§7 Release workflow"

REL=.github/workflows/release.yml
if [ ! -f "$REL" ]; then
  skip "STD-REL-1..7" "release workflow" "no release.yml; N/A if the repo publishes nothing"
else
  grep -q "tags:" "$REL" &&
    ok "STD-REL-1" "triggered by a version tag" ||
    bad "STD-REL-1" "triggered by a version tag" "no tag trigger in $REL"

  # Recorded, because STD-SUP-2 is the same assertion read from §9 and settles
  # on this result rather than on a grep of its own.
  if grep -q 'provenance' "$REL"; then
    PROVENANCE=1
    ok "STD-REL-3" "publishes with provenance"
  else
    PROVENANCE=0
    bad "STD-REL-3" "publishes with provenance" "no --provenance in $REL"
  fi

  grep -q 'id-token: *write' "$REL" &&
    ok "STD-REL-4" "grants id-token: write" ||
    bad "STD-REL-4" "grants id-token: write" "provenance needs id-token: write"

  grep -qi 'EPUBLISHCONFLICT' "$REL" &&
    ok "STD-REL-5" "tolerates a registry-side conflict" ||
    bad "STD-REL-5" "tolerates a registry-side conflict" \
      "no conflict fallback; the npm view pre-check alone races a concurrent publish"

  # STD-REL-5 introduces the pipe that makes this load-bearing. Checked as a
  # pair, because REL-5 without REL-6 is worse than neither.
  if grep -q 'set -o pipefail' "$REL"; then
    ok "STD-REL-6" "publish sets pipefail"
  elif grep -qi 'EPUBLISHCONFLICT' "$REL"; then
    bad "STD-REL-6" "publish sets pipefail" \
      "the conflict fallback pipes into tee, so a failed publish reports success"
  else
    bad "STD-REL-6" "publish sets pipefail" "no pipefail in $REL"
  fi

  grep -q 'release view\|release create' "$REL" &&
    ok "STD-REL-7" "creates a GitHub Release idempotently" ||
    bad "STD-REL-7" "creates a GitHub Release idempotently" "no gh release step"

  # Version consistency before publish, which is a different assertion in each
  # layout. A workspace reconciles the root against its packages, and that is
  # the check:versions script. A single-package repository has no such split, so
  # STD-SCRIPT-3 is N/A there and the script does not exist; the consistency
  # that remains is the pushed tag against the manifest it is about to publish.
  # Requiring the script form in both layouts left STD-REL-2 unsatisfiable for
  # every single-package repo, which is the standard contradicting itself.
  #
  # No single-line pattern reads that comparison. One loose enough to match the
  # spellings a shell allows also matches `if`, `test` and `version` inside
  # ordinary words, so it passed lines that gate nothing and failed real gates
  # written across two lines. Reporting a guess as `ok` is worse than the
  # guaranteed FAIL it replaced; `--` is the honest answer.
  if has_script check:versions; then
    grep -q 'check-versions\|check:versions' "$REL" &&
      ok "STD-REL-2" "version gate runs before publish" ||
      bad "STD-REL-2" "version gate runs before publish" "$REL never runs check:versions"
  else
    skip "STD-REL-2" "publish gate compares the tag to the manifest version" \
      "the tag-to-manifest comparison is spelled per repository"
  fi

  # Provenance binds to a source repository, so each published package needs it.
  # Read every manifest: a single-package repository publishes from the root, so
  # walking only the package tree passes having checked nothing. The workspace
  # root is excluded in the other layout, where it aggregates and publishes
  # nothing, and requiring `repository` of it tested a field no element names.
  NOREPO=""
  for f in "${MANIFESTS[@]}"; do
    [ "$WORKSPACE" -eq 1 ] && [ "$f" = package.json ] && continue
    node -e 'const fs = require("fs");
      const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (p.private) process.exit(0);
      process.exit(p.repository ? 0 : 1)' "$f" 2>/dev/null || NOREPO="$NOREPO$f "
  done
  [ -z "$NOREPO" ] &&
    ok "STD-REL-3" "published packages declare repository" ||
    bad "STD-REL-3" "published packages declare repository" \
      "provenance has no source to bind to in: $NOREPO"
fi

# ---------------------------------------------------------------------------
section "§8 Package manager, §9 Supply chain"

PM="$(pkg_field '.packageManager')"
pkg_has '.packageManager' && echo "$PM" | grep -q 'sha512' &&
  ok "STD-PM-1" "packageManager pinned with its hash" ||
  bad "STD-PM-1" "packageManager pinned with its hash" "packageManager=$PM"

pkg_has '.engines.node' &&
  ok "STD-PM-3" "engines.node declared" ||
  bad "STD-PM-3" "engines.node declared" "no engines.node"

pkg_has '.engines.pnpm' &&
  ok "STD-PM-4" "engines constrains the package manager major" ||
  bad "STD-PM-4" "engines constrains the package manager major" \
    "no engines.pnpm, so a local install under the wrong major does not fail"

if [ -f .nvmrc ] && [ -f .node-version ]; then
  [ "$(tr -d ' v\n' < .nvmrc)" = "$(tr -d ' v\n' < .node-version)" ] &&
    ok "STD-PM-5" ".nvmrc and .node-version agree" ||
    bad "STD-PM-5" ".nvmrc and .node-version agree" \
      "$(cat .nvmrc) vs $(cat .node-version)"
else
  bad "STD-PM-5" ".nvmrc and .node-version present" "one or both missing"
fi

# Workspace globs that match nothing are dead config, so this keys on the
# declaration and not on the layout: a single-package repository can hold
# pnpm-workspace.yaml for the §9 settings alone, and that file declares no
# globs to go dead.
if [ "$WS_DECLARED" -eq 1 ]; then
  DEAD=""
  for glob in "${WS_GLOBS[@]}"; do
    case "$glob" in '!'*) continue ;; esac
    # shellcheck disable=SC2086
    set -- $glob
    [ -e "$1" ] || DEAD="$DEAD$glob "
  done
  [ -z "$DEAD" ] &&
    ok "STD-PM-7" "every workspace glob matches" ||
    bad "STD-PM-7" "every workspace glob matches" "matches nothing: $DEAD"
else
  skip "STD-PM-7" "every workspace glob matches" \
    "N/A: no workspace packages are declared"
fi

# §9's install-time policies. These are NOT gated on the workspace layout: pnpm
# reads pnpm-workspace.yaml for settings whether or not it declares `packages:`,
# so a single-package repository holds the file for these keys alone. Gating
# them on a workspace made all three vanish from the accounting on every sibling
# repo, reported as neither ok, FAIL, nor --.
#
# The file has three dispositions, not two, and `[ -f ]` decides only the first
# of them. Substituting /dev/null reported success for a file that is not there;
# testing existence alone reported it for a file node could not read, and did so
# on the two facets whose default reads as passing. Present and parsed is the
# only state that earns a verdict.
#
#   absent      STD-SUP-3 and STD-SUP-5 admit no N/A, so they FAIL. STD-SUP-4 is
#               N/A: with no file there is nowhere to declare an exclusion, the
#               same condition its row grants a file that declares none.
#   unreadable  Nothing is known, which is `--` on all four per the contract at
#               the top of this file. A parse that fails must not leave a facet
#               reading ok off its default.
#   parsed      Judged on the values.
#
# The values decide, not the keys: `minimumReleaseAge: 0`, `trustPolicy: none`
# and `trustLockfile: True` each satisfy a key-presence grep while turning the
# control off, and the last of those silently disables the other two. Parsed in
# node from top-level scalars only, with no YAML dependency, because this file
# has to stay byte-identical across repositories that install nothing extra.
PNPMWS=pnpm-workspace.yaml
WS_POLICY=""
[ -f "$PNPMWS" ] && WS_POLICY="$(node -e '
  const fs = require("fs");
  const v = {};
  // \r is a JS line terminator, so `.` cannot cross it and `$` is unreachable
  // on a CRLF checkout: the match failed outright and every key read as unset.
  for (const raw of fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(raw);
    // Strip a trailing comment, then one *matched* pair of surrounding quotes,
    // written as escapes so the apostrophe does not end this shell string.
    if (m) v[m[1]] = m[2].replace(/(^|[ \t]+)#.*$/, "").trim()
      .replace(/^([\u0022\u0027])(.*)\1$/, "$2");
  }
  const show = (k) => (v[k] === undefined || v[k] === "" ? "unset" : v[k]);
  // An underscore separator is a digit group, not a different number.
  const age = Number(String(show("minimumReleaseAge")).replace(/_/g, ""));
  // true/True/TRUE are YAML 1.2 booleans. yes/on/y are YAML 1.1 booleans that
  // 1.2 leaves as strings, so whether a given parser acts on one is not
  // decidable here — but every spelling states an intent to turn the switch on,
  // and this element is about leaving it at its default.
  const truthy = ["true", "yes", "on", "y"]
    .indexOf(String(v.trustLockfile).toLowerCase()) !== -1;
  const line = (okay, key) => console.log((okay ? 1 : 0) + " " + show(key));
  line(v.minimumReleaseAge !== undefined && Number.isFinite(age) && age > 0, "minimumReleaseAge");
  line(v.trustPolicy !== undefined && v.trustPolicy !== "" &&
    v.trustPolicy.toLowerCase() !== "none", "trustPolicy");
  line(truthy, "trustLockfile");' "$PNPMWS" 2>/dev/null)"

if [ ! -f "$PNPMWS" ]; then
  bad "STD-SUP-3" "minimum release age set explicitly" \
    "no $PNPMWS, so the package manager's default applies and that moved between majors"
  bad "STD-SUP-5" "dependency trust verified on install" \
    "no $PNPMWS to declare trustPolicy in"
  bad "STD-SUP-3" "supply-chain policies actually applied" \
    "no $PNPMWS, so there is no policy to apply on install"
  skip "STD-SUP-4" "exclusions do not need a hand edit each release" \
    "N/A: no $PNPMWS, so the repository declares no exclusions"
elif [ -z "$WS_POLICY" ]; then
  skip "STD-SUP-3" "minimum release age set explicitly" "$PNPMWS cannot be read"
  skip "STD-SUP-5" "dependency trust verified on install" "$PNPMWS cannot be read"
  skip "STD-SUP-3" "supply-chain policies actually applied" "$PNPMWS cannot be read"
  skip "STD-SUP-4" "exclusions do not need a hand edit each release" "$PNPMWS cannot be read"
else
  { read -r AGE_OK AGE_VAL
    read -r TRUST_OK TRUST_VAL
    read -r LOCK_ON LOCK_VAL; } <<<"$WS_POLICY"

  [ "${AGE_OK:-0}" = 1 ] &&
    ok "STD-SUP-3" "minimum release age set explicitly" ||
    bad "STD-SUP-3" "minimum release age set explicitly" \
      "minimumReleaseAge is ${AGE_VAL:-unset} in $PNPMWS; only a positive value holds a fresh release out"

  [ "${TRUST_OK:-0}" = 1 ] &&
    ok "STD-SUP-5" "dependency trust verified on install" ||
    bad "STD-SUP-5" "dependency trust verified on install" \
      "trustPolicy is ${TRUST_VAL:-unset} in $PNPMWS; none verifies nothing"

  # This one silently disables both of the above. Its safe reading is the
  # failing one, so a missing third line from the parse must not read as off.
  if [ "${LOCK_ON:-1}" = 1 ]; then
    bad "STD-SUP-3" "supply-chain policies actually applied" \
      "trustLockfile: ${LOCK_VAL:-unset} skips re-applying minimumReleaseAge and trustPolicy"
  else
    ok "STD-SUP-3" "supply-chain policies actually applied"
  fi

  # An exclusion pinned to an exact version goes stale every release. The row
  # grants an N/A to a repository that declares no exclusions, and a file
  # without the key declares none just as an absent file does. Reporting `ok`
  # there counted an element that does not apply as a checked pass, which is the
  # inflation the absent-file arm above exists to avoid.
  if grep -q '^minimumReleaseAgeExclude:' "$PNPMWS" 2>/dev/null; then
    # Quotes are optional in YAML, so an unquoted entry is a pin too.
    PINNED="$(grep -A20 '^minimumReleaseAgeExclude:' "$PNPMWS" 2>/dev/null |
      grep -oE "^ *- *['\"]?[^ '\"]+@[0-9]+\.[0-9]+\.[0-9]+" | tr '\n' ' ')"
    [ -z "$PINNED" ] &&
      ok "STD-SUP-4" "exclusions do not need a hand edit each release" ||
      bad "STD-SUP-4" "exclusions do not need a hand edit each release" \
        "pinned to an exact version: $PINNED"
  else
    skip "STD-SUP-4" "exclusions do not need a hand edit each release" \
      "N/A: the repository declares no exclusions"
  fi
fi

# Both ecosystems, not just actions. The npm half is the one that surfaces the
# dependency updates the repository actually consumes.
[ -f .github/dependabot.yml ] &&
  grep -qE "package-ecosystem: *['\"]?npm['\"]?" .github/dependabot.yml &&
  grep -qE "package-ecosystem: *['\"]?github-actions['\"]?" .github/dependabot.yml &&
  ok "STD-SUP-1" "dependabot covers npm and actions" ||
  bad "STD-SUP-1" "dependabot covers npm and actions" \
    "missing, or one ecosystem absent: needs a npm block and a github-actions block"

# STD-SUP-8: version-update PRs disabled ecosystem-wide. Upgrades are done
# manually under the repository's upgrade policy; Dependabot's own security
# updates are a separate host feature and are unaffected. The policy holds only
# when every `package-ecosystem` block carries `open-pull-requests-limit: 0`, so
# the check counts blocks against zero-limit lines and rejects any positive
# limit. A single un-zeroed block reopens the automated-PR firehose for that
# ecosystem, which is the failure this element exists to catch.
if [ -f .github/dependabot.yml ]; then
  sup8_eco=$(grep -cE "^[[:space:]]*-?[[:space:]]*package-ecosystem:" .github/dependabot.yml)
  sup8_zero=$(grep -cE "^[[:space:]]*open-pull-requests-limit:[[:space:]]*[\"']?0[\"']?[[:space:]]*(#.*)?$" .github/dependabot.yml)
  sup8_pos=$(grep -cE "^[[:space:]]*open-pull-requests-limit:[[:space:]]*[\"']?[1-9][0-9]*[\"']?[[:space:]]*(#.*)?$" .github/dependabot.yml)
  { [ "$sup8_pos" -eq 0 ] && [ "$sup8_zero" -eq "$sup8_eco" ] && [ "$sup8_eco" -gt 0 ]; } &&
    ok "STD-SUP-8" "dependabot version-update PRs disabled" ||
    bad "STD-SUP-8" "dependabot version-update PRs disabled" \
      "every package-ecosystem block needs open-pull-requests-limit: 0 ($sup8_zero of $sup8_eco set, $sup8_pos positive)"
else
  bad "STD-SUP-8" "dependabot version-update PRs disabled" "no .github/dependabot.yml"
fi

{ [ -f .github/workflows/codeql.yml ] && [ -f .github/workflows/dependency-review.yml ]; } &&
  ok "STD-SUP-6" "static analysis and dependency review" ||
  bad "STD-SUP-6" "static analysis and dependency review" "codeql.yml or dependency-review.yml missing"

{ [ -f .github/CODEOWNERS ] || [ -f CODEOWNERS ]; } &&
  ok "STD-SUP-7" "CODEOWNERS present" ||
  bad "STD-SUP-7" "CODEOWNERS present" "no CODEOWNERS"
# STD-PM-2: the same package manager major and version string in every
# repository. $PM was read by STD-PM-1 above, JSON-encoded (quoted); the
# baseline's copy is read unquoted, so strip the quotes rather than re-parse.
if baseline_gate "STD-PM-2" "same package manager version everywhere"; then
  EXP_PM="$(baseline_str packageManager)"
  PM_UNQUOTED="$(printf '%s' "$PM" | sed -e 's/^"//' -e 's/"$//')"
  [ -n "$EXP_PM" ] && [ "$PM_UNQUOTED" = "$EXP_PM" ] &&
    ok "STD-PM-2" "same package manager version everywhere" ||
    bad "STD-PM-2" "same package manager version everywhere" \
      "packageManager=$PM_UNQUOTED, ecosystem pin is $EXP_PM"
fi

# The location the allowlist belongs in is decided by the pinned major, which
# STD-PM-1 already read into $PM: pnpm 11 reads `allowBuilds` from
# pnpm-workspace.yaml and no longer reads `pnpm.onlyBuiltDependencies` from
# package.json, which is the move the element warns about. Declaring one in the
# old location under a major that ignores it is the failure mode -- the settings
# read as present and are inert -- so it is reported as a failure rather than as
# an absent allowlist.
#
# Declaring none anywhere is the element's own N/A condition: no dependency
# requires a build script. That cannot be distinguished from "forgot to declare
# one", and the element accepts the ambiguity by naming it as the N/A. Reported
# as N/A rather than passed, so it is counted as unchecked.
PM_MAJOR="$(printf '%s' "$PM" | sed -n 's/^"\?pnpm@\([0-9]\+\)\..*/\1/p')"
NEW_LOC=0
OLD_LOC=0
[ -f pnpm-workspace.yaml ] && grep -q '^allowBuilds:' pnpm-workspace.yaml && NEW_LOC=1
grep -q '"onlyBuiltDependencies"' package.json && OLD_LOC=1
if [ -z "$PM_MAJOR" ]; then
  skip "STD-PM-6" "build allowlist in the expected location" \
    "no pnpm major to read the expected location from"
elif [ "$NEW_LOC" -eq 0 ] && [ "$OLD_LOC" -eq 0 ]; then
  skip "STD-PM-6" "build allowlist in the expected location" \
    "N/A: no dependency requires a build script"
elif [ "$PM_MAJOR" -ge 11 ]; then
  [ "$NEW_LOC" -eq 1 ] &&
    ok "STD-PM-6" "build allowlist in the expected location" ||
    bad "STD-PM-6" "build allowlist in the expected location" \
      "pnpm $PM_MAJOR reads allowBuilds: from pnpm-workspace.yaml; the allowlist is in package.json, where it is inert"
else
  [ "$OLD_LOC" -eq 1 ] &&
    ok "STD-PM-6" "build allowlist in the expected location" ||
    bad "STD-PM-6" "build allowlist in the expected location" \
      "pnpm $PM_MAJOR reads pnpm.onlyBuiltDependencies from package.json; the allowlist is in pnpm-workspace.yaml, where it is not yet read"
fi

# Not a grep of its own: the element says "See STD-REL-3", so reading the
# release workflow a second time would let the two disagree. $PROVENANCE is
# unset when there is no release.yml at all, which is this element's own N/A.
if [ -z "${PROVENANCE:-}" ]; then
  skip "STD-SUP-2" "published packages carry provenance" "N/A: the repository publishes nothing"
else
  [ "$PROVENANCE" -eq 1 ] &&
    ok "STD-SUP-2" "published packages carry provenance" ||
    bad "STD-SUP-2" "published packages carry provenance" "see STD-REL-3"
fi

# ---------------------------------------------------------------------------
section "§11 Issue and PR process, §12 Community health"

for f in SECURITY.md README.md LICENSE CHANGELOG.md CLAUDE.md CONTRIBUTING.md CODE_OF_CONDUCT.md .gitignore; do
  [ -f "$f" ] || MISSING_DOCS="${MISSING_DOCS:-}$f "
done
[ -z "${MISSING_DOCS:-}" ] &&
  ok "STD-DOC-1..5" "community health files present" ||
  bad "STD-DOC-1..5" "community health files present" "missing: ${MISSING_DOCS:-}"

[ -f .github/labeler.yml ] &&
  ok "STD-PROC-2" "labeler.yml maps paths to area labels" ||
  bad "STD-PROC-2" "labeler.yml maps paths to area labels" "no .github/labeler.yml"

[ -f .github/workflows/pr-labels.yml ] &&
  ok "STD-PROC-3" "PR area-label workflow" ||
  bad "STD-PROC-3" "PR area-label workflow" "no pr-labels.yml"

[ -d .github/ISSUE_TEMPLATE ] &&
  ok "STD-PROC-5" "ISSUE_TEMPLATE forms" ||
  bad "STD-PROC-5" "ISSUE_TEMPLATE forms" "no .github/ISSUE_TEMPLATE/"

[ -f .github/PULL_REQUEST_TEMPLATE.md ] &&
  ok "STD-PROC-6" "PULL_REQUEST_TEMPLATE.md" ||
  bad "STD-PROC-6" "PULL_REQUEST_TEMPLATE.md" "missing"
skip "STD-PROC-1" "area:* taxonomy" "label state lives on the host"
skip "STD-PROC-4" "issue workflow reads state fresh" "needs judgement about the script"
# The script's path is not repo-specific after all -- every repository in scope
# carries it at .github/scripts/sync-labels.sh -- and idempotency has a marker
# worth reading rather than trusting: `gh label create --force` upserts, where a
# bare `gh label create` exits non-zero the second time and, under `set -e`,
# halts the sync partway. Requiring --force on every create is what the element
# means by reproducible. A rewrite in another language would report as absent
# here, which is a false negative worth taking over passing on presence alone.
LABEL_SYNC=.github/scripts/sync-labels.sh
if [ ! -f "$LABEL_SYNC" ]; then
  bad "STD-PROC-7" "idempotent label-sync script" "no $LABEL_SYNC"
else
  # Join backslash continuations before counting, then drop comment lines. Both
  # matter on the reference script and each one alone reports it non-conformant:
  # two of its three calls carry --force on the continued line, and the header
  # comment documenting the flag otherwise counts as a fourth call.
  LABEL_SRC="$(sed -e :a -e '/\\$/N; s/\\\n//; ta' "$LABEL_SYNC" | grep -v '^[[:space:]]*#')"
  CREATES="$(printf '%s\n' "$LABEL_SRC" | grep -c 'gh label create')"
  FORCED="$(printf '%s\n' "$LABEL_SRC" | grep -c 'gh label create.*--force')"
  if [ "$CREATES" -eq 0 ]; then
    skip "STD-PROC-7" "idempotent label-sync script" \
      "$LABEL_SYNC calls no gh label create; idempotency needs judgement"
  else
    [ "$CREATES" -eq "$FORCED" ] &&
      ok "STD-PROC-7" "idempotent label-sync script" ||
      bad "STD-PROC-7" "idempotent label-sync script" \
        "$((CREATES - FORCED)) of $CREATES gh label create calls lack --force; a re-run halts on the first existing label"
  fi
fi

# ---------------------------------------------------------------------------
section "§6 Git hooks, §10 Dependency versions"

if [ -f lefthook.yml ]; then
  grep -q 'pre-commit:' lefthook.yml &&
    grep -q 'piped: *true' lefthook.yml &&
    ok "STD-HOOK-3" "pre-commit runs piped" ||
    bad "STD-HOOK-3" "pre-commit runs piped" "no piped: true under pre-commit"

  # Format before lint; the reverse lets the formatter undo a lint fix.
  FMT_LINE="$(grep -n 'oxfmt' lefthook.yml | head -1 | cut -d: -f1)"
  LINT_LINE="$(grep -n 'oxlint' lefthook.yml | head -1 | cut -d: -f1)"
  if [ -n "$FMT_LINE" ] && [ -n "$LINT_LINE" ]; then
    [ "$FMT_LINE" -lt "$LINT_LINE" ] &&
      ok "STD-HOOK-2" "pre-commit formats before linting" ||
      bad "STD-HOOK-2" "pre-commit formats before linting" "lint runs first; format would undo its fixes"
  fi

  grep -q 'pre-push:' lefthook.yml &&
    ok "STD-HOOK-4" "pre-push runs typecheck and tests" ||
    bad "STD-HOOK-4" "pre-push runs typecheck and tests" "no pre-push block"

  has_script prepare &&
    ok "STD-HOOK-1" "hook manager installed via prepare" ||
    bad "STD-HOOK-1" "hook manager installed via prepare" "no prepare script"
else
  bad "STD-HOOK-1..4" "git hooks configured" "no lefthook.yml"
fi

# STD-HOOK-5: a pre-commit command's glob must not reduce, for some real
# commit, to a set the invoked tool's own ignore config fully covers. A hook
# glob (lefthook.yml) and a tool's ignorePatterns (.oxfmtrc.json,
# .oxlintrc.json) are declared in two different files and checked by no one
# against each other; when every staged file a glob selects is also in the
# tool's own ignore list, the tool receives an all-ignored input and commonly
# exits non-zero rather than no-op, which halts the rest of a `piped: true`
# chain (STD-HOOK-3) over a commit that touches nothing the tool cares about.
# Decided from the tree: every tracked file is tested against each oxfmt/
# oxlint command's own `glob`, and a match not already carved out by that
# command's own `exclude:` is bad if the tool's own ignorePatterns also
# covers it. Never skipped — no lefthook.yml, or no oxfmt/oxlint command,
# means nothing can match, which is a decided ok, not an unchecked element.
HOOK5_RESULT="$(node -e '
  const fs = require("fs");
  const { execFileSync } = require("child_process");

  let lhText = "";
  try { lhText = fs.readFileSync("lefthook.yml", "utf8"); } catch (e) { lhText = ""; }
  const lines = lhText.split(/\r?\n/);
  const commands = {};
  let inPreCommit = false, inCommands = false, commandsIndent = -1, curCmd = null, inExclude = false;
  const indentOf = (s) => s.match(/^ */)[0].length;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = indentOf(line);
    if (/^pre-commit:\s*$/.test(trimmed) && indent === 0) { inPreCommit = true; inCommands = false; curCmd = null; continue; }
    if (indent === 0 && !/^pre-commit:\s*$/.test(trimmed)) { inPreCommit = false; inCommands = false; curCmd = null; }
    if (inPreCommit && /^commands:\s*$/.test(trimmed)) { inCommands = true; commandsIndent = indent; continue; }
    if (!inCommands) continue;
    const cm = /^([A-Za-z0-9_.-]+):\s*$/.exec(trimmed);
    if (cm && indent === commandsIndent + 2) {
      curCmd = cm[1];
      commands[curCmd] = { glob: null, exclude: [], run: "" };
      inExclude = false;
      continue;
    }
    if (curCmd && indent <= commandsIndent) { curCmd = null; inExclude = false; continue; }
    if (!curCmd) continue;
    let m = /^glob:\s*(.+)$/.exec(trimmed);
    if (m) { commands[curCmd].glob = m[1].trim().replace(/^["\x27]|["\x27]$/g, ""); inExclude = false; continue; }
    m = /^run:\s*(.+)$/.exec(trimmed);
    if (m) { commands[curCmd].run = m[1]; inExclude = false; continue; }
    if (/^exclude:\s*$/.test(trimmed)) { inExclude = true; continue; }
    if (inExclude && /^-\s*/.test(trimmed)) {
      commands[curCmd].exclude.push(trimmed.replace(/^-\s*/, "").trim().replace(/^["\x27]|["\x27]$/g, ""));
      continue;
    }
    if (!/^-/.test(trimmed)) inExclude = false;
  }

  // Minimal glob matcher: lefthook'"'"'s default (gobwas, no separators
  // configured) lets a bare `*` cross `/` the same as `**` does — confirmed
  // against this repository'"'"'s own lefthook.yml, whose `packages/web/**`
  // exclude only has an effect because the plain `*.{...}` glob above it
  // already reaches into that subtree.
  const expandBraces = (g) => {
    const m = /\{([^{}]+)\}/.exec(g);
    if (!m) return [g];
    const alts = m[1].split(",");
    const out = [];
    for (const a of alts) {
      for (const r of expandBraces(g.slice(0, m.index) + a + g.slice(m.index + m[0].length))) out.push(r);
    }
    return out;
  };
  // Memoized: the same glob string (a command'"'"'s `glob`, or an `exclude`/
  // `ignorePatterns` entry) recurs once per tracked file below, so compiling
  // it fresh each time would recompile identical globs file count times.
  const regexCache = new Map();
  const toRegexes = (glob) => {
    if (regexCache.has(glob)) return regexCache.get(glob);
    const compiled = expandBraces(glob).map((p) => {
      let re = "";
      let i = 0;
      while (i < p.length) {
        if (p.startsWith("**", i)) { re += ".*"; i += 2; continue; }
        const ch = p[i];
        if (ch === "*") re += ".*";
        else if (ch === "?") re += ".";
        else re += ch.replace(/[.^$+()|[\]\\]/g, "\\$&");
        i += 1;
      }
      return new RegExp("^" + re + "$");
    });
    regexCache.set(glob, compiled);
    return compiled;
  };
  const globMatches = (glob, path) => (glob ? toRegexes(glob).some((re) => re.test(path)) : false);
  // A directory-prefix entry with no wildcard (e.g. "dist", "packages/web")
  // covers itself and everything under it, the same shape lefthook'"'"'s own
  // `exclude:` and a tool'"'"'s `ignorePatterns` both use for bare names.
  const ignoreMatches = (pattern, path) => {
    if (/[*?{]/.test(pattern)) return globMatches(pattern, path);
    return path === pattern || path.startsWith(pattern.replace(/\/$/, "") + "/");
  };

  let tracked = [];
  try {
    tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) { tracked = []; }

  const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } };
  const readJSONC = (p) => {
    try { return require(process.argv[1]).readJSONC(p); } catch (e) { return null; }
  };
  const TOOL_CONFIGS = {
    oxfmt: { path: ".oxfmtrc.json", read: readJSON },
    oxlint: { path: ".oxlintrc.json", read: readJSONC },
  };

  const bad = [];
  for (const [name, c] of Object.entries(commands)) {
    const tool = /oxfmt/.test(c.run || name) ? "oxfmt" : /oxlint/.test(c.run || name) ? "oxlint" : null;
    if (!tool || !c.glob) continue;
    const cfg = TOOL_CONFIGS[tool];
    const parsed = cfg.read(cfg.path);
    const ignorePatterns = (parsed && Array.isArray(parsed.ignorePatterns)) ? parsed.ignorePatterns : [];
    if (ignorePatterns.length === 0) continue;
    for (const f of tracked) {
      if (!globMatches(c.glob, f)) continue;
      if (c.exclude.some((ex) => ignoreMatches(ex, f))) continue;
      if (ignorePatterns.some((pat) => ignoreMatches(pat, f))) bad.push(name + ":" + f);
    }
  }
  process.stdout.write([...new Set(bad)].sort().join(" "));
' "$SELF_DIR/jsonc.cjs" 2>/dev/null)"
[ -z "$HOOK5_RESULT" ] &&
  ok "STD-HOOK-5" "no pre-commit glob reduces to a set the tool fully ignores" ||
  bad "STD-HOOK-5" "no pre-commit glob reduces to a set the tool fully ignores" \
    "glob matches a file the tool's own ignorePatterns also covers, with no lefthook exclude: $HOOK5_RESULT"

# STD-DEP-1: shared build and test tooling pinned to the same range. The
# baseline names which deps count as "shared build and test tooling" — the
# linter, formatter, test runner, compiler, hook manager, unused-dep checker,
# and @types/node — and records rill's own range for each. Repo-specific
# runtime deps (e.g. rill-config's `semver`) are deliberately not in that set;
# this element is about the tools the ecosystem shares, not every devDependency
# a repository happens to declare.
if baseline_gate "STD-DEP-1" "shared build and test tooling pinned to the same range"; then
  EXP_TOOLING="$(baseline_json sharedTooling)"
  DEP1_MISMATCH="$(node -e '
    const fs = require("fs");
    let pkg; try { pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); } catch (e) { pkg = {}; }
    const have = Object.assign({}, pkg.dependencies, pkg.devDependencies,
      pkg.peerDependencies, pkg.optionalDependencies);
    const want = JSON.parse(process.argv[1] || "{}") ?? {};
    const out = [];
    for (const [name, range] of Object.entries(want)) {
      if (have[name] === undefined) out.push(name + ": not declared");
      else if (have[name] !== range) out.push(name + ": " + have[name] + " vs " + range);
    }
    process.stdout.write(out.join("; "));
  ' "$EXP_TOOLING")"
  [ -z "$DEP1_MISMATCH" ] &&
    ok "STD-DEP-1" "shared build and test tooling pinned to the same range" ||
    bad "STD-DEP-1" "shared build and test tooling pinned to the same range" "$DEP1_MISMATCH"
fi

# STD-DEP-2: one compiler major across the ecosystem. Read from the root
# manifest's own `typescript` devDependency; a repository declaring none has
# nothing to compare and is reported unchecked rather than guessed at.
TS_RANGE="$(node -p "((require('./package.json').devDependencies)||{}).typescript || ((require('./package.json').dependencies)||{}).typescript || ''" 2>/dev/null)"
TS_MAJOR="$(printf '%s' "$TS_RANGE" | sed -nE 's/^[^0-9]*([0-9]+).*/\1/p')"
if [ -z "$TS_MAJOR" ]; then
  skip "STD-DEP-2" "one compiler major across the ecosystem" \
    "no typescript dependency declared in package.json"
elif baseline_gate "STD-DEP-2" "one compiler major across the ecosystem"; then
  EXP_TS_MAJOR="$(baseline_str typescriptMajor)"
  [ "$TS_MAJOR" = "$EXP_TS_MAJOR" ] &&
    ok "STD-DEP-2" "one compiler major across the ecosystem (typescript $TS_MAJOR)" ||
    bad "STD-DEP-2" "one compiler major across the ecosystem" \
      "typescript major is $TS_MAJOR, ecosystem pin is $EXP_TS_MAJOR"
fi

# STD-DEP-3: a tool incompatible with the current compiler major is handled by
# a scoped nested override, never a whole-workspace downgrade. Decided from the
# tree, not the baseline: this is about whether THIS repository's own override
# shape is scoped, which needs no comparison to rill at all. No override
# anywhere is this element's own N/A — nothing conflicts with the pinned
# compiler major. pnpm reads workspace-wide overrides from two places
# depending on major: `pnpm.overrides` in package.json (older) and a top-level
# `overrides:` block in pnpm-workspace.yaml (newer); either is a candidate.
# `>` in an override key is pnpm's syntax for a scoped, nested override
# (dependency-of-dependency); a bare package name overrides it everywhere,
# which is the whole-workspace downgrade this element forbids.
PKG_OVERRIDE_KEYS="$(node -p "Object.keys(((require('./package.json').pnpm)||{}).overrides||{}).join('\n')" 2>/dev/null)"
WS_OVERRIDE_KEYS=""
if [ -f pnpm-workspace.yaml ] && grep -q '^overrides:' pnpm-workspace.yaml; then
  # A one-line structured read, not an awk scan: the block-start match requires
  # the rest of the line to be blank or a comment (so a trailing comment on
  # `overrides:` itself doesn't confuse the scan), quoted keys are captured
  # verbatim so a colon inside one doesn't truncate the key, and a line
  # without a colon before the first unquoted `#` (block-scalar content, a
  # blank line) is skipped rather than misread as a key.
  WS_OVERRIDE_KEYS="$(node -e '
    const fs = require("fs");
    let text = "";
    try { text = fs.readFileSync("pnpm-workspace.yaml", "utf8"); } catch (e) { text = ""; }
    let inBlock = false;
    const keys = [];
    for (const raw of text.split("\n")) {
      if (!inBlock) {
        if (/^overrides:\s*(#.*)?$/.test(raw)) inBlock = true;
        continue;
      }
      if (raw.trim() === "") continue;
      if (/^\S/.test(raw)) break;
      const m = raw.match(/^\s*(?:\x27([^\x27]+)\x27|"([^"]+)"|([^\s\x27"#][^:]*?))\s*:/);
      if (m) keys.push(m[1] || m[2] || m[3]);
    }
    process.stdout.write(keys.join("\n"));
  ' 2>/dev/null)"
fi
ALL_OVERRIDE_KEYS="$(printf '%s\n%s\n' "$PKG_OVERRIDE_KEYS" "$WS_OVERRIDE_KEYS" | grep -v '^$')"
if [ -z "$ALL_OVERRIDE_KEYS" ]; then
  skip "STD-DEP-3" "incompatible tool handled by a scoped nested override" \
    "N/A: no tool conflicts with the current compiler major"
else
  UNSCOPED_OVERRIDES="$(printf '%s\n' "$ALL_OVERRIDE_KEYS" | grep -v '>' | tr '\n' ' ')"
  [ -z "$UNSCOPED_OVERRIDES" ] &&
    ok "STD-DEP-3" "incompatible tool handled by a scoped nested override" ||
    bad "STD-DEP-3" "incompatible tool handled by a scoped nested override" \
      "whole-workspace override, not scoped with '>': $UNSCOPED_OVERRIDES"
fi

# STD-DEP-4: test runner declared consistently — either in every package or in
# none, relying on root resolution. Cross-package, not cross-repository, so
# this is decided from the tree under test alone. Read literally: presence is
# binary across PKG_DIRS, not "wherever declared, versions agree" — a package
# with its own bundler config still resolves a hoisted root install by Node's
# ordinary upward node_modules walk, so a local devDependency entry is
# redundant, not load-bearing, and does not earn an exception from the text.
# Version drift is checked too, inside the "every package declares it" branch
# only: it is a defect that binary presence alone cannot see, but it does not
# replace the binary reading, since a repository is non-conformant on
# structure alone regardless of whether the versions happen to agree.
if [ "$WORKSPACE" -eq 0 ]; then
  skip "STD-DEP-4" "test runner declared consistently" "N/A: the repository is a single package"
else
  DEP4_RESULT="$(node -e '
    const fs = require("fs");
    const KNOWN = ["vitest", "jest", "mocha", "ava", "tape", "uvu"];
    const load = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return {}; } };
    const has = (m, name) => Boolean((m.dependencies || {})[name] || (m.devDependencies || {})[name]);
    const range = (m, name) => (m.dependencies || {})[name] || (m.devDependencies || {})[name];
    const root = load("package.json");
    const dirs = process.argv.slice(1);
    const pkgs = dirs.map((d) => load(d + "/package.json"));
    for (const name of KNOWN) {
      const rootHas = has(root, name);
      const declaring = dirs.filter((d, i) => has(pkgs[i], name));
      const missing = dirs.filter((d, i) => !has(pkgs[i], name));
      if (!rootHas && declaring.length === 0) continue; // not used at all
      if (declaring.length === 0) { console.log("ok-none " + name); process.exit(0); }
      if (missing.length > 0) {
        console.log("bad-mixed " + name + " declares=" + declaring.join(",") +
          " relies-on-root=" + missing.join(","));
        process.exit(0);
      }
      // Every package declares it. Version drift is a second, additive check:
      // compare each package range to the first packages own range, not to
      // root, since "every package" means root resolution plays no part here.
      const base = range(pkgs[0], name);
      const drift = dirs.filter((d, i) => range(pkgs[i], name) !== base);
      if (drift.length > 0) {
        console.log("bad-drift " + name + " " + dirs.map((d, i) => d + "=" + range(pkgs[i], name)).join(" "));
        process.exit(0);
      }
      console.log("ok-every " + name);
      process.exit(0);
    }
    console.log("none");
  ' "${PKG_DIRS[@]}" 2>/dev/null)"
  DEP4_RESULT="${DEP4_RESULT:-none}"
  set -f
  set -- $DEP4_RESULT
  set +f
  DEP4_KIND="$1"
  DEP4_NAME="${2:-}"
  [ $# -ge 2 ] && shift 2 || shift $#
  case "$DEP4_KIND" in
    ok-none)
      ok "STD-DEP-4" "test runner declared consistently (none; $DEP4_NAME resolves from root)" ;;
    ok-every)
      ok "STD-DEP-4" "test runner declared consistently (every package declares $DEP4_NAME)" ;;
    bad-mixed)
      bad "STD-DEP-4" "test runner declared consistently" \
        "$DEP4_NAME declared in some packages, relied on root resolution in others: $*" ;;
    bad-drift)
      bad "STD-DEP-4" "test runner declared consistently" \
        "$DEP4_NAME declared in every package but at drifted ranges: $*" ;;
    *)
      skip "STD-DEP-4" "test runner declared consistently" \
        "no recognised test runner dependency found in this workspace" ;;
  esac
fi

# STD-DEP-5: cross-repository peer ranges track the current published version.
# The baseline's publishedVersions map is the current published version for
# each package this ecosystem's peer ranges point at; only @rcrsr/* peer
# dependencies count, and only the workspace-external kind. A `workspace:`
# range never resolves through the registry, so a package pinning its sibling
# that way (packages/service on @rcrsr/rill, here) is the root consuming
# itself, not a cross-repository peer dependency — the same distinction
# STD-CI-9's CONSUMES walk already draws.
PEER_LINES="$(node -e '
  const fs = require("fs");
  const load = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return {}; } };
  const dirs = ["."].concat(process.argv.slice(1));
  const out = [];
  for (const d of dirs) {
    const p = load((d === "." ? "" : d + "/") + "package.json");
    for (const [name, r] of Object.entries(p.peerDependencies || {})) {
      if (name.startsWith("@rcrsr/") && !String(r).startsWith("workspace:")) out.push(name + " " + r);
    }
  }
  process.stdout.write(out.join("\n"));
' "${PKG_DIRS[@]}")"
if [ -z "$PEER_LINES" ]; then
  skip "STD-DEP-5" "cross-repository peer ranges track the current published version" \
    "N/A: no cross-repository peer dependency"
elif baseline_gate "STD-DEP-5" "cross-repository peer ranges track the current published version"; then
  EXP_VERSIONS="$(baseline_json publishedVersions)"
  # Tracks the published version by major.minor, not the exact patch: a `~`
  # or `^` peer range names the release its author last verified against, and
  # a patch bump on the pinned package is exactly the case such a range is
  # written to keep tracking without an edit.
  PEER_MISMATCH="$(node -e '
    const versions = JSON.parse(process.argv[1] || "{}") ?? {};
    const lines = process.argv[2].split("\n").filter(Boolean);
    const majorMinor = (v) => (String(v).match(/(\d+)\.(\d+)/) || []).slice(1, 3).join(".");
    const out = [];
    const unresolved = [];
    for (const line of lines) {
      const [name, range] = line.split(/ (.*)/s);
      if (!(name in versions)) { unresolved.push(name); continue; }
      if (majorMinor(range) !== majorMinor(versions[name])) {
        out.push(name + ": peer " + range + " vs published " + versions[name]);
      }
    }
    process.stdout.write(JSON.stringify({ mismatch: out, unresolved, checked: lines.length - unresolved.length }));
  ' "$EXP_VERSIONS" "$PEER_LINES")"
  PM_CHECKED="$(printf '%s' "$PEER_MISMATCH" | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).checked))')"
  PM_BAD="$(printf '%s' "$PEER_MISMATCH" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).mismatch.join("; "))')"
  if [ "$PM_CHECKED" -eq 0 ]; then
    skip "STD-DEP-5" "cross-repository peer ranges track the current published version" \
      "no baseline pin for the peer dependency this repository declares"
  elif [ -z "$PM_BAD" ]; then
    ok "STD-DEP-5" "cross-repository peer ranges track the current published version"
  else
    bad "STD-DEP-5" "cross-repository peer ranges track the current published version" "$PM_BAD"
  fi
fi

# ---------------------------------------------------------------------------
printf '\n'
TOTAL=$((PASS + FAIL))
# Stamped on both verdicts. The element counts move between checker versions --
# 0.1.1 took the tree-only set from 55 to 56 -- so a count reported without the
# version that produced it cannot be compared against another repository's.
STAMP=""
[ -n "$SELF_VERSION" ] && STAMP="  $(dim "(rill-dev $SELF_VERSION)")"
# --list is a catalogue, not a gate: the header promises it prints every
# element this script covers, and every probe above still ran to produce a
# real verdict for each row. Exiting non-zero here would make `--list` behave
# like a second invocation of the check itself, which is not what the header
# documents and not what a caller piping the catalogue through a pager wants.
if [ "$LIST" -eq 1 ]; then
  printf '%s  %d elements listed (%d ok, %d bad, %d not machine-checkable).%s\n' \
    "$(dim 'CATALOGUE')" "$((TOTAL + SKIP))" "$PASS" "$FAIL" "$SKIP" "$STAMP"
  exit 0
fi
if [ "$FAIL" -eq 0 ]; then
  printf '%s  %d checked, %d passed, %d not machine-checkable.%s\n' \
    "$(green 'CONFORMANT')" "$TOTAL" "$PASS" "$SKIP" "$STAMP"
  printf '%s\n' "$(dim 'A green run covers only the elements above. The skipped ones still apply.')"
  exit 0
fi
printf '%s  %d of %d checked elements failed: %s%s\n' \
  "$(red 'NON-CONFORMANT')" "$FAIL" "$TOTAL" "$(printf '%s ' "${FAILED_IDS[@]}")" "$STAMP"
printf '%s\n' "$(dim 'See https://github.com/rcrsr/rill/blob/main/packages/dev/REPO-STANDARDS.md for what each element requires and why.')"
exit 1
