#!/usr/bin/env bash
# sync-docs.sh — Transform docs/*.md into Hugo content structure
# Run from packages/web/

set -euo pipefail

DOCS_DIR="$(cd "$(dirname "$0")/../../../docs" && pwd)"
CONTENT_DIR="$(cd "$(dirname "$0")/.." && pwd)/content/docs"

# Wipe and recreate content/docs/ from scratch
rm -rf "$CONTENT_DIR"
mkdir -p "$CONTENT_DIR"

# Section definitions: key → "title|description|weight"
declare -A SECTION_MAP=(
  ["guide"]="Guide|Getting started with rill — tutorials, examples, and conventions|1"
  ["language"]="Language|rill language topics — types, variables, control flow, operators, closures|2"
  ["data"]="Data & Collections|Working with data in rill — collections, iterators, strings, parsing|3"
  ["integration"]="Integration|Embedding rill in applications — host API, extensions, modules, CLI|4"
  ["extensions"]="Bundled Extensions|Pre-built extensions shipped with rill|5"
  ["reference"]="Reference|rill reference documentation — language spec, host API, errors|6"
)

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
  ["extension-anthropic"]="extensions/anthropic 1"
  ["extension-claude-code"]="extensions/claude-code 2"
  ["extension-gemini"]="extensions/gemini 3"
  ["extension-openai"]="extensions/openai 4"
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
  ["bundled-extensions.md"]="/docs/extensions/"
  ["extension-claude-code.md"]="/docs/extensions/claude-code/"
  ["extension-anthropic.md"]="/docs/extensions/anthropic/"
  ["extension-openai.md"]="/docs/extensions/openai/"
  ["extension-gemini.md"]="/docs/extensions/gemini/"
  ["ref-language.md"]="/docs/reference/language/"
  ["ref-host-api.md"]="/docs/reference/host-api/"
  ["ref-errors.md"]="/docs/reference/errors/"
  ["ref-grammar.ebnf"]="/ref-grammar.ebnf"
  ["index.md"]="/docs/"
)

echo "Syncing docs from $DOCS_DIR to $CONTENT_DIR"

# Generate docs hub _index.md
cat > "$CONTENT_DIR/_index.md" << 'EOF'
---
title: Documentation
description: "rill language documentation — guides, references, and integration"
weight: 1
---

Scripting designed for machine-generated code.

{{< cards >}}
  {{< card link="guide" title="Guide" subtitle="Getting started, examples, and conventions" >}}
  {{< card link="language" title="Language" subtitle="Types, variables, control flow, operators, closures" >}}
  {{< card link="data" title="Data & Collections" subtitle="Iterators, strings, parsing, collection operators" >}}
  {{< card link="integration" title="Integration" subtitle="Host embedding, modules, CLI" >}}
  {{< card link="extensions" title="Bundled Extensions" subtitle="Pre-built extensions shipped with rill" >}}
  {{< card link="reference" title="Reference" subtitle="Language spec, host API, error reference" >}}
{{< /cards >}}
EOF

# Generate section _index.md files from SECTION_MAP
for section in "${!SECTION_MAP[@]}"; do
  IFS='|' read -r title description weight <<< "${SECTION_MAP[$section]}"
  local_dir="$CONTENT_DIR/$section"
  mkdir -p "$local_dir"
  cat > "$local_dir/_index.md" << SEOF
---
title: "$title"
description: "$description"
weight: $weight
sidebar:
  open: true
---
SEOF
done

# Promote bundled-extensions.md to extensions section _index.md
bundled_src="$DOCS_DIR/bundled-extensions.md"
if [[ -f "$bundled_src" ]]; then
  ext_index="$CONTENT_DIR/extensions/_index.md"
  body="$(tail -n +4 "$bundled_src" | sed '1{/^$/d;}')"
  cat > "$ext_index" << BEOF
---
title: "Bundled Extensions"
description: "Pre-built extensions shipped with rill"
weight: 5
sidebar:
  open: true
---
${body}
BEOF
  # Rewrite internal links
  sed_script=""
  for link_src in "${!LINK_MAP[@]}"; do
    link_target="${LINK_MAP[$link_src]}"
    escaped_src="${link_src//./\\.}"
    sed_script+="s|(${escaped_src})|(${link_target})|g;"
    sed_script+="s|(${escaped_src}#|(${link_target}#|g;"
  done
  sed -i "$sed_script" "$ext_index"
  echo "  bundled-extensions → extensions/_index.md (promoted)"
fi

# Process source docs into Hugo content
process_file() {
  local src="$1"
  local basename
  basename="$(basename "$src" .md)"

  # Skip index.md and bundled-extensions (promoted to _index.md)
  [[ "$basename" == "index" || "$basename" == "bundled-extensions" ]] && return

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
    echo "title: \"${title//\"/\\\"}\""
    echo "description: \"${description//\"/\\\"}\""
    echo "weight: $weight"
    echo "---"
    # Skip first 3 lines (H1, blank, subtitle) and the blank line after subtitle
    tail -n +4 "$src" | sed '1{/^$/d;}'
  } > "$target_file"

  # Rewrite internal links (single sed pass per file)
  local sed_script=""
  for link_src in "${!LINK_MAP[@]}"; do
    local link_target="${LINK_MAP[$link_src]}"
    local escaped_src="${link_src//./\\.}"
    sed_script+="s|(${escaped_src})|(${link_target})|g;"
    sed_script+="s|(${escaped_src}#|(${link_target}#|g;"
  done
  sed -i "$sed_script" "$target_file"

  echo "  $basename → $target_path"
}

for src in "$DOCS_DIR"/*.md; do
  process_file "$src"
done

# Append child link lists to section _index.md files
generate_section_links() {
  local section_dir="$1"
  local index_file="$section_dir/_index.md"
  [[ -f "$index_file" ]] || return

  # Skip extensions — promoted _index.md has its own curated content
  [[ "$(basename "$section_dir")" == "extensions" ]] && return

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

  # Append links to _index.md
  {
    echo ""
    echo -e "$links"
  } >> "$index_file"
}

for section_dir in "$CONTENT_DIR"/*/; do
  generate_section_links "$section_dir"
done

# Copy static assets
cp "$DOCS_DIR/ref-grammar.ebnf" "$(cd "$(dirname "$0")/.." && pwd)/static/ref-grammar.ebnf" 2>/dev/null || true
cp "$DOCS_DIR/ref-llm.txt" "$(cd "$(dirname "$0")/.." && pwd)/static/llms-full.txt" 2>/dev/null || true

echo "Done: $(find "$CONTENT_DIR" -name '*.md' ! -name '_index.md' | wc -l) docs synced"
