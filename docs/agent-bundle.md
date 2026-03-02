# rill Agent Bundle

*Assemble rill agents from agent.json manifests into deployable bundles*

## Overview

`@rcrsr/rill-agent-bundle` assembles rill agents from `agent.json` manifests. It resolves extensions, compiles custom functions, loads modules, and parses the entry script. The package ships as both a Node.js API and the `rill-agent-bundle` CLI.

## Installation

```bash
npm install @rcrsr/rill-agent-bundle
```

## Quick Start

Build a bundle from an `agent.json` manifest using the CLI:

```bash
rill-agent-bundle build agent.json --output dist/
```

To build programmatically, import `buildBundle` from `@rcrsr/rill-agent-bundle`:

```typescript
import { buildBundle } from '@rcrsr/rill-agent-bundle';

await buildBundle('./agent.json', { outputDir: './dist' });
```

To validate a manifest and compose an agent for programmatic use, import from `@rcrsr/rill-agent-shared` (for validation) and `@rcrsr/rill-agent-harness` (for composition). See [Agent Harness](agent-harness.md) for full details.

---

## Manifest Format

`agent.json` defines all composition inputs. Every field listed as required must be present.

### Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Package name for the agent |
| `version` | string | yes | — | Semver version string (e.g., `"1.0.0"`) |
| `runtime` | string | yes | — | rill runtime constraint: `"@rcrsr/rill@^0.8.0"` |
| `entry` | string | yes | — | Path to entry `.rill` file, relative to manifest |
| `modules` | Record\<string, string\> | no | `{}` | Module alias → `.rill` file path |
| `extensions` | Record\<string, ManifestExtension\> | no | `{}` | Extension alias → config |
| `functions` | Record\<string, string\> | no | `{}` | `"app::name"` → `.ts` source path |
| `assets` | string[] | no | `[]` | Additional asset paths to include |
| `description` | string | no | — | Agent description for A2A discovery |
| `skills` | AgentSkill[] | no | `[]` | Agent skill declarations |
| `input` | Record\<string, InputParamDescriptor\> | no | `{}` | Named input parameters with type and validation rules |
| `output` | OutputSchema | no | — | Expected output type descriptor for discovery and tooling |
| `host` | ManifestHostOptions | no | — | Runtime configuration |
| `deploy` | ManifestDeployOptions | no | — | Deployment configuration |

### ManifestExtension Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `package` | string | yes | npm package name, `@rcrsr/rill/ext/<name>`, or relative path |

### ManifestHostOptions Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | number | none | Execution timeout in ms |
| `maxCallStackDepth` | number | `100` | Maximum call stack depth |
| `requireDescriptions` | boolean | `false` | Require descriptions on all host functions |

### ManifestDeployOptions Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | none | HTTP port for deployment |
| `healthPath` | string | `"/health"` | Health check endpoint path |

### AgentSkill Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique skill identifier |
| `name` | string | yes | Human-readable name |
| `description` | string | yes | Purpose description |
| `tags` | string[] | no | Categorization tags |
| `examples` | string[] | no | Example invocations |
| `inputModes` | string[] | no | Supported input MIME types |
| `outputModes` | string[] | no | Supported output MIME types |

### InputParamDescriptor Fields

`input` maps parameter names to descriptors. The host validates each call argument against its descriptor before executing the entry script.

| Field | Type | Required | Input only | Description |
|-------|------|----------|------------|-------------|
| `type` | `'string' \| 'number' \| 'bool' \| 'list' \| 'dict'` | yes | no | Rill type the value must match |
| `required` | boolean | no | yes | Whether callers must supply this parameter; defaults to `false` |
| `description` | string | no | no | Human-readable description for discovery and tooling |
| `default` | JSON value | no | yes | Value used when the parameter is omitted; must match `type` |

### OutputSchema Fields

