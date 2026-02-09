#!/usr/bin/env bash
# inject-version.sh — Write core package version into Hugo data file
# Run from packages/web/

set -euo pipefail

WEB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CORE_PKG="$WEB_DIR/../core/package.json"

VERSION="$(node -p "require('$CORE_PKG').version")"

mkdir -p "$WEB_DIR/data"
printf '{"version": "%s"}\n' "$VERSION" > "$WEB_DIR/data/version.json"

echo "Injected version: $VERSION"
