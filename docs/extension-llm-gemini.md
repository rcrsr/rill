# gemini Extension

*Gemini API integration for rill scripts*

This extension allows rill scripts to access the Gemini API using the `@google/genai` SDK (preview). The host binds it to a namespace with `prefixFunctions('llm', ext)`, and scripts call `llm::message()`, `llm::embed()`, and so on. Switching to Anthropic or OpenAI means changing one line of host config. Scripts stay identical.

Six functions cover the core LLM operations. `message` sends a single prompt. `messages` continues a multi-turn conversation. `embed` and `embed_batch` generate vector embeddings. `tool_loop` runs an agentic loop where the model calls rill closures as tools. `generate` extracts structured data as a typed dict. `message`, `messages`, and `tool_loop` return the same dict shape (`content`, `model`, `usage`, `stop_reason`, `id`, `messages`), so scripts work across providers without changes. `generate` returns a separate shape with `data` and `raw` fields instead of `content` and `messages`. Google's API returns 0 for token counts and empty string for request IDs — see [Provider Notes](#provider-notes) for details.

The host sets API key, model, and temperature at creation time — scripts never handle credentials. Each call emits a structured event (`gemini:message`, `gemini:tool_call`) for host-side logging and metrics.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createGeminiExtension } from '@rcrsr/rill-ext-gemini';

const ext = createGeminiExtension({
  api_key: process.env.GEMINI_API_KEY!,
  model: 'gemini-2.0-flash',
});
const functions = prefixFunctions('gemini', ext);
const ctx = createRuntimeContext({ functions });

// Script: gemini::message("Explain TCP handshakes")
```

## Configuration

```typescript
const ext = createGeminiExtension({
  api_key: process.env.GEMINI_API_KEY!,
  model: 'gemini-2.0-flash',
  temperature: 0.7,
  max_tokens: 8192,
  system: 'You are a helpful assistant.',
  embed_model: 'text-embedding-004',
  base_url: 'https://custom-endpoint.example.com',
  max_retries: 3,
  timeout: 30000,
});
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `api_key` | string | — | API key (required) |
| `model` | string | — | Model identifier (required) |
| `temperature` | number | — | Response randomness, 0.0–2.0 |
| `max_tokens` | number | 8192 | Maximum response tokens |
| `system` | string | — | Default system prompt |
| `embed_model` | string | — | Model for embed operations |
| `base_url` | string | — | Custom API endpoint |
| `max_retries` | number | — | Retry attempts for failures |
| `timeout` | number | — | Request timeout in ms |

## Functions

**message(text, options?)** — Send a single prompt:

```rill
gemini::message("Explain TCP handshakes") => $result
$result.content      # Response text
$result.stop_reason  # Why generation stopped
$result.usage.input  # Input tokens
$result.usage.output # Output tokens
```

**messages(messages, options?)** — Multi-turn conversation:

```rill
[
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
] -> gemini::messages => $result
$result.content   # Latest response
$result.messages  # Full conversation history
```

**embed(text)** — Generate text embedding:

```rill
gemini::embed("sample text") => $vec
$vec -> .dimensions  # Vector size
$vec.model           # Embedding model used
```

**embed_batch(texts)** — Batch embeddings:

```rill
["first text", "second text"] -> gemini::embed_batch => $vectors
$vectors.len  # Number of vectors
```

**tool_loop(prompt, options?)** — Agentic tool-use loop:

```rill
tool("get_weather", "Get current weather", [city: "string"], {
  "Weather in {$city}: 72F sunny"
}) => $weather_tool

gemini::tool_loop("What's the weather in Paris?", [
  tools: [$weather_tool],
  max_turns: 5,
]) => $result
$result.content  # Final response
$result.turns    # Number of LLM round-trips
```

**generate(prompt, options)** — Structured output extraction:

```rill
[
  name: "string",
  confidence: "number",
  tags: "list",
] => $schema

gemini::generate("Extract metadata from: rill is a pipe-based scripting language", [
  schema: $schema,
  system: "Extract structured data from the input.",
]) => $result
$result.data.name        # Extracted name field
$result.data.confidence  # Extracted confidence field
$result.data.tags        # Extracted tags list
$result.raw              # Original JSON string from model
$result.stop_reason      # Why generation stopped
$result.usage.input      # Input tokens
$result.usage.output     # Output tokens
```

### Per-Call Options

