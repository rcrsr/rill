# @rcrsr/rill-ext-pinecone

[rill](https://rill.run) extension for [Pinecone](https://www.pinecone.io) vector database integration. Provides 11 host functions for vector CRUD, batch operations, and collection management.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-pinecone
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createPineconeExtension } from '@rcrsr/rill-ext-pinecone';

const ext = createPineconeExtension({
  apiKey: process.env.PINECONE_API_KEY!,
  index: 'my-index',
});
const prefixed = prefixFunctions('pinecone', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `
  pinecone::upsert("doc-1", $embedding, [title: "Example"])
  pinecone::search($embedding, [k: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

All vector database extensions share identical function signatures. Swap `pinecone::` for `qdrant::` or `chroma::` with no script changes.

### pinecone::upsert(id, vector, metadata?)

Insert or update a single vector with metadata.

```rill
pinecone::upsert("doc-1", $embedding, [title: "Example", page: 1]) => $result
$result.id -> log       # "doc-1"
$result.success -> log  # true
```

**Idempotent.** Duplicate ID overwrites existing vector.

### pinecone::upsert_batch(items)

Batch insert or update vectors. Processes sequentially; halts on first failure.

```rill
pinecone::upsert_batch([
  [id: "doc-1", vector: $v1, metadata: [title: "First"]],
  [id: "doc-2", vector: $v2, metadata: [title: "Second"]]
]) => $result
$result.succeeded -> log  # 2
```

Returns `{ succeeded }` on success. Returns `{ succeeded, failed, error }` on failure.

### pinecone::search(vector, options?)

Search for k nearest neighbors.

```rill
pinecone::search($embedding, [k: 5, score_threshold: 0.8]) => $results
$results -> each { "{.id}: {.score}" -> log }
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `k` | number | `10` | Max results to return |
| `filter` | dict | `{}` | Metadata filter conditions |
| `score_threshold` | number | (none) | Exclude results below threshold |

Returns `[{ id, score, metadata }]`. Empty results return `[]`.

### pinecone::get(id)

Fetch a vector by ID.

```rill
pinecone::get("doc-1") => $point
$point.id -> log        # "doc-1"
$point.metadata -> log  # [title: "Example", page: 1]
```

Returns `{ id, vector, metadata }`. Halts with error if ID not found.

### pinecone::delete(id)

Delete a vector by ID.

```rill
pinecone::delete("doc-1") => $result
$result.deleted -> log  # true
```

Returns `{ id, deleted }`. Halts with error if ID not found.

### pinecone::delete_batch(ids)

Batch delete vectors. Processes sequentially; halts on first failure.

```rill
pinecone::delete_batch(["doc-1", "doc-2", "doc-3"]) => $result
$result.succeeded -> log  # 3
```

Returns `{ succeeded }` on success. Returns `{ succeeded, failed, error }` on failure.

### pinecone::count()

Count vectors in the index.

```rill
pinecone::count() -> log  # 42
```

Returns a number.

### pinecone::create_collection(name, options?)

Create a new collection.

```rill
pinecone::create_collection("my_vectors", [dimensions: 384, distance: "cosine"]) => $result
$result.created -> log  # true
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dimensions` | number | (none) | Vector dimension size |
| `distance` | string | `"cosine"` | `"cosine"`, `"euclidean"`, or `"dot"` |

Returns `{ name, created }`. **Not idempotent** — halts if collection exists.

### pinecone::delete_collection(id)

Delete a collection.

```rill
pinecone::delete_collection("old_vectors") => $result
$result.deleted -> log  # true
```

Returns `{ name, deleted }`. **Not idempotent** — halts if collection not found.

### pinecone::list_collections()

List all collection names.

```rill
pinecone::list_collections() -> log  # ["my_vectors", "archive"]
```

Returns a list of strings.

### pinecone::describe()

Describe the configured index.

```rill
pinecone::describe() => $info
$info.name -> log        # "my-index"
$info.count -> log       # 42
$info.dimensions -> log  # 384
$info.distance -> log    # "cosine"
```

Returns `{ name, count, dimensions, distance }`.

## Configuration

```typescript
const ext = createPineconeExtension({
  apiKey: process.env.PINECONE_API_KEY!,
  index: 'my-index',
  namespace: 'production',
  timeout: 30000,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | required | Pinecone API key |
| `index` | string | required | Index name |
| `namespace` | string | `''` | Namespace for partitioning |
| `timeout` | number | `30000` | Request timeout in ms |

## Error Handling

All errors use `RuntimeError('RILL-R004', 'pinecone: <message>')` and halt script execution.

| Condition | Message |
|-----------|---------|
| HTTP 401 | `pinecone: authentication failed (401)` |
| Collection not found | `pinecone: collection not found` |
| Rate limit (429) | `pinecone: rate limit exceeded` |
| Timeout | `pinecone: request timeout` |
| Dimension mismatch | `pinecone: dimension mismatch (expected N, got M)` |
| Collection exists | `pinecone: collection already exists` |
| ID not found | `pinecone: id not found` |
| After dispose | `pinecone: operation cancelled` |
| Other | `pinecone: <error message>` |

## Cloud Setup

Create a free account at [pinecone.io](https://www.pinecone.io). Find your API key in the Pinecone Console under **API Keys**.

```bash
pinecone index create my-index \
  --dimension 384 \
  --metric cosine \
  --cloud aws \
  --region us-east-1
```

Free tier includes 1 serverless index, 2GB storage, 10K vectors per namespace. See [Pinecone Pricing](https://www.pinecone.io/pricing/) for current limits.

## Lifecycle

```typescript
const ext = createPineconeExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

`dispose()` aborts pending requests and closes the SDK client. Idempotent — second call resolves without error.

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |
| [Pinecone Documentation](https://docs.pinecone.io) | Official Pinecone docs |

## License

MIT
