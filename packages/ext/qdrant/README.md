# @rcrsr/rill-ext-qdrant

[rill](https://rill.run) extension for [Qdrant](https://qdrant.tech) vector database integration. Provides host functions for vector operations, collection management, and semantic search.

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
  qdrant::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example"])
  qdrant::search([0.1, 0.2, 0.3], [limit: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

### qdrant::upsert(id, vector, metadata?)

Insert or update a vector with optional metadata.

```rill
qdrant::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example", page: 1]) => $result
$result.status -> log
```

### qdrant::upsert_batch(items)

Batch insert or update multiple vectors.

```rill
qdrant::upsert_batch([
  [id: "doc-1", vector: [0.1, 0.2, 0.3], metadata: [title: "First"]],
  [id: "doc-2", vector: [0.4, 0.5, 0.6], metadata: [title: "Second"]]
]) => $result
$result.status -> log
```

### qdrant::search(vector, options?)

Search for similar vectors.

```rill
qdrant::search([0.1, 0.2, 0.3], [limit: 5, score_threshold: 0.8]) => $results
$results.points -> log
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | number | `10` | Max results to return |
| `score_threshold` | number | undefined | Min similarity score |
| `filter` | dict | undefined | Metadata filter conditions |
| `offset` | number | `0` | Pagination offset |

### qdrant::get(id)

Retrieve a vector by ID.

```rill
qdrant::get("doc-1") => $point
$point.vector -> log
$point.payload -> log
```

### qdrant::delete(id)

Delete a vector by ID.

```rill
qdrant::delete("doc-1") => $result
$result.status -> log
```

### qdrant::delete_batch(ids)

Delete multiple vectors by ID.

```rill
qdrant::delete_batch(["doc-1", "doc-2", "doc-3"]) => $result
$result.status -> log
```

### qdrant::count()

Count vectors in the collection.

```rill
qdrant::count() => $result
$result.count -> log
```

### qdrant::create_collection(name, options?)

Create a new collection.

```rill
qdrant::create_collection("my_vectors", [dimensions: 384, distance: "cosine"]) => $result
$result.status -> log
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dimensions` | number | required | Vector dimension size |
| `distance` | string | `"cosine"` | Distance metric: `"cosine"`, `"euclidean"`, `"dot"` |

### qdrant::delete_collection(name)

Delete a collection.

```rill
qdrant::delete_collection("old_vectors") => $result
$result.status -> log
```

### qdrant::list_collections()

List all collections.

```rill
qdrant::list_collections() => $result
$result.collections -> log
```

### qdrant::describe()

Get collection information.

```rill
qdrant::describe() => $info
$info.vectors_count -> log
$info.config.params.vectors -> log
```

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
| `distance` | string | `"cosine"` | Distance metric: `"cosine"`, `"euclidean"`, `"dot"` |
| `apiKey` | string | undefined | API key for Qdrant Cloud |
| `timeout` | number | SDK default | Request timeout in ms |

## Error Handling

All errors use the format `RuntimeError('RILL-R004', 'qdrant: <message>')`.

| Error Condition | Message Pattern |
|----------------|-----------------|
| Missing required config | `qdrant: <field> is required` |
| Invalid vector dimension | `qdrant: vector dimension mismatch` |
| Collection not found | `qdrant: collection not found` |
| Network timeout | `qdrant: request timeout` |
| API error | `qdrant: <API error message>` |

```rill
# Errors are caught at the rill level:
qdrant::search([0.1, 0.2]) => $result  # Dimension mismatch error
```

## Local Qdrant Setup

For development, run Qdrant locally using Docker:

```bash
# Start Qdrant server
docker run -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage:z \
  qdrant/qdrant

# Verify server is running
curl http://localhost:6333
```

The server will be available at `http://localhost:6333` (REST API) and `http://localhost:6334` (gRPC).

**Default configuration:**

```typescript
const ext = createQdrantExtension({
  url: 'http://localhost:6333',
  collection: 'test_collection',
  dimensions: 384,
});
```

## Lifecycle

Call `dispose()` on the extension to clean up:

```typescript
const ext = createQdrantExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |
| [Qdrant Documentation](https://qdrant.tech/documentation/) | Official Qdrant docs |

## License

MIT
