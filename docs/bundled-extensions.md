# Bundled Extensions

*Pre-built extensions shipped with rill*

rill provides extensions in two forms: core extensions bundled with `@rcrsr/rill` and external extensions as separate packages.

## Core Extensions

Core extensions ship as part of `@rcrsr/rill`. Import them using sub-path imports.

### Import Pattern

```typescript
import { createFsExtension } from '@rcrsr/rill/ext/fs';
import { createFetchExtension } from '@rcrsr/rill/ext/fetch';
import { createExecExtension } from '@rcrsr/rill/ext/exec';
import { createKvExtension } from '@rcrsr/rill/ext/kv';
import { createCryptoExtension } from '@rcrsr/rill/ext/crypto';
```

### fs — Filesystem Operations

Provides sandboxed filesystem access via mount-based permissions.

**Configuration:**

```typescript
interface FsConfig {
  mounts: Record<string, MountConfig>;
  maxFileSize?: number;  // bytes (default: 10485760 = 10MB)
  encoding?: 'utf-8' | 'utf8' | 'ascii';
}

interface MountConfig {
  path: string;
  mode: 'read-only' | 'read-write';
  glob?: string;  // file filter pattern
  maxFileSize?: number;
}
```

**Functions (12 total):**

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `read` | mount, path | string | Read file contents |
| `write` | mount, path, content | string | Write file (bytes written) |
| `append` | mount, path, content | string | Append to file (bytes written) |
| `list` | mount, path? | list | Directory contents |
| `find` | mount, pattern? | list | Recursive file search with glob |
| `exists` | mount, path | bool | Check file existence |
| `remove` | mount, path | bool | Delete file |
| `stat` | mount, path | dict | File metadata (name, type, size, timestamps) |
| `mkdir` | mount, path | bool | Create directory |
| `copy` | mount, src, dest | bool | Copy file within mount |
| `move` | mount, src, dest | bool | Move file within mount |
| `mounts` | — | list | List configured mounts |

**Namespace convention:** `fs`

### fetch — HTTP Requests

Creates endpoint functions from configuration. Scripts cannot specify arbitrary URLs.

**Configuration:**

```typescript
interface FetchConfig {
  baseUrl: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  timeout?: number;  // ms (default: 30000)
  retries?: number;  // default: 0
  retryDelay?: number;  // ms (default: 1000)
  maxConcurrent?: number;
  responseFormat?: 'json' | 'text';
  responseShape?: 'body' | 'full';
  endpoints: Record<string, EndpointConfig>;
}

interface EndpointConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  params?: EndpointParam[];
  headers?: Record<string, string>;
  body?: 'json' | 'form' | 'text';
  responseFormat?: 'json' | 'text';
  responseShape?: 'body' | 'full';
  description?: string;
}

interface EndpointParam {
  name: string;
  type: 'string' | 'number' | 'bool' | 'dict';
  required?: boolean;
  location: 'path' | 'query' | 'body' | 'header';
  defaultValue?: string | number | boolean;
}
```

**Functions:** One function per endpoint declared in `endpoints` config, plus `endpoints()` introspection function.

**Namespace convention:** `api` or domain-specific (e.g., `github`, `slack`)

### exec — Command Execution

Provides sandboxed command execution via allowlist/blocklist controls.

**Configuration:**

```typescript
interface ExecConfig {
  commands: Record<string, CommandConfig>;
  timeout?: number;  // ms (default: 30000)
  maxOutputSize?: number;  // bytes (default: 1048576 = 1MB)
  inheritEnv?: boolean;  // default: false
}

interface CommandConfig {
  binary: string;
  allowedArgs?: string[];
  blockedArgs?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxBuffer?: number;
  description?: string;
}
```

**Functions:** One function per command declared in `commands` config, plus `commands()` introspection function.

**Each command function:**

| Parameters | Returns | Description |
|-----------|---------|-------------|
| args?, stdin? | dict | Executes command, returns `{stdout, stderr, exitCode}` |

**Namespace convention:** `cmd` or `exec`

### kv — Key-Value Store

Provides persistent JSON-backed key-value storage with optional schema validation. Supports multiple named mounts for organizing data.

**Configuration:**

