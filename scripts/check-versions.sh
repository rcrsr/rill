#!/bin/bash
set -e

# Verify all publishable packages share the same major.minor as root package.json.
# Packages may have different patch versions.
# Usage: ./scripts/check-versions.sh
# Exit code 0 = all aligned, 1 = mismatch found.

# Strict MAJOR.MINOR.PATCH parse. A bare `sed 's/\.[0-9]*$//'` split on a
# prerelease/build version (0.21.0-rc.1) strips only the trailing numeric
# group, leaving "0.21.0-rc" as the reported major.minor -- wrong, and silent
# about why. Versions carrying a `-` prerelease or `+` build suffix are
# reported explicitly instead of being fed through the numeric split.
version_major_minor() {
  case "$1" in
    *-* | *+*)
      return 1
      ;;
    *)
      echo "$1" | sed 's/\.[0-9]*$//'
      return 0
      ;;
  esac
}

ROOT_VERSION=$(node -p "require('./package.json').version")
ERRORS=0

if ! ROOT_MAJOR_MINOR=$(version_major_minor "$ROOT_VERSION"); then
  echo "MISMATCH: root version $ROOT_VERSION carries a prerelease/build suffix; major.minor comparison is not defined for it" >&2
  exit 1
fi

for pkg in packages/core packages/service; do
  pkg="${pkg%/}"
  [ -f "$pkg/package.json" ] || continue

  NAME=$(node -p "require('./$pkg/package.json').name")
  VERSION=$(node -p "require('./$pkg/package.json').version")
  if ! PKG_MAJOR_MINOR=$(version_major_minor "$VERSION"); then
    echo "MISMATCH: $NAME is $VERSION, which carries a prerelease/build suffix (expected ${ROOT_MAJOR_MINOR}.x)" >&2
    ERRORS=$((ERRORS + 1))
    continue
  fi

  if [ "$PKG_MAJOR_MINOR" != "$ROOT_MAJOR_MINOR" ]; then
    echo "MISMATCH: $NAME is $VERSION (expected ${ROOT_MAJOR_MINOR}.x)" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

# packages/service may be absent (e.g. a checkout that only ships core); the
# loop above already skips missing manifests via `[ -f ... ] || continue`, so
# the equality check below must skip too rather than unconditionally
# require()-ing a manifest that may not exist, which would abort under set -e
# with a raw Node MODULE_NOT_FOUND instead of this script's own message.
if [ -f packages/core/package.json ] && [ -f packages/service/package.json ]; then
  CORE_VERSION=$(node -p "require('./packages/core/package.json').version")
  SERVICE_VERSION=$(node -p "require('./packages/service/package.json').version")
  if [ "$SERVICE_VERSION" != "$CORE_VERSION" ]; then
    echo "MISMATCH: service $SERVICE_VERSION != core $CORE_VERSION (exact-equality required)" >&2
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "SKIP: core/service exact-version check (one or both manifests absent)" >&2
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS version mismatch(es). Root major.minor: $ROOT_MAJOR_MINOR" >&2
  exit 1
fi

echo "All publishable packages at ${ROOT_MAJOR_MINOR}.x (root: $ROOT_VERSION)"