| Option | Type | Applies To | Description |
|--------|------|-----------|-------------|
| `system` | string | message, messages, tool_loop, generate | Override system prompt |
| `max_tokens` | number | message, messages, tool_loop, generate | Override max tokens |
| `tools` | list | tool_loop (required) | Tool descriptors |
| `max_turns` | number | tool_loop | Limit LLM round-trips |
| `max_errors` | number | tool_loop | Consecutive error limit (default: 3) |
| `messages` | list | tool_loop, generate | Prepend conversation history |
| `schema` | dict | generate (required) | Field names mapped to type strings |

## Result Dict

All functions except `embed`, `embed_batch`, and `generate` return:

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Response text |
| `model` | string | Model identifier |
| `usage.input` | number | Input token count |
| `usage.output` | number | Output token count |
| `stop_reason` | string | Why generation stopped |
| `id` | string | Request identifier |
| `messages` | list | Conversation history |

The `tool_loop` result adds `turns` (number of LLM round-trips).

### Generate Result Dict

`generate` returns a separate dict shape:

| Field | Type | Description |
|-------|------|-------------|
| `data` | dict | Parsed JSON matching schema keys |
| `raw` | string | Original JSON string from model response |
| `model` | string | Provider model identifier |
| `usage.input` | number | Input token count |
| `usage.output` | number | Output token count |
| `stop_reason` | string | Provider stop reason string |
| `id` | string | Provider response ID |

## Error Behavior

**Validation errors** (before API call):

- Empty prompt → `RuntimeError RILL-R004: prompt text cannot be empty`
- Missing role → `RuntimeError RILL-R004: message missing required 'role' field`
- Invalid role → `RuntimeError RILL-R004: invalid role '{value}'`
- Missing content → `RuntimeError RILL-R004: {role} message requires 'content'`
- No embed_model → `RuntimeError RILL-R004: embed_model not configured`
- Missing tools → `RuntimeError RILL-R004: tool_loop requires 'tools' option`

**API errors** (from provider):

- Rate limit → `RuntimeError RILL-R004: Gemini: rate limit`
- Auth failure → `RuntimeError RILL-R004: Gemini: authentication failed (401)`
- Timeout → `RuntimeError RILL-R004: Gemini: request timeout`
- Other → `RuntimeError RILL-R004: Gemini: {detail} ({status})`

**Tool loop errors**:

- Unknown tool → `RuntimeError RILL-R004: unknown tool '{name}'`
- Error limit → `RuntimeError RILL-R004: tool loop aborted after {n} consecutive errors`

**Generate errors**:

- Missing schema → `RuntimeError RILL-R004: generate requires 'schema' option`
- Unsupported type in schema → `RuntimeError RILL-R004: unsupported schema type '{type}'`
- JSON parse failure → `RuntimeError RILL-R004: generate response parse failed: {detail}`

## Provider Notes

- `usage.input` and `usage.output` return 0 (Gemini API does not provide token counts consistently)
- `id` returns empty string
- SDK is `@google/genai` (preview); do NOT use `@google/generative-ai` (EOL)

## Events

| Event | Emitted When |
|-------|-------------|
| `gemini:message` | message() completes |
| `gemini:messages` | messages() completes |
| `gemini:embed` | embed() completes |
| `gemini:embed_batch` | embed_batch() completes |
| `gemini:tool_loop` | tool_loop() completes |
| `gemini:generate` | generate() completes successfully |
| `gemini:tool_call` | Tool invoked during loop |
| `gemini:tool_result` | Tool returns during loop |
| `gemini:error` | Any operation fails |

### Completion Event Fields

Completion events (`gemini:message`, `gemini:messages`, `gemini:tool_loop`, `gemini:generate`) include these fields:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in milliseconds (`total_duration` for `tool_loop`) |
| `model` | Model identifier used for the request |
| `usage` | Token usage object (`input` and `output` counts) |
| `request` | Messages array sent to the provider API |
| `content` | Response text from the provider |

## Test Host

A runnable example at `packages/ext/gemini/examples/test-host.ts` demonstrates integration:

```bash
# Set API key
export GEMINI_API_KEY="AIza..."

# Built-in demo
pnpm exec tsx examples/test-host.ts

# Inline expression
pnpm exec tsx examples/test-host.ts -e 'llm::message("Tell me a joke") -> $.content -> log'

# Script file
pnpm exec tsx examples/test-host.ts script.rill
```

Override model with `GEMINI_MODEL`.

## See Also

- [Bundled Extensions](bundled-extensions.md) — All shipped extensions
- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
- [Reference](ref-language.md) — Language specification
