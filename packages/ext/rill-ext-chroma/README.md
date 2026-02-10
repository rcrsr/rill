# @rcrsr/rill-ext-chroma

[rill](https://rill.run) extension for [ChromaDB](https://www.trychroma.com) vector database integration. Provides host functions for vector operations, collection management, and semantic search.

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
  url: 'http://localhost:8000',
  collection: 'my_vectors',
});
const prefixed = prefixFunctions('chroma', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `
  chroma::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example"])
  chroma::search([0.1, 0.2, 0.3], [k: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

### chroma::upsert(id, vector, metadata?)

Insert or update a vector with optional metadata.

```rill
chroma::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example", page: 1]) => $result
$result.success -> log
```

### chroma::upsert_batch(items)

Batch insert or update multiple vectors.

```rill
chroma::upsert_batch([
  [id: "doc-1", vector: [0.1, 0.2, 0.3], metadata: [title: "First"]],
  [id: "doc-2", vector: [0.4, 0.5, 0.6], metadata: [title: "Second"]]
]) => $result
$result.succeeded -> log
```

### chroma::search(vector, options?)

Search for similar vectors.

```rill
chroma::search([0.1, 0.2, 0.3], [k: 5, filter: [category: "docs"]]) => $results
$results -> log
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `k` | number | `10` | Max results to return |
| `filter` | dict | undefined | Metadata filter conditions |

### chroma::get(id)

Retrieve a vector by ID.

```rill
chroma::get("doc-1") => $point
$point.vector -> log
$point.metadata -> log
```

### chroma::delete(id)

Delete a vector by ID.

```rill
chroma::delete("doc-1") => $result
$result.deleted -> log
```

### chroma::delete_batch(ids)

Delete multiple vectors by ID.

```rill
chroma::delete_batch(["doc-1", "doc-2", "doc-3"]) => $result
$result.succeeded -> log
```

### chroma::count()

Count vectors in the collection.

```rill
chroma::count() => $count
$count -> log
```

### chroma::create_collection(name, options?)

Create a new collection.

```rill
chroma::create_collection("my_vectors", [metadata: [description: "Test vectors"]]) => $result
$result.created -> log
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `metadata` | dict | `{}` | Collection metadata |

### chroma::delete_collection(name)

Delete a collection.

```rill
chroma::delete_collection("old_vectors") => $result
$result.deleted -> log
```

### chroma::list_collections()

List all collections.

```rill
chroma::list_collections() => $collections
$collections -> log
```

### chroma::describe()

Get collection information.

```rill
chroma::describe() => $info
$info.name -> log
$info.count -> log
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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | undefined | ChromaDB API endpoint URL (undefined uses embedded mode) |
| `collection` | string | required | Default collection name |
| `embeddingFunction` | string | undefined | Embedding function name (e.g., 'openai', 'cohere') |
| `timeout` | number | SDK default | Request timeout in ms |

## Error Handling

All errors use the format `RuntimeError('RILL-R004', 'chroma: <message>')`.

| Error Condition | Message Pattern |
|----------------|-----------------|
| Missing required config | `chroma: collection is required` |
| Authentication failure | `chroma: authentication failed (401)` |
| Collection not found | `chroma: collection not found` |
| Rate limit exceeded | `chroma: rate limit exceeded` |
| Network timeout | `chroma: request timeout` |
| Dimension mismatch | `chroma: dimension mismatch (expected X, got Y)` |
| Collection already exists | `chroma: collection already exists` |
| ID not found | `chroma: id not found` |
| API error | `chroma: <API error message>` |

```rill
# Errors are caught at the rill level:
chroma::search([0.1, 0.2]) => $result  # Dimension mismatch error
```

## Local ChromaDB Setup

For development, run ChromaDB locally using embedded mode or Docker.

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

**HTTP mode configuration:**

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

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |
| [ChromaDB Documentation](https://docs.trychroma.com) | Official ChromaDB docs |

## License

MIT
