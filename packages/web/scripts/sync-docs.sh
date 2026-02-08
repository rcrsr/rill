#!/usr/bin/env bash
# sync-docs.sh — Transform docs/*.md into Hugo content structure
# Run from packages/web/

set -euo pipefail

DOCS_DIR="$(cd "$(dirname "$0")/../../../docs" && pwd)"
CONTENT_DIR="$(cd "$(dirname "$0")/.." && pwd)/content/docs"

# Clean generated docs (preserve _index.md files)
find "$CONTENT_DIR" -name '*.md' ! -name '_index.md' -delete 2>/dev/null || true

# File mapping: source-prefix → target-dir/target-name weight
declare -A FILE_MAP=(
  ["guide-getting-started"]="guide/getting-started 1"
  ["guide-examples"]="guide/examples 2"
  ["guide-conventions"]="guide/conventions 3"
  ["cookbook"]="guide/cookbook 4"
  ["topic-types"]="language/types 1"
  ["topic-variables"]="language/variables 2"
  ["topic-control-flow"]="language/control-flow 3"
  ["topic-operators"]="language/operators 4"
  ["topic-closures"]="language/closures 5"
  ["topic-design-principles"]="language/design-principles 6"
  ["topic-collections"]="data/collections 1"
  ["topic-iterators"]="data/iterators 2"
  ["topic-strings"]="data/strings 3"
  ["integration-host"]="integration/host 1"
  ["integration-extensions"]="integration/extensions 2"
  ["integration-modules"]="integration/modules 3"
  ["integration-cli"]="integration/cli 4"
  ["bundled-extensions"]="integration/bundled-extensions 5"
  ["extension-claude-code"]="integration/extension-claude-code 6"
  ["ref-language"]="reference/language 1"
  ["ref-host-api"]="reference/host-api 2"
  ["ref-errors"]="reference/errors 3"
)

# Link rewrite map: source filename → Hugo path
declare -A LINK_MAP=(
  ["guide-getting-started.md"]="/docs/guide/getting-started/"
  ["guide-examples.md"]="/docs/guide/examples/"
  ["guide-conventions.md"]="/docs/guide/conventions/"
  ["cookbook.md"]="/docs/guide/cookbook/"
  ["topic-types.md"]="/docs/language/types/"
  ["topic-variables.md"]="/docs/language/variables/"
  ["topic-control-flow.md"]="/docs/language/control-flow/"
  ["topic-operators.md"]="/docs/language/operators/"
  ["topic-closures.md"]="/docs/language/closures/"
  ["topic-design-principles.md"]="/docs/language/design-principles/"
  ["topic-collections.md"]="/docs/data/collections/"
  ["topic-iterators.md"]="/docs/data/iterators/"
  ["topic-strings.md"]="/docs/data/strings/"
  ["integration-host.md"]="/docs/integration/host/"
  ["integration-extensions.md"]="/docs/integration/extensions/"
  ["integration-modules.md"]="/docs/integration/modules/"
  ["integration-cli.md"]="/docs/integration/cli/"
  ["bundled-extensions.md"]="/docs/integration/bundled-extensions/"
  ["extension-claude-code.md"]="/docs/integration/extension-claude-code/"
  ["ref-language.md"]="/docs/reference/language/"
  ["ref-host-api.md"]="/docs/reference/host-api/"
  ["ref-errors.md"]="/docs/reference/errors/"
  ["ref-grammar.ebnf"]="/ref-grammar.ebnf"
  ["index.md"]="/docs/"
)

process_file() {
  local src="$1"
  local basename
  basename="$(basename "$src" .md)"

  # Skip index.md
  [[ "$basename" == "index" ]] && return

  local mapping="${FILE_MAP[$basename]:-}"
  [[ -z "$mapping" ]] && { echo "WARN: No mapping for $basename, skipping"; return; }

  local target_path="${mapping% *}"
  local weight="${mapping#* }"
  local target_file="$CONTENT_DIR/${target_path}.md"

  # Extract title from first H1 line, strip leading "rill " prefix
  local title
  title="$(head -1 "$src" | sed 's/^# //;s/^rill //')"

  # Extract description from italic subtitle (line 3)
  local description
  description="$(sed -n '3p' "$src" | sed 's/^\*//;s/\*$//')"

  # Create target directory
  mkdir -p "$(dirname "$target_file")"

  # Build content: frontmatter + body (skip H1 and subtitle lines)
  {
    echo "---"
    echo "title: \"$title\""
    echo "description: \"$description\""
    echo "weight: $weight"
    echo "---"
    # Skip first 3 lines (H1, blank, subtitle) and the blank line after subtitle
    tail -n +4 "$src" | sed '1{/^$/d;}'
  } > "$target_file"

  # Rewrite internal links
  for link_src in "${!LINK_MAP[@]}"; do
    local link_target="${LINK_MAP[$link_src]}"
    # Replace markdown links: (filename.md) → (hugo-path)
    sed -i "s|(${link_src})|(${link_target})|g" "$target_file"
    # Replace markdown links with anchors: (filename.md#anchor) → (hugo-path#anchor)
    sed -i "s|(${link_src}#|(${link_target}#|g" "$target_file"
  done

  echo "  $basename → $target_path"
}

echo "Syncing docs from $DOCS_DIR to $CONTENT_DIR"

for src in "$DOCS_DIR"/*.md; do
  process_file "$src"
done

# Generate section _index.md link lists from synced pages
generate_section_links() {
  local section_dir="$1"
  local index_file="$section_dir/_index.md"
  [[ -f "$index_file" ]] || return

  # Extract frontmatter (first --- through second ---, inclusive)
  local frontmatter
  frontmatter="$(awk '/^---$/{n++; print; if(n==2) exit; next} n>=1{print}' "$index_file")"

  # Collect child pages as links
  local links=""
  for child in "$section_dir"/*.md; do
    [[ "$(basename "$child")" == "_index.md" ]] && continue
    [[ -f "$child" ]] || continue
    local child_title child_desc child_slug
    child_title="$(grep '^title:' "$child" | head -1 | sed 's/^title: *"//;s/"$//')"
    child_desc="$(grep '^description:' "$child" | head -1 | sed 's/^description: *"//;s/"$//')"
    child_slug="$(basename "$child" .md)"
    links="${links}- [${child_title}](${child_slug}/) — ${child_desc}\n"
  done

  # Rewrite _index.md: frontmatter + links
  {
    echo "$frontmatter"
    echo ""
    echo -e "$links"
  } > "${index_file}.tmp"
  mv "${index_file}.tmp" "$index_file"
}

for section_dir in "$CONTENT_DIR"/*/; do
  generate_section_links "$section_dir"
done

# Copy grammar file as static download
cp "$DOCS_DIR/ref-grammar.ebnf" "$(cd "$(dirname "$0")/.." && pwd)/static/ref-grammar.ebnf" 2>/dev/null || true

echo "Done: $(find "$CONTENT_DIR" -name '*.md' ! -name '_index.md' | wc -l) docs synced"
