# Extension Backend Selection

*Choosing and swapping storage backends*

rill provides core extensions (`fs`, `kv`) with built-in JSON/filesystem backends and separate packages for alternative storage backends. Scripts use the same API regardless of backend — hosts swap backends without changing script code.

## Backend Selection Strategy

| Deployment | fs Backend | kv Backend | Rationale |
|------------|------------|------------|-----------|
| Development | JSON (core) | JSON (core) | Zero configuration, file-based persistence |
| Single-server | Local files (core) | SQLite (`@rcrsr/rill-ext-kv-sqlite`) | Drop-in database file, concurrent safe |
| Multi-server | S3 (`@rcrsr/rill-ext-fs-s3`) | Redis (`@rcrsr/rill-ext-kv-redis`) | Shared state, distributed access |
| Cloud/serverless | S3 (`@rcrsr/rill-ext-fs-s3`) | Redis (`@rcrsr/rill-ext-kv-redis`) | Cross-server access, managed services |

## API Contract Guarantee

All `kv` backends implement `KvExtensionContract` interface. All `fs` backends implement `FsExtensionContract` interface. Scripts import no backend-specific types — the same script runs unchanged across JSON, SQLite, Redis, S3 backends.

```rill
# Works with ANY kv backend (JSON, SQLite, Redis)
kv::set("user", "name", "Alice")
kv::get("user", "name")
# Result: "Alice"

# Works with ANY fs backend (local, S3)
fs::write("data", "file.txt", "content")
fs::read("data", "file.txt")
# Result: "content"
```

## Mount Configuration Examples

### Development: JSON-backed kv

```typescript
import { createKvExtension } from '@rcrsr/rill/ext/kv';
import { createFsExtension } from '@rcrsr/rill/ext/fs';

const ctx = createRuntimeContext({
  functions: {
    ...createKvExtension({
      mounts: {
        user: { store: './data/user.json' },
        cache: { store: './data/cache.json' }
      }
    }).functions,
    ...createFsExtension({
      mounts: {
        data: { path: './data', mode: 'read-write' }
      }
    }).functions,
  },
});
```

### Single-server: SQLite kv + Local fs

```typescript
import { createSqliteKvExtension } from '@rcrsr/rill-ext-kv-sqlite';
import { createFsExtension } from '@rcrsr/rill/ext/fs';

const ctx = createRuntimeContext({
  functions: {
    ...createSqliteKvExtension({
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
      }
    }).functions,
    ...createFsExtension({
      mounts: {
        data: { path: './data', mode: 'read-write' }
      }
    }).functions,
  },
});
```

### Multi-server: Redis kv + S3 fs

```typescript
import { createRedisKvExtension } from '@rcrsr/rill-ext-kv-redis';
import { createS3FsExtension } from '@rcrsr/rill-ext-fs-s3';

const ctx = createRuntimeContext({
  functions: {
    ...createRedisKvExtension({
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
    }).functions,
    ...createS3FsExtension({
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
    }).functions,
  },
});
```

## Backend Package Imports

Install and import external backends as separate packages:

**SQLite kv backend:**
```bash
npm install @rcrsr/rill-ext-kv-sqlite
```
```typescript
import { createSqliteKvExtension } from '@rcrsr/rill-ext-kv-sqlite';
```

**Redis kv backend:**
```bash
npm install @rcrsr/rill-ext-kv-redis
```
```typescript
import { createRedisKvExtension } from '@rcrsr/rill-ext-kv-redis';
```

**S3 fs backend:**
```bash
npm install @rcrsr/rill-ext-fs-s3
```
```typescript
import { createS3FsExtension } from '@rcrsr/rill-ext-fs-s3';
```

## Swapping Backends Without Script Changes

Scripts reference mount names and functions, never backend-specific configuration:

```typescript
// Development backend (JSON)
const devCtx = createRuntimeContext({
  functions: {
    ...createKvExtension({
      mounts: { user: { store: './dev.json' } }
    }).functions,
  },
});

// Production backend (Redis)
const prodCtx = createRuntimeContext({
  functions: {
    ...createRedisKvExtension({
      url: process.env.REDIS_URL,
      mounts: { user: { mode: 'read-write', prefix: 'prod:user:' } }
    }).functions,
  },
});

// Same script works with both contexts
const script = `
  kv::set("user", "name", "Alice")
  kv::get("user", "name")
`;

const devResult = await execute(parse(script), devCtx);   // Uses JSON
const prodResult = await execute(parse(script), prodCtx); // Uses Redis
```
