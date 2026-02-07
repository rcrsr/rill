# rill Content Parsing

*Built-in functions for extracting structured data from text, optimized for LLM output*

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

---

## Auto-Detection with `parse_auto`

Automatically detects format and extracts structured content:

```rill
$response -> parse_auto => $result

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

```rill
"{{\"count\": 42}}" -> parse_auto
# type: "json", data: [count: 42]
```

```rill
"<answer>42</answer>" -> parse_auto
# type: "xml", data: [answer: "42"]
```

```rill
"- [ ] Todo\n- [x] Done" -> parse_auto
# type: "checklist", data: [[false, "Todo"], [true, "Done"]]

# Frontmatter
"---\ntitle: Doc\n---\nBody" -> parse_auto
# type: "frontmatter", data: [meta: [title: "Doc"], body: "Body"]
```

### Confidence Checking

Use confidence scores to handle ambiguous responses:

```rill
prompt("Analyze this data") -> parse_auto => $parsed

($parsed.confidence < 0.8) ? {
  "Low confidence parse: {$parsed.type}" -> log
  # Fall back to manual handling
}
```

---

## JSON Parsing

### `parse_json`

Parses JSON with automatic error repair for common LLM formatting issues:

```rill
"{{\"name\": \"test\", \"count\": 42}}" -> parse_json
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

```rill
# LLM returns JSON with common errors
prompt("Return user data as JSON") -> parse_json => $user

# Safe access with defaults
$user.name ?? "Unknown"
$user.age ?? 0
```

---

## XML Parsing

### `parse_xml`

Extract content from XML tags. Useful for chain-of-thought prompting:

```rill
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

```rill
"""
Analyze this problem step by step.

<thinking>
Show your reasoning here
</thinking>

<answer>
Return your final answer as JSON
</answer>
""" => $prompt_text

app::prompt($prompt_text) => $response

# Log reasoning for debugging
$response -> parse_xml("thinking") -> log

# Parse structured answer
$response -> parse_xml("answer") -> parse_json => $result
```

### Tool Calling Pattern

```text
"""
You have access to tools. To call a tool, use:
<tool>
  <name>tool_name</name>
  <args>{"param": "value"}</args>
</tool>
""" -> app::prompt() => $response

$response -> parse_xml("tool") => $tool
$tool -> parse_xml("name") => $fn_name
$tool -> parse_xml("args") -> parse_json => $fn_args

# Call the function dynamically (host-provided)
app::call($fn_name, $fn_args)
```

---

## Fenced Code Blocks

### `parse_fence`

Extract content from markdown fenced code blocks:

```rill
# Extract by language
$response -> parse_fence("json") -> parse_json
# Extracts ```json block, parses as JSON

# Extract first fence (any language)
$response -> parse_fence
# Returns content of first fenced block
```

### `parse_fences`

Extract all fenced code blocks:

```rill
prompt("Show examples in Python and JavaScript") -> parse_fences -> each {
  "{$.lang}:" -> log
  $.content -> log
}
# Returns list of [lang: "python", content: "..."], [lang: "javascript", content: "..."]
```

### Practical Usage

```rill
# ...
# Parse fenced JSON from LLM response
# prompt("Generate JSON") -> parse_fence("json") -> parse_json => $config
# $config.host -> log
```

---

## Frontmatter Parsing

### `parse_frontmatter`

Parse YAML frontmatter delimited by `---`:

```rill
"---\ntitle: Hello\n---\nBody text" => $doc
$doc -> parse_frontmatter
# Returns [meta: [title: "Hello"], body: "Body text"]
```

Destructure into variables:

```rill
"---\ntitle: Hello\n---\nBody text" => $doc
$doc -> parse_frontmatter -> *<meta: $m, body: $b>
$m.title -> log
```

### Practical Usage

```rill
# Parse frontmatter from document
"---\ntitle: My Doc\nstatus: draft\n---\nContent here" -> parse_frontmatter => $doc

$doc.meta.title -> log
($doc.meta.status ?? "") -> .eq("draft") ? { "Document is still a draft" -> log }
$doc.body -> log
```

---

## Checklist Parsing

### `parse_checklist`

Parse markdown task list items:

```rill
"- [ ] Buy milk\n- [x] Call mom" -> parse_checklist
# Returns [[false, "Buy milk"], [true, "Call mom"]]
```

Each item is a tuple: `[completed: bool, text: string]`

### Practical Usage

```rill
"- [ ] Deploy\n- [x] Test" -> parse_checklist => $tasks
$tasks -> .len
```

---

## Validation Patterns

### Type Checking

```text
app::prompt("Return JSON with status and items") -> parse_auto => $result

($result.type != "json") ? {
  app::error("Expected JSON response, got {$result.type}")
}

$result.data -> app::process()
```

### Required Fields

```text
app::prompt("Return user profile as JSON") -> parse_json => $user

# Validate required fields exist
($user.?name && $user.?email) ? {
  app::create_account($user)
} ! {
  app::error("Missing required fields")
}
```

### Retry on Parse Failure

```text
^(limit: 3) @ {
  app::prompt("Generate valid JSON for a user profile")
} ? (parse_json($) -> type != "dict")

# Loop exits when valid dict is returned
parse_json($) => $profile
```

---

## Combining Parsers

Chain parsers for complex extraction:

```rill
# ...
# Extract JSON from a fenced block
# $response -> parse_fence("json") -> parse_json => $data

# Extract XML answer, parse as JSON
# $response -> parse_xml("answer") -> parse_json => $result

# Parse frontmatter, then parse body as checklist
# $doc -> parse_frontmatter => $parsed
# $parsed.body -> parse_checklist => $tasks
```

---

## Best Practices

1. **Use `parse_auto` for unknown formats** — Let it detect the structure
2. **Use specific parsers when format is known** — More predictable results
3. **Check confidence for ambiguous content** — Handle low-confidence parses specially
4. **Chain parsers for nested structures** — XML containing JSON, frontmatter with checklists
5. **Validate before using** — Check type and required fields exist

---

## Limitations

These parsers handle common LLM output patterns with zero external dependencies. For full-featured parsing (nested YAML, XML attributes, streaming JSON), host applications can register their own functions via `RuntimeContext`.

### YAML Parser

The YAML parser handles **flat `key: value` format only**:

```text
# Supported
title: My Document
count: 42
enabled: true

# NOT supported (returns raw string or fails)
nested:
  child: value
items:
  - one
  - two
multiline: |
  long text
  across lines
```

### JSON Repair

Repairs common LLM errors but **cannot fix**:

| Repaired | Not Repaired |
|----------|--------------|
| Trailing commas | Missing commas between items |
| Single quotes on values | Malformed string escapes |
| Unquoted keys | Truncated mid-string |
| Unclosed braces | Invalid Unicode |

### XML Parser

Extracts simple `<tag>content</tag>` but **does not support**:

- Attribute extraction (`<tag attr="val">` — attr ignored)
- Nested same-name tags (`<item><item>...</item></item>`)
- CDATA sections, namespaces, self-closing tags

---

## See Also

- [Reference](ref-language.md) — Language specification
- [Strings](topic-strings.md) — String methods for text manipulation
- [Cookbook](cookbook.md) — LLM integration patterns
