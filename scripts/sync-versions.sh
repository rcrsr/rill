#!/bin/bash
set -e

# Sync major.minor from root package.json to all workspace packages.
# Preserves each package's patch version.
# Usage: ./scripts/sync-versions.sh

ROOT_VERSION=$(node -p "require('./package.json').version")
ROOT_MAJOR_MINOR=$(echo "$ROOT_VERSION" | sed 's/\.[0-9]*$//')
UPDATED=0

for pkg in packages/core packages/rill-config packages/cli; do
  pkg="${pkg%/}"
  [ -f "$pkg/package.json" ] || continue

  CURRENT=$(node -p "require('./$pkg/package.json').version")
  CURRENT_MAJOR_MINOR=$(echo "$CURRENT" | sed 's/\.[0-9]*$//')
  CURRENT_PATCH=$(echo "$CURRENT" | sed 's/.*\.//')

  if [ "$CURRENT_MAJOR_MINOR" != "$ROOT_MAJOR_MINOR" ]; then
    NEW_VERSION="${ROOT_MAJOR_MINOR}.${CURRENT_PATCH}"
    node -e "
      const fs = require('fs');
      const path = './$pkg/package.json';
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
      pkg.version = '$NEW_VERSION';
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
    "
    NAME=$(node -p "require('./$pkg/package.json').name")
    echo "  $NAME: $CURRENT -> $NEW_VERSION"
    UPDATED=$((UPDATED + 1))
  fi
done

if [ "$UPDATED" -eq 0 ]; then
  echo "All packages already at ${ROOT_MAJOR_MINOR}.x"
else
  echo "Updated $UPDATED package(s) to ${ROOT_MAJOR_MINOR}.x"
fi