```typescript
interface KvConfig {
  mounts: Record<string, KvMountConfig>;  // named mounts
}

interface KvMountConfig {
  store: string;  // file path
  schema?: Record<string, SchemaEntry>;  // optional (enables declared mode)
  maxEntries?: number;  // default: 10000
  maxValueSize?: number;  // bytes (default: 102400 = 100KB)
  maxStoreSize?: number;  // bytes (default: 10485760 = 10MB)
  writePolicy?: 'dispose' | 'immediate';  // default: 'dispose'
}

interface SchemaEntry {
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  default?: RillValue;
  description?: string;
}
```

**Backward compatibility:** Single-store config (`{ store: "path" }`) is supported and creates a default mount named `"default"`.

**Functions (11 total):**

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `get` | mount, key | any | Get value or schema default |
| `get_or` | mount, key, default | any | Get value or provided default |
| `set` | mount, key, value | bool | Set value (validates against schema) |
| `merge` | mount, key, partial | bool | Merge dict fields into existing value |
| `delete` | mount, key | bool | Delete key |
| `keys` | mount | list | Get all keys in mount |
| `has` | mount, key | bool | Check key existence |
| `clear` | mount | bool | Clear all keys in mount (restores schema defaults) |
| `getAll` | mount | dict | Get all entries in mount as dict |
| `schema` | mount | list | Get schema information (empty in open mode) |
| `mounts` | — | list | Get list of available mount names |

**Namespace convention:** `kv` or `state`

### crypto — Cryptographic Operations

Wraps Node.js `crypto` module for hashing and random generation.

**Configuration:**

```typescript
interface CryptoConfig {
  defaultAlgorithm?: string;  // default: 'sha256'
  hmacKey?: string;  // required only if hmac() used
}
```

**Functions (4 total):**

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `hash` | input, algorithm? | string | Hash content (hex output) |
| `hmac` | input, algorithm? | string | Generate HMAC signature (hex output) |
| `uuid` | — | string | Generate random UUID v4 |
| `random` | bytes | string | Generate random bytes as hex string |

**Namespace convention:** `crypto`

---

## External Extensions

External extensions ship as separate npm packages. Install and integrate as needed.

| Extension | Package | Namespace | Description |
|-----------|---------|-----------|-------------|
| [anthropic](extension-anthropic.md) | `@rcrsr/rill-ext-anthropic` | `anthropic` | Anthropic Claude API integration |
| [chroma](extension-chroma.md) | `@rcrsr/rill-ext-chroma` | `chroma` | ChromaDB vector database |
| [claude_code](extension-claude-code.md) | `@rcrsr/rill-ext-claude-code` | `claude_code` | Claude Code CLI integration |
| fs-s3 | `@rcrsr/rill-ext-fs-s3` | `fs` | S3-compatible object storage backend |
| [gemini](extension-gemini.md) | `@rcrsr/rill-ext-gemini` | `gemini` | Gemini API integration |
| kv-redis | `@rcrsr/rill-ext-kv-redis` | `kv` | Redis key-value storage backend |
| kv-sqlite | `@rcrsr/rill-ext-kv-sqlite` | `kv` | SQLite key-value storage backend |
| [openai](extension-openai.md) | `@rcrsr/rill-ext-openai` | `openai` | OpenAI API integration |
| [pinecone](extension-pinecone.md) | `@rcrsr/rill-ext-pinecone` | `pinecone` | Pinecone vector database |
| [qdrant](extension-qdrant.md) | `@rcrsr/rill-ext-qdrant` | `qdrant` | Qdrant vector database |

### kv-sqlite — SQLite Key-Value Storage Backend

Provides persistent key-value storage using SQLite databases. Alternative to the JSON-backed core kv extension with better performance for large datasets.

**Factory signature:**

```typescript
import { createSqliteKvExtension } from '@rcrsr/rill-ext-kv-sqlite';

const ext = createSqliteKvExtension(config);
```

**Configuration:**

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

**Example configuration:**

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

**Functions:** Provides same 11 functions as core kv extension: `get`, `get_or`, `set`, `merge`, `delete`, `keys`, `has`, `clear`, `getAll`, `schema`, `mounts`.

**Namespace convention:** `kv` or `state`

**Backend selection strategy:** Use SQLite backend when working with large datasets (>1000 entries), need better write performance, or require concurrent access from multiple processes. Use JSON-backed core kv for simple applications with small data volumes.

