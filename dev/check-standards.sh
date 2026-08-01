#!/usr/bin/env bash
#
# Mechanically enforce the elements of dev/REPO-STANDARDS.md that a script can
# decide from the repository itself.
#
#   dev/check-standards.sh            check the repository this script sits in
#   dev/check-standards.sh --list     print every element this script covers
#   dev/check-standards.sh --remote   also check host settings, needs gh auth
#
# Wire it up with `"check:standards": "bash dev/check-standards.sh"` and call it
# from the root `check` script.
#
# Scope, deliberately narrow. This covers the elements with a deterministic
# answer readable from the tree. Elements needing judgement are NOT checked and
# are not silently treated as passing: --list marks them, and the summary counts
# them, so a green run never reads as full conformance.
#
# Host settings (§1, §13) need an authenticated API call, so they run only under
# --remote. Without it they are reported as unchecked, never as passing.
#
# Repository-agnostic: everything is derived from the tree, so the copy in each
# repository is byte-identical.
#
# Exit codes: 0 all checked elements pass, 1 at least one fails, 2 usage error.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# No `set -e` here, deliberately, so a failing cd would otherwise run every
# relative-path check against the caller's directory and print a page of
# misleading results instead of one error.
cd "$ROOT" || { echo "cannot cd to $ROOT" >&2; exit 2; }

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

# ok <id> <description> — record a pass.
ok() {
  PASS=$((PASS + 1))
  [ "$LIST" -eq 1 ] || printf '  %s %-14s %s\n' "$(green ok)" "$1" "$2"
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

WORKFLOWS=(.github/workflows/*.yml)
[ -e "${WORKFLOWS[0]}" ] || WORKFLOWS=()

pkg_field() { node -p "JSON.stringify((require('./package.json')$1)||null)" 2>/dev/null; }
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

# Every package manifest the repository owns, root included. A single-package
# repository publishes from the root and has no packages/ tree at all, so a walk
# that starts at packages/ sees nothing and every element derived from this list
# passes vacuously. WORKSPACE distinguishes the two layouts.
WORKSPACE=0
[ -f pnpm-workspace.yaml ] && grep -q '^packages:' pnpm-workspace.yaml && WORKSPACE=1

MANIFESTS=(package.json)
for f in packages/*/package.json packages/*/*/package.json; do
  [ -f "$f" ] && MANIFESTS+=("$f")
done

# Publishable package count. Several elements are N/A for a repository that
# publishes one package and so has no root-versus-package split to reconcile,
# so count once here rather than assuming either way. A workspace root is
# normally private and drops out on its own.
PUBLISHABLE=0
for f in "${MANIFESTS[@]}"; do
  node -e "process.exit(require('./$f').private?1:0)" 2>/dev/null && PUBLISHABLE=$((PUBLISHABLE + 1))
done

# ---------------------------------------------------------------------------
section "§1 Merge gates, §13 Repository settings"

if [ "$REMOTE" -eq 1 ]; then
  # Strip the .git suffix before taking the last two path segments; doing it in
  # one expression lets the optional group match inside the slug.
  SLUG="$(git remote get-url origin 2>/dev/null |
    sed -E 's#\.git$##' | sed -E 's#.*[:/]([^/]+/[^/]+)$#\1#')"
  SETTINGS=""
  PROT=""
  if [ -n "$SLUG" ] && command -v gh >/dev/null 2>&1; then
    SETTINGS="$(gh api "repos/$SLUG" 2>/dev/null)"
    PROT="$(gh api "repos/$SLUG/branches/main/protection" 2>/dev/null)"
    # A 404 still returns a body, so emptiness is not the test. Require the
    # response to carry the field every repository object has.
    node -p "try{JSON.parse(process.argv[1]).full_name?0:1}catch(e){1}" "$SETTINGS" 2>/dev/null |
      grep -q '^0$' || SETTINGS=""
    # Test .url, not .required_status_checks: a branch can be protected and
    # carry no required checks at all, which is exactly the STD-GATE-2 and
    # STD-GATE-4 failure this section exists to report. Keying readability on
    # that field converted the failure into "unreadable" and hid it.
    node -p "try{JSON.parse(process.argv[1]).url?0:1}catch(e){1}" "$PROT" 2>/dev/null |
      grep -q '^0$' || PROT=""
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

    if [ -n "$PROT" ]; then
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
    if [ -z "$PROT" ]; then
      skip "STD-GATE-2" "required contexts cover the matrix" "branch protection unreadable"
    elif ! visible "$(j "$PROT" '.required_status_checks')" ||
      [ "$(j "$PROT" '.required_status_checks.contexts.length')" = "0" ]; then
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
  # in this repository and versioned with it.
  UNPINNED="$(grep -hoE '^ *-? *uses: *[^ ]+' "${WORKFLOWS[@]}" 2>/dev/null |
    sed -E 's/.*uses: *//' | grep -v '^\./' | grep -vE '@[0-9a-f]{40}$' | sort -u | tr '\n' ' ')"
  [ -z "$UNPINNED" ] &&
    ok "STD-CI-8" "every action pinned to a SHA" ||
    bad "STD-CI-8" "every action pinned to a SHA" "unpinned: $UNPINNED"

  # The trailing comment is what dependabot reads to offer an upgrade.
  NOCOMMENT="$(grep -hnE 'uses: *[^ ]+@[0-9a-f]{40} *$' "${WORKFLOWS[@]}" 2>/dev/null | tr '\n' ' ')"
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
CONSUMES="$(node -e '
  const fs = require("fs");
  const names = new Set();
  for (const f of process.argv.slice(1)) {
    let p; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { continue; }
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const [n, v] of Object.entries(p[field] || {})) {
        if (n.startsWith("@rcrsr/") && !String(v).startsWith("workspace:")) names.add(n);
      }
    }
  }
  process.stdout.write([...names].join(" "));' "${MANIFESTS[@]}" 2>/dev/null)"

