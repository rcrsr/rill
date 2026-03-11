# @rcrsr/rill-config

Config resolution, validation, and project loading for [rill](https://rill.run). Parses `rill-config.json`, loads extensions, resolves mounts, and generates bindings.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-config
```

Requires `@rcrsr/rill` as a peer dependency.

## API

### Config Resolution

```typescript
import { resolveConfigPath, parseConfig } from '@rcrsr/rill-config';

const configPath = resolveConfigPath('/path/to/project');
const config = parseConfig(configPath);
```

| Export | Purpose |
|--------|---------|
| `resolveConfigPath(dir)` | Find `rill-config.json` from a directory |
| `parseConfig(path)` | Parse and interpolate env vars |

### Validation

```typescript
import { checkRuntimeVersion, validateContext } from '@rcrsr/rill-config';

checkRuntimeVersion(config, '0.12.0');
validateContext(config.context, providedValues);
```

| Export | Purpose |
|--------|---------|
| `checkRuntimeVersion(config, version)` | Verify runtime satisfies semver range |
| `validateContext(context, values)` | Validate context values against schema |
| `validateBundleRestrictions(config)` | Check bundle-time field restrictions |

### Extension Loading

```typescript
import { resolveMounts, loadExtensions } from '@rcrsr/rill-config';

const mounts = resolveMounts(config.extensions);
const loaded = await loadExtensions(mounts, config.extensions);
```

| Export | Purpose |
|--------|---------|
| `resolveMounts(extensions)` | Parse mount paths and package specifiers |
| `detectNamespaceCollisions(mounts)` | Find conflicting mount paths |
| `loadExtensions(mounts, extensions)` | Load and initialize extensions |

### Bindings Generation

```typescript
import { buildExtensionBindings, buildContextBindings } from '@rcrsr/rill-config';

const extBindings = buildExtensionBindings(extTree, manifests);
const ctxBindings = buildContextBindings(config.context);
```

| Export | Purpose |
|--------|---------|
| `buildExtensionBindings(tree, manifests)` | Generate `use:` bindings for extensions |
| `buildContextBindings(context)` | Generate `use:` bindings for context vars |
| `isLeafFunction(value)` | Check if a value is a terminal function node |

### Project Loading

```typescript
import { loadProject } from '@rcrsr/rill-config';

const project = await loadProject('/path/to/project');
// project.config, project.extTree, project.resolverConfig, ...
```

`loadProject` combines all steps: resolve config, validate, load extensions, build resolvers, and generate bindings.

### Handler Introspection

```typescript
import { parseMainField, introspectHandler, marshalCliArgs } from '@rcrsr/rill-config';

const { file, handler } = parseMainField('script.rill:handleRequest');
const meta = introspectHandler(closure);
const args = marshalCliArgs(meta, ['--name', 'alice']);
```

| Export | Purpose |
|--------|---------|
| `parseMainField(main)` | Split `file:handler` syntax |
| `introspectHandler(closure)` | Extract parameter metadata from a closure |
| `marshalCliArgs(meta, argv)` | Convert CLI arguments to handler parameters |

### Resolvers

| Export | Purpose |
|--------|---------|
| `buildResolvers(config)` | Build `use<scheme:resource>` resolvers from config |

### Error Classes

All errors extend `ConfigError`:

| Error | Cause |
|-------|-------|
| `ConfigNotFoundError` | No `rill-config.json` found |
| `ConfigParseError` | Invalid JSON or structure |
| `ConfigEnvError` | Missing environment variables |
| `ConfigValidationError` | Invalid field values |
| `RuntimeVersionError` | Runtime version mismatch |
| `MountValidationError` | Invalid mount path or specifier |
| `ExtensionLoadError` | Extension failed to load |
| `ExtensionVersionError` | Extension version incompatible |
| `NamespaceMismatchError` | Extension namespace does not match mount |
| `NamespaceCollisionError` | Two mounts conflict |
| `ContextValidationError` | Context value fails schema check |
| `BundleRestrictionError` | Prohibited field present during bundle |
| `HandlerArgError` | Invalid handler arguments |

## Documentation

| Document | Description |
|----------|-------------|
| [Config Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-config.md) | `rill-config.json` field documentation |
| [Config API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-config-api.md) | TypeScript API details |
| [Extensions](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Writing extensions |
| [Resolver Registration](https://github.com/rcrsr/rill/blob/main/docs/integration-resolvers.md) | `use<scheme:resource>` setup |

## License

MIT
