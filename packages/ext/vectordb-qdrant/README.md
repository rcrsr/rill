# @rcrsr/rill-ext-qdrant

[rill](https://rill.run) extension for [Qdrant](https://qdrant.tech) vector database integration. Provides 11 host functions for vector CRUD, batch operations, and collection management.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-qdrant
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createQdrantExtension } from '@rcrsr/rill-ext-qdrant';

const ext = createQdrantExtension({
  url: 'http://localhost:6333',
  collection: 'my_vectors',
  dimensions: 384,
});
const prefixed = prefixFunctions('qdrant', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `
  qdrant::upsert("doc-1", $embedding, [title: "Example"])
  qdrant::search($embedding, [k: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

All vector database extensions share identical function signatures. Swap `qdrant::` for `pinecone::` or `chroma::` with no script changes.

### qdrant::upsert(id, vector, metadata?)

Insert or update a single vector with metadata.

```rill
qdrant::upsert("doc-1", $embedding, [title: "Example", page: 1]) => $result
$result.id -> log       # "doc-1"
$result.success -> log  # true
```

**Idempotent.** Duplicate ID overwrites existing vector.

### qdrant::upsert_batch(items)

Batch insert or update vectors. Processes sequentially; halts on first failure.

```rill
qdrant::upsert_batch([
  [id: "doc-1", vector: $v1, metadata: [title: "First"]],
  [id: "doc-2", vector: $v2, metadata: [title: "Second"]]
]) => $result
$result.succeeded -> log  # 2
```

Returns `{ succeeded }` on success. Returns `{ succeeded, failed, error }` on failure.

### qdrant::search(vector, options?)

Search for k nearest neighbors.

```rill
qdrant::search($embedding, [k: 5, score_threshold: 0.8]) => $results
$results -> each { "{.id}: {.score}" -> log }
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `k` | number | `10` | Max results to return |
| `filter` | dict | `{}` | Metadata filter conditions |
| `score_threshold` | number | (none) | Exclude results below threshold |

Returns `[{ id, score, metadata }]`. Empty results return `[]`.

### qdrant::get(id)

Fetch a vector by ID.

```rill
qdrant::get("doc-1") => $point
$point.id -> log        # "doc-1"
$point.metadata -> log  # [title: "Example", page: 1]
```

Returns `{ id, vector, metadata }`. Halts with error if ID not found.

### qdrant::delete(id)

Delete a vector by ID.

```rill
qdrant::delete("doc-1") => $result
$result.deleted -> log  # true
```

Returns `{ id, deleted }`. Halts with error if ID not found.

### qdrant::delete_batch(ids)

Batch delete vectors. Processes sequentially; halts on first failure.

```rill
qdrant::delete_batch(["doc-1", "doc-2", "doc-3"]) => $result
$result.succeeded -> log  # 3
```

Returns `{ succeeded }` on success. Returns `{ succeeded, failed, error }` on failure.

### qdrant::count()

Count vectors in the collection.

```rill
qdrant::count() -> log  # 42
```

Returns a number.

### qdrant::create_collection(name, options?)

Create a new collection.

```rill
qdrant::create_collection("my_vectors", [dimensions: 384, distance: "cosine"]) => $result
$result.created -> log  # true
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dimensions` | number | (none) | Vector dimension size |
| `distance` | string | `"cosine"` | `"cosine"`, `"euclidean"`, or `"dot"` |

Returns `{ name, created }`. **Not idempotent** — halts if collection exists.

### qdrant::delete_collection(id)

Delete a collection.

```rill
qdrant::delete_collection("old_vectors") => $result
$result.deleted -> log  # true
```

Returns `{ name, deleted }`. **Not idempotent** — halts if collection not found.

### qdrant::list_collections()

List all collection names.

```rill
qdrant::list_collections() -> log  # ["my_vectors", "archive"]
```

Returns a list of strings.

### qdrant::describe()

Describe the configured collection.

```rill
qdrant::describe() => $info
$info.name -> log        # "my_vectors"
$info.count -> log       # 42
$info.dimensions -> log  # 384
$info.distance -> log    # "cosine"
```

Returns `{ name, count, dimensions, distance }`.

## Configuration

```typescript
const ext = createQdrantExtension({
  url: 'http://localhost:6333',
  collection: 'my_vectors',
  dimensions: 384,
  distance: 'cosine',
  apiKey: process.env.QDRANT_API_KEY,
  timeout: 30000,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | required | Qdrant API endpoint URL |
| `collection` | string | required | Default collection name |
| `dimensions` | number | undefined | Vector dimension size |
| `distance` | string | `"cosine"` | `"cosine"`, `"euclidean"`, or `"dot"` |
| `apiKey` | string | undefined | API key for Qdrant Cloud |
| `timeout` | number | SDK default | Request timeout in ms |

## Error Handling

All errors use `RuntimeError('RILL-R004', 'qdrant: <message>')` and halt script execution.

| Condition | Message |
|-----------|---------|
| HTTP 401 | `qdrant: authentication failed (401)` |
| Collection not found | `qdrant: collection not found` |
| Rate limit (429) | `qdrant: rate limit exceeded` |
| Timeout | `qdrant: request timeout` |
| Dimension mismatch | `qdrant: dimension mismatch (expected N, got M)` |
| Collection exists | `qdrant: collection already exists` |
| ID not found | `qdrant: id not found` |
| After dispose | `qdrant: operation cancelled` |
| Other | `qdrant: <error message>` |

## Local Setup

Run Qdrant locally with Docker:

```bash
docker run -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage:z \
  qdrant/qdrant
```

Verify: `curl http://localhost:6333`

## Lifecycle

```typescript
const ext = createQdrantExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

`dispose()` aborts pending requests and closes the SDK client. Idempotent — second call resolves without error.

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |
| [Qdrant Documentation](https://qdrant.tech/documentation/) | Official Qdrant docs |

## License

MIT
