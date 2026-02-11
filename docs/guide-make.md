# rill Agent Instructions

*Workflow for building rill agent projects*

These instructions guide you through building a rill agent. Follow the four phases in order. Do not skip to implementation.

**Prompt template:** "Using the rill agent instructions at [URL], build an agent that [goal]."

**References:** [rill.run/llms-full.txt](https://rill.run/llms-full.txt) (complete language spec) | [rill.run/docs](https://rill.run/docs/) (full documentation)

> **Hard rule:** Always scaffold with `npx @rcrsr/rill-create-agent`. Never create `package.json`, `host.ts`, `run.ts`, or `tsconfig.json` by hand. The scaffolder generates correct dependencies, imports, and runtime wiring. Hand-rolled projects break on missing internal packages.

---

## Phase 1: Explore

Understand the user's goal and discover which capabilities apply.

### 1.1 Clarify the Goal

Ask the user these questions before proceeding:

- What task should the agent perform? (one-sentence summary)
- What external services does it call? (LLM providers, HTTP APIs, databases)
- What files does it read or write? (paths, formats, permissions)
- Does it need state that persists between runs?
- Does it need to run shell commands?

Do not assume requirements. Interview until the scope is clear.

### 1.2 Discover Available Extensions

rill agents compose capabilities from extensions. Two categories exist:

**External extensions** — separate npm packages for third-party APIs:

| Extension | NPM Package | Namespace | Purpose |
|-----------|-------------|-----------|---------|
| anthropic | `@rcrsr/rill-ext-anthropic` | `anthropic` | Anthropic Claude API |
| openai | `@rcrsr/rill-ext-openai` | `openai` | OpenAI API |
| gemini | `@rcrsr/rill-ext-gemini` | `gemini` | Google Gemini API |
| claude-code | `@rcrsr/rill-ext-claude-code` | `claude_code` | Claude Code integration |
| qdrant | `@rcrsr/rill-ext-qdrant` | `qdrant` | Qdrant vector database |
| pinecone | `@rcrsr/rill-ext-pinecone` | `pinecone` | Pinecone vector database |
| chroma | `@rcrsr/rill-ext-chroma` | `chroma` | ChromaDB vector database |

**Core extensions** — bundled with `@rcrsr/rill`, no extra install:

| Extension | Import Path | Namespace | Purpose |
|-----------|-------------|-----------|---------|
| fs | `@rcrsr/rill/ext/fs` | `fs` | Sandboxed file I/O with mount points |
| fetch | `@rcrsr/rill/ext/fetch` | (custom) | Pre-configured HTTP endpoints |
| exec | `@rcrsr/rill/ext/exec` | (custom) | Sandboxed command execution |
| kv | `@rcrsr/rill/ext/kv` | `kv` | Persistent key-value state across runs |
| crypto | `@rcrsr/rill/ext/crypto` | `crypto` | Hashing, HMAC, UUID generation |

### 1.3 Match Extensions to Requirements

Map the user's requirements to extensions:

| Requirement | Extension | Why |
|-------------|-----------|-----|
| Call an LLM | `anthropic`, `openai`, or `gemini` | Identical function signatures — swap providers by changing namespace |
| Vector similarity search | `qdrant`, `pinecone`, or `chroma` | Identical function signatures — swap providers by changing namespace |
| Read/write files | `fs` | Sandboxed mounts with read/write/read-write modes |
| Call HTTP APIs | `fetch` | Pre-declared endpoints with retry, auth, response parsing |
| Run shell commands | `exec` | Allowlisted commands with argument validation |
| Remember state across runs | `kv` | Key-value store persisting to JSON file |
| Generate hashes or IDs | `crypto` | SHA-256, HMAC, UUID v4, random bytes |
| Integrate with Claude Code | `claude-code` | Run prompts and tools inside Claude Code |

**Present your findings to the user.** List selected extensions with rationale. Confirm before proceeding.

---

## Phase 2: Design

Sketch the agent architecture before writing any code.

### 2.1 Map the Data Flow

rill scripts flow data through pipes (`->`). Design the agent as a sequence of transformations:

```text
[input] -> [transform] -> [transform] -> [output]
```

Example for a RAG agent:

```text
user query -> embed query -> search vector DB -> format context
  -> LLM completion with context -> write output
```

### 2.2 Identify Host Functions

For each step in the data flow, identify which extension function handles it. Use the Extension Function Reference (below) to find exact signatures.

Example:

| Step | Extension Function | Purpose |
|------|--------------------|---------|
| Embed query | `anthropic::embed($query)` | Convert text to vector |
| Search | `qdrant::search($vector, 5)` | Find similar documents |
| Complete | `anthropic::message($prompt)` | Generate response |
| Persist | `kv::set("last_query", $query)` | Remember last query |
| Write output | `fs::write("output", "result.md", $response)` | Save to file |

### 2.3 Gather Configuration Values

For each selected extension, **ask the user** for the specific values needed to configure `host.ts`. Do not guess — every value below must come from the user or be explicitly marked as a reasonable default.

**LLM extensions** (anthropic, openai, gemini):
- Which provider and model?
- What environment variable holds the API key?

**Vector DB extensions** (qdrant, pinecone, chroma):
- Connection URL and collection name?
- What environment variable holds the API key (if any)?

**fs** — ask for each mount point:
- Mount name, directory path, and mode (`read`, `write`, or `read-write`)?
- File type filter (glob pattern)?

**fetch** — ask for each external API:
- Base URL?
- Auth mechanism (Bearer token env var, API key header, none)?
- List each endpoint: HTTP method, path, parameters (name, type, location)?

**exec** — ask for each command:
- Binary name and allowed arguments?
- Working directory?
- Does it accept stdin?

**kv** — ask for state requirements:
- File path for the state store?
- Schema keys with types and defaults? (or open mode with no schema)

**crypto** — ask only if selected:
- HMAC secret env var (if HMAC is needed)?

Record every answer. These values flow directly into `host.ts` in Phase 4.

### 2.4 Identify Custom Host Functions

If the agent needs capabilities no extension provides, plan custom host functions using `prefixFunctions`. Keep these minimal — prefer extensions over custom code.

**Present the design to the user.** Show the data flow, extension choices, and every configuration value collected. Get approval before proceeding.

---

## Phase 3: Plan

Create a concrete implementation plan mapping to files and code.

### 3.1 Plan the File Structure

The `rill-create-agent` scaffolder generates this structure:

```
my-agent/
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── src/
│   ├── host.ts         # Extension initialization and runtime context
│   ├── run.ts          # Executes agent.rill with context from host.ts
│   └── agent.rill      # Main rill script — agent logic goes here
├── .env.example        # Required API keys for selected extensions
└── CLAUDE.md           # Project-specific instructions for Claude Code
```

### 3.2 Plan the Implementation Steps

1. **Scaffold** — Run `rill-create-agent` with the selected external extensions (generates all project files)
2. **Install** — Run the package manager to install dependencies
3. **Add core extensions** — Edit the generated `host.ts` to wire core extensions (fs, fetch, exec, kv, crypto)
4. **Set up .env** — Copy `.env.example` to `.env` and fill in API keys
5. **Write agent.rill** — Replace the generated starter script with agent logic from Phase 2
6. **Test** — Run with `npm start` and verify output
7. **Iterate** — Adjust `agent.rill` logic and `host.ts` configuration based on results

Steps 1-2 produce a working project. Steps 3-5 customize it. Never create project files outside of step 1.

### 3.3 Determine the Scaffold Command

Ask the user for project setup values:

- **Project name** — valid npm package name (lowercase, hyphens, underscores)
- **Package manager** — `npm`, `pnpm`, or `yarn` (default: `npm`)
- **Description** — one-line project description

Build the scaffold command from these values plus the external extensions selected in Phase 1. The `--extensions` or `--preset` flag is required. Core extensions need no flag — they ship with `@rcrsr/rill` and get wired in `host.ts` manually.

```bash
npx @rcrsr/rill-create-agent <project-name> \
  --extensions <comma-separated-list> \
  --description "<description>" \
  --package-manager <pm> \
  --no-install
```

Run from the user's project parent directory — the scaffolder creates a new folder.

**Present the plan to the user.** Show the scaffold command, implementation steps, and expected file changes. Get approval before executing.

---

## Phase 4: Execute

Implement the plan step by step.

> **Do not create files manually.** The scaffolder generates `package.json`, `host.ts`, `run.ts`, `tsconfig.json`, `.env.example`, and `CLAUDE.md` with correct internal dependencies. You edit the generated files — you never write them from scratch.

### 4.1 Scaffold the Project

Run `rill-create-agent` with the external extensions selected in Phase 1:

```bash
npx @rcrsr/rill-create-agent my-agent --extensions anthropic,qdrant
```

This generates a working project with all dependencies, imports, and runtime wiring. The generated `host.ts` already contains `hoistExtension` calls for every external extension passed via `--extensions`. The generated `run.ts` already handles parsing, execution, output formatting, and cleanup.

**Do not modify `run.ts`** unless you need custom callbacks. **Do not modify `package.json`** unless adding new npm dependencies.

After scaffolding, install dependencies with the chosen package manager:

```bash
cd my-agent && npm install
```

### 4.2 Add Core Extensions to host.ts

The scaffolder wires external extensions (anthropic, openai, gemini, qdrant, etc.) automatically. Core extensions (fs, fetch, exec, kv, crypto) ship with `@rcrsr/rill` and require no extra `npm install`, but you must add them to the generated `host.ts` manually.

**Open the scaffolded `src/host.ts` and add imports for each core extension you need:**

```typescript
// Add these imports below the existing ones in the generated host.ts
import { createFsExtension } from '@rcrsr/rill/ext/fs';
import { createFetchExtension } from '@rcrsr/rill/ext/fetch';
import { createExecExtension } from '@rcrsr/rill/ext/exec';
import { createKvExtension } from '@rcrsr/rill/ext/kv';
import { createCryptoExtension } from '@rcrsr/rill/ext/crypto';
```

**Add initialization calls alongside the existing ones:**

```typescript
// These go next to the existing hoistExtension calls in the generated file
const newsapi = hoistExtension('newsapi', createFetchExtension({
  baseUrl: 'https://newsapi.org/v2',
  headers: { 'X-Api-Key': process.env.NEWSAPI_KEY || '' },
  endpoints: {
    top_headlines: {
      method: 'GET',
      path: '/top-headlines',
      params: [
        { name: 'country', type: 'string', location: 'query', defaultValue: 'us' },
        { name: 'pageSize', type: 'number', location: 'query', defaultValue: 10 },
      ],
    },
  },
}));

const kv = hoistExtension('kv', createKvExtension({
  store: './data/agent-state.json',
}));
```

**Spread their functions into the existing `createHost()` return value:**

```typescript
// Edit the existing createHost() — add to the functions spread and dispose calls
export function createHost() {
  return {
    functions: {
      ...anthropic.functions,   // ← already generated
      ...newsapi.functions,     // ← add this
      ...kv.functions,          // ← add this
    },
    dispose: async () => {
      await anthropic.dispose?.();  // ← already generated
      await kv.dispose?.();         // ← add this
    },
  };
}
```

### 4.3 Add Custom Host Functions (if needed)

Only add custom host functions when no extension covers the requirement. Add them to the generated `host.ts`:

```typescript
const appFunctions: Record<string, HostFunctionDefinition> = {
  greet: {
    fn: async (args) => `Hello, ${args[0]}!`,
    params: [{ name: 'name', type: 'string' }],
    returnType: 'string',
  },
};

// In createHost() functions spread:
...prefixFunctions('app', appFunctions),
```

### 4.4 Write agent.rill

Replace the generated `src/agent.rill` with your agent logic. Use the data flow designed in Phase 2 and the extension functions wired in `host.ts`. See the Syntax Quick Reference and Extension Function Reference sections below.

The agent script calls extension functions using `namespace::function()` syntax. The namespace matches the first argument to `hoistExtension` in `host.ts`:

```rill
// If host.ts has: hoistExtension('newsapi', createFetchExtension({...}))
// Then agent.rill calls: newsapi::top_headlines(...)
newsapi::top_headlines([country: "us", pageSize: 5]) => $articles
```

### 4.5 Test and Iterate

```bash
npm run start          # Execute agent.rill
npm run typecheck      # Validate types
```

Edit `src/agent.rill` to change agent behavior. Edit `src/host.ts` to add or reconfigure extensions.

---

## rill Syntax Quick Reference

rill scripts flow data through pipes (`->`), not assignment.

**Pipes and variables:**

```rill
"hello" -> .upper               # pipe to method
5 -> ($ * 2)                    # $ = current piped value
"data" => $input                # capture into variable
$input -> .len                  # use variable
```

**Conditionals:**

```rill
5 -> ($ > 3) ? "big" ! "small"
"hello" -> .contains("ell") ? "found" ! "missing"
```

**Loops:**

```rill
0 => $i
$i -> ($ < 3) @ { $ + 1 }
# Result: 3
```

**Collections:**

```rill
[1, 2, 3] -> each { $ * 2 }       # sequential iteration
[1, 2, 3] -> map { $ * 2 }        # parallel iteration
[1, 2, 3] -> filter { $ > 1 }     # filter elements
[1, 2, 3] -> fold(0) { $@ + $ }   # reduce to value
```

**Closures:**

```rill
"prefix" => $pre
|x| { "{$pre} {$x}" } => $fn
$fn("test")
# Result: "prefix test"
```

**Dict-bound closures:**

```rill
[name: "alice", greet: || { "Hello, {$.name}" }] => $obj
$obj.greet
# Result: "Hello, alice"
```

**Extension functions** use `namespace::function()` syntax:

```rill
anthropic::message("Summarize: {$text}") => $summary
$query -> anthropic::embed($) -> qdrant::search($, 5) => $results
fs::read("input", "data.csv") => $data
kv::get("run_count") -> $ + 1 -> kv::set("run_count", $)
crypto::uuid() => $request_id
```

---

## Extension Function Reference

### LLM Extensions (anthropic, openai, gemini)

All three share identical function signatures:

- `namespace::message(prompt)` — Single message completion
- `namespace::conversation(messages)` — Multi-turn conversation
- `namespace::embed(text)` — Generate embeddings

### Vector Database Extensions (qdrant, pinecone, chroma)

All three share identical function signatures:

- `namespace::search(vector, limit)` — Vector similarity search
- `namespace::upsert(id, vector, metadata)` — Insert or update vector
- `namespace::delete(id)` — Remove vector by ID

### fs — Sandboxed File I/O

| Function | Purpose |
|----------|---------|
| `fs::read(mount, path)` | Read file contents as string |
| `fs::write(mount, path, content)` | Write string to file |
| `fs::append(mount, path, content)` | Append string to file |
| `fs::list(mount, path?)` | List directory entries |
| `fs::find(mount, pattern?)` | Recursive file search with glob |
| `fs::exists(mount, path)` | Check file existence |
| `fs::remove(mount, path)` | Delete file |
| `fs::stat(mount, path)` | File metadata (size, timestamps) |
| `fs::mkdir(mount, path)` | Create directory |
| `fs::copy(mount, src, dest)` | Copy within mount |
| `fs::move(mount, src, dest)` | Move within mount |
| `fs::mounts()` | List configured mount points |

Mount modes: `read`, `write`, `read-write`. Path traversal outside mount boundary throws error.

### fetch — Pre-configured HTTP

Each endpoint in config becomes a callable function:

```rill
api::get_users([limit: 10])
api::get_user("user-123")
api::create_user([name: "Alice", email: "alice@example.com"])
api::endpoints()              # list available endpoints
```

Supports retry with exponential backoff, `maxConcurrent` throttling, dynamic headers, and `responseShape: 'full'` for status/headers access.

### exec — Sandboxed Commands

Each declared command returns `{ stdout, stderr, exitCode }`:

```rill
sh::git_status() => $status
sh::jq((".",), $json_data) => $formatted    # stdin support
sh::commands()                               # list available commands
```

Uses `child_process.execFile()` — no shell injection. Arguments validated against allowlist/blocklist.

### kv — Persistent State

```rill
kv::set("last_run", "2026-02-10T14:30:00Z")
kv::get("last_run") => $timestamp
kv::get("run_count") -> $ + 1 -> kv::set("run_count", $)
kv::keys() => $all_keys
kv::getAll() => $state
kv::schema()                    # list declared keys (empty in open mode)
```

Host controls persistence via store file path. Schema mode validates key names and value types.

### crypto — Hashing and Identifiers

```rill
crypto::hash($content)                    # SHA-256 hex digest
crypto::hash($content, "sha512")          # specify algorithm
crypto::hmac($payload)                    # HMAC signature (key in config)
crypto::uuid()                            # random UUID v4
crypto::random(32)                        # 64-char hex random string
```

---

## Core Extension Configuration Reference

### fs

```typescript
createFsExtension({
  mounts: {
    config: { path: '/app/config', mode: 'read' },
    output: { path: '/app/output', mode: 'read-write' },
    data: { path: '/app/data', mode: 'read', glob: '*.csv' },
  },
  maxFileSize: 10_485_760,    // 10MB default
})
```

### fetch

```typescript
createFetchExtension({
  baseUrl: 'https://api.example.com/v2',
  headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
  timeout: 30000,
  retries: 2,
  maxConcurrent: 5,
  endpoints: {
    get_users: {
      method: 'GET',
      path: '/users',
      params: [
        { name: 'limit', type: 'number', location: 'query', defaultValue: 20 },
      ],
    },
    create_user: {
      method: 'POST',
      path: '/users',
      body: 'json',
      params: [
        { name: 'name', type: 'string', location: 'body', required: true },
        { name: 'email', type: 'string', location: 'body', required: true },
      ],
    },
  },
})
```

### exec

```typescript
createExecExtension({
  commands: {
    git_status: {
      binary: 'git',
      allowedArgs: ['status', '--porcelain'],
      cwd: '/app',
    },
    jq: {
      binary: 'jq',
      stdin: true,
    },
  },
  timeout: 15000,
  inheritEnv: false,          // isolated environment by default
})
```

### kv

```typescript
createKvExtension({
  store: './data/agent-state.json',
  schema: {
    last_run: { type: 'string', default: '' },
    run_count: { type: 'number', default: 0 },
    processed_ids: { type: 'list', default: [] },
  },
  writePolicy: 'dispose',    // batch write on shutdown (default)
})
```

### crypto

```typescript
createCryptoExtension({
  defaultAlgorithm: 'sha256',  // default
  hmacKey: process.env.HMAC_SECRET,
})
```

---

## Common Mistakes

These patterns cause broken projects. Avoid them.

| Mistake | Why it breaks | Correct approach |
|---------|---------------|------------------|
| Writing `package.json` by hand | Missing internal dependencies like `@rcrsr/rill-ext-llm-shared` | Run `npx @rcrsr/rill-create-agent` |
| Writing `run.ts` by hand | Wrong imports, missing `parse`/`execute` pattern, no output formatting | Use the generated `run.ts` unmodified |
| Writing `host.ts` from scratch | Missing `dotenv/config` import, wrong `hoistExtension` wiring | Edit the generated `host.ts` |
| Using raw `fetch()` or `axios` for HTTP | Bypasses sandboxing, no retry/auth, wrong function signature | Use the `fetch` core extension with `createFetchExtension` |
| Installing core extensions via npm | `fs`, `fetch`, `exec`, `kv`, `crypto` are sub-path exports of `@rcrsr/rill` | Import from `@rcrsr/rill/ext/<name>` — no extra install |
| Skipping `--extensions` flag | Scaffolder requires either `--extensions` or `--preset` | Always pass external extensions to the scaffold command |

---

## See Also

- [Complete Language Reference](https://rill.run/llms-full.txt) — Full rill syntax for LLMs
- [Language Reference](https://rill.run/docs/reference/language/) — Core language specification
- [Host Integration](https://rill.run/docs/integration/host/) — Embedding rill in applications
- [Extensions](https://rill.run/docs/integration/extensions/) — Writing reusable function packages
- [Bundled Extensions](https://rill.run/docs/extensions/) — Extension API reference
