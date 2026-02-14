# kv-sqlite Extension

*SQLite key-value storage backend for rill scripts*

Provides persistent key-value storage using SQLite databases. Alternative to the JSON-backed core kv extension with better performance for large datasets. Scripts use the same 11-function API regardless of backend — hosts swap implementations without changing script code.

Use SQLite backend when working with large datasets (>1000 entries), need better write performance, or require concurrent access from multiple processes. Use JSON-backed core kv for simple applications with small data volumes.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createSqliteKvExtension } from '@rcrsr/rill-ext-kv-sqlite';

const ext = createSqliteKvExtension({
  mounts: {
    user: {
      mode: 'read-write',
      database: './data/app.db',
      table: 'user_state',
    },
  },
});
const functions = prefixFunctions('kv', ext);
const ctx = createRuntimeContext({ functions });

// Script: kv::set("user", "name", "Alice")
```

## Configuration

```typescript
interface SqliteKvConfig {
  mounts: Record<string, SqliteKvMountConfig>;
  maxStoreSize?: number;  // bytes (default: 10485760 = 10MB)
  writePolicy?: 'dispose' | 'immediate';  // default: 'dispose'
}

interface SqliteKvMountConfig {
  mode: 'read' | 'write' | 'read-write';
  database: string;  // SQLite file path
  table: string;  // table name
  schema?: Record<string, SchemaEntry>;
  maxEntries?: number;  // default: 10000
  maxValueSize?: number;  // bytes (default: 102400 = 100KB)
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mounts` | Record | — | Named mount configurations (required) |
| `maxStoreSize` | number | 10485760 | Maximum store size in bytes |
| `writePolicy` | string | `'dispose'` | When to flush writes (`'dispose'` or `'immediate'`) |

**Mount parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | — | Access mode: `'read'`, `'write'`, or `'read-write'` (required) |
| `database` | string | — | SQLite file path (required) |
| `table` | string | — | Table name (required) |
| `schema` | Record | — | Optional schema for declared mode |
| `maxEntries` | number | 10000 | Maximum entries per mount |
| `maxValueSize` | number | 102400 | Maximum value size in bytes |

**Example with schema:**

```typescript
const ext = createSqliteKvExtension({
  mounts: {
    user: {
      mode: 'read-write',
      database: './data/app.db',
      table: 'user_state',
      schema: {
        name: { type: 'string', default: '' },
        count: { type: 'number', default: 0 }
      }
    },
    cache: {
      mode: 'read-write',
      database: './data/cache.db',
      table: 'cache_entries'
    }
  },
  writePolicy: 'immediate'
});
```

## Functions

Provides the same 11 functions as the core kv extension:

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `get` | mount, key | any | Get value or schema default |
| `get_or` | mount, key, default | any | Get value or provided default |
| `set` | mount, key, value | bool | Set value (validates against schema) |
| `merge` | mount, key, partial | bool | Merge dict fields into existing value |
| `delete` | mount, key | bool | Delete key |
| `keys` | mount | list | Get all keys in mount |
| `has` | mount, key | bool | Check key existence |
| `clear` | mount | bool | Clear all keys (restores schema defaults) |
| `getAll` | mount | dict | Get all entries as dict |
| `schema` | mount | list | Get schema information |
| `mounts` | — | list | Get available mount names |

**Namespace convention:** `kv` or `state`

## See Also

- [Bundled Extensions](bundled-extensions.md) — All shipped extensions
- [Extension Backend Selection](integration-backends.md) — Choosing storage backends
- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
