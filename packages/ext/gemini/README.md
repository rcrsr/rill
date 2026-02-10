# @rcrsr/rill-ext-gemini

[rill](https://rill.run) extension for [Google Gemini](https://ai.google.dev/docs) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, and `tool_loop` host functions.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-gemini
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createGeminiExtension } from '@rcrsr/rill-ext-gemini';

const ext = createGeminiExtension({
  api_key: process.env.GOOGLE_API_KEY!,
  model: 'gemini-2.0-flash',
});
const prefixed = prefixFunctions('gemini', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `gemini::message("Explain TCP handshakes")`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

All functions return a dict with `content`, `model`, `usage`, `stop_reason`, `id`, and `messages`.

### gemini::message(text, options?)

Send a single message to Gemini.

```rill
gemini::message("Analyze this code for security issues") => $response
$response.content -> log
$response.usage.output -> log
```

### gemini::messages(messages, options?)

Send a multi-turn conversation.

```rill
gemini::messages([
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language for AI agents."],
  [role: "user", content: "Show me an example."]
]) => $response
$response.content -> log
```

### gemini::embed(text)

Generate an embedding vector for text. Requires `embed_model` in config.

```rill
gemini::embed("Hello world") => $vector
```

### gemini::embed_batch(texts)

Generate embedding vectors for multiple texts in a single API call.

```rill
gemini::embed_batch(["Hello", "World"]) => $vectors
```

### gemini::tool_loop(prompt, options)

Execute a tool-use loop where the model calls rill functions iteratively.

```rill
gemini::tool_loop("Find the weather", [tools: $my_tools]) => $result
$result.content -> log
$result.turns -> log
```

## Configuration

```typescript
const ext = createGeminiExtension({
  api_key: process.env.GOOGLE_API_KEY!,
  model: 'gemini-2.0-flash',
  temperature: 0.7,
  max_tokens: 8192,
  system: 'You are a helpful assistant.',
  embed_model: 'text-embedding-004',
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `api_key` | string | required | Google API key |
| `model` | string | required | Model identifier |
| `temperature` | number | undefined | Temperature (0.0-2.0) |
| `base_url` | string | undefined | Custom API endpoint URL |
| `max_tokens` | number | `8192` | Max tokens in response |
| `max_retries` | number | undefined | Max retry attempts |
| `timeout` | number | undefined | Request timeout in ms |
| `system` | string | undefined | Default system instruction |
| `embed_model` | string | undefined | Embedding model identifier |

## Result Shape

```typescript
interface GeminiResult {
  content: string;     // response text
  model: string;       // model used
  usage: {
    input: number;     // prompt tokens
    output: number;    // completion tokens
  };
  stop_reason: string; // finish reason
  id: string;          // request ID
  messages: Array<{    // full conversation history
    role: string;
    content: string;
  }>;
}
```

## Lifecycle

Call `dispose()` on the extension to cancel pending requests:

```typescript
const ext = createGeminiExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

## Test Host

A runnable example at `examples/test-host.ts` wires up the extension with the rill runtime:

```bash
pnpm exec tsx examples/test-host.ts
pnpm exec tsx examples/test-host.ts -e 'gemini::message("Tell me a joke") -> log'
pnpm exec tsx examples/test-host.ts script.rill
```

Requires `GOOGLE_API_KEY` environment variable.

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |

## License

MIT
