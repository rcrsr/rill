# Feedback Analyzer Demo

A rill agent that analyzes customer feedback using `llm::generate()` for structured extraction and `llm::message()` for response drafting via the OpenAI extension.

## Prerequisites

From the repository root:

```bash
pnpm install
pnpm run -r build
```

Set your Groq API key:

```bash
export GROQ_API_KEY="gsk_..."
```

## Build and start

```bash
cd demo/feedback-analyzer
pnpm build   # rill-agent-bundle build agent.json
pnpm start   # rill-agent-run dist/ feedback-analyzer --config config.json
```

Or run directly:

```bash
rill-agent-run dist/ feedback-analyzer --config config.json --param feedback='The onboarding was confusing and I almost gave up twice.'
```

Or pipe input via stdin:

```bash
echo '{"feedback":"The onboarding was confusing and I almost gave up twice."}' | rill-agent-run dist/ feedback-analyzer --config config.json
```

Example output:

```json
{
  "sentiment": "negative",
  "issues": ["confusing onboarding"],
  "urgency": "high",
  "category": "onboarding",
  "response": "I'm sorry to hear the onboarding process was frustrating...",
  "usage": { "analysis_tokens": 202, "response_tokens": 133 }
}
```

## Runtime configuration

Extension config is supplied at runtime via `--config`, not embedded in the manifest.

`config.json` provides the `llm` extension its API credentials and model:

```json
{
  "llm": {
    "api_key": "${GROQ_API_KEY}",
    "model": "openai/gpt-oss-20b",
    "base_url": "https://api.groq.com/openai/v1"
  }
}
```

`${GROQ_API_KEY}` interpolates from `process.env` at runtime. Export the variable before running.

Pass inline JSON instead of a file:

```bash
rill-agent-run dist/ feedback-analyzer \
  --config '{"llm":{"api_key":"'"$GROQ_API_KEY"'","model":"llama-3.3-70b-versatile","base_url":"https://api.groq.com/openai/v1"}}' \
  --param feedback='Great product!'
```

## Verify bundle

```bash
pnpm check   # rill-agent-bundle check --platform node dist/
```

## What it demonstrates

- **Runtime extension config**: `--config` supplies API keys and model settings at run time
- **Environment interpolation**: `${GROQ_API_KEY}` resolves from `process.env` in config values
- **Structured output**: `llm::generate()` extracts typed fields (sentiment, issues, urgency, category) from free text
- **Response drafting**: `llm::message()` drafts an empathetic reply using the extracted analysis
- **Manifest-driven composition**: `rill-agent-bundle` builds the agent from `agent.json` into `dist/`
- **CLI execution**: `rill-agent-run` executes the bundle as a one-shot CLI command

## Build output

```
dist/
  bundle.json                  # Bundle manifest
  handlers.js                  # Compiled handler entry
  agents/
    feedback-analyzer/
      scripts/main.rill        # Copied entry script
  .well-known/agent-card.json  # Agent discovery card
```
