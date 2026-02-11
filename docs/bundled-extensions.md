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

Provides persistent JSON-backed key-value storage with optional schema validation.

**Configuration:**

```typescript
interface KvConfig {
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

**Functions (8 total):**

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `get` | key | any | Get value or schema default |
| `set` | key, value | bool | Set value (validates against schema) |
| `delete` | key | bool | Delete key |
| `keys` | — | list | Get all keys |
| `has` | key | bool | Check key existence |
| `clear` | — | bool | Clear all keys (restores schema defaults) |
| `getAll` | — | dict | Get all entries as dict |
| `schema` | — | list | Get schema information (empty in open mode) |

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
| [gemini](extension-gemini.md) | `@rcrsr/rill-ext-gemini` | `gemini` | Gemini API integration |
| [openai](extension-openai.md) | `@rcrsr/rill-ext-openai` | `openai` | OpenAI API integration |
| [pinecone](extension-pinecone.md) | `@rcrsr/rill-ext-pinecone` | `pinecone` | Pinecone vector database |
| [qdrant](extension-qdrant.md) | `@rcrsr/rill-ext-qdrant` | `qdrant` | Qdrant vector database |

## See Also

- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
