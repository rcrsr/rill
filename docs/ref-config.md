# rill Config File Reference

*Complete field documentation for `rill-config.json`*

`rill-config.json` configures a rill project: entry point, extensions, context schema, host options, and runtime constraints.

---

## Top-Level Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Project name. |
| `version` | string | — | Project version string (semver). |
| `runtime` | string | — | Semver range constraint on the rill runtime version. |
| `description` | string | — | Human-readable project description. |
| `main` | string | — | Entry point in module mode or handler mode. |
| `extensions` | object | — | Extension mount, config, and bindings block. |
| `context` | object | — | Context schema, values, and bindings output. |
| `host` | object | — | Runtime execution options. |
| `modules` | object | — | Module resolver configuration. |

A minimal valid config:

```text
{
  "name": "my-project"
}
```

---

## `$schema` Field

Include `$schema` to enable editor autocomplete via JSON Schema:

```text
{
  "$schema": "https://cdn.jsdelivr.net/npm/@rcrsr/rill@latest/schema/rill-config.schema.json",
  "name": "my-project"
}
```

---

## `runtime` Field

Specifies a semver range. The rill CLI checks the installed runtime version at startup.

```text
{
  "runtime": ">=0.10.0"
}
```

If the installed version does not satisfy the range, the CLI exits with an error before execution. See [Error Reference](ref-errors.md) for the error code.

---

## `main` Field

### Module Mode

`main` points to a `.rill` file. The file executes as a script.

```text
{
  "main": "script.rill"
}
```

### Handler Mode

`main` uses colon syntax to name a specific exported handler in the file.

```text
{
  "main": "script.rill:handleRequest"
}
```

The identifier after `:` must be a closure exported by the script.

---

## `extensions` Block

### `extensions.mounts`

Maps mount paths to package specifiers. Mount paths are dot-separated segments.

```text
{
  "extensions": {
    "mounts": {
      "myext": "@scope/pkg",
      "myext.tools": "@scope/pkg@^1.0.0",
      "myext.tools.search": "./local/path"
    }
  }
}
```

**Mount path rules:** Each segment must match `/^[a-zA-Z0-9_-]+$/`. Examples: `"myext"`, `"myext.tools"`, `"myext.tools.search"`.

**Package specifier formats:**

| Format | Example |
|--------|---------|
| Scoped package | `@scope/pkg` |
| Scoped package with version | `@scope/pkg@^1.0.0` |
| Local path | `./local/path` |

### `extensions.config`

Maps mount paths to config objects passed to each extension at setup time.

```text
{
  "extensions": {
    "mounts": {
      "myext": "@scope/pkg"
    },
    "config": {
      "myext": {
        "apiKey": "${API_KEY}",
        "region": "us-east-1"
      }
    }
  }
}
```

A key in `extensions.config` with no matching entry in `extensions.mounts` is an error. See [Error Reference](ref-errors.md) for the orphaned key error code.

**Bundle-time restriction:** `extensions.config` is prohibited during `rill-agent bundle`. Presence throws `BundleRestrictionError`.

### `extensions.bindings`

Output path for the generated bindings file. Defaults to `"bindings/ext.rill"`.

```text
{
  "extensions": {
    "bindings": "generated/ext.rill"
  }
}
```

---

## `context` Block

`context` defines a typed schema for values injected into scripts at runtime.

### `context.schema`

Declares keys with a `{ type }` entry. Supported types: `"string"`, `"number"`, `"bool"`.

```text
{
  "context": {
    "schema": {
      "userId":  { "type": "string" },
      "retries": { "type": "number" },
      "debug":   { "type": "bool" }
    }
  }
}
```

### `context.values`

Static values for each key declared in `context.schema`.

```text
{
  "context": {
    "schema": {
      "userId": { "type": "string" }
    },
    "values": {
      "userId": "${USER_ID}"
    }
  }
}
```

**Bundle-time restriction:** The entire `context` block is prohibited during `rill-agent bundle`. Presence throws `BundleRestrictionError`.

### `context.bindings`

Output path for the generated context bindings file. Defaults to `"bindings/context.rill"`.

```text
{
  "context": {
    "bindings": "generated/context.rill"
  }
}
```

---

## Environment Variable Interpolation

Use `${VAR_NAME}` in any string value to reference an environment variable.

```text
{
  "extensions": {
    "config": {
      "myext": {
        "apiKey": "${MYEXT_API_KEY}",
        "endpoint": "${API_ENDPOINT}"
      }
    }
  }
}
```

**Behavior:**

| Scenario | Behavior |
|----------|----------|
| Variable defined | Value substituted at load time |
| Variable missing | `ConfigEnvError` lists all missing names |
| Multiple missing | All missing names reported in one error |

The CLI auto-loads a `.env` file from the project root before resolving variables. Embedded callers (using the host API) must supply pre-resolved env vars. See [Error Reference](ref-errors.md) for `ConfigEnvError`.

---

## `host` Block

Runtime execution options. All fields are optional.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | number (ms) | 30000 | Maximum script execution time. |
| `maxCallStackDepth` | number | 100 | Maximum call stack depth. |
| `setupTimeout` | number (ms) | — | Maximum time for the setup phase. |

```text
{
  "host": {
    "timeout": 10000,
    "maxCallStackDepth": 50,
    "setupTimeout": 5000
  }
}
```

---

## `modules` Block

Configures module resolver behavior for `use:` imports. Keys and values depend on the resolver registered by the host.

```text
{
  "modules": {
    "greetings": "./greet.rill",
    "utils": "./utils.rill"
  }
}
```

Paths are relative to the config file's directory. See [Resolver Registration](integration-resolvers.md) for resolver-specific options.

---

## Bundle-Time Restrictions

During `rill-agent bundle`, certain fields are prohibited. The bundler throws `BundleRestrictionError` if they appear.

| Field | Restriction |
|-------|-------------|
| `extensions.config` | Prohibited |
| `context` | Prohibited (entire block) |

These fields contain environment-specific data that must not be baked into a bundle.

---

## Related

| Document | Description |
|----------|-------------|
| [CLI Tools](integration-cli.md) | `rill-run` command usage and flags |
| [Error Reference](ref-errors.md) | Error codes for invalid config, missing env vars, and bundle restrictions |
| [Resolver Registration](integration-resolvers.md) | `modules` block options per resolver |
| [Developing Extensions](integration-extensions.md) | Writing extensions consumed via `extensions.mounts` |
