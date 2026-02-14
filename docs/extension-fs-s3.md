# fs-s3 Extension

*S3-compatible object storage backend for rill scripts*

Provides filesystem operations for S3-compatible object storage. Alternative to the core fs extension for cloud storage scenarios. Supports AWS S3, Cloudflare R2, MinIO, and other S3-compatible services. Scripts use the same 12-function API regardless of backend — hosts swap implementations without changing script code.

Use S3 fs backend for cloud deployments, serverless environments, multi-region data access, or when working with existing S3 infrastructure. Use core fs for local file operations or single-machine deployments.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createS3FsExtension } from '@rcrsr/rill-ext-fs-s3';

const ext = createS3FsExtension({
  mounts: {
    data: {
      mode: 'read-write',
      region: 'us-east-1',
      bucket: 'my-app-data',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    }
  }
});
const functions = prefixFunctions('fs', ext);
const ctx = createRuntimeContext({ functions });

// Script: fs::read("data", "report.txt")
```

## Configuration

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

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mounts` | Record | — | Named mount configurations (required) |
| `maxFileSize` | number | 10485760 | Maximum file size in bytes |
| `encoding` | string | `'utf-8'` | File content encoding |

**Mount parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | — | Access mode: `'read-only'` or `'read-write'` (required) |
| `region` | string | — | AWS region or `'auto'` for R2 (required) |
| `bucket` | string | — | S3 bucket name (required) |
| `prefix` | string | — | Object key prefix for namespace isolation |
| `credentials` | object | — | AWS credentials (required) |
| `endpoint` | string | — | Custom endpoint for S3-compatible services |
| `forcePathStyle` | boolean | false | Path-style addressing (required for MinIO) |
| `glob` | string | — | File filter pattern |

**Cloudflare R2:**

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

**MinIO:**

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

## Key Differences from Core fs

- `endpoint` option enables S3-compatible services beyond AWS (MinIO, Cloudflare R2, DigitalOcean Spaces)
- `forcePathStyle: true` required for services using path-style bucket addressing (`http://host/bucket/key` instead of `http://bucket.host/key`)
- `prefix` option maps mount paths to S3 object key prefixes for namespace isolation within buckets
- Object keys replace filesystem paths, enabling cloud-native storage patterns

## Functions

Provides the same 12 functions as the core fs extension:

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `read` | mount, path | string | Read file contents |
| `write` | mount, path, content | string | Write file (bytes written) |
| `append` | mount, path, content | string | Append to file (bytes written) |
| `list` | mount, path? | list | Directory contents |
| `find` | mount, pattern? | list | Recursive file search with glob |
| `exists` | mount, path | bool | Check file existence |
| `remove` | mount, path | bool | Delete file |
| `stat` | mount, path | dict | File metadata |
| `mkdir` | mount, path | bool | Create directory |
| `copy` | mount, src, dest | bool | Copy file within mount |
| `move` | mount, src, dest | bool | Move file within mount |
| `mounts` | — | list | List configured mounts |

**Namespace convention:** `fs` or `s3`

## See Also

- [Bundled Extensions](bundled-extensions.md) — All shipped extensions
- [Extension Backend Selection](integration-backends.md) — Choosing storage backends
- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
