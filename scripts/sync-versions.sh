#!/bin/bash
set -e

# Sync major.minor from root package.json to publishable packages (core, service).
# Preserves each package's patch version.
# Usage: ./scripts/sync-versions.sh

# Strict MAJOR.MINOR.PATCH parse. A bare `sed 's/\.[0-9]*$//'` /
# `sed 's/.*\.//'` split on a prerelease/build version (0.21.0-rc.1) yields
# major.minor "0.21.0-rc" and patch "1" -- and would go on to silently write
# "0.21.1", dropping the prerelease suffix entirely. Refuse instead: a version
# carrying a `-` prerelease or `+` build suffix aborts with a named error
# rather than being rewritten.
assert_plain_version() {
  case "$1" in
    *-* | *+*)
      echo "ERROR: $2 version $1 carries a prerelease/build suffix; sync-versions.sh does not rewrite it. Bump it by hand." >&2
      exit 1
      ;;
  esac
}

ROOT_VERSION=$(node -p "require('./package.json').version")
assert_plain_version "$ROOT_VERSION" "root"
ROOT_MAJOR_MINOR=$(echo "$ROOT_VERSION" | sed 's/\.[0-9]*$//')
UPDATED=0

for pkg in packages/core packages/service; do
  pkg="${pkg%/}"
  [ -f "$pkg/package.json" ] || continue

  CURRENT=$(node -p "require('./$pkg/package.json').version")
  assert_plain_version "$CURRENT" "$pkg"
  CURRENT_MAJOR_MINOR=$(echo "$CURRENT" | sed 's/\.[0-9]*$//')
  CURRENT_PATCH=$(echo "$CURRENT" | sed 's/.*\.//')

  if [ "$CURRENT_MAJOR_MINOR" != "$ROOT_MAJOR_MINOR" ]; then
    NEW_VERSION="${ROOT_MAJOR_MINOR}.${CURRENT_PATCH}"
    NEW_VERSION="$NEW_VERSION" PKG_PATH="./$pkg/package.json" node -e "
      const fs = require('fs');
      const path = process.env.PKG_PATH;
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
      pkg.version = process.env.NEW_VERSION;
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
    "
    NAME=$(node -p "require('./$pkg/package.json').name")
    echo "  $NAME: $CURRENT -> $NEW_VERSION"
    UPDATED=$((UPDATED + 1))
  fi
done

# Service version is held exactly equal to core (not just major.minor).
# Guarded: the loop above already tolerates a missing manifest via
# `[ -f ... ] || continue`, so this unconditional require() would otherwise
# abort under set -e with a raw Node MODULE_NOT_FOUND the moment either
# packages/core or packages/service is absent from the checkout.
if [ -f packages/core/package.json ] && [ -f packages/service/package.json ]; then
  CORE_VERSION=$(node -p "require('./packages/core/package.json').version")
  assert_plain_version "$CORE_VERSION" "packages/core"
  SERVICE_CURRENT=$(node -p "require('./packages/service/package.json').version")
  if [ "$SERVICE_CURRENT" != "$CORE_VERSION" ]; then
    CORE_VERSION="$CORE_VERSION" PKG_PATH="./packages/service/package.json" node -e "
      const fs = require('fs');
      const path = process.env.PKG_PATH;
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
      pkg.version = process.env.CORE_VERSION;
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
    "
    echo "  @rcrsr/rill-language-service: $SERVICE_CURRENT -> $CORE_VERSION"
    UPDATED=$((UPDATED + 1))
  fi
else
  echo "  skip: core/service exact-version sync (one or both manifests absent)"
fi

if [ "$UPDATED" -eq 0 ]; then
  echo "All packages already at ${ROOT_MAJOR_MINOR}.x"
else
  echo "Updated $UPDATED package(s) to ${ROOT_MAJOR_MINOR}.x"
fi
