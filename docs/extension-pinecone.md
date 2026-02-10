# pinecone Extension

*Pinecone vector database integration for rill scripts*

This extension allows rill scripts to access Pinecone's vector database API. The host binds it to a namespace with `prefixFunctions('pinecone', ext)`, and scripts call `pinecone::upsert()`, `pinecone::search()`, and so on. Switching to Qdrant or Chroma means changing one line of host config. Scripts stay identical.

Eleven functions cover vector operations and collection management. `upsert` and `upsert_batch` insert vectors with metadata. `search` finds k-nearest neighbors. `get` fetches by ID. `delete` and `delete_batch` remove vectors. `count` returns the namespace vector count. `create_collection`, `delete_collection`, `list_collections`, and `describe` manage collections. All operations use the configured index and namespace.

The host sets API key, index name, and namespace at creation time — scripts never handle credentials. Pinecone automatically validates vector dimensions against the index configuration.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createPineconeExtension } from '@rcrsr/rill-ext-pinecone';

const ext = createPineconeExtension({
  apiKey: process.env.PINECONE_API_KEY,
  index: 'my-index',
  namespace: 'default',
});
const prefixed = prefixFunctions('pinecone', ext);
const { dispose, ...functions } = prefixed;
const ctx = createRuntimeContext({ functions });

// Script: pinecone::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example"])
```

## Configuration

```typescript
const ext = createPineconeExtension({
  apiKey: process.env.PINECONE_API_KEY,
  index: 'my-index',
  namespace: 'production',
  timeout: 30000,
});
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | string | — | Pinecone API key (required) |
| `index` | string | — | Index name (required) |
| `namespace` | string | `''` | Namespace (empty string allowed) |
| `timeout` | number | `30000` | Request timeout in ms (must be positive integer) |

## Functions

**upsert(id, vector, metadata?)** — Insert or update a vector:

```rill
pinecone::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example", page: 1]) => $result
$result.upsertedCount -> log
```

**upsert_batch(items)** — Batch insert or update multiple vectors:

```rill
[
  [id: "doc-1", vector: [0.1, 0.2, 0.3], metadata: [title: "First"]],
  [id: "doc-2", vector: [0.4, 0.5, 0.6], metadata: [title: "Second"]],
] -> pinecone::upsert_batch => $result
$result.upsertedCount -> log
```

**search(vector, options?)** — Search for k-nearest neighbor vectors:

```rill
pinecone::search([0.1, 0.2, 0.3], [limit: 5, minScore: 0.8]) => $results
$results.matches -> log
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | number | `10` | Max results to return |
| `minScore` | number | — | Min similarity score |
| `filter` | dict | — | Metadata filter conditions |
| `includeValues` | boolean | `true` | Include vector values in results |
| `includeMetadata` | boolean | `true` | Include metadata in results |

**get(id)** — Fetch a vector by ID:

```rill
pinecone::get("doc-1") => $record
$record.values -> log
$record.metadata -> log
```

**delete(id)** — Delete a vector by ID:

```rill
pinecone::delete("doc-1")
```

**delete_batch(ids)** — Delete multiple vectors by ID:

```rill
pinecone::delete_batch(["doc-1", "doc-2", "doc-3"])
```

**count()** — Count total vectors in the namespace:

```rill
pinecone::count() => $result
$result.vectorCount -> log
```

**create_collection(name, options?)** — Create a new collection from the current index:

```rill
pinecone::create_collection("backup-2024", [source: "my-index"]) => $result
$result.name -> log
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | string | current index | Source index name |

**delete_collection(id)** — Delete a collection by name:

```rill
pinecone::delete_collection("backup-2023")
```

**list_collections()** — List all collections in the project:

```rill
pinecone::list_collections() => $result
$result.collections -> log
```

**describe()** — Describe the current index:

```rill
pinecone::describe() => $info
$info.dimension -> log
$info.metric -> log
$info.totalVectorCount -> log
```

## Error Behavior

**Validation errors** (before API call):

- Missing API key → `RuntimeError RILL-R004: pinecone: apiKey is required`
- Missing index → `RuntimeError RILL-R004: pinecone: index is required`
- Invalid timeout → `RuntimeError RILL-R004: pinecone: timeout must be a positive integer`

**API errors** (from Pinecone):

- Index not found → `RuntimeError RILL-R004: pinecone: index not found`
- Network timeout → `RuntimeError RILL-R004: pinecone: request timeout`
- Other API errors → `RuntimeError RILL-R004: pinecone: {API error message}`

## Cloud Pinecone Setup

Create a free Pinecone account at [pinecone.io](https://www.pinecone.io).

### Create Index

Using the Pinecone CLI:

```bash
pinecone index create my-index \
  --dimension 384 \
  --metric cosine \
  --cloud aws \
  --region us-east-1
```

Or via the Pinecone Console at [app.pinecone.io](https://app.pinecone.io).

### API Key

Find your API key in the Pinecone Console under **API Keys** section.

Default configuration:

```typescript
const ext = createPineconeExtension({
  apiKey: process.env.PINECONE_API_KEY,
  index: 'my-index',
  namespace: '', // Empty string for default namespace
});
```

### Free Tier Limits

Pinecone Starter (free) tier includes:
- 1 project
- 1 serverless index
- 2GB storage
- 10K vectors per namespace

See [Pinecone Pricing](https://www.pinecone.io/pricing/) for current limits.

## Lifecycle

Call `dispose()` on the extension to clean up:

```typescript
const ext = createPineconeExtension({ ... });
// ... use extension ...
await ext.dispose?.();
```

## See Also

- [Bundled Extensions](bundled-extensions.md) — All shipped extensions
- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
- [Reference](ref-language.md) — Language specification