`output` describes the shape of the value the agent returns. The host does not validate runtime output against this descriptor — it exists for discovery and tooling only.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'string' \| 'number' \| 'bool' \| 'list' \| 'dict'` | yes | Rill type of the output value |
| `description` | string | no | Human-readable description for discovery and tooling |
| `fields` | Record\<string, OutputSchema\> | no | Sub-descriptors for each key when `type` is `'dict'` |

`OutputSchema` omits `required` and `default` — those fields apply to input parameters only.

### JSON-to-rill Type Mapping

The `type` field uses rill type names. This table shows how each name maps to a JSON input value and a JavaScript runtime check.

| Rill Type | JavaScript Check | JSON Input |
|-----------|-----------------|------------|
| `string` | `typeof v === 'string'` | `"text"` |
| `number` | `typeof v === 'number'` | `42` |
| `bool` | `typeof v === 'boolean'` | `true` |
| `list` | `Array.isArray(v)` | `[1, 2]` |
| `dict` | plain object (`typeof v === 'object' && !Array.isArray(v)`) | `{"k": "v"}` |

### Example agent.json

```json
{
  "name": "my-agent",
  "version": "0.1.0",
  "runtime": "@rcrsr/rill@^0.8.0",
  "entry": "main.rill",
  "description": "An agent that answers questions using a knowledge base",
  "input": {
    "question": {
      "type": "string",
      "required": true,
      "description": "The question to answer"
    },
    "language": {
      "type": "string",
      "required": false,
      "description": "Response language code",
      "default": "en"
    }
  },
  "output": {
    "type": "dict",
    "description": "Answer with supporting metadata",
    "fields": {
      "answer": { "type": "string" },
      "confidence": { "type": "number" },
      "sources": { "type": "list" }
    }
  },
  "skills": [
    {
      "id": "answer-question",
      "name": "Answer Question",
      "description": "Answers natural language questions from a knowledge base",
      "tags": ["qa", "knowledge-base"],
      "examples": ["What is the refund policy?", "How do I reset my password?"]
    }
  ],
  "extensions": {
    "llm": {
      "package": "@rcrsr/rill-ext-anthropic"
    },
    "kv": {
      "package": "@rcrsr/rill/ext/kv"
    }
  },
  "host": {
    "timeout": 30000
  }
}
```

---

## AHI Extension in Manifests

The Agent-to-Host Interface (AHI) extension (`@rcrsr/rill-agent-ext-ahi`) lets a rill agent call other agents by name. Configure it in the `extensions` block of `agent.json`.

### Static URL Mode

Use static URL mode when agent endpoints are fixed at deploy time.

```json
{
  "extensions": {
    "ahi": {
      "package": "@rcrsr/rill-agent-ext-ahi"
    }
  }
}
```

The AHI config (`agents` map, `timeout`) is no longer embedded in the manifest. Pass it at runtime via `--config ahi=...` or the `config` option to `composeAgent`. See [Agent Run](agent-run.md) for config flag usage.

### Registry Mode

Use registry mode when agent endpoints are resolved at runtime from a service registry.

```json
{
  "extensions": {
    "ahi": {
      "package": "@rcrsr/rill-agent-ext-ahi"
    }
  }
}
```

In registry mode, `agents` is a string array of agent names. The AHI extension resolves each name to an endpoint via the registry at call time. Pass the registry URL and agent list at runtime via `--config` or `composeAgent`'s `config` option.

### AHI Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `agents` | `Record<string, {url: string}>` or `string[]` | Static URL dict (static mode) or agent name list (registry mode) |
| `registry` | string | Registry base URL; required in registry mode |
| `timeout` | number | Per-call timeout in ms (default: 30000) |

### `ahiDependencies` and Self-Registration

When `RILL_REGISTRY_URL` is set, the host self-registers after binding its port. If the runtime config `agents` field is a string array (registry mode), those names populate the `dependencies` field of the registration payload. The registry uses this to track which agents depend on which other agents.

```json
{
  "extensions": {
    "ahi": {
      "package": "@rcrsr/rill-agent-ext-ahi"
    }
  }
}
```

With the manifest above and `RILL_REGISTRY_URL` set, the host registers with `dependencies: ["parser", "classifier"]` when the runtime config provides `agents` as a string array.

If `agents` is a dict (static mode), `dependencies` is an empty array — static-mode agents declare their endpoints directly and do not require registry resolution.

See [Agent Harness](agent-harness.md) for full self-registration behavior.

---

## Harness Manifests

A harness manifest runs multiple rill agents in one process. Use it instead of `agent.json` when agents share infrastructure (LLM client, database, key-value store) and you want a single deployment unit.

The `agents` key distinguishes a harness manifest from a single-agent manifest. `detectManifestType()` reads this key to select the correct validation path.

### HarnessManifest Schema

```typescript
interface HarnessManifest {
  readonly host?: {
    port?: number;
    maxConcurrency?: number;
  };
  readonly shared?: Record<string, ManifestExtension>;
  readonly agents: HarnessAgentEntry[];
}

