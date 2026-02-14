# @rcrsr/rill-ext-openai

[rill](https://rill.run) extension for [OpenAI](https://platform.openai.com/docs) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, and `tool_loop` host functions. Compatible with any OpenAI-compatible server (LM Studio, Ollama, vLLM).

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-openai
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createOpenAIExtension } from '@rcrsr/rill-ext-openai';

const ext = createOpenAIExtension({
  api_key: process.env.OPENAI_API_KEY!,
  model: 'gpt-4-turbo',
});
const prefixed = prefixFunctions('openai', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `openai::message("Explain TCP handshakes")`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

All functions return a dict with `content`, `model`, `usage`, `stop_reason`, `id`, and `messages`.

### openai::message(text, options?)

Send a single message to OpenAI.

```rill
openai::message("Analyze this code for security issues") => $response
$response.content -> log
$response.usage.output -> log
```

### openai::messages(messages, options?)

Send a multi-turn conversation.

```rill
openai::messages([
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language for AI agents."],
  [role: "user", content: "Show me an example."]
]) => $response
$response.content -> log
```

### openai::embed(text)

Generate an embedding vector for text. Requires `embed_model` in config.

```rill
openai::embed("Hello world") => $vector
```

### openai::embed_batch(texts)

Generate embedding vectors for multiple texts in a single API call.

```rill
openai::embed_batch(["Hello", "World"]) => $vectors
```

### openai::tool_loop(prompt, options)

Execute a tool-use loop where the model calls rill functions iteratively.

```rill
openai::tool_loop("Find the weather", [tools: $my_tools]) => $result
$result.content -> log
$result.turns -> log
```

## Configuration

```typescript
const ext = createOpenAIExtension({
  api_key: process.env.OPENAI_API_KEY!,
  model: 'gpt-4-turbo',
  temperature: 0.7,
  base_url: 'http://localhost:1234/v1', // OpenAI-compatible server
  max_tokens: 4096,
  max_retries: 3,
  timeout: 30000,
  system: 'You are a helpful assistant.',
  embed_model: 'text-embedding-3-small',
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `api_key` | string | required | OpenAI API key |
| `model` | string | required | Model identifier |
| `temperature` | number | undefined | Temperature (0.0-2.0) |
| `base_url` | string | undefined | Custom API endpoint URL |
| `max_tokens` | number | `4096` | Max tokens in response |
| `max_retries` | number | undefined | Max retry attempts |
| `timeout` | number | undefined | Request timeout in ms |
| `system` | string | undefined | Default system prompt |
| `embed_model` | string | undefined | Embedding model identifier |

## Result Shape

```typescript
interface OpenAIResult {
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
const ext = createOpenAIExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

## Test Host

A runnable example at `examples/test-host.ts` wires up the extension with the rill runtime:

```bash
pnpm exec tsx examples/test-host.ts
pnpm exec tsx examples/test-host.ts -e 'openai::message("Tell me a joke") -> log'
pnpm exec tsx examples/test-host.ts script.rill
```

Requires `OPENAI_API_KEY` environment variable (or `--base-url` for local servers).

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |

## License

MIT
