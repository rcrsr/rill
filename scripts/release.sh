#!/bin/bash
set -e

# Rill Release Script
# Validates, creates a version tag, and pushes to trigger CI release

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

error() { echo -e "${RED}ERROR: $1${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}INFO: $1${NC}"; }
warn() { echo -e "${YELLOW}WARN: $1${NC}"; }

# Verify project root
[ -f "pnpm-workspace.yaml" ] || error "Must run from project root"

# Verify clean working directory
[ -z "$(git status --porcelain)" ] || error "Working directory not clean"

# Verify on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  warn "Not on main branch (currently on $CURRENT_BRANCH)"
  read -p "Continue anyway? (y/N) " -n 1 -r; echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# Verify version consistency
info "Verifying version consistency..."
./scripts/check-versions.sh || error "Version mismatch detected"

# Build and test locally
info "Building all packages..."
pnpm run -r build || error "Build failed"

info "Running tests..."
pnpm run -r test || error "Tests failed"

# Extract version and confirm
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

if git tag -l "$TAG" | grep -q "$TAG"; then
  error "Tag $TAG already exists"
fi

echo
info "Ready to tag and push $TAG"
info "CI will publish packages after push"
echo
read -p "Create tag and push? (y/N) " -n 1 -r; echo
[[ $REPLY =~ ^[Yy]$ ]] || { info "Release cancelled"; exit 0; }

# Create and push tag
git tag -a "$TAG" -m "Release $TAG"
info "Created tag $TAG"

git push origin "$TAG" || error "Failed to push tag"
info "Pushed $TAG — CI release triggered"
