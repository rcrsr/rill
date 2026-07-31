#!/usr/bin/env bash
#
# Copy the shared dev assets in this directory into a target repository.
#
#   dev/apply.sh <target-repo>            copy, overwriting the target's copies
#   dev/apply.sh --check <target-repo>    report drift, change nothing
#
# Nothing here is published or installable. Repositories hold a copy and this
# script is how the copy is made and kept honest. `--check` is what a target
# repo runs in CI to fail on drift.
#
# Exit codes: 0 in sync or copied, 1 drift found (--check), 2 usage error.

set -euo pipefail

# Assets to propagate, relative to this directory. A target ends up with
# dev/<asset> for each. Add to this list when a new shared asset appears.
ASSETS=(
  lint-rules
  REPO-STANDARDS.md
  bootstrap.sh
)

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Files inside an asset that belong to this repository only and must never be
# copied. node_modules can appear if someone installs inside dev/.
EXCLUDES=(--exclude 'node_modules' --exclude '.DS_Store')

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^#\s\?//'
  exit 2
}

CHECK=0
TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    -h | --help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *)
      [ -n "$TARGET" ] && { echo "unexpected argument: $1" >&2; usage; }
      TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || usage
[ -d "$TARGET" ] || { echo "not a directory: $TARGET" >&2; exit 2; }

TARGET="$(cd "$TARGET" && pwd)"

if [ "$TARGET" = "$(dirname "$SRC_DIR")" ]; then
  echo "target is this repository; nothing to copy." >&2
  exit 0
fi

command -v rsync >/dev/null 2>&1 || {
  echo "rsync is required but not installed." >&2
  exit 2
}

DRIFT=0
for asset in "${ASSETS[@]}"; do
  src="$SRC_DIR/$asset"
  dst="$TARGET/dev/$asset"

  [ -e "$src" ] || { echo "missing source asset: $src" >&2; exit 2; }

  # Trailing slash on a directory source copies its contents, so the target
  # mirrors the source rather than nesting a second level.
  if [ -d "$src" ]; then src="$src/"; fi

  if [ "$CHECK" -eq 1 ]; then
    # --itemize-changes with --dry-run lists what would change. Empty means
    # in sync. --delete catches files the target has and the source dropped.
    out="$(rsync -rlpgoDc --dry-run --itemize-changes --delete \
      "${EXCLUDES[@]}" "$src" "$dst" 2>/dev/null || true)"
    if [ -n "$out" ]; then
      DRIFT=1
      echo "DRIFT  dev/$asset"
      printf '%s\n' "$out" | sed 's/^/         /'
    else
      echo "ok     dev/$asset"
    fi
  else
    mkdir -p "$(dirname "$dst")"
    rsync -rlpgoDc --delete "${EXCLUDES[@]}" "$src" "$dst"
    echo "copied dev/$asset"
  fi
done

if [ "$CHECK" -eq 1 ]; then
  if [ "$DRIFT" -eq 1 ]; then
    echo >&2
    echo "Target is out of sync with rill's dev/ assets." >&2
    echo "Re-apply from the rill checkout:  dev/apply.sh $TARGET" >&2
    exit 1
  fi
  echo "in sync."
  exit 0
fi

cat <<EOF

Copied into $TARGET/dev/

Next, in the target repository:
  1. Point .oxlintrc.json at the plugin:
       "jsPlugins": ["./dev/lint-rules/index.js"]
  2. Enable the rule for shipped source:
       { "files": ["packages/*/src/**/*.{ts,tsx}"],
         "rules": { "rill/no-spec-id-reference": "error" } }
  3. Add a drift check to CI so the copy cannot rot silently.
     See dev/README.md.
EOF
