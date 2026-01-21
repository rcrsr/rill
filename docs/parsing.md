# Content Parsing

Built-in functions for extracting structured data from text, optimized for LLM output.

## Overview

| Function | Purpose |
|----------|---------|
| `parse_auto` | Auto-detect format and extract structured content |
| `parse_json` | Parse JSON with error repair |
| `parse_xml` | Extract content from XML tags |
| `parse_fence` | Extract fenced code block content |
| `parse_fences` | Extract all fenced code blocks |
| `parse_frontmatter` | Parse YAML frontmatter and body |
| `parse_checklist` | Parse markdown checkbox items |

## Auto-Detection with `parse_auto`

Automatically detects format and extracts structured content:

```text
$response -> parse_auto -> $result

# $result contains:
#   type: "json" | "xml" | "yaml" | "frontmatter" | "fence" | "checklist" | "text"
#   data: <parsed structured data>
#   raw: <original extracted content>
#   confidence: <0.0-1.0 detection confidence>
#   repaired: <true if error recovery applied>
```

### Detection Priority

| Priority | Format | Detection Signal |
|----------|--------|------------------|
| 1 | frontmatter | Starts with `---\n` |
| 2 | fence (json/yaml) | ` ```json ` or ` ```yaml ` blocks |
| 3 | fence (other) | ` ```lang ` blocks |
| 4 | xml | `<tag>...</tag>` structure |
| 5 | json | `{...}` or `[...]` with balanced braces |
| 6 | checklist | `- [ ]` or `- [x]` patterns |
| 7 | yaml | `key: value` line patterns (2+ lines) |
| 8 | text | Fallback (returns trimmed input) |

### Examples

```text
# JSON in fenced code block
"Here's the data:\n```json\n{\"count\": 42}\n```" -> parse_auto
# type: "json", data: [count: 42], confidence: 0.98

# XML tags
"<thinking>Step 1</thinking><answer>42</answer>" -> parse_auto
# type: "xml", data: [thinking: "Step 1", answer: "42"]

# Raw JSON with surrounding text
"The result is {\"status\": \"ok\"}." -> parse_auto
# type: "json", data: [status: "ok"], confidence: 0.85

# Checklist
"- [ ] Todo\n- [x] Done" -> parse_auto
# type: "checklist", data: [[false, "Todo"], [true, "Done"]]

# Frontmatter
"---\ntitle: Doc\n---\nBody" -> parse_auto
# type: "frontmatter", data: [meta: [title: "Doc"], body: "Body"]
```

### Confidence Checking

Use confidence scores to handle ambiguous responses:

```text
prompt("Analyze this data") -> parse_auto -> $parsed

($parsed.confidence < 0.8) ? {
  "Low confidence parse: {$parsed.type}" -> log
  # Fall back to manual handling
}
```

## JSON Parsing

### `parse_json`

Parses JSON with automatic error repair for common LLM formatting issues:

```text
"{name: 'test', count: 42,}" -> parse_json
# Returns [name: "test", count: 42]
```

### Error Repair

| Error | Repair |
|-------|--------|
| Trailing commas | Removed |
| Single quotes | Converted to double quotes |
| Unquoted keys | Quoted |
| Unclosed braces | Closed (best effort) |

### Practical Usage

```text
# LLM returns JSON with common errors
prompt("Return user data as JSON") -> parse_json -> $user

# Safe access with defaults
$user.name ?? "Unknown"
$user.age ?? 0
```

## XML Parsing

### `parse_xml`

Extract content from XML tags. Useful for chain-of-thought prompting:

```text
# Extract single tag
$response -> parse_xml("thinking")
# Returns content between <thinking>...</thinking>

# Extract and parse nested content
$response -> parse_xml("answer") -> parse_json
# Extract <answer> tag, parse its content as JSON

# Extract all tags as dict
$response -> parse_xml
# Returns [tag1: "content1", tag2: "content2", ...]
```

### Chain-of-Thought Pattern

```text
prompt(<<EOF
Analyze this problem step by step.

<thinking>
Show your reasoning here
</thinking>

<answer>
Return your final answer as JSON
</answer>
EOF
) -> $response