### kv-redis — Redis Key-Value Storage Backend

Provides persistent key-value storage using Redis. Alternative to the JSON-backed core kv extension with better performance for distributed systems, caching scenarios, and high-throughput workloads.

**Factory signature:**

```typescript
import { createRedisKvExtension } from '@rcrsr/rill-ext-kv-redis';

const ext = createRedisKvExtension(config);
```

**Configuration:**

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

**Example configurations:**

Standard Redis:

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

Redis with authentication:

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

Redis Cluster or TLS (rediss://):

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

**Key features:**

- TTL support for automatic key expiration
- SCAN-based key listing (production-safe, non-blocking)
- Connection URL format supports authentication and database selection
- TLS support via `rediss://` protocol
- Key prefix isolation enables multi-tenant patterns

**Functions:** Provides same 11 functions as core kv extension: `get`, `get_or`, `set`, `merge`, `delete`, `keys`, `has`, `clear`, `getAll`, `schema`, `mounts`.

**Namespace convention:** `kv` or `state`

**Backend selection strategy:** Use Redis backend for distributed systems, caching layers, high-throughput workloads, TTL-based expiry, or when integrating with existing Redis infrastructure. Use SQLite for large datasets with complex queries. Use JSON-backed core kv for simple single-process applications.

### fs-s3 — S3-Compatible Object Storage Backend

Provides filesystem operations for S3-compatible object storage. Alternative to the core fs extension for cloud storage scenarios. Supports AWS S3, Cloudflare R2, MinIO, and other S3-compatible services.

**Factory signature:**

```typescript
import { createS3FsExtension } from '@rcrsr/rill-ext-fs-s3';

const ext = createS3FsExtension(config);
```

**Configuration:**

```typescript
interface S3FsConfig {
  mounts: Record<string, S3FsMountConfig>;
  maxFileSize?: number;  // bytes (default: 10485760 = 10MB)
  encoding?: 'utf-8' | 'utf8' | 'ascii';
}

interface S3FsMountConfig {
  mode: 'read-only' | 'read-write';
  region: string;
  bucket: string;
  prefix?: string;  // object key prefix
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  endpoint?: string;  // for S3-compatible services (MinIO, R2)
  forcePathStyle?: boolean;  // use path-style addressing (required for MinIO)
  glob?: string;  // file filter pattern
  maxFileSize?: number;
}
```

**Example configurations:**

AWS S3:

```typescript
const ext = createS3FsExtension({
  mounts: {
    data: {
      mode: 'read-write',
      region: 'us-east-1',
      bucket: 'my-app-data',
      prefix: 'documents/',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    }
  }
});
```

Cloudflare R2:

```typescript
const ext = createS3FsExtension({
  mounts: {
    storage: {
      mode: 'read-write',
      region: 'auto',
      bucket: 'my-r2-bucket',
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      },
      endpoint: `https://<account-id>.r2.cloudflarestorage.com`
    }
  }
});
```

MinIO:

```typescript
const ext = createS3FsExtension({
  mounts: {
    local: {
      mode: 'read-write',
      region: 'us-east-1',
      bucket: 'test-bucket',
      credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin'
      },
      endpoint: 'http://localhost:9000',
      forcePathStyle: true  // MinIO requires path-style addressing
    }
  }
});
```

**Key differences from core fs extension:**

- `endpoint` option enables S3-compatible services beyond AWS (MinIO, Cloudflare R2, DigitalOcean Spaces)
- `forcePathStyle: true` required for services like MinIO that use path-style bucket addressing (`http://host/bucket/key` instead of `http://bucket.host/key`)
- `prefix` option maps mount paths to S3 object key prefixes for namespace isolation within buckets
- Object keys replace filesystem paths, enabling cloud-native storage patterns

**Functions:** Provides same 12 functions as core fs extension: `read`, `write`, `append`, `list`, `find`, `exists`, `remove`, `stat`, `mkdir`, `copy`, `move`, `mounts`.

**Namespace convention:** `fs` or `s3`

**Backend selection strategy:** Use S3 fs backend for cloud deployments, serverless environments, multi-region data access, or when working with existing S3 infrastructure. Use core fs for local file operations or single-machine deployments.

## See Also

- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