if [ -z "$CONSUMES" ]; then
  skip "STD-CI-9" "scheduled compatibility workflow" \
    "N/A: consumes no ecosystem package from the registry, i.e. the upstream root"
else
  # A workflow that runs on a schedule and names one of those packages.
  COMPAT=""
  for f in "${WORKFLOWS[@]}"; do
    grep -q '^ *schedule:' "$f" 2>/dev/null || continue
    for n in $CONSUMES; do
      grep -qF "$n" "$f" 2>/dev/null && COMPAT="$f" && break
    done
    [ -n "$COMPAT" ] && break
  done
  [ -n "$COMPAT" ] &&
    ok "STD-CI-9" "scheduled compatibility workflow covers $CONSUMES" ||
    bad "STD-CI-9" "scheduled compatibility workflow covers $CONSUMES" \
      "no scheduled workflow builds and tests against the latest $CONSUMES"
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
    // Two levels of packages/, the same depth the shell globs in this file walk,
    // so a nested package is not invisible to the expansion.
    const kids = (p) => { try { return fs.readdirSync(p).filter((n) => n !== "node_modules"); } catch (e) { return []; } };
    const found = ["."];
    for (const a of kids("packages")) {
      found.push("packages/" + a);
      for (const b of kids("packages/" + a)) found.push("packages/" + a + "/" + b);
    }
    const dirs = found.filter((d) => fs.existsSync(d + "/package.json"));
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
  ' 2>/dev/null)"

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
  CHK5_DIRS=()
  if [ "$WORKSPACE" -eq 1 ]; then
    for d in packages/*/ packages/*/*/; do CHK5_DIRS+=("${d%/}"); done
  else
    CHK5_DIRS=(.)
  fi

  UNTYPED=""
  for d in "${CHK5_DIRS[@]}"; do
    [ -f "$d/package.json" ] || continue
    has_ts "$d" || continue
    awk -v d="$d" '$1 == d && ($2 == "typecheck" || $0 ~ / tsc( |$)/) { hit = 1 }
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
  for d in packages/*/ packages/*/*/; do
    [ -f "$d/package.json" ] || continue
    has_ts "$d" || continue
    for s in build typecheck lint check; do
      node -e "process.exit(((require('./$d/package.json').scripts)||{})['$s']?0:1)" 2>/dev/null ||
        PKG_MISSING="${PKG_MISSING:-}$d:$s "
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

  # Naming a plugins array replaces the tool defaults, so unicorn is off unless
  # relisted. Its absence is the silent case STD-LINT-8 exists to catch.
  if grep -q '"plugins"' "$LINTRC"; then
    grep -A2 '"plugins"' "$LINTRC" | grep -q 'unicorn' &&
      ok "STD-LINT-8" "default-on plugins relisted explicitly" ||
      bad "STD-LINT-8" "default-on plugins relisted explicitly" \
        "plugins array does not list unicorn, which the CLI enables by default"
  fi

  # Lint scope must include tests/, checked at the call sites that run it.
  UNSCOPED=""
  for f in packages/*/package.json; do
    [ -f "$f" ] || continue
    L="$(node -p "((require('./$f').scripts)||{}).lint||''" 2>/dev/null)"
    [ -z "$L" ] && continue
    [ -d "$(dirname "$f")/tests" ] || continue
    case "$L" in *tests*) ;; *) UNSCOPED="$UNSCOPED$(dirname "$f") " ;; esac
  done
  [ -z "$UNSCOPED" ] &&
    ok "STD-LINT-4" "lint scope covers src/ and tests/" ||
    bad "STD-LINT-4" "lint scope covers src/ and tests/" "tests/ not linted in: $UNSCOPED"
else
  skip "STD-LINT-2,4,7,8" "lint configuration" "no $LINTRC in this repository"
fi
skip "STD-LINT-1" "shared linter and formatter" "cross-repository comparison"
skip "STD-LINT-3" "workflow-artifact rule enabled" "depends on a private planning directory"
skip "STD-LINT-5" "same plugin set as rill" "cross-repository comparison"
skip "STD-LINT-6" "disabled rules carry counts" "the comment is prose, not machine-checkable"
skip "STD-LINT-9" "shared rules carry the same severity" "cross-repository comparison"

# ---------------------------------------------------------------------------
section "§7 Release workflow"

REL=.github/workflows/release.yml
if [ ! -f "$REL" ]; then
  skip "STD-REL-1..7" "release workflow" "no release.yml; N/A if the repo publishes nothing"
else
  grep -q "tags:" "$REL" &&
    ok "STD-REL-1" "triggered by a version tag" ||
    bad "STD-REL-1" "triggered by a version tag" "no tag trigger in $REL"

  grep -q 'provenance' "$REL" &&
    ok "STD-REL-3" "publishes with provenance" ||
    bad "STD-REL-3" "publishes with provenance" "no --provenance in $REL"

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
  # The fallback tests for a comparison carrying a ref-derived and a
  # version-derived term on one line, so it reads the assertion rather than a
  # fixed string a file could be shaped around.
  if has_script check:versions; then
    grep -q 'check-versions\|check:versions' "$REL" &&
      ok "STD-REL-2" "version gate runs before publish" ||
      bad "STD-REL-2" "version gate runs before publish" "$REL never runs check:versions"
  else
    grep -qE '(if|\[\[?|test).*((REF|TAG|ref_name).*(VERSION|version)|(VERSION|version).*(REF|TAG|ref_name))' "$REL" &&
      ok "STD-REL-2" "publish gate compares the tag to the manifest version" ||
      bad "STD-REL-2" "publish gate compares the tag to the manifest version" \
        "$REL publishes without failing on a tag that disagrees with package.json"
  fi

  # Provenance binds to a source repository, so each published package needs it.
  # Read every manifest, root included: a single-package repository publishes
  # from the root, and walking only packages/ passes having checked nothing.
  NOREPO=""
  for f in "${MANIFESTS[@]}"; do
    node -e "
      const p=require('./$f');
      if (p.private) process.exit(0);
      process.exit(p.repository ? 0 : 1)" 2>/dev/null || NOREPO="$NOREPO$f "
  done
  [ -z "$NOREPO" ] &&
    ok "STD-REL-3" "published packages declare repository" ||
    bad "STD-REL-3" "published packages declare repository" \
      "provenance has no source to bind to in: $NOREPO"
fi

# ---------------------------------------------------------------------------
section "§8 Package manager, §9 Supply chain"

PM="$(pkg_field '.packageManager')"
[ "$PM" != "null" ] && [ "$PM" != "" ] && echo "$PM" | grep -q 'sha512' &&
  ok "STD-PM-1" "packageManager pinned with its hash" ||
  bad "STD-PM-1" "packageManager pinned with its hash" "packageManager=$PM"

[ "$(pkg_field '.engines.node')" != "null" ] &&
  ok "STD-PM-3" "engines.node declared" ||
  bad "STD-PM-3" "engines.node declared" "no engines.node"

[ "$(pkg_field '.engines.pnpm')" != "null" ] &&
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

# Workspace globs that match nothing are dead config. Only a repository that
# declares a workspace has any, so the single-package case is the stated N/A.
if [ "$WORKSPACE" -eq 1 ]; then
  DEAD=""
  while read -r glob; do
    [ -z "$glob" ] && continue
    # shellcheck disable=SC2086
    set -- $glob
    [ -e "$1" ] || DEAD="$DEAD$glob "
  done < <(grep -oE "^ *- *'[^']+'" pnpm-workspace.yaml | sed -E "s/^ *- *'//; s/'$//")
  [ -z "$DEAD" ] &&
    ok "STD-PM-7" "every workspace glob matches" ||
    bad "STD-PM-7" "every workspace glob matches" "matches nothing: $DEAD"
else
  skip "STD-PM-7" "every workspace glob matches" \
    "N/A: single package with no workspace file"
fi

# §9's install-time policies. These are NOT gated on a workspace: pnpm reads
# pnpm-workspace.yaml for settings whether or not it declares `packages:`, so a
# single-package repository holds the file for these keys alone. Gating them on
# a workspace made all three vanish from the accounting on every sibling repo,
# reported as neither ok, FAIL, nor --. A missing file is a FAIL, not a skip:
# STD-SUP-3 and STD-SUP-5 admit no N/A.
PNPMWS=pnpm-workspace.yaml
[ -f "$PNPMWS" ] || PNPMWS=/dev/null

grep -q '^minimumReleaseAge:' "$PNPMWS" &&
  ok "STD-SUP-3" "minimum release age set explicitly" ||
  bad "STD-SUP-3" "minimum release age set explicitly" \
    "not in pnpm-workspace.yaml; inheriting the major's default does not satisfy this"

grep -q '^trustPolicy:' "$PNPMWS" &&
  ok "STD-SUP-5" "dependency trust verified on install" ||
  bad "STD-SUP-5" "dependency trust verified on install" "no trustPolicy in pnpm-workspace.yaml"

# This one silently disables both of the above.
if grep -q '^trustLockfile: *true' "$PNPMWS"; then
  bad "STD-SUP-3" "supply-chain policies actually applied" \
    "trustLockfile: true skips re-applying minimumReleaseAge and trustPolicy"
else
  ok "STD-SUP-3" "supply-chain policies actually applied"
fi

# An exclusion pinned to an exact version goes stale every release.
PINNED="$(grep -A20 '^minimumReleaseAgeExclude:' "$PNPMWS" 2>/dev/null |
  grep -oE "^ *- *'[^']*@[0-9]+\.[0-9]+\.[0-9]+'" | tr '\n' ' ')"
[ -z "$PINNED" ] &&
  ok "STD-SUP-4" "exclusions do not need a hand edit each release" ||
  bad "STD-SUP-4" "exclusions do not need a hand edit each release" \
    "pinned to an exact version: $PINNED"

# Both ecosystems, not just actions. The npm half is the one that surfaces the
# dependency updates the repository actually consumes.
[ -f .github/dependabot.yml ] &&
  grep -qE "package-ecosystem: *['\"]?npm['\"]?" .github/dependabot.yml &&
  grep -qE "package-ecosystem: *['\"]?github-actions['\"]?" .github/dependabot.yml &&
  ok "STD-SUP-1" "dependabot covers npm and actions" ||
  bad "STD-SUP-1" "dependabot covers npm and actions" \
    "missing, or one ecosystem absent: needs a npm block and a github-actions block"

{ [ -f .github/workflows/codeql.yml ] && [ -f .github/workflows/dependency-review.yml ]; } &&
  ok "STD-SUP-6" "static analysis and dependency review" ||
  bad "STD-SUP-6" "static analysis and dependency review" "codeql.yml or dependency-review.yml missing"

{ [ -f .github/CODEOWNERS ] || [ -f CODEOWNERS ]; } &&
  ok "STD-SUP-7" "CODEOWNERS present" ||
  bad "STD-SUP-7" "CODEOWNERS present" "no CODEOWNERS"
skip "STD-PM-2" "same package manager version everywhere" "cross-repository comparison"
skip "STD-PM-6" "build allowlist in the expected location" "the location moves between majors"
skip "STD-SUP-2" "published packages carry provenance" "same as STD-REL-3, checked above"

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
skip "STD-PROC-7" "idempotent label-sync script" "the script's name is repo-specific"

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
skip "STD-DEP-1..5" "dependency versions" "cross-repository comparison"

# ---------------------------------------------------------------------------
printf '\n'
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  printf '%s  %d checked, %d passed, %d not machine-checkable.\n' \
    "$(green 'CONFORMANT')" "$TOTAL" "$PASS" "$SKIP"
  printf '%s\n' "$(dim 'A green run covers only the elements above. The skipped ones still apply.')"
  exit 0
fi
printf '%s  %d of %d checked elements failed: %s\n' \
  "$(red 'NON-CONFORMANT')" "$FAIL" "$TOTAL" "$(printf '%s ' "${FAILED_IDS[@]}")"
printf '%s\n' "$(dim 'See dev/REPO-STANDARDS.md for what each element requires and why.')"
exit 1
