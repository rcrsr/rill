# rill Config API Reference

*TypeScript API for the `@rcrsr/rill-config` shared configuration library*

## Package Import

```typescript
import {
  resolveConfigPath,
  parseConfig,
  checkRuntimeVersion,
  validateContext,
  validateBundleRestrictions,
  parseMainField,
  resolveMounts,
  detectNamespaceCollisions,
  loadExtensions,
  buildExtensionBindings,
  buildContextBindings,
  buildResolvers,
  loadProject,
  introspectHandler,
  marshalCliArgs,
} from '@rcrsr/rill-config';
```

The package path is `@rcrsr/rill-config`. All functions, types, and error classes documented here are public exports.

---

## Process Isolation Contract

The library never calls `process.exit()`. It never writes to `process.stdout` or `process.stderr`. It never reads `process.env`. Callers supply all environment variables via the `env` parameter on each function that requires them.

---

## `.env` Auto-Loading

The `rill-run` CLI loads `.env` automatically using `dotenv` before calling library functions. The library itself never calls `dotenv.config()`.

Embedded callers must supply pre-resolved environment variables. Resolve your `.env` file before passing values to `parseConfig` or `loadProject`:

```typescript
import { config } from 'dotenv';
import { loadProject } from '@rcrsr/rill-config';

// Caller resolves .env; library receives pre-resolved values
const env = config().parsed ?? {};

const result = await loadProject({
  configPath: './rill.config.json',
  env,
  rillVersion: '1.2.0',
});
```

---

## Exported Functions

### `resolveConfigPath`

```typescript
resolveConfigPath(options: { configFlag?: string; cwd: string }): string
```

Locates the config file path. Walks ancestor directories from `cwd` when `configFlag` is absent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.configFlag` | `string` | No | Explicit path from `--config` CLI flag |
| `options.cwd` | `string` | Yes | Working directory to begin the ancestor walk |

**Returns:** Absolute path to the config file.

**Throws:** `ConfigNotFoundError` (EC-1) when no config file is found.

---

### `parseConfig`

```typescript
parseConfig(raw: string, env: Record<string, string>): RillConfigFile
```

Parses and validates a raw JSON config string. Substitutes `${VAR}` references using `env`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `raw` | `string` | Yes | Raw JSON content of the config file |
| `env` | `Record<string, string>` | Yes | Pre-resolved environment variables |

**Returns:** Validated `RillConfigFile`.

**Throws:** `ConfigParseError` (EC-2) on invalid JSON. Throws `ConfigEnvError` (EC-3) on missing env vars. Throws `ConfigValidationError` (EC-4) on invalid field types or orphaned config keys.

---

### `checkRuntimeVersion`

```typescript
checkRuntimeVersion(constraint: string, installedVersion: string): void
```

Validates that `installedVersion` satisfies the semver `constraint` from the config file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `constraint` | `string` | Yes | Semver constraint string (e.g., `">=1.0.0"`) |
| `installedVersion` | `string` | Yes | Installed rill version string |

**Returns:** `void` on success.

**Throws:** `RuntimeVersionError` (EC-5) on version mismatch or invalid semver constraint.

---

### `validateContext`

```typescript
validateContext(context: ContextBlock): Record<string, unknown>
```

Validates context values against their schema types.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `context` | `ContextBlock` | Yes | Context block from the config file |

**Returns:** Validated context values as a plain object.

**Throws:** `ContextValidationError` (EC-12) on missing values or type mismatches.

---

### `validateBundleRestrictions`

```typescript
validateBundleRestrictions(config: RillConfigFile): void
```

Checks that the config file contains no fields prohibited at bundle time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config` | `RillConfigFile` | Yes | Parsed config to validate |

**Returns:** `void` on success.

**Throws:** `BundleRestrictionError` (EC-14) when prohibited fields are present.

---

### `parseMainField`

```typescript
parseMainField(main: string): { filePath: string; handlerName?: string }
```

Parses the `main` field of the config file into its file path and optional handler name.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `main` | `string` | Yes | Raw `main` field value (e.g., `"script.rill"` or `"script.rill::handler"`) |

**Returns:** Object with `filePath` and optional `handlerName`.

**Throws:** `ConfigValidationError` (EC-4) on empty path or invalid format.

---

### `resolveMounts`

```typescript
resolveMounts(mounts: Record<string, string>): ResolvedMount[]
```

Validates and resolves raw mount definitions from the config into structured `ResolvedMount` objects.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mounts` | `Record<string, string>` | Yes | Raw mount map from the config file |

**Returns:** Array of `ResolvedMount` objects.

**Throws:** `MountValidationError` (EC-6) on invalid segments or conflicting version constraints.

---

### `detectNamespaceCollisions`

```typescript
detectNamespaceCollisions(mounts: ResolvedMount[]): void
```

Checks for cross-package mount path collisions (exact match or prefix overlap).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mounts` | `ResolvedMount[]` | Yes | Resolved mount definitions |