# Log reasoning for debugging
$response -> parse_xml("thinking") -> log

# Parse structured answer
$response -> parse_xml("answer") -> parse_json -> $result
```

### Tool Calling Pattern

```text
prompt(<<EOF
You have access to tools. To call a tool, use:
<tool>
  <name>tool_name</name>
  <args>{"param": "value"}</args>
</tool>
EOF
) -> $response

$response -> parse_xml("tool") -> $tool
$tool -> parse_xml("name") -> $fn_name
$tool -> parse_xml("args") -> parse_json -> $fn_args

# Call the function dynamically
call($fn_name, $fn_args)
```

## Fenced Code Blocks

### `parse_fence`

Extract content from markdown fenced code blocks:

```text
# Extract by language
$response -> parse_fence("json") -> parse_json
# Extracts ```json block, parses as JSON

# Extract first fence (any language)
$response -> parse_fence
# Returns content of first fenced block
```

### `parse_fences`

Extract all fenced code blocks:

```text
prompt("Show examples in Python and JavaScript") -> parse_fences -> each {
  "{$.lang}:" -> log
  $.content -> log
}
# Returns list of [lang: "python", content: "..."], [lang: "javascript", content: "..."]
```

### Practical Usage

```text
# LLM returns code in a fenced block
prompt("Generate a JSON config") -> parse_fence("json") -> parse_json -> $config

$config.host -> log
$config.port -> log
```

## Frontmatter Parsing

### `parse_frontmatter`

Parse YAML frontmatter delimited by `---`:

```text
$doc -> parse_frontmatter
# Returns [meta: [key: value, ...], body: "..."]

# Destructure into variables
$doc -> parse_frontmatter -> *<meta: $m, body: $b>
$m.title -> log
$b -> process()
```

### Practical Usage

```text
# LLM returns document with metadata
prompt("Generate a document with title and status in frontmatter") -> parse_frontmatter -> $doc

$doc.meta.title -> log
$doc.meta.status -> ?(.eq("draft")) {
  "Document is still a draft" -> log
}
$doc.body -> save_content()
```

## Checklist Parsing

### `parse_checklist`

Parse markdown task list items:

```text
"- [ ] Buy milk\n- [x] Call mom" -> parse_checklist
# Returns [[false, "Buy milk"], [true, "Call mom"]]
```

Each item is a tuple: `[completed: bool, text: string]`

### Practical Usage

```text
# LLM returns task list
prompt("Create a deployment checklist") -> parse_checklist -> $tasks

# Filter incomplete tasks
$tasks -> filter { !$.0 } -> each {
  "TODO: {$.1}" -> log
}

# Filter completed tasks
$tasks -> filter { $.0 } -> each {
  "DONE: {$.1}" -> log
}
```

## Validation Patterns

### Type Checking

```text
prompt("Return JSON with status and items") -> parse_auto -> $result

($result.type != "json") ? {
  error("Expected JSON response, got {$result.type}")
}

$result.data -> process()
```

### Required Fields

```text
prompt("Return user profile as JSON") -> parse_json -> $user

# Validate required fields exist
($user.?name && $user.?email) ? {
  create_account($user)
} ! {
  error("Missing required fields")
}
```

### Retry on Parse Failure

```text
^(limit: 3) @ {
  prompt("Generate valid JSON for a user profile")
} ? (parse_json($) -> type != "dict")

# Loop exits when valid dict is returned
parse_json($) -> $profile
```

## Combining Parsers

Chain parsers for complex extraction:

```text
# Extract JSON from a fenced block
$response -> parse_fence("json") -> parse_json -> $data

# Extract XML answer, parse as JSON
$response -> parse_xml("answer") -> parse_json -> $result

# Parse frontmatter, then parse body as checklist
$doc -> parse_frontmatter -> $parsed
$parsed.body -> parse_checklist -> $tasks
```

## Best Practices

1. **Use `parse_auto` for unknown formats** — Let it detect the structure
2. **Use specific parsers when format is known** — More predictable results
3. **Check confidence for ambiguous content** — Handle low-confidence parses specially
4. **Chain parsers for nested structures** — XML containing JSON, frontmatter with checklists
5. **Validate before using** — Check type and required fields exist
