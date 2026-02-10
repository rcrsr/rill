# @rcrsr/rill-ext-anthropic

[rill](https://rill.run) extension for [Anthropic Claude](https://docs.anthropic.com) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, and `tool_loop` host functions.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-anthropic
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createAnthropicExtension } from '@rcrsr/rill-ext-anthropic';

const ext = createAnthropicExtension({
  api_key: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',
});
const prefixed = prefixFunctions('anthropic', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `anthropic::message("Explain TCP handshakes")`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

All functions return a dict with `content`, `model`, `usage`, `stop_reason`, `id`, and `messages`.

### anthropic::message(text, options?)

Send a single message to Claude.

```rill
anthropic::message("Analyze this code for security issues") => $response
$response.content -> log
$response.usage.output -> log
```

### anthropic::messages(messages, options?)

Send a multi-turn conversation.

```rill
anthropic::messages([
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language for AI agents."],
  [role: "user", content: "Show me an example."]
]) => $response
$response.content -> log
```

### anthropic::embed(text)

Generate an embedding vector for text. Requires `embed_model` in config.

> **Note:** Anthropic does not currently provide a public embeddings API. This function validates inputs but raises an error at call time.

```rill
anthropic::embed("Hello world") => $vector
```

### anthropic::embed_batch(texts)

Generate embedding vectors for multiple texts.

> **Note:** Same limitation as `embed` above.

```rill
anthropic::embed_batch(["Hello", "World"]) => $vectors
```

### anthropic::tool_loop(prompt, options)

Execute a tool-use loop where Claude calls rill functions iteratively.

```rill
anthropic::tool_loop("Find the weather", [tools: $my_tools]) => $result
$result.content -> log
$result.turns -> log
```

## Configuration

```typescript
const ext = createAnthropicExtension({
  api_key: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',
  temperature: 0.7,
  max_tokens: 4096,
  max_retries: 3,
  timeout: 30000,
  system: 'You are a helpful assistant.',
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `api_key` | string | required | Anthropic API key |
| `model` | string | required | Model identifier |
| `temperature` | number | undefined | Temperature (0.0-2.0) |
| `base_url` | string | undefined | Custom API endpoint URL |
| `max_tokens` | number | `4096` | Max tokens in response |
| `max_retries` | number | undefined | Max retry attempts |
| `timeout` | number | undefined | Request timeout in ms |
| `system` | string | undefined | Default system prompt |
| `embed_model` | string | undefined | Embedding model (not yet supported) |

## Result Shape

```typescript
interface AnthropicResult {
  content: string;     // response text
  model: string;       // model used
  usage: {
    input: number;     // input tokens
    output: number;    // output tokens
  };
  stop_reason: string; // stop reason (end_turn, tool_use, max_tokens)
  id: string;          // message ID
  messages: Array<{    // full conversation history
    role: string;
    content: string;
  }>;
}
```

## Lifecycle

Call `dispose()` on the extension to clean up:

```typescript
const ext = createAnthropicExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

## Test Host

A runnable example at `examples/test-host.ts` wires up the extension with the rill runtime:

```bash
pnpm exec tsx examples/test-host.ts
pnpm exec tsx examples/test-host.ts -e 'anthropic::message("Tell me a joke") -> log'
pnpm exec tsx examples/test-host.ts script.rill
```

Requires `ANTHROPIC_API_KEY` environment variable.

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |

## License

MIT