interface HarnessAgentEntry {
  readonly name: string;
  readonly entry: string;
  readonly modules?: Record<string, string>;
  readonly extensions?: Record<string, ManifestExtension>;
  readonly maxConcurrency?: number;
  readonly input?: InputSchema;
  readonly output?: OutputSchema;
}
```

### Field Reference

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `host.port` | number | No | Process-level HTTP port |
| `host.maxConcurrency` | number | No | Global session cap for all agents |
| `shared` | Record\<string, ManifestExtension\> | No | Extensions instantiated once, shared across all agents |
| `agents` | HarnessAgentEntry[] | Yes | Minimum 1 element |
| `agents[].name` | string | Yes | Unique within the harness; used in routing and metrics |
| `agents[].entry` | string | Yes | Relative path to `.rill` file |
| `agents[].modules` | Record\<string, string\> | No | Per-agent module map |
| `agents[].extensions` | Record\<string, ManifestExtension\> | No | Per-agent extensions (additive to shared) |
| `agents[].maxConcurrency` | number | No | Per-agent session cap |
| `agents[].input` | InputSchema | No | Per-agent input contract |
| `agents[].output` | OutputSchema | No | Per-agent output contract |

**Defaults:**

- `host` is optional. Omitting it applies no port or concurrency defaults at the manifest level.
- `shared` defaults to `{}` when absent. Agents receive no shared extensions.
- `agents[].maxConcurrency` defaults to `Math.floor(host.maxConcurrency / agents.length)` when `host.maxConcurrency` is set and the per-agent cap is absent. When `host.maxConcurrency` is also absent, no per-agent cap is enforced.

`validateHarnessManifest()` throws on namespace collisions across shared + per-agent extensions and when per-agent cap sums exceed `host.maxConcurrency`.

### Example harness.json

```json
{
  "host": {
    "port": 8080,
    "maxConcurrency": 30
  },
  "shared": {
    "llm": {
      "package": "@rcrsr/rill-ext-anthropic"
    },
    "kv": {
      "package": "@rcrsr/rill-ext-kv-sqlite"
    }
  },
  "agents": [
    {
      "name": "classifier",
      "entry": "classify.rill",
      "maxConcurrency": 10
    },
    {
      "name": "resolver",
      "entry": "resolve.rill",
      "maxConcurrency": 5,
      "extensions": {
        "vectors": {
          "package": "@rcrsr/rill-ext-qdrant"
        }
      }
    },
    {
      "name": "summarizer",
      "entry": "summarize.rill"
    }
  ]
}
```

The `resolver` agent adds its own `vectors` extension on top of the shared `llm` and `kv` extensions. The `summarizer` agent receives only the shared extensions.

---

## Bundle Output

`rill-agent-bundle build` produces a bundle directory containing all agent files, resolved dependencies, and manifests. The bundle directory is self-contained and can be passed directly to `rill-agent-run` for execution.

| Output File | Description |
|-------------|-------------|
| `agent.json` | Validated manifest (normalized) |
| `*.rill` | Entry and module scripts |
| `functions/` | Compiled custom host function sources |
| `extensions.json` | Resolved extension dependency map |
| `assets/` | Additional asset files declared in `assets[]` |

The bundle does not include Dockerfile, zip archive, or Worker artifacts. Platform-specific packaging is the responsibility of the deployment tooling that consumes the bundle.

---

## API Reference

### validateManifest(json)

```typescript
function validateManifest(json: unknown): AgentManifest
```

Parses and validates raw JSON against the `AgentManifest` schema. Returns the validated manifest on success. Throws `ManifestValidationError` with structured field paths on failure.

### composeAgent(manifest, options?)

```typescript
async function composeAgent(
  manifest: AgentManifest,
  options?: ComposeOptions
): Promise<ComposedAgent>
```

Resolves extensions, compiles custom functions, loads modules, and parses the entry script. Returns a `ComposedAgent` ready to execute.

**ComposeOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | string | `process.cwd()` | Base directory for resolving relative paths in manifest |
| `config` | `Record<string, Record<string, unknown>>` | required | Extension config keyed by extension alias |

> **Note:** Always pass `basePath: import.meta.dirname` (or `__dirname`) when the manifest lives in a different directory than the process working directory. Entry and module paths resolve relative to `basePath`.

**ComposedAgent interface:**

| Property | Type | Description |
|----------|------|-------------|
| `context` | RuntimeContext | Initialized runtime context with all extensions registered |
| `ast` | ScriptNode | Parsed entry script AST |
| `modules` | Record\<string, Record\<string, RillValue\>\> | Executed module exports by alias |
| `card` | AgentCard | Agent capability card |
| `dispose()` | Promise\<void\> | Releases all extension resources in reverse declaration order |

Throws `ComposeError` on any composition failure.

### detectManifestType(raw)

```typescript
export function detectManifestType(raw: unknown): 'agent' | 'harness';
```

Returns `'harness'` if `raw` is an object containing an `agents` key. Returns `'agent'` for all other inputs including non-objects and `null`. Never throws.

The CLI and host API call `detectManifestType()` first, then route to `validateManifest()` or `validateHarnessManifest()`.

### validateHarnessManifest(raw)

```typescript
export function validateHarnessManifest(raw: unknown): HarnessManifest;
```

Validates `raw` against the `HarnessManifest` zod schema. Returns the validated manifest on success.

Throws `ManifestValidationError` on:

| Condition | Example |
|-----------|---------|
| Missing required fields | `agents` array absent |
| Duplicate agent names | Two entries with `name: "classifier"` |
| Per-agent cap sum exceeds `host.maxConcurrency` | Sum of `maxConcurrency` values exceeds global cap |
| Namespace collision across shared + per-agent extensions | Same extension key in `shared` and `agents[].extensions` |

### composeHarness(manifest, options?)

```typescript
export async function composeHarness(
  manifest: HarnessManifest,
  options?: ComposeOptions
): Promise<ComposedHarness>;
```

Assembles all agents in a harness manifest into a single `ComposedHarness`.

**Composition sequence:**

1. Validate the harness manifest (zod).
2. Validate provided config against each extension's `configSchema`.
3. Resolve and instantiate `shared` extensions once.
4. For each agent in `agents[]`:
   - Resolve and instantiate per-agent extensions.
   - Merge shared + per-agent extensions. Per-agent overrides shared on namespace collision.
   - Parse the entry `.rill` file and load modules.
   - Create `RuntimeContext` with the merged function map.
   - Generate `AgentCard` from agent-level fields.
   - Construct `ComposedAgent`.
5. Return `ComposedHarness` with `agents: Map<string, ComposedAgent>`.

Throws `ComposeError` if any extension fails to resolve or instantiate. Disposes already-instantiated extensions before throwing.

**ComposedHarness interface:**

| Member | Type | Description |
|--------|------|-------------|
| `agents` | Map\<string, ComposedAgent\> | All composed agents keyed by name |
| `sharedExtensions` | Record\<string, ExtensionResult\> | Shared extension instances |
| `bindHost(host)` | void | Wires in-process shortcut functions for co-located agents |
| `dispose()` | Promise\<void\> | Releases all extension resources |

`bindHost(host)` must be called after `createAgentHost()` returns. Calling `dispose()` before `bindHost()` is safe.

**Quick start:**

> `composeHarness`, `validateHarnessManifest`, and `detectManifestType` are exported from `@rcrsr/rill-agent-harness`, not `@rcrsr/rill-agent-bundle`. Install `@rcrsr/rill-agent-harness` separately to use these functions. See [Agent Harness](agent-harness.md) for the full harness API.

```typescript
import { readFileSync } from 'node:fs';
import { detectManifestType, validateHarnessManifest } from '@rcrsr/rill-agent-shared';
import { composeHarness } from '@rcrsr/rill-agent-harness';

