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
pnpm start   # rill-agent-run dist/ feedback-analyzer --param feedback='...'
```

Or run directly:

```bash
rill-agent-run dist/ feedback-analyzer --param feedback='The onboarding was confusing and I almost gave up twice.'
```

Or pipe input via stdin:

```bash
echo '{"feedback":"The onboarding was confusing and I almost gave up twice."}' | rill-agent-run dist/ feedback-analyzer
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

## Verify bundle

```bash
pnpm check   # rill-agent-bundle check --platform node dist/
```

## What it demonstrates

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
