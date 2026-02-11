#!/bin/bash
set -e

# Rill Manual Release Script
# Builds all packages, runs tests, publishes to npm, and creates git tags

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions for colored output
error() {
  echo -e "${RED}ERROR: $1${NC}" >&2
  exit 1
}

info() {
  echo -e "${GREEN}INFO: $1${NC}"
}

warn() {
  echo -e "${YELLOW}WARN: $1${NC}"
}

# Step 1: Verify we're in the project root
if [ ! -f "pnpm-workspace.yaml" ]; then
  error "Must run from project root (pnpm-workspace.yaml not found)"
fi

# Step 2: Verify clean working directory
if [ -n "$(git status --porcelain)" ]; then
  error "Working directory not clean. Commit or stash changes before release"
fi

# Step 3: Verify on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  warn "Not on main branch (currently on $CURRENT_BRANCH)"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Step 4: Verify version consistency
info "Verifying version consistency..."
./scripts/check-versions.sh || error "Version mismatch detected"

# Step 5: Build all packages
info "Building all packages..."
pnpm run -r build || error "Build failed"

# Step 6: Run tests
info "Running tests..."
pnpm run -r test || error "Tests failed"

# Step 7: Discover publishable packages
PACKAGES=()
for dir in packages/core packages/cli packages/ext/*/; do
  dir="${dir%/}"
  [ -f "$dir/package.json" ] || continue
  PRIVATE=$(node -p "require('./$dir/package.json').private || false")
  [ "$PRIVATE" = "true" ] && continue
  NAME=$(node -p "require('./$dir/package.json').name")
  PACKAGES+=("$dir:$NAME")
done

# Step 8: Verify all packages have publishConfig.access: "public"
info "Verifying publish configuration..."
for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="${pkg%%:*}"
  PKG_NAME="${pkg##*:}"

  if [ ! -f "$PKG_DIR/package.json" ]; then
    error "Package directory not found: $PKG_DIR"
  fi

  # Check for publishConfig.access
  if ! grep -q '"access": "public"' "$PKG_DIR/package.json"; then
    error "Package $PKG_NAME missing publishConfig.access: \"public\" in $PKG_DIR/package.json"
  fi
done

info "All packages have publishConfig.access: \"public\""

# Step 9: Confirm before publishing
VERSION=$(node -p "require('./package.json').version")
echo
info "Ready to publish the following packages at v$VERSION:"
for pkg in "${PACKAGES[@]}"; do
  PKG_NAME="${pkg##*:}"
  echo "  - $PKG_NAME@$VERSION"
done

echo
read -p "Proceed with publish? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  info "Release cancelled"
  exit 0
fi

# Step 10: Publish packages
info "Publishing packages..."
for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="${pkg%%:*}"
  PKG_NAME="${pkg##*:}"

  if npm view "${PKG_NAME}@${VERSION}" version &>/dev/null; then
    warn "$PKG_NAME@$VERSION already published, skipping"
    continue
  fi

  info "Publishing $PKG_NAME@$VERSION..."
  cd "$PKG_DIR"
  npm publish --access public || error "Failed to publish $PKG_NAME"
  cd - > /dev/null

  info "Published $PKG_NAME@$VERSION successfully"
done

# Step 11: Create git tags
info "Creating git tags..."
for pkg in "${PACKAGES[@]}"; do
  PKG_NAME="${pkg##*:}"
  TAG="${PKG_NAME}@${VERSION}"

  if git tag -l "$TAG" | grep -q "$TAG"; then
    warn "Tag $TAG already exists, skipping"
  else
    git tag -a "$TAG" -m "Release $TAG"
    info "Created tag $TAG"
  fi
done

# Step 12: Push tags
echo
read -p "Push tags to remote? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  info "Pushing tags..."
  git push --tags || error "Failed to push tags"
  info "Tags pushed successfully"
else
  info "Tags created locally but not pushed. Push manually with: git push --tags"
fi

echo
info "Release completed successfully!"
info "Published packages:"
for pkg in "${PACKAGES[@]}"; do
  PKG_NAME="${pkg##*:}"
  echo "  - $PKG_NAME@$VERSION"
done