const json = JSON.parse(readFileSync('./harness.json', 'utf-8'));
if (detectManifestType(json) !== 'harness') throw new Error('Not a harness manifest');

const manifest = validateHarnessManifest(json);
const harness = await composeHarness(manifest, { basePath: import.meta.dirname, config: {} });

// harness.agents is a Map<string, ComposedAgent>
await harness.dispose();
```

### resolveExtensions(extensions, options)

```typescript
async function resolveExtensions(
  extensions: Record<string, ManifestExtension>,
  options: ResolveOptions
): Promise<ResolvedExtension[]>
```

Loads extension factories from package references. Auto-detects resolution strategy from the `package` field.

**Resolution strategies:**

| Strategy | Pattern | Example |
|----------|---------|---------|
| `local` | Starts with `./` or `../` | `"./my-ext.js"` |
| `builtin` | Starts with `@rcrsr/rill/ext/` | `"@rcrsr/rill/ext/kv"` |
| `npm` | All other package names | `"@scope/my-extension"` |

**Built-in extension names:** `fs`, `fetch`, `exec`, `kv`, `crypto`

**ResolveOptions:**

| Option | Type | Description |
|--------|------|-------------|
| `manifestDir` | string | Directory for resolving local extension paths |

Throws `ComposeError` (phase: `'resolution'`) if a package is not found or a namespace collision occurs.

### initProject(name, options?)

```typescript
async function initProject(name: string, options?: InitOptions): Promise<void>
```

Creates a new project directory with `agent.json`, `main.rill`, and `package.json`. Creates `.env.example` when the selected extensions require environment variables.

**InitOptions:**

| Option | Type | Description |
|--------|------|-------------|
| `extensions` | string[] | Extension names to pre-configure |

**Supported extension names for `--extensions`:** `anthropic`, `openai`, `qdrant`, `fetch`, `kv`, `fs`

Throws `ComposeError` (phase: `'init'`) if the directory exists, the name is invalid, or an extension name is unknown.

---

## Environment Interpolation

Extension config is no longer embedded in manifests. Pass config at runtime via the `--config` flag (CLI) or the `config` option to `composeAgent`.

Config values support `${VAR_NAME}` interpolation when loaded from a file or inline JSON string. The CLI applies interpolation against `process.env` before passing config to `composeAgent`. Only uppercase identifiers matching `[A-Z_][A-Z0-9_]*` are substituted. Unresolved variables remain as-is.

---

## Error Types

### ComposeError

```typescript
class ComposeError extends Error {
  readonly phase: ComposePhase;  // 'validation' | 'resolution' | 'compatibility' | 'compilation' | 'bundling' | 'init'
  readonly fieldPath?: string;
}
```

Base error for all rill-agent-bundle failures. The `phase` field identifies where composition failed.

### ManifestValidationError

```typescript
class ManifestValidationError extends ComposeError {
  readonly issues: readonly ManifestIssue[];  // { path, message, line? }
}
```

Thrown by `validateManifest` when the JSON fails schema validation. Each issue contains a dot-notation `path` (e.g., `"manifest.extensions.llm.package"`) and a human-readable `message`.

**Error handling example:**

```typescript
import { validateManifest, ManifestValidationError, ComposeError } from '@rcrsr/rill-agent-shared';

