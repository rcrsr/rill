#!/bin/bash
set -e

# Verify all publishable packages share the same major.minor as root package.json.
# Packages may have different patch versions.
# Usage: ./scripts/check-versions.sh
# Exit code 0 = all aligned, 1 = mismatch found.

ROOT_VERSION=$(node -p "require('./package.json').version")
ROOT_MAJOR_MINOR=$(echo "$ROOT_VERSION" | sed 's/\.[0-9]*$//')
ERRORS=0

for pkg in packages/core; do
  pkg="${pkg%/}"
  [ -f "$pkg/package.json" ] || continue

  NAME=$(node -p "require('./$pkg/package.json').name")
  VERSION=$(node -p "require('./$pkg/package.json').version")
  PKG_MAJOR_MINOR=$(echo "$VERSION" | sed 's/\.[0-9]*$//')

  if [ "$PKG_MAJOR_MINOR" != "$ROOT_MAJOR_MINOR" ]; then
    echo "MISMATCH: $NAME is $VERSION (expected ${ROOT_MAJOR_MINOR}.x)" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS version mismatch(es). Root major.minor: $ROOT_MAJOR_MINOR" >&2
  exit 1
fi

echo "All publishable packages at ${ROOT_MAJOR_MINOR}.x (root: $ROOT_VERSION)"
