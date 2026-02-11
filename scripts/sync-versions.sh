#!/bin/bash
set -e

# Sync version from root package.json to all workspace packages.
# Usage: ./scripts/sync-versions.sh

ROOT_VERSION=$(node -p "require('./package.json').version")
UPDATED=0

for pkg in packages/core packages/cli packages/web packages/fiddle packages/ext/*/; do
  pkg="${pkg%/}"
  [ -f "$pkg/package.json" ] || continue

  CURRENT=$(node -p "require('./$pkg/package.json').version")
  if [ "$CURRENT" != "$ROOT_VERSION" ]; then
    node -e "
      const fs = require('fs');
      const path = './$pkg/package.json';
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
      pkg.version = '$ROOT_VERSION';
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
    "
    NAME=$(node -p "require('./$pkg/package.json').name")
    echo "  $NAME: $CURRENT -> $ROOT_VERSION"
    UPDATED=$((UPDATED + 1))
  fi
done

if [ "$UPDATED" -eq 0 ]; then
  echo "All packages already at v$ROOT_VERSION"
else
  echo "Updated $UPDATED package(s) to v$ROOT_VERSION"
fi
