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
pnpm build   # rill-agent-bundle agent.json --target local --output dist/
pnpm start   # tsx dist/host.ts
```

The server starts on `http://localhost:4001`.

## Endpoints

### Run the agent

```bash
curl -X POST http://localhost:4001/run \
  -H 'Content-Type: application/json' \
  -d '{"params": {"feedback": "The onboarding was confusing and I almost gave up twice."}}'
```

Example response:

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

### Health check

```bash
curl http://localhost:4001/healthz
```

### List sessions

```bash
curl http://localhost:4001/sessions
```

### SSE stream for a session

```bash
curl -N http://localhost:4001/sessions/{id}/stream
```

Replace `{id}` with a session ID from the `/run` or `/sessions` response.

### Agent card

```bash
curl http://localhost:4001/.well-known/agent-card.json
```

## What it demonstrates

- **Structured output**: `llm::generate()` extracts typed fields (sentiment, issues, urgency, category) from free text
- **Response drafting**: `llm::message()` drafts an empathetic reply using the extracted analysis
- **Manifest-driven composition**: `rill-agent-bundle` builds the agent from `agent.json` into `dist/`
- **Generated host entry**: `dist/host.ts` is generated — no hand-written server code
- **SSE observability**: `log` calls emit real-time events on `/sessions/{id}/stream`

## Build output

```
dist/
  host.ts                      # Generated server entry (run with tsx)
  agent.json                   # Resolved manifest
  scripts/main.rill            # Copied entry script
  .well-known/agent-card.json  # Agent discovery card
```
