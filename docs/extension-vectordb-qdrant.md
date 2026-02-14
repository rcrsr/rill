# qdrant Extension

*Qdrant vector database integration for rill scripts*

This extension allows rill scripts to access Qdrant's vector database API. The host binds it to a namespace with `prefixFunctions('qdrant', ext)`, and scripts call `qdrant::upsert()`, `qdrant::search()`, and so on. Switching to Pinecone or Chroma means changing one line of host config. Scripts stay identical.

Eleven functions cover vector operations and collection management. `upsert` and `upsert_batch` insert vectors with metadata. `search` finds similar vectors. `get` retrieves by ID. `delete` and `delete_batch` remove vectors. `count` returns the total vector count. `create_collection`, `delete_collection`, `list_collections`, and `describe` manage collections. All operations use the configured collection unless overridden.

The host sets URL, collection name, and API key at creation time — scripts never handle credentials. Vector dimensions are validated against the collection configuration.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createQdrantExtension } from '@rcrsr/rill-ext-qdrant';

const ext = createQdrantExtension({
  url: 'http://localhost:6333',
  collection: 'my_vectors',
  dimensions: 384,
});
const prefixed = prefixFunctions('qdrant', ext);
const { dispose, ...functions } = prefixed;
const ctx = createRuntimeContext({ functions });

// Script: qdrant::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example"])
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

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | — | Qdrant API endpoint URL (required) |
| `collection` | string | — | Default collection name (required) |
| `dimensions` | number | — | Vector dimension size |
| `distance` | string | `"cosine"` | Distance metric: `"cosine"`, `"euclidean"`, `"dot"` |
| `apiKey` | string | — | API key for Qdrant Cloud |
| `timeout` | number | SDK default | Request timeout in ms |

## Functions

**upsert(id, vector, metadata?)** — Insert or update a vector:

```rill
qdrant::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example", page: 1]) => $result
$result.status -> log
```

**upsert_batch(items)** — Batch insert or update multiple vectors:

```rill
[
  [id: "doc-1", vector: [0.1, 0.2, 0.3], metadata: [title: "First"]],
  [id: "doc-2", vector: [0.4, 0.5, 0.6], metadata: [title: "Second"]],
] -> qdrant::upsert_batch => $result
$result.status -> log
```

**search(vector, options?)** — Search for similar vectors:

```rill
qdrant::search([0.1, 0.2, 0.3], [limit: 5, score_threshold: 0.8]) => $results
$results.points -> log
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | number | `10` | Max results to return |
| `score_threshold` | number | — | Min similarity score |
| `filter` | dict | — | Metadata filter conditions |
| `offset` | number | `0` | Pagination offset |

**get(id)** — Retrieve a vector by ID:

```rill
qdrant::get("doc-1") => $point
$point.vector -> log
$point.payload -> log
```

**delete(id)** — Delete a vector by ID:

```rill
qdrant::delete("doc-1") => $result
$result.status -> log
```

**delete_batch(ids)** — Delete multiple vectors by ID:

```rill
qdrant::delete_batch(["doc-1", "doc-2", "doc-3"]) => $result
$result.status -> log
```

**count()** — Count vectors in the collection:

```rill
qdrant::count() => $result
$result.count -> log
```

**create_collection(name, options?)** — Create a new collection:

```rill
qdrant::create_collection("my_vectors", [dimensions: 384, distance: "cosine"]) => $result
$result.status -> log
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dimensions` | number | — | Vector dimension size (required) |
| `distance` | string | `"cosine"` | Distance metric: `"cosine"`, `"euclidean"`, `"dot"` |

**delete_collection(name)** — Delete a collection:

```rill
qdrant::delete_collection("old_vectors") => $result
$result.status -> log
```

**list_collections()** — List all collections:

```rill
qdrant::list_collections() => $result
$result.collections -> log
```

**describe()** — Get collection information:

```rill
qdrant::describe() => $info
$info.vectors_count -> log
$info.config -> log
```

## Error Behavior

**Validation errors** (before API call):

- Missing URL → `RuntimeError RILL-R004: qdrant: url is required`
- Missing collection → `RuntimeError RILL-R004: qdrant: collection is required`
- Vector dimension mismatch → `RuntimeError RILL-R004: qdrant: vector dimension mismatch`

**API errors** (from Qdrant):

- Collection not found → `RuntimeError RILL-R004: qdrant: collection not found`
- Network timeout → `RuntimeError RILL-R004: qdrant: request timeout`
- Other API errors → `RuntimeError RILL-R004: qdrant: {API error message}`

## Local Qdrant Setup

Run Qdrant locally using Docker:

```bash
# Start Qdrant server
docker run -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage:z \
  qdrant/qdrant

# Verify server is running
curl http://localhost:6333
```

The server will be available at `http://localhost:6333` (REST API) and `http://localhost:6334` (gRPC).

Default local configuration:

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

## See Also

- [Bundled Extensions](bundled-extensions.md) — All shipped extensions
- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
- [Reference](ref-language.md) — Language specification
