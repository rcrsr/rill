---
title: "Agent Instructions"
description: "Workflow for building rill agent projects"
---
These instructions guide you through building a rill agent. Follow the four phases in order. Do not skip to implementation.

**Prompt template:** "Using the rill agent instructions at [URL], build an agent that [goal]."

**References:** [rill.run/llms-full.txt](https://rill.run/llms-full.txt) (complete language spec) | [rill.run/docs](https://rill.run/docs/) (full documentation)

---

## Phase 1: Explore

Understand the user's goal and discover which capabilities apply.

### 1.1 Clarify the Goal

Ask the user clarifying questions before proceeding:

- What task should the agent perform?
- What external services does it need (LLMs, APIs, databases)?
- What data does it read, transform, or produce?
- Does it need persistent state across runs?
- What environment will it run in?

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

### 2.3 Define Host Configuration

For each extension, determine what configuration the host needs:

- **fs:** Which directories to mount, with what permissions?
- **fetch:** What base URL, which endpoints, what auth headers?
- **exec:** Which commands to allow, what arguments to permit?
- **kv:** What schema keys, what defaults for first run?
- **LLM extensions:** Which model, what API key env var?
- **Vector DB extensions:** What URL, which collection?

### 2.4 Identify Custom Host Functions

If the agent needs capabilities no extension provides, plan custom host functions using `prefixFunctions`. Keep these minimal — prefer extensions over custom code.

**Present the design to the user.** Show the data flow, extension choices, and host configuration plan. Get approval before proceeding.

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

1. **Scaffold** — Run `rill-create-agent` with the selected external extensions
2. **Configure host.ts** — Wire all extensions (external + core) with `hoistExtension`
3. **Set up .env** — Add API keys and connection strings
4. **Write agent.rill** — Implement the data flow designed in Phase 2
5. **Test** — Run with `npm start` and verify output
6. **Iterate** — Adjust agent logic and host configuration based on results

### 3.3 Determine the Scaffold Command

Build the `npx rill-create-agent` command from the selected external extensions:

```bash
npx rill-create-agent <project-name> --extensions <comma-separated-list>
```

Core extensions need no flag — they ship with `@rcrsr/rill` and get wired in `host.ts` manually.

**Present the plan to the user.** Show the scaffold command, implementation steps, and expected file changes. Get approval before executing.

---

## Phase 4: Execute

Implement the plan step by step.

### 4.1 Scaffold the Project

```bash
npx rill-create-agent my-agent --extensions anthropic,qdrant
```

### 4.2 Configure host.ts

Wire extensions into the runtime context using `hoistExtension`. Each call returns `{ functions, dispose }`.

**Import pattern:**

```typescript
// Core runtime
import { hoistExtension, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';

// External extensions (separate npm packages)
import { createAnthropicExtension } from '@rcrsr/rill-ext-anthropic';
import { createQdrantExtension } from '@rcrsr/rill-ext-qdrant';

// Core extensions (bundled sub-path imports)
import { createFsExtension } from '@rcrsr/rill/ext/fs';
import { createFetchExtension } from '@rcrsr/rill/ext/fetch';
import { createExecExtension } from '@rcrsr/rill/ext/exec';
import { createKvExtension } from '@rcrsr/rill/ext/kv';
import { createCryptoExtension } from '@rcrsr/rill/ext/crypto';
```

**Initialization pattern:**

```typescript
const anthropic = hoistExtension('anthropic', createAnthropicExtension({
  api_key: process.env.ANTHROPIC_API_KEY || '',
}));

const fs = hoistExtension('fs', createFsExtension({
  mounts: {
    input: { path: './data', mode: 'read' },
    output: { path: './output', mode: 'read-write' },
  },
}));

const kv = hoistExtension('kv', createKvExtension({
  store: './data/agent-state.json',
}));
```

**Combining into createHost():**

```typescript
export function createHost() {
  return {
    functions: {
      ...anthropic.functions,
      ...fs.functions,
      ...kv.functions,
    },
    dispose: async () => {
      await anthropic.dispose?.();
      await kv.dispose?.();
    },
  };
}
```

**Custom host functions** (when no extension fits):

```typescript
const appFunctions: Record<string, HostFunctionDefinition> = {
  greet: {
    fn: async (args) => `Hello, ${args[0]}!`,
    params: [{ name: 'name', type: 'string' }],
    returnType: 'string',
  },
};

// In createHost():
...prefixFunctions('app', appFunctions),
```

**Dispose lifecycle** — always in a `finally` block:

```typescript
try {
  const result = await execute(ast, ctx);
} finally {
  await host.dispose();
}
```

### 4.3 Write agent.rill

Implement the data flow from Phase 2 using rill syntax. See the Syntax Quick Reference and Extension Function Reference sections below.

### 4.4 Test and Iterate

```bash
npm run start          # Execute agent.rill
npm run build          # Compile TypeScript
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

## See Also

- [Complete Language Reference](https://rill.run/llms-full.txt) — Full rill syntax for LLMs
- [Language Reference](https://rill.run/docs/reference/language/) — Core language specification
- [Host Integration](https://rill.run/docs/integration/host/) — Embedding rill in applications
- [Extensions](https://rill.run/docs/integration/extensions/) — Writing reusable function packages
- [Bundled Extensions](https://rill.run/docs/extensions/) — Extension API reference