try {
  const manifest = validateManifest(json);
} catch (err) {
  if (err instanceof ManifestValidationError) {
    for (const issue of err.issues) {
      console.error(`${issue.path}: ${issue.message}`);
    }
  }
}
```

---

## CLI

### Commands

```bash
rill-agent-bundle build <manifest-path> [--output <dir>]
rill-agent-bundle init <project-name> [--extensions <ext1,ext2>]
rill-agent-bundle check --platform <name> [<bundle-path>]
```

### build subcommand

| Argument | Description |
|----------|-------------|
| `manifest-path` | Path to `agent.json` or `harness.json` |
| `--output` | Output directory (default: `dist/`) |

`build` validates the manifest, resolves all extensions, and writes a bundle directory to `--output`. The bundle directory is self-contained and ready for `rill-agent-run`.

### init subcommand

| Argument | Description |
|----------|-------------|
| `project-name` | Valid npm package name (lowercase, hyphens, underscores, or scoped `@scope/name`) |
| `--extensions` | Comma-separated extension names: `anthropic`, `openai`, `qdrant`, `fetch`, `kv`, `fs` |

### check subcommand

| Argument | Description |
|----------|-------------|
| `--platform` | Target platform name to validate against |
| `bundle-path` | Path to bundle directory (default: current directory) |

`check` validates that a bundle directory meets the constraints of the named platform. Returns exit code 0 on success, exit code 1 on failure.

### Examples

```bash
rill-agent-bundle init my-agent --extensions anthropic,kv
rill-agent-bundle build agent.json --output dist/
rill-agent-bundle check --platform cloud dist/
```

---

## See Also

| Document | Description |
|----------|-------------|
| [Agent Harness](agent-harness.md) | Production HTTP server for rill agents |
| [Agent Run](agent-run.md) | Execute bundled rill agents from the command line |
| [Agent Shared](agent-shared.md) | Shared types, validation, and card generation |
| [Host Integration](integration-host.md) | Embedding rill without the HTTP layer |
| [Bundled Extensions](bundled-extensions.md) | Pre-built extensions shipped with rill |
| [Creating rill Apps](guide-make.md) | Workflow guide for building rill agent projects |
