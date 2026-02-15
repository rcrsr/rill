# rill Agent Instructions

*Workflow for building rill agent projects*

These instructions guide you through building a rill agent. The four phases are mandatory gates, not suggestions. Each phase produces deliverables that require user approval before the next phase begins. Do not skip phases. Do not combine phases. Do not proceed without explicit user approval at each gate.

**Prompt template:** "Using the rill agent instructions at [URL], build an agent that [goal]."

**References:** [rill.run/llms-full.txt](https://rill.run/llms-full.txt) (complete language spec) | [rill.run/docs](https://rill.run/docs/) (full documentation)

> **Hard rule — scaffolder:** Always scaffold with `npx @rcrsr/rill-create-agent`. Never create `package.json`, `host.ts`, `run.ts`, or `tsconfig.json` by hand. The scaffolder generates correct dependencies, imports, and runtime wiring. Hand-rolled projects break on missing internal packages.

> **Hard rule — phases:** Do not run any shell commands, create any files, or write any code until Phase 4. Phases 1–3 are research and planning only. If you find yourself about to scaffold or edit files, stop — you skipped a phase.

### Workflow Entry Points

Determine where to start based on what the user provides:

| User provides | Start at | First action |
|---------------|----------|--------------|
| Goal statement ("build an agent that...") | Phase 1 (Explore) | Clarify requirements per §1.1 |
| Pre-scaffolded project directory | Phase 4 (Execute) | Verify scaffolder was used: check `package.json` has `@rcrsr/rill` dependency and `src/host.ts` uses `hoistExtension` |
| Only API keys or credentials | **Ask first** | Confirm whether Phases 1–3 already completed, or restart from Phase 1 |
| Bug in existing agent | Phase 4, §4.5 | Read `src/agent.rill` and `src/host.ts`, diagnose, iterate |

Never assume context. If the user's intent is ambiguous, ask which phase applies before proceeding.

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

**STOP — Phase 1 gate.** Present the user with:

- One-sentence summary of the agent's task
- List of selected extensions with rationale
- Any open questions or assumptions

Wait for explicit approval ("yes", "proceed", "looks good") before moving to Phase 2. Do not proceed on silence or ambiguity.

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

### 2.4 Define Output Strategy

Ask the user how the agent should deliver results:

| Output mode | When to use | Implementation |
|-------------|-------------|----------------|
| **JSON** (recommended) | Agent output consumed by other programs or scripts | Last expression returns a dict or list; no `log` calls in the main flow |
| **Plain text** | Human reads output directly in terminal | Last expression returns a formatted string; no `log` calls in the main flow |
| **Logged progress + result** | Long-running agent where user wants status updates | Use `log` for progress only; last expression returns the final result |

**Rules for `log` vs return value:**

- The **last expression** in `agent.rill` is the return value. `run.ts` prints it automatically via `formatOutput()`.
- `log` is for **side-effect messages only** — progress updates, debug info, status. Never `log` the final result.
- Do not `log` the same data that the last expression returns. This produces duplicated output.

**Wrong — duplicated output:**

```rill
anthropic::message($prompt) => $result
log($result.content)      # prints the content
$result.content            # run.ts prints the same content again
```

**Correct — log progress, return result:**

```rill
log("Fetching headlines...")
newsapi::headlines() => $articles
log("Summarizing {$articles -> .len} articles...")
anthropic::message("Summarize: {$articles}") => $result
$result.content            # only printed once by run.ts
```

**Correct — structured JSON return, no log:**

```rill
newsapi::headlines() => $articles
$articles -> map { [title: $.title, source: $.source.name] }
# returns list of dicts — run.ts prints as JSON
```

If the user has no preference, default to **JSON** output with no `log` calls.

### 2.5 Identify Custom Host Functions

If the agent needs capabilities no extension provides, plan custom host functions using `prefixFunctions`. Keep these minimal — prefer extensions over custom code.

**STOP — Phase 2 gate.** Present the user with:

- Data flow diagram (pipe chain sequence)
- Extension selection with configuration values
- Output strategy (JSON, plain text, or logged progress)
- Any custom host functions planned

Wait for explicit approval before moving to Phase 3. Do not proceed on silence or ambiguity.

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

**STOP — Phase 3 gate.** Present the user with:

- The exact scaffold command that will run
- List of implementation steps with expected file changes
- Environment variables that need values in `.env`

Wait for explicit approval before moving to Phase 4. Do not run any commands until approved.

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

### 4.4 Write and Review agent.rill

Replace the generated `src/agent.rill` with your agent logic. Use the data flow designed in Phase 2 and the extension functions wired in `host.ts`. See the Syntax Quick Reference and Extension Function Reference sections below.

The agent script calls extension functions using `namespace::function()` syntax. The namespace matches the first argument to `hoistExtension` in `host.ts`:

```rill
// If host.ts has: hoistExtension('newsapi', createFetchExtension({...}))
// Then agent.rill calls: newsapi::top_headlines(...)
newsapi::top_headlines([country: "us", pageSize: 5]) => $articles
```

**STOP — do not run `npm start` yet.** You must complete two steps before executing.

**Step 1: Verify against common rill mistakes.** Search your `agent.rill` code for each pattern below and fix before presenting:

| Search for | Error if found | Replace with |
|------------|---------------|--------------|
| `.length` | `Unknown method: length` | `.len` |
| Single quote `'` | `Unexpected character: '` | Double quotes `"` only |
| `$str + $str` (string + string) | `Arithmetic requires number` | Interpolation: `"{$a}{$b}"` |
| `join(` without leading `.` | `Unknown function: join` | Method syntax: `-> .join(sep)` |
| `log(` on final result | Duplicated output | `log` for progress only; last expression is sole output |
| `$.?field ?? "default"` | `Cannot combine existence check with default` | Use one: `$.field ?? "default"` or `$.?field` |

**Step 2: Present for user review:**

1. The complete `src/agent.rill` source code
2. All `src/host.ts` edits (core extensions added, configuration values, namespace choices)
3. One-line explanation of each pipe chain in the agent
4. The output strategy: what the last expression returns and whether `log` is used

Wait for explicit approval before executing. If the user requests changes, edit and re-present before running.

### 4.5 Test and Iterate

```bash
npm run start          # Execute agent.rill
npm run typecheck      # Validate types
```

Edit `src/agent.rill` to change agent behavior. Edit `src/host.ts` to add or reconfigure extensions.

### 4.6 Debugging Guidance

When the agent fails, follow this order:

1. **Read the error message.** rill errors include the line, column, and expression that failed.
2. **Reproduce with minimal input.** Isolate the failing pipe chain in a separate `.rill` file.
3. **Classify the error:**

| Symptom | Category | Action |
|---------|----------|--------|
| HTTP 4xx/5xx from fetch extension | Configuration error | Check `baseUrl`, `path`, headers, and auth in `host.ts` |
| "Undefined variable" after `??` or `=>` | Operator precedence | See Gotchas in Syntax Quick Reference |
| "File not found" for `agent.rill` | Path error | Verify `src/agent.rill` exists; `run.ts` reads from `src/agent.rill` |
| Type error on extension return value | Shape mismatch | Check return types in Extension Function Reference |
| Extension function not found | Namespace mismatch | Verify `hoistExtension` namespace in `host.ts` matches `namespace::function()` in `agent.rill` |

4. **Do not hand-edit generated files as workarounds.** If `run.ts` or scaffolded `host.ts` structure seems wrong, report upstream rather than patching locally.
5. **Do not move files** generated by the scaffolder. The directory structure in §3.1 is the source of truth.

---

## rill Syntax Quick Reference

rill scripts flow data through pipes (`->`), not assignment. Strings use double quotes only — single quotes are not valid syntax.

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

**String building** — the `+` operator is arithmetic-only. Use interpolation or `.join()`:

```text
# Interpolation — embed variables and expressions in double-quoted strings
"Hello, {$name}!"                             # variable
"Count: {$list -> .len}"                      # expression
"Result: {$x * 2}"                            # arithmetic in interpolation

# Multi-part assembly — build a list, then join
[$title, $description] -> .join(" — ")        # "Title — Description"
$items -> map { "- {$}" } -> .join("\n")      # markdown bullet list
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
fs::read("input", "data.csv") => $csv
kv::get("run_count") -> ($ + 1) -> kv::set("run_count", $)
crypto::uuid() => $request_id
```

**Gotchas — operator precedence:**

The `??` (default value) operator consumes the entire pipe chain to its right. This causes subtle bugs:

```text
$.description ?? "" => $desc     # WRONG: captures ("" => $desc) as the default
($.description ?? "") => $desc   # CORRECT: explicit grouping
```

In the wrong form, `"" => $desc` becomes the default expression — the capture only runs when the default activates, leaving `$desc` undefined on the normal path.

**Safe patterns for optional dict fields:**

```rill
# Pattern 1: group the default, then capture
($article.?description ?? "") => $desc

# Pattern 2: ternary with safe access
($article.?description) ? $article.description ! "" => $desc

# Pattern 3: capture first, then default on use
$article.?description => $desc
# ... later use $desc ?? "" where needed
```

**Other precedence rules:**

| Operator | Binds | Gotcha |
|----------|-------|--------|
| `??` | Tighter than `=>`, `->` | Always group: `(expr ?? default) => $var` |
| `=>` | Captures the result of the left-hand pipe chain | `a -> b => $x` captures the result of `a -> b` |
| `?` / `!` | Ternary binds loosely | `expr ? "yes" ! "no"` — no grouping needed |
| `.?` | Safe access returns empty string on missing key | `$dict.?missing_key` returns `""`, not an error |

---

## Extension Function Reference

Every function below shows its return type. Use these shapes to pipe results correctly.

### LLM Extensions (anthropic, openai, gemini)

All three share identical function signatures and return shapes.

| Function | Returns | Shape |
|----------|---------|-------|
| `namespace::message(prompt)` | dict | `{ content, model, usage: { input, output }, stop_reason, id, messages }` |
| `namespace::messages(messages)` | dict | Same shape — `messages` contains full conversation history |
| `namespace::embed(text)` | vector | Float32Array vector for similarity search |
| `namespace::embed_batch(texts)` | list | List of vectors |
| `namespace::tool_loop(prompt, options)` | dict | Same shape + `turns` (number of loop iterations) |

**Accessing LLM results:**

```rill
anthropic::message("Summarize: {$text}") => $result
$result.content => $answer           # response text (string)
$result.usage.input => $tokens_in    # input token count (number)
$result.stop_reason => $reason       # "end_turn", "max_tokens", etc.
```

### Vector Database Extensions (qdrant, pinecone, chroma)

All three share identical function signatures and return shapes.

| Function | Returns | Shape |
|----------|---------|-------|
| `namespace::search(vector, limit)` | list | `[{ id, score, metadata }, ...]` |
| `namespace::upsert(id, vector, metadata)` | dict | `{ id, success: true }` |
| `namespace::upsert_batch(items)` | dict | `{ succeeded }` or `{ succeeded, failed, error }` |
| `namespace::get(id)` | dict | `{ id, vector, metadata }` |
| `namespace::delete(id)` | dict | `{ id, deleted: true }` |
| `namespace::count()` | number | Total vectors in collection |
| `namespace::describe()` | dict | `{ name, count, dimensions, distance }` |

**Iterating search results:**

```rill
$embedding -> qdrant::search($, 5) => $results
$results -> each { log("{$.id}: {$.score}") }     # id and score on each hit
$results -> map { $.metadata } => $all_metadata    # extract metadata dicts
```

### fs — Sandboxed File I/O

| Function | Returns | Shape |
|----------|---------|-------|
| `fs::read(mount, path)` | string | File contents |
| `fs::write(mount, path, content)` | string | Bytes written |
| `fs::append(mount, path, content)` | string | Bytes written |
| `fs::list(mount, path?)` | list | `[{ name, type, size }, ...]` — type is `"file"` or `"directory"` |
| `fs::find(mount, pattern?)` | list | `["path/to/file.txt", ...]` — relative paths |
| `fs::exists(mount, path)` | bool | `true` or `false` |
| `fs::remove(mount, path)` | bool | `true` if deleted, `false` if absent |
| `fs::stat(mount, path)` | dict | `{ name, type, size, created, modified }` — timestamps are ISO 8601 |
| `fs::mkdir(mount, path)` | bool | `true` if created, `false` if exists |
| `fs::copy(mount, src, dest)` | bool | `true` on success |
| `fs::move(mount, src, dest)` | bool | `true` on success |
| `fs::mounts()` | list | `[{ name, mode, glob }, ...]` |

Mount modes: `read`, `write`, `read-write`. Path traversal outside mount boundary throws error.

### fetch — Pre-configured HTTP

Each endpoint in config becomes a callable function. Return shape depends on `responseShape` in config:

| responseShape | Returns | Shape |
|---------------|---------|-------|
| `'body'` (default) | varies | Parsed JSON body directly (dict, list, string, or number) |
| `'full'` | dict | `{ status, headers, body }` — status is number, headers is dict |

**Two calling conventions** — both work for every endpoint:

```rill
# Positional args — matched to params by declaration order
api::get_users(10) => $users
newsapi::top_headlines("us", 5) => $resp

# Dict/named args — matched to params by name
api::get_users([limit: 10]) => $users
newsapi::top_headlines([country: "us", pageSize: 5]) => $resp

# Introspection
api::endpoints() => $list                    # [{ name, method, path, description }, ...]
```

The runtime detects which convention you used: a single dict argument triggers named matching; anything else triggers positional matching. Both produce identical HTTP requests.

Supports retry with exponential backoff, `maxConcurrent` throttling, dynamic headers.

### exec — Sandboxed Commands

Each declared command returns a dict with `stdout`, `stderr`, and `exitCode`:

```rill
sh::git_status() => $result
$result.stdout => $output              # string (empty if no output)
$result.exitCode => $code              # number (0 = success)
sh::commands() => $list                # [{ name, description }, ...]
```

Uses `child_process.execFile()` — no shell injection. Arguments validated against allowlist/blocklist. Stdin support via second argument: `sh::jq((".",), $json_data)`.

### kv — Persistent State

| Function | Returns | Shape |
|----------|---------|-------|
| `kv::get(key)` | varies | Stored value, or `""` (empty string) if key absent |
| `kv::set(key, value)` | bool | `true` on success |
| `kv::delete(key)` | bool | `true` if existed, `false` if absent |
| `kv::has(key)` | bool | `true` or `false` |
| `kv::keys()` | list | `["key1", "key2", ...]` |
| `kv::getAll()` | dict | `{ key1: value1, key2: value2, ... }` |
| `kv::clear()` | bool | `true` |
| `kv::schema()` | list | `[{ key, type, description }, ...]` — empty list in open mode |

**Important:** `kv::get()` returns empty string `""` for missing keys, not an error. Check with `kv::has()` if you need to distinguish "empty" from "absent".

```rill
kv::get("run_count") -> ($ + 1) -> kv::set("run_count", $)
kv::keys() -> each { log($) }
```

### crypto — Hashing and Identifiers

All functions return strings (hex-encoded where applicable).

| Function | Returns | Example output |
|----------|---------|----------------|
| `crypto::hash(input)` | string | `"a7ffc6f8..."` (SHA-256 hex, 64 chars) |
| `crypto::hash(input, "sha512")` | string | SHA-512 hex (128 chars) |
| `crypto::hmac(input)` | string | HMAC hex (key configured in host.ts) |
| `crypto::uuid()` | string | `"550e8400-e29b-41d4-a716-446655440000"` |
| `crypto::random(32)` | string | 64-char hex string (2 hex chars per byte) |

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

These patterns cause broken projects or runtime errors. Avoid them.

**Project structure mistakes:**

| Mistake | Why it breaks | Correct approach |
|---------|---------------|------------------|
| Writing `package.json` by hand | Missing internal dependencies like `@rcrsr/rill-ext-llm-shared` | Run `npx @rcrsr/rill-create-agent` |
| Writing `run.ts` by hand | Wrong imports, missing `parse`/`execute` pattern, no output formatting | Use the generated `run.ts` unmodified |
| Writing `host.ts` from scratch | Missing `dotenv/config` import, wrong `hoistExtension` wiring | Edit the generated `host.ts` |
| Using raw `fetch()` or `axios` for HTTP | Bypasses sandboxing, no retry/auth, wrong function signature | Use the `fetch` core extension with `createFetchExtension` |
| Installing core extensions via npm | `fs`, `fetch`, `exec`, `kv`, `crypto` are sub-path exports of `@rcrsr/rill` | Import from `@rcrsr/rill/ext/<name>` — no extra install |
| Skipping `--extensions` flag | Scaffolder requires either `--extensions` or `--preset` | Always pass external extensions to the scaffold command |

**rill language syntax mistakes:**

| Mistake | Error message | Correct approach |
|---------|---------------|------------------|
| Single quotes: `'hello'` | `Unexpected character: '` | rill uses double quotes only: `"hello"` |
| `"text {$.field ?? 'fallback'}"` | `Unexpected character: '` | Extract default to a variable: `($.field ?? "fallback") => $val` then `"text {$val}"` |
| `a ++ b` for string concatenation | `Unexpected token: +` | Use interpolation `"{$a}{$b}"` — see string building patterns below |
| `$str1 + $str2` for string concatenation | `Arithmetic requires number, got string` | `+` is arithmetic-only in rill. Use interpolation `"{$str1}{$str2}"` or build a list and `.join("")` |
| `$.?field ?? "default"` | `Cannot combine existence check (.?field) with default value operator (??)` | Use one: `$.field ?? "default"` or `$.?field` — not both |
| `join(sep, $list)` or `$list -> join(sep)` | `Unknown function: join` | rill operations are methods, not functions: `$list -> .join(sep)` |
| `$list -> .length` | `Unknown method: length` | Use `.len` — rill method names are abbreviated |
| `$dict -> .keys` | `Unknown method: keys` | Use `.entries` for dict iteration, or `kv::keys()` for kv store |
| `log($result)` then `$result` as last line | Duplicated output — `log` prints once, `run.ts` prints the return value again | Use `log` for progress only; let the last expression be the sole output |
| Skipping phases to "save time" | Syntax errors, wrong extensions, misconfigured APIs — costs more time than the phases save | Follow all 4 phases; each gate prevents a class of errors |

**Method syntax rule:** rill data operations use `.method()` syntax, not standalone functions. Use `$list -> .join(",")`, `$str -> .upper`, `$list -> .len`, `$str -> .split(" ")`, `$str -> .trim`. The dot is required — without it, rill looks for a host function or built-in.

---

## See Also

- [Complete Language Reference](https://rill.run/llms-full.txt) — Full rill syntax for LLMs
- [Language Reference](https://rill.run/docs/reference/language/) — Core language specification
- [Host Integration](https://rill.run/docs/integration/host/) — Embedding rill in applications
- [Extensions](https://rill.run/docs/integration/extensions/) — Writing reusable function packages
- [Bundled Extensions](https://rill.run/docs/extensions/) — Extension API reference