**Returns:** `void` on success.

**Throws:** `NamespaceCollisionError` (EC-9/EC-13) when mount paths from different packages conflict or have prefix overlap.

---

### `loadExtensions`

```typescript
loadExtensions(
  mounts: ResolvedMount[],
  config: Record<string, Record<string, unknown>>
): Promise<LoadedProject>
```

Loads all extension packages listed in `mounts` and applies per-extension config.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mounts` | `ResolvedMount[]` | Yes | Resolved mount definitions |
| `config` | `Record<string, Record<string, unknown>>` | Yes | Per-extension config keyed by mount path |

**Returns:** `Promise<LoadedProject>` containing all loaded extension data.

**Throws:** `ExtensionLoadError` (EC-7) when a package is not found, has no manifest, or the factory fails. Throws `ExtensionVersionError` (EC-10) on version constraint mismatch.

---

### `buildExtensionBindings`

```typescript
buildExtensionBindings(extTree: NestedExtConfig): string
```

Generates rill source text that binds loaded extension functions into the script namespace.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `extTree` | `NestedExtConfig` | Yes | Nested extension configuration tree |

**Returns:** rill source string with extension bindings.

---

### `buildContextBindings`

```typescript
buildContextBindings(
  schema: Record<string, ContextFieldSchema>,
  values: Record<string, unknown>
): string
```

Generates rill source text that binds context values into the script namespace.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schema` | `Record<string, ContextFieldSchema>` | Yes | Context field schema definitions |
| `values` | `Record<string, unknown>` | Yes | Validated context values |

**Returns:** rill source string with context variable bindings.

---

### `buildResolvers`

```typescript
buildResolvers(options: {
  extTree: NestedExtConfig;
  contextValues: Record<string, unknown>;
  extensionBindings: string;
  contextBindings: string;
  modulesConfig: Record<string, string>;
}): ResolverConfig
```

Assembles the final resolver configuration for the rill runtime.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.extTree` | `NestedExtConfig` | Yes | Nested extension configuration tree |
| `options.contextValues` | `Record<string, unknown>` | Yes | Validated context values |
| `options.extensionBindings` | `string` | Yes | Generated extension binding source |
| `options.contextBindings` | `string` | Yes | Generated context binding source |
| `options.modulesConfig` | `Record<string, string>` | Yes | Module path map for the `host` resolver |

**Returns:** `ResolverConfig` for use with `createRuntimeContext`.

---

### `loadProject`

```typescript
loadProject(options: {
  configPath: string;
  env: Record<string, string>;
  rillVersion: string;
}): Promise<ProjectResult>
```

Orchestrates the full project loading sequence: parse config, check version, load extensions, build bindings, and assemble resolvers.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.configPath` | `string` | Yes | Absolute path to the config file |
| `options.env` | `Record<string, string>` | Yes | Pre-resolved environment variables |
| `options.rillVersion` | `string` | Yes | Installed rill version for constraint checking |

**Returns:** `Promise<ProjectResult>`.

**Throws:** Any typed error from the functions it orchestrates (EC-1 through EC-14).

---

### `introspectHandler`

```typescript
introspectHandler(closure: ScriptCallable): HandlerIntrospection
```

Extracts parameter metadata from a rill script closure.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `closure` | `ScriptCallable` | Yes | A rill script closure to introspect |

**Returns:** `HandlerIntrospection` with the closure's parameter list.

---

### `marshalCliArgs`

```typescript
marshalCliArgs(
  args: Record<string, string>,
  params: ReadonlyArray<HandlerParam>
): Record<string, unknown>
```

Coerces CLI flag values to the types declared in the handler's parameter list.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `args` | `Record<string, string>` | Yes | Raw CLI flag values (all strings) |
| `params` | `ReadonlyArray<HandlerParam>` | Yes | Handler parameter descriptors |

**Returns:** Coerced argument map with values typed per the parameter schema.

**Throws:** `HandlerArgError` (EC-16) on missing required param, coercion failure, or unknown flag.

---

## Exported Types

### `RillConfigFile`

The parsed and validated config file structure.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `main` | `string` | No | Entry point path with optional `::handlerName` suffix |
| `extensions` | `ExtensionsBlock` | No | Extension mount definitions |
| `context` | `ContextBlock` | No | Context schema and values |
| `host` | `HostBlock` | No | Host and runtime options |

---

### `ExtensionsBlock`

Extension configuration from the `extensions` section of the config file.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mounts` | `Record<string, string>` | No | Mount path to package specifier map |
| `config` | `Record<string, Record<string, unknown>>` | No | Per-extension config keyed by mount path |

---

### `ContextBlock`

Context schema and values from the `context` section of the config file.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | `Record<string, ContextFieldSchema>` | No | Field name to type schema map |
| `values` | `Record<string, unknown>` | No | Concrete values for each schema field |

---

### `ContextFieldSchema`

Type descriptor for a single context field.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'string' \| 'number' \| 'bool'` | Yes | Expected value type |

