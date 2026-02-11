#!/bin/bash
set -e

# Verify all publishable packages share the same version as root package.json.
# Usage: ./scripts/check-versions.sh
# Exit code 0 = all consistent, 1 = mismatch found.

ROOT_VERSION=$(node -p "require('./package.json').version")
ERRORS=0

for pkg in packages/core packages/cli packages/ext/*/; do
  pkg="${pkg%/}"  # strip trailing slash
  [ -f "$pkg/package.json" ] || continue

  # Skip private packages
  PRIVATE=$(node -p "require('./$pkg/package.json').private || false")
  [ "$PRIVATE" = "true" ] && continue

  NAME=$(node -p "require('./$pkg/package.json').name")
  VERSION=$(node -p "require('./$pkg/package.json').version")

  if [ "$VERSION" != "$ROOT_VERSION" ]; then
    echo "MISMATCH: $NAME is $VERSION (expected $ROOT_VERSION)" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS version mismatch(es). Root version: $ROOT_VERSION" >&2
  exit 1
fi

echo "All publishable packages at v$ROOT_VERSION"
