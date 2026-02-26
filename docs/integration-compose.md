# Compose

*Assemble and deploy rill agents from agent.json manifests*

## Overview

`@rcrsr/rill-compose` assembles rill agents from `agent.json` manifests. It resolves extensions, compiles custom functions, loads modules, and parses the entry script. The package ships as both a Node.js API and the `rill-compose` CLI.

## Installation

```bash
npm install @rcrsr/rill-compose
```

## Quick Start

Read the manifest file, validate it, then pass the validated object to `composeAgent`.

```typescript
import { readFileSync } from 'node:fs';
import { validateManifest, composeAgent } from '@rcrsr/rill-compose';

const json = JSON.parse(readFileSync('./agent.json', 'utf-8'));
const manifest = validateManifest(json);
const agent = await composeAgent(manifest, { basePath: import.meta.dirname });

// Use agent.context, agent.ast, agent.modules...
await agent.dispose();
```

`composeAgent` takes a validated `AgentManifest` object, not a file path.

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
| `output` | OutputDescriptor | no | — | Expected output type descriptor for discovery and tooling |
| `host` | ManifestHostOptions | no | — | Runtime configuration |
| `deploy` | ManifestDeployOptions | no | — | Deployment configuration |

### ManifestExtension Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `package` | string | yes | npm package name, `@rcrsr/rill/ext/<name>`, or relative path |
| `config` | Record\<string, unknown\> | no | Extension-specific config; supports `${VAR}` interpolation |

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
| `stateBackend` | string | none | State backend identifier |

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

### OutputDescriptor Fields

`output` describes the shape of the value the agent returns. The host does not validate runtime output against this descriptor — it exists for discovery and tooling only.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'string' \| 'number' \| 'bool' \| 'list' \| 'dict'` | yes | Rill type of the output value |
| `description` | string | no | Human-readable description for discovery and tooling |
| `fields` | Record\<string, OutputDescriptor\> | no | Sub-descriptors for each key when `type` is `'dict'` |

`OutputDescriptor` omits `required` and `default` — those fields apply to input parameters only.

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
      "package": "@rcrsr/rill-ext-anthropic",
      "config": { "api_key": "${ANTHROPIC_API_KEY}" }
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
| `env` | Record\<string, string\> | `process.env` | Environment variables for `${VAR}` interpolation |

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
| `env` | Record\<string, string\> | Environment variables for interpolation |

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

String values in `extensions[*].config` support `${VAR_NAME}` syntax. `composeAgent` substitutes values from `process.env` (or `options.env`). Only uppercase identifiers matching `[A-Z_][A-Z0-9_]*` are substituted. Unresolved variables remain as-is in the config.

```json
"config": { "api_key": "${ANTHROPIC_API_KEY}" }
```

---

## Error Types

### ComposeError

```typescript
class ComposeError extends Error {
  readonly phase: ComposePhase;  // 'validation' | 'resolution' | 'compatibility' | 'compilation' | 'bundling' | 'init'
  readonly fieldPath?: string;
}
```

Base error for all rill-compose failures. The `phase` field identifies where composition failed.

### ManifestValidationError

```typescript
class ManifestValidationError extends ComposeError {
  readonly issues: readonly ManifestIssue[];  // { path, message, line? }
}
```

Thrown by `validateManifest` when the JSON fails schema validation. Each issue contains a dot-notation `path` (e.g., `"manifest.extensions.llm.package"`) and a human-readable `message`.

**Error handling example:**

```typescript
import { validateManifest, ManifestValidationError, ComposeError } from '@rcrsr/rill-compose';

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
rill-compose init <project-name> [--extensions <list>]
rill-compose <manifest-path> [--target <target>] [--output <dir>]
```

### init subcommand

| Argument | Description |
|----------|-------------|
| `project-name` | Valid npm package name (lowercase, hyphens, underscores, or scoped `@scope/name`) |
| `--extensions` | Comma-separated extension names: `anthropic`, `openai`, `qdrant`, `fetch`, `kv`, `fs` |

### build subcommand

| Option | Default | Description |
|--------|---------|-------------|
| `--target` | `container` | Build target: `container`, `lambda`, `worker`, `local` |
| `--output` | `dist/` | Output directory |

### Examples

```bash
rill-compose init my-agent --extensions anthropic,kv
rill-compose agent.json --target container --output dist/
```

---

## See Also

| Document | Description |
|----------|-------------|
| [Agent Host](integration-agent-host.md) | Production HTTP server for rill agents |
| [Host Integration](integration-host.md) | Embedding rill without the HTTP layer |
| [Bundled Extensions](bundled-extensions.md) | Pre-built extensions shipped with rill |
| [Creating rill Apps](guide-make.md) | Workflow guide for building rill agent projects |

