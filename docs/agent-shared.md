# rill-agent-shared

*Shared types, validation, and card generation for rill agent packages*

## Overview

`@rcrsr/rill-agent-shared` exports the types, validation functions, and error classes shared across `@rcrsr/rill-agent-harness`, `@rcrsr/rill-agent-bundle`, and `@rcrsr/rill-agent-run`. Import directly from this package when you need types or utilities without taking a dependency on a full runtime package.

## Installation

```bash
npm install @rcrsr/rill-agent-shared
```

## Exports

### Types

| Type | Description |
|------|-------------|
| `AgentManifest` | Validated single-agent manifest object |
| `HarnessManifest` | Validated harness manifest object |
| `HarnessAgentEntry` | Single agent entry within a harness manifest |
| `ManifestExtension` | Extension reference with `package` and optional `config` |
| `ManifestHostOptions` | Runtime configuration options (`timeout`, `maxCallStackDepth`, `requireDescriptions`) |
| `ManifestDeployOptions` | Deployment configuration options (`port`, `healthPath`) |
| `InputParamDescriptor` | Input parameter definition with `type`, `required`, `description`, and `default` |
| `InputSchema` | Map of parameter names to `InputParamDescriptor` |
| `OutputSchema` | Output type descriptor with `type`, `description`, and optional `fields` |
| `EnvSource` | Environment variable source descriptor |
| `BuildTarget` | Target platform identifier for bundle validation |
| `AgentSkill` | Skill definition with `id`, `name`, `description`, and optional metadata |
| `AgentCard` | A2A-compliant agent capability card |
| `AgentCapabilities` | Flags for `streaming` and `pushNotifications` support |
| `ManifestIssue` | Single validation issue with `path`, `message`, and optional `line` |
| `ComposePhase` | Phase identifier: `'validation' \| 'resolution' \| 'compatibility' \| 'compilation' \| 'bundling' \| 'init'` |
| `AgentRunner` | Function type for executing a composed agent |
| `ComposedHandler` | Single composed agent handler function |
| `ComposedHandlerMap` | Map from agent name to `ComposedHandler` |
| `HandlerContext` | Execution context passed to a composed handler |
| `RunRequest` | Input to a `/run` invocation |
| `RunResponse` | Output from a `/run` invocation |
| `InProcessRunRequest` | Input for in-process agent invocation |
| `InProcessRunResponse` | Output from in-process agent invocation |

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `validateManifest` | `(json: unknown) => AgentManifest` | Validates raw JSON against the single-agent schema |
| `validateHarnessManifest` | `(json: unknown) => HarnessManifest` | Validates raw JSON against the harness schema |
| `detectManifestType` | `(raw: unknown) => 'agent' \| 'harness'` | Returns `'harness'` when `raw` has an `agents` key |
| `generateAgentCard` | `(manifest: AgentManifest, url: string) => AgentCard` | Builds an A2A-compliant `AgentCard` from a manifest |
| `resolveExtensions` | `(extensions, options) => Promise<ResolvedExtension[]>` | Loads extension factories from package references |
| `interpolateEnv` | `(value: string, env: Record<string, string>) => string` | Substitutes `${VAR}` tokens using the provided env map |
| `loadEnv` | `(sources: EnvSource[]) => Record<string, string>` | Loads and merges environment variables from declared sources |
| `checkTargetCompatibility` | `(bundle, target: BuildTarget) => ManifestIssue[]` | Returns issues when the bundle does not meet platform constraints |

### Error Classes

| Class | Description |
|-------|-------------|
| `ComposeError` | Base error for all composition failures; carries a `phase: ComposePhase` field |
| `ManifestValidationError` | Extends `ComposeError`; carries an `issues: readonly ManifestIssue[]` field |

## Usage Examples

### validateManifest

```typescript
import { validateManifest, ManifestValidationError } from '@rcrsr/rill-agent-shared';
import { readFileSync } from 'node:fs';

const json = JSON.parse(readFileSync('./agent.json', 'utf-8'));

try {
  const manifest = validateManifest(json);
  console.log(manifest.name, manifest.version);
} catch (err) {
  if (err instanceof ManifestValidationError) {
    for (const issue of err.issues) {
      console.error(`${issue.path}: ${issue.message}`);
    }
  }
}
```

### detectManifestType

```typescript
import { detectManifestType, validateManifest, validateHarnessManifest } from '@rcrsr/rill-agent-shared';
import { readFileSync } from 'node:fs';

const json = JSON.parse(readFileSync('./manifest.json', 'utf-8'));
const type = detectManifestType(json);

if (type === 'harness') {
  const harness = validateHarnessManifest(json);
  console.log(`Harness with ${harness.agents.length} agents`);
} else {
  const manifest = validateManifest(json);
  console.log(`Single agent: ${manifest.name}`);
}
```

### resolveExtensions

```typescript
import { resolveExtensions } from '@rcrsr/rill-agent-shared';

const extensions = {
  llm: { package: '@rcrsr/rill-ext-anthropic', config: { api_key: '${ANTHROPIC_API_KEY}' } },
};

const resolved = await resolveExtensions(extensions, {
  manifestDir: import.meta.dirname,
  env: process.env as Record<string, string>,
});

console.log(resolved.map(r => r.name));
```

## Error Classes

### ComposeError

```typescript
class ComposeError extends Error {
  readonly phase: ComposePhase;
  readonly fieldPath?: string;
}
```

The `phase` field identifies where in the composition pipeline the failure occurred. Use it to provide targeted error messages.

| Phase | Trigger |
|-------|---------|
| `'validation'` | Manifest schema validation failed |
| `'resolution'` | Extension package could not be loaded |
| `'compatibility'` | Bundle does not meet platform constraints |
| `'compilation'` | Custom function compilation failed |
| `'bundling'` | Bundle output write failed |
| `'init'` | Project initialization failed |

### ManifestValidationError

```typescript
class ManifestValidationError extends ComposeError {
  readonly issues: readonly ManifestIssue[];
}

interface ManifestIssue {
  readonly path: string;    // dot-notation field path, e.g. "manifest.extensions.llm.package"
  readonly message: string; // human-readable description of the problem
  readonly line?: number;   // source line number when available
}
```

`ManifestValidationError` is thrown by `validateManifest` and `validateHarnessManifest`. The `issues` array contains one entry per validation failure, with a dot-notation `path` and a human-readable `message`.

## See Also

| Document | Description |
|----------|-------------|
| [Agent Harness](agent-harness.md) | Production HTTP server that uses these types at runtime |
| [Agent Bundle](agent-bundle.md) | CLI and API for building agent bundles from manifests |
| [Agent Run](agent-run.md) | Execute bundled agents using the `RunRequest`/`RunResult` types |
