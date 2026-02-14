# @rcrsr/rill-ext-chroma

[rill](https://rill.run) extension for [ChromaDB](https://www.trychroma.com) vector database integration. Provides 11 host functions for vector CRUD, batch operations, and collection management.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-chroma
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createChromaExtension } from '@rcrsr/rill-ext-chroma';

const ext = createChromaExtension({
  collection: 'my_vectors',
});
const prefixed = prefixFunctions('chroma', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `
  chroma::upsert("doc-1", $embedding, [title: "Example"])
  chroma::search($embedding, [k: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

All vector database extensions share identical function signatures. Swap `chroma::` for `qdrant::` or `pinecone::` with no script changes.

### chroma::upsert(id, vector, metadata?)

Insert or update a single vector with metadata.

```rill
chroma::upsert("doc-1", $embedding, [title: "Example", page: 1]) => $result
$result.id -> log       # "doc-1"
$result.success -> log  # true
```

**Idempotent.** Duplicate ID overwrites existing vector.

### chroma::upsert_batch(items)

Batch insert or update vectors. Processes sequentially; halts on first failure.

```rill
chroma::upsert_batch([
  [id: "doc-1", vector: $v1, metadata: [title: "First"]],
  [id: "doc-2", vector: $v2, metadata: [title: "Second"]]
]) => $result
$result.succeeded -> log  # 2
```

Returns `{ succeeded }` on success. Returns `{ succeeded, failed, error }` on failure.

### chroma::search(vector, options?)

Search for k nearest neighbors.

```rill
chroma::search($embedding, [k: 5, score_threshold: 0.8]) => $results
$results -> each { "{.id}: {.score}" -> log }
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `k` | number | `10` | Max results to return |
| `filter` | dict | `{}` | Metadata filter conditions |
| `score_threshold` | number | (none) | Exclude results below threshold |

Returns `[{ id, score, metadata }]`. Empty results return `[]`.

### chroma::get(id)

Fetch a vector by ID.

```rill
chroma::get("doc-1") => $point
$point.id -> log        # "doc-1"
$point.metadata -> log  # [title: "Example", page: 1]
```

Returns `{ id, vector, metadata }`. Halts with error if ID not found.

### chroma::delete(id)

Delete a vector by ID.

```rill
chroma::delete("doc-1") => $result
$result.deleted -> log  # true
```

Returns `{ id, deleted }`. Halts with error if ID not found.

### chroma::delete_batch(ids)

Batch delete vectors. Processes sequentially; halts on first failure.

```rill
chroma::delete_batch(["doc-1", "doc-2", "doc-3"]) => $result
$result.succeeded -> log  # 3
```

Returns `{ succeeded }` on success. Returns `{ succeeded, failed, error }` on failure.

### chroma::count()

Count vectors in the collection.

```rill
chroma::count() -> log  # 42
```

Returns a number.

### chroma::create_collection(name, options?)

Create a new collection.

```rill
chroma::create_collection("my_vectors", [dimensions: 384, distance: "cosine"]) => $result
$result.created -> log  # true
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dimensions` | number | (none) | Vector dimension size |
| `distance` | string | `"cosine"` | `"cosine"`, `"euclidean"`, or `"dot"` |

Returns `{ name, created }`. **Not idempotent** — halts if collection exists.

### chroma::delete_collection(id)

Delete a collection.

```rill
chroma::delete_collection("old_vectors") => $result
$result.deleted -> log  # true
```

Returns `{ name, deleted }`. **Not idempotent** — halts if collection not found.

### chroma::list_collections()

List all collection names.

```rill
chroma::list_collections() -> log  # ["my_vectors", "archive"]
```

Returns a list of strings.

### chroma::describe()

Describe the configured collection.

```rill
chroma::describe() => $info
$info.name -> log        # "my_vectors"
$info.count -> log       # 42
$info.dimensions -> log  # 384
$info.distance -> log    # "cosine"
```

Returns `{ name, count, dimensions, distance }`.

## Configuration

```typescript
const ext = createChromaExtension({
  url: 'http://localhost:8000',
  collection: 'my_vectors',
  embeddingFunction: 'openai',
  timeout: 30000,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | undefined | ChromaDB API endpoint (undefined uses embedded mode) |
| `collection` | string | required | Default collection name |
| `embeddingFunction` | string | undefined | Embedding function name |
| `timeout` | number | SDK default | Request timeout in ms |

## Error Handling

All errors use `RuntimeError('RILL-R004', 'chroma: <message>')` and halt script execution.

| Condition | Message |
|-----------|---------|
| HTTP 401 | `chroma: authentication failed (401)` |
| Collection not found | `chroma: collection not found` |
| Rate limit (429) | `chroma: rate limit exceeded` |
| Timeout | `chroma: request timeout` |
| Dimension mismatch | `chroma: dimension mismatch (expected N, got M)` |
| Collection exists | `chroma: collection already exists` |
| ID not found | `chroma: id not found` |
| After dispose | `chroma: operation cancelled` |
| Other | `chroma: <error message>` |

## Local Setup

### Embedded Mode (default)

ChromaDB runs in-process without an external server:

```typescript
const ext = createChromaExtension({
  collection: 'test_collection',
});
```

No Docker or server setup required.

### HTTP Server Mode

Run ChromaDB with Docker:

```bash
docker run -p 8000:8000 chromadb/chroma
```

Verify: `curl http://localhost:8000/api/v1`

```typescript
const ext = createChromaExtension({
  url: 'http://localhost:8000',
  collection: 'test_collection',
});
```

## Lifecycle

```typescript
const ext = createChromaExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

`dispose()` aborts pending requests and closes the SDK client. Idempotent — second call resolves without error.

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |
| [ChromaDB Documentation](https://docs.trychroma.com) | Official ChromaDB docs |

## License

MIT
