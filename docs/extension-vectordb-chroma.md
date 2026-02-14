# chroma Extension

*ChromaDB vector database integration for rill scripts*

This extension allows rill scripts to access ChromaDB's vector database API. The host binds it to a namespace with `prefixFunctions('chroma', ext)`, and scripts call `chroma::upsert()`, `chroma::search()`, and so on. Switching to Pinecone or Qdrant means changing one line of host config. Scripts stay identical.

Eleven functions cover vector operations and collection management. `upsert` and `upsert_batch` insert vectors with metadata. `search` finds similar vectors. `get` retrieves by ID. `delete` and `delete_batch` remove vectors. `count` returns the total vector count. `create_collection`, `delete_collection`, `list_collections`, and `describe` manage collections. All operations use the configured collection unless overridden.

The host sets URL and collection name at creation time — scripts never handle credentials. ChromaDB supports both embedded mode (in-process) and HTTP server mode. Vector dimensions are validated automatically.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createChromaExtension } from '@rcrsr/rill-ext-chroma';

const ext = createChromaExtension({
  url: 'http://localhost:8000',
  collection: 'my_vectors',
});
const prefixed = prefixFunctions('chroma', ext);
const { dispose, ...functions } = prefixed;
const ctx = createRuntimeContext({ functions });

// Script: chroma::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example"])
```

## Configuration

```typescript
const ext = createChromaExtension({
  url: 'http://localhost:8000',
  collection: 'my_vectors',
  embeddingFunction: 'openai',
  timeout: 30000,
});
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | — | ChromaDB API endpoint URL (undefined uses embedded mode) |
| `collection` | string | — | Default collection name (required) |
| `embeddingFunction` | string | — | Embedding function name (e.g., 'openai', 'cohere') |
| `timeout` | number | SDK default | Request timeout in ms |

## Functions

**upsert(id, vector, metadata?)** — Insert or update a vector:

```rill
chroma::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example", page: 1]) => $result
$result.success -> log
```

**upsert_batch(items)** — Batch insert or update multiple vectors:

```rill
[
  [id: "doc-1", vector: [0.1, 0.2, 0.3], metadata: [title: "First"]],
  [id: "doc-2", vector: [0.4, 0.5, 0.6], metadata: [title: "Second"]],
] -> chroma::upsert_batch => $result
$result.succeeded -> log
```

**search(vector, options?)** — Search for similar vectors:

```rill
chroma::search([0.1, 0.2, 0.3], [k: 5]) => $results
$results -> log
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `k` | number | `10` | Max results to return |
| `filter` | dict | — | Metadata filter conditions |

**get(id)** — Retrieve a vector by ID:

```rill
chroma::get("doc-1") => $point
$point.vector -> log
$point.metadata -> log
```

**delete(id)** — Delete a vector by ID:

```rill
chroma::delete("doc-1") => $result
$result.deleted -> log
```

**delete_batch(ids)** — Delete multiple vectors by ID:

```rill
chroma::delete_batch(["doc-1", "doc-2", "doc-3"]) => $result
$result.succeeded -> log
```

**count()** — Count vectors in the collection:

```rill
chroma::count() => $count
$count -> log
```

**create_collection(name, options?)** — Create a new collection:

```rill
chroma::create_collection("my_vectors", [metadata: [description: "Test vectors"]]) => $result
$result.created -> log
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `metadata` | dict | `{}` | Collection metadata |

**delete_collection(name)** — Delete a collection:

```rill
chroma::delete_collection("old_vectors") => $result
$result.deleted -> log
```

**list_collections()** — List all collections:

```rill
chroma::list_collections() => $collections
$collections -> log
```

**describe()** — Get collection information:

```rill
chroma::describe() => $info
$info.name -> log
$info.count -> log
```

## Error Behavior

**Validation errors** (before API call):

- Missing collection → `RuntimeError RILL-R004: chroma: collection is required`
- Vector dimension mismatch → `RuntimeError RILL-R004: chroma: dimension mismatch (expected X, got Y)`
- Collection already exists → `RuntimeError RILL-R004: chroma: collection already exists`
- ID not found → `RuntimeError RILL-R004: chroma: id not found`

**API errors** (from ChromaDB):

- Authentication failure → `RuntimeError RILL-R004: chroma: authentication failed (401)`
- Collection not found → `RuntimeError RILL-R004: chroma: collection not found`
- Rate limit exceeded → `RuntimeError RILL-R004: chroma: rate limit exceeded`
- Network timeout → `RuntimeError RILL-R004: chroma: request timeout`
- Other API errors → `RuntimeError RILL-R004: chroma: {API error message}`

## Local ChromaDB Setup

ChromaDB supports embedded mode (in-process) or HTTP server mode.

### Embedded Mode (Default)

ChromaDB embedded mode runs in-process without external server:

```typescript
const ext = createChromaExtension({
  collection: 'test_collection',
});
```

No Docker or server setup required. Data persists to local storage.

### HTTP Server Mode

Run ChromaDB server using Docker:

```bash
# Start ChromaDB server
docker run -p 8000:8000 chromadb/chroma

# Verify server is running
curl http://localhost:8000/api/v1
```

The server will be available at `http://localhost:8000`.

HTTP mode configuration:

```typescript
const ext = createChromaExtension({
  url: 'http://localhost:8000',
  collection: 'test_collection',
});
```

## Lifecycle

Call `dispose()` on the extension to clean up:

```typescript
const ext = createChromaExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

## See Also

- [Bundled Extensions](bundled-extensions.md) — All shipped extensions
- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
- [Reference](ref-language.md) — Language specification
