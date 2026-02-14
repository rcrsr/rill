# kv-redis Extension

*Redis key-value storage backend for rill scripts*

Provides persistent key-value storage using Redis. Alternative to the JSON-backed core kv extension with better performance for distributed systems, caching scenarios, and high-throughput workloads. Scripts use the same 11-function API regardless of backend — hosts swap implementations without changing script code.

Use Redis backend for distributed systems, caching layers, high-throughput workloads, TTL-based expiry, or when integrating with existing Redis infrastructure. Use SQLite for large single-server datasets. Use JSON-backed core kv for simple single-process applications.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createRedisKvExtension } from '@rcrsr/rill-ext-kv-redis';

const ext = createRedisKvExtension({
  url: 'redis://localhost:6379',
  mounts: {
    user: {
      mode: 'read-write',
      prefix: 'app:user:',
    },
  },
});
const functions = prefixFunctions('kv', ext);
const ctx = createRuntimeContext({ functions });

// Script: kv::set("user", "name", "Alice")
```

## Configuration

```typescript
interface RedisKvConfig {
  url: string;  // Redis connection URL
  mounts: Record<string, RedisKvMountConfig>;
  maxStoreSize?: number;  // bytes (default: 10485760 = 10MB)
  writePolicy?: 'dispose' | 'immediate';  // default: 'dispose'
}

interface RedisKvMountConfig {
  mode: 'read' | 'write' | 'read-write';
  prefix: string;  // key prefix for isolation
  schema?: Record<string, SchemaEntry>;
  maxEntries?: number;  // default: 10000
  maxValueSize?: number;  // bytes (default: 102400 = 100KB)
  ttl?: number;  // expiry in seconds (optional)
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | — | Redis connection URL (required) |
| `mounts` | Record | — | Named mount configurations (required) |
| `maxStoreSize` | number | 10485760 | Maximum store size in bytes |
| `writePolicy` | string | `'dispose'` | When to flush writes |

**Mount parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | — | Access mode: `'read'`, `'write'`, or `'read-write'` (required) |
| `prefix` | string | — | Key prefix for namespace isolation (required) |
| `schema` | Record | — | Optional schema for declared mode |
| `maxEntries` | number | 10000 | Maximum entries per mount |
| `maxValueSize` | number | 102400 | Maximum value size in bytes |
| `ttl` | number | — | Key expiry in seconds |

**Example with schema and TTL:**

```typescript
const ext = createRedisKvExtension({
  url: 'redis://localhost:6379',
  mounts: {
    user: {
      mode: 'read-write',
      prefix: 'app:user:',
      schema: {
        name: { type: 'string', default: '' },
        count: { type: 'number', default: 0 }
      }
    },
    cache: {
      mode: 'read-write',
      prefix: 'app:cache:',
      ttl: 3600  // 1 hour expiry
    }
  },
  writePolicy: 'immediate'
});
```

**Redis with authentication:**

```typescript
const ext = createRedisKvExtension({
  url: 'redis://user:password@host:6379/0',
  mounts: {
    session: {
      mode: 'read-write',
      prefix: 'session:',
      ttl: 1800  // 30 minute session timeout
    }
  }
});
```

**Redis with TLS:**

```typescript
const ext = createRedisKvExtension({
  url: 'rediss://secure-host:6380',
  mounts: {
    data: {
      mode: 'read-write',
      prefix: 'prod:data:',
      maxEntries: 50000,
      ttl: 86400  // 24 hours
    }
  }
});
```

## Key Features

- TTL support for automatic key expiration
- SCAN-based key listing (production-safe, non-blocking)
- Connection URL format supports authentication and database selection
- TLS support via `rediss://` protocol
- Key prefix isolation enables multi-tenant patterns

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
