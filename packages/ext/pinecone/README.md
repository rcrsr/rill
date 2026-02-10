# @rcrsr/rill-ext-pinecone

[rill](https://rill.run) extension for [Pinecone](https://www.pinecone.io) vector database integration. Provides host functions for vector operations, collection management, and semantic search.

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
  apiKey: process.env.PINECONE_API_KEY,
  index: 'my-index',
  namespace: 'default',
});
const prefixed = prefixFunctions('pinecone', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `
  pinecone::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example"])
  pinecone::search([0.1, 0.2, 0.3], [limit: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

### pinecone::upsert(id, vector, metadata?)

Insert or update a vector with optional metadata.

```rill
pinecone::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example", page: 1]) => $result
$result.upsertedCount -> log
```

### pinecone::upsert_batch(items)

Batch insert or update multiple vectors.

```rill
pinecone::upsert_batch([
  [id: "doc-1", vector: [0.1, 0.2, 0.3], metadata: [title: "First"]],
  [id: "doc-2", vector: [0.4, 0.5, 0.6], metadata: [title: "Second"]]
]) => $result
$result.upsertedCount -> log
```

### pinecone::search(vector, options?)

Search for k-nearest neighbor vectors.

```rill
pinecone::search([0.1, 0.2, 0.3], [limit: 5, minScore: 0.8]) => $results
$results.matches -> log
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | number | `10` | Max results to return |
| `minScore` | number | undefined | Min similarity score |
| `filter` | dict | undefined | Metadata filter conditions |
| `includeValues` | boolean | `true` | Include vector values in results |
| `includeMetadata` | boolean | `true` | Include metadata in results |

### pinecone::get(id)

Fetch a vector by ID.

```rill
pinecone::get("doc-1") => $record
$record.values -> log
$record.metadata -> log
```

### pinecone::delete(id)

Delete a vector by ID.

```rill
pinecone::delete("doc-1")
```

### pinecone::delete_batch(ids)

Delete multiple vectors by ID.

```rill
pinecone::delete_batch(["doc-1", "doc-2", "doc-3"])
```

### pinecone::count()

Count total vectors in the namespace.

```rill
pinecone::count() => $result
$result.vectorCount -> log
```

### pinecone::create_collection(name, options?)

Create a new collection from the current index.

```rill
pinecone::create_collection("backup-2024", [source: "my-index"]) => $result
$result.name -> log
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | string | current index | Source index name |

### pinecone::delete_collection(id)

Delete a collection by name.

```rill
pinecone::delete_collection("backup-2023")
```

### pinecone::list_collections()

List all collections in the project.

```rill
pinecone::list_collections() => $result
$result.collections -> log
```

### pinecone::describe()

Describe the current index.

```rill
pinecone::describe() => $info
$info.dimension -> log
$info.metric -> log
$info.totalVectorCount -> log
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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | required | Pinecone API key |
| `index` | string | required | Index name |
| `namespace` | string | `''` | Namespace (empty string allowed) |
| `timeout` | number | `30000` | Request timeout in ms (must be positive integer) |

## Error Handling

All errors use the format `RuntimeError('RILL-R004', 'pinecone: <message>')`.

| Error Condition | Message Pattern |
|----------------|-----------------|
| Missing required config | `pinecone: <field> is required` |
| Invalid timeout value | `pinecone: timeout must be a positive integer` |
| Index not found | `pinecone: index not found` |
| Network timeout | `pinecone: request timeout` |
| API error | `pinecone: <API error message>` |

```rill
# Errors are caught at the rill level:
pinecone::get("nonexistent-id") => $result  # Record not found error
```

## Cloud Pinecone Setup

For development, create a free Pinecone account at [pinecone.io](https://www.pinecone.io).

### Create Index

```bash
# Using the Pinecone CLI (https://docs.pinecone.io/guides/get-started/quickstart)
pinecone index create my-index \
  --dimension 384 \
  --metric cosine \
  --cloud aws \
  --region us-east-1
```

Or via the Pinecone Console at [app.pinecone.io](https://app.pinecone.io).

### API Key

Find your API key in the Pinecone Console under **API Keys** section.

**Default configuration:**

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

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |
| [Pinecone Documentation](https://docs.pinecone.io) | Official Pinecone docs |

## License

MIT
