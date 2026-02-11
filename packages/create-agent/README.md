# rill-create-agent

Scaffolding tool for [rill](https://rill.run) extension projects.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npx rill-create-agent my-agent --extensions anthropic
```

No global installation required. `npx` executes the latest version from npm.

## Usage

All inputs are provided via CLI flags. The `--extensions` or `--preset` flag is required.

```bash
npx rill-create-agent my-agent --extensions anthropic,qdrant
```

```bash
npx rill-create-agent my-agent --preset rag
```

### All Options

| Flag | Description | Example |
|------|-------------|---------|
| `--extensions` | Comma-separated extension list | `--extensions anthropic,qdrant` |
| `--preset` | Use predefined extension bundle | `--preset rag` |
| `--description` | Project description | `--description "My agent"` |
| `--package-manager` | Package manager (`npm`, `pnpm`, `yarn`) | `--package-manager pnpm` |
| `--no-install` | Skip dependency installation | `--no-install` |
| `--typescript` | Generate TypeScript project | `--typescript` |

**Required:** Either `--extensions` or `--preset` must be provided. They cannot be combined.

## Extensions

The tool supports 7 bundled rill extensions:

| Extension | NPM Package | Purpose |
|-----------|-------------|---------|
| `anthropic` | `@rcrsr/rill-ext-anthropic` | Anthropic Claude LLM API |
| `openai` | `@rcrsr/rill-ext-openai` | OpenAI API |
| `gemini` | `@rcrsr/rill-ext-gemini` | Google Gemini API |
| `claude-code` | `@rcrsr/rill-ext-claude-code` | Claude Code integration |
| `qdrant` | `@rcrsr/rill-ext-qdrant` | Qdrant vector database |
| `pinecone` | `@rcrsr/rill-ext-pinecone` | Pinecone vector database |
| `chroma` | `@rcrsr/rill-ext-chroma` | ChromaDB vector database |

All LLM extensions share identical function signatures. Swap providers by changing one line of host code.

Vector database extensions follow the same pattern — `qdrant::search`, `pinecone::search`, `chroma::search` work identically.

## Presets

Presets bundle extensions with starter patterns for common use cases:

| Preset | Extensions | Starter Pattern | Use Case |
|--------|-----------|-----------------|----------|
| `rag` | `anthropic`, `qdrant` | `search-focused` | Retrieval-augmented generation workflows |
| `chatbot` | `anthropic` | `conversation-loop` | Conversational agent loops |

**Usage:**

```bash
npx rill-create-agent my-rag-agent --preset rag
```

This generates a project with Anthropic + Qdrant extensions and a search-focused starter script.

## Generated Structure

The tool creates this file structure:

```
my-agent/
  agent.rill          # Starter rill script with extension examples
  host.ts             # TypeScript host integration
  run.ts              # Execution entry point
  package.json        # Dependencies and scripts
  tsconfig.json       # TypeScript configuration
  .env.example        # Environment variable template
  CLAUDE.md           # Agent instructions for Claude Code
```

**Files:**

- `agent.rill` — Starter script demonstrating extension usage patterns
- `host.ts` — Initializes extensions and creates runtime context
- `run.ts` — Executes `agent.rill` with context from `host.ts`
- `package.json` — Includes selected extensions and `@rcrsr/rill`
- `.env.example` — Lists required API keys for selected extensions
- `CLAUDE.md` — Instructions for Claude Code to understand project structure

**Generated scripts:**

```bash
npm run start          # Execute agent.rill
npm run build          # Compile TypeScript to dist/
npm run typecheck      # Validate types
```

## Examples

### With Preset

```bash
npx rill-create-agent my-rag-bot --preset rag --package-manager pnpm
```

Generates project with:
- Extensions: `anthropic`, `qdrant`
- Starter pattern: `search-focused`
- Package manager: `pnpm`

### With Custom Extensions

```bash
npx rill-create-agent my-agent \
  --extensions anthropic,openai,pinecone \
  --description "Multi-provider agent" \
  --typescript \
  --no-install
```

Generates TypeScript project with 3 extensions, skips `npm install`.

### All LLM Providers + Vector DB

```bash
npx rill-create-agent my-agent --extensions anthropic,openai,gemini,qdrant
```

Includes all 3 LLM providers and Qdrant. Starter script demonstrates provider-agnostic patterns.

## Next Steps

After scaffolding:

1. **Configure environment variables:**
   ```bash
   cd my-agent
   cp .env.example .env
   # Edit .env with your API keys
   ```

2. **Install dependencies (if skipped):**
   ```bash
   npm install
   ```

3. **Run the starter script:**
   ```bash
   npm run start
   ```

4. **Edit `agent.rill` to build your workflow.** See [rill documentation](https://rill.run) for language reference.

## Documentation

| Document | Description |
|----------|-------------|
| [Language Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-language.md) | rill language specification |
| [Host Integration](https://github.com/rcrsr/rill/blob/main/docs/integration-host.md) | Embedding rill in applications |
| [Bundled Extensions](https://github.com/rcrsr/rill/blob/main/docs/bundled-extensions.md) | Extension API reference |
| [Examples](https://github.com/rcrsr/rill/blob/main/docs/guide-examples.md) | Workflow patterns |

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `Missing project name` | No positional argument | Provide project name: `npx rill-create-agent my-agent --extensions anthropic` |
| `Project name must be valid npm package name` | Invalid npm package name | Use lowercase alphanumeric, hyphens, underscores |
| `Unknown extension: X` | Invalid extension name | Use one of: `anthropic`, `openai`, `gemini`, `claude-code`, `qdrant`, `pinecone`, `chroma` |
| `Unknown preset: X` | Invalid preset name | Use `rag` or `chatbot` |
| `Cannot combine --preset and --extensions` | Both flags provided | Use `--preset` OR `--extensions`, not both |
| `Provide --extensions or --preset` | Missing required flag | Add `--extensions` or `--preset` flag |
| `Invalid --package-manager value` | Unknown package manager | Use `npm`, `pnpm`, or `yarn` |

## License

MIT