---

### `HostBlock`

Host and runtime options from the `host` section of the config file.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rillVersion` | `string` | No | Semver constraint for the installed rill version |
| `modules` | `Record<string, string>` | No | Module identifier to file path map |

---

### `ResolvedMount`

Structured result of parsing a single mount entry.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mountPath` | `string` | Yes | Namespace path where the extension is mounted |
| `packageSpec` | `string` | Yes | npm package specifier (e.g., `"@rcrsr/rill-ext-kv"`) |
| `versionConstraint` | `string` | No | Semver constraint extracted from the package specifier |
| `localPath` | `string` | No | Resolved local path for `file:` specifiers |

---

### `LoadedProject`

Result of `loadExtensions`. Contains all loaded extension data.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `manifests` | `ReadonlyMap<string, ExtensionManifest>` | Yes | Map of mount path to loaded manifest |
| `extTree` | `NestedExtConfig` | Yes | Nested extension configuration tree |

---

### `ResolverConfig`

Resolver configuration for use with `createRuntimeContext` from `@rcrsr/rill`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resolvers` | `Record<string, SchemeResolver>` | Yes | Scheme-to-resolver map |
| `configurations` | `Record<string, unknown>` | Yes | Per-scheme configuration data |

---

### `ProjectResult`

Result of `loadProject`. Contains everything needed to run a rill script.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resolverConfig` | `ResolverConfig` | Yes | Assembled resolver configuration |
| `bindings` | `string` | Yes | Combined extension and context binding source |
| `contextValues` | `Record<string, unknown>` | Yes | Validated context values |
| `handlerInfo` | `HandlerIntrospection` | No | Present when `main` specifies a handler name |

---

### `HandlerIntrospection`

Introspection result for a script closure.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `params` | `HandlerParam[]` | Yes | Ordered list of parameter descriptors |

---

### `HandlerParam`

Descriptor for a single handler parameter.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Parameter name |
| `type` | `string` | No | Declared type annotation string |
| `required` | `boolean` | Yes | Whether the parameter has no default value |
| `description` | `string` | No | Description from closure annotation metadata |

---

## Typed Errors

All errors extend `ConfigError`, which extends `Error` with a `code: string` field.

```typescript
class ConfigError extends Error {
  readonly code: string;
}
```

| Error Class | Code | Triggering Condition | Inspectable Fields |
|-------------|------|---------------------|--------------------|
| `ConfigNotFoundError` | EC-1 | Config file not found by ancestor walk or explicit path | `message` |
| `ConfigParseError` | EC-2 | Config file contains invalid JSON | `message` |
| `ConfigEnvError` | EC-3 | One or more `${VAR}` references have no value in `env` | `message` (lists all missing var names) |
| `ConfigValidationError` | EC-4 | Invalid field type, empty path or handler, or orphaned config key | `message` |
| `RuntimeVersionError` | EC-5 | Installed version fails the semver constraint, or constraint is invalid | `message` |
| `MountValidationError` | EC-6 | Mount path contains an invalid segment or version constraints conflict | `message` |
| `ExtensionLoadError` | EC-7 | Package not found, extension has no manifest, or factory function fails | `message` |
| `NamespaceCollisionError` | EC-9/EC-13 | Two mounts from different packages conflict or have prefix overlap | `message` |
| `ExtensionVersionError` | EC-10 | Extension version does not satisfy the constraint in the mount specifier | `message` |
| `ContextValidationError` | EC-12 | A required context value is missing, or a value has the wrong type | `message` |
| `BundleRestrictionError` | EC-14 | Config contains fields prohibited in bundle mode | `message` |
| `HandlerArgError` | EC-16 | Missing required param, type coercion failure, or unknown CLI flag | `message` |

### Catching Typed Errors

```typescript
import {
  loadProject,
  ConfigError,
  ConfigNotFoundError,
  ConfigEnvError,
} from '@rcrsr/rill-config';

try {
  const result = await loadProject({ configPath, env, rillVersion });
} catch (err) {
  if (err instanceof ConfigNotFoundError) {
    console.error('No config file found:', err.message);
  } else if (err instanceof ConfigEnvError) {
    console.error('Missing environment variables:', err.message);
  } else if (err instanceof ConfigError) {
    console.error(`Config error [${err.code}]:`, err.message);
  } else {
    throw err;
  }
}
```

---

## See Also

- [Config File Format](ref-config.md) — JSON structure, field reference, and env var substitution syntax
- [CLI Tools](integration-cli.md) — `rill-run` command and `--config` flag usage
- [Host Integration](integration-host.md) — Using `ResolverConfig` with `createRuntimeContext`
