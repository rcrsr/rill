# mcp Extension

*MCP server integration for rill scripts*

This extension allows rill scripts to access Model Context Protocol (MCP) servers. MCP provides a standard interface for exposing tools, resources, and prompts from external services. The host binds the extension to a namespace with `prefixFunctions('fs', ext)`, and scripts call server functions dynamically. Each MCP server generates host functions automatically from its capabilities — no manual bindings needed.

The extension supports stdio and HTTP transports. Stdio servers run as child processes (filesystem, database, GitHub). HTTP servers connect to remote endpoints with static or dynamic authentication. Multi-server composition lets scripts mix capabilities from different sources in a single namespace.

Host functions generate dynamically from server metadata: one function per tool, resource template functions, prompt functions, and introspection helpers. Use `list_tools()`, `list_resources()`, and `list_prompts()` to discover capabilities at runtime.

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createMcpExtension } from '@rcrsr/rill-ext-mcp';

const ext = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
});
const prefixed = prefixFunctions('fs', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({ functions });

// Script: fs::list_tools() -> log
```

## Configuration

```typescript
interface McpExtensionConfig {
  transport: McpTransportConfig;
  timeout?: number;          // per-call timeout in ms, default: 30000
  toolFilter?: string[];     // include only these tool names (empty = all)
  resourceFilter?: string[]; // include only these resource URIs (empty = all)
  promptFilter?: string[];   // include only these prompt names (empty = all)
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `transport` | object | — | Transport configuration (required) |
| `timeout` | number | 30000 | Request timeout in ms |
| `toolFilter` | string[] | — | Include only specified tool names |
| `resourceFilter` | string[] | — | Include only specified resource URIs |
| `promptFilter` | string[] | — | Include only specified prompt names |

## Transport Types

### stdio Transport

Run MCP servers as child processes. Use for local tools (filesystem, database CLI, Git).

```typescript
interface McpStdioTransportConfig {
  type: 'stdio';
  command: string;              // executable name or path
  args?: string[];              // command-line arguments
  env?: Record<string, string>; // environment variables
}
```

Example:

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'mcp-server-postgres',
    args: ['--host', 'localhost', '--port', '5432'],
    env: {
      DATABASE_URL: process.env.PG_URL,
      LOG_LEVEL: 'info',
    },
  },
  timeout: 60000, // 60-second timeout for long queries
});
```

### HTTP Transport

Connect to remote MCP servers over HTTP. Use for managed services and internal APIs.

```typescript
interface McpHttpTransportConfig {
  type: 'http';
  url: string;                  // HTTP endpoint URL
  headers?:                     // static headers, sync/async function
    | HeadersInit
    | (() => HeadersInit | Promise<HeadersInit>);
}
```

Example with static headers:

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'http',
    url: 'https://mcp.example.com/v1',
    headers: {
      'Authorization': `Bearer ${process.env.API_KEY}`,
      'Content-Type': 'application/json',
    },
  },
});
```

Dynamic token refresh:

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'http',
    url: 'https://mcp.corp.internal',
    headers: async () => ({
      Authorization: `Bearer ${await getValidToken(userId, 'mcp-server')}`,
    }),
  },
});
```

The header function executes before each MCP request, enabling token refresh without reconnection.

## Host Functions

The extension generates functions dynamically from server capabilities:

| Function Type | Generated From | Example |
|--------------|---------------|---------|
| Tool functions | MCP tools | `read_file([path: "/tmp/test.txt"])` |
| Resource functions | Static resources | `read_resource("file:///logs/app.log")` |
| Template functions | Resource templates | `file_resource([path: "/tmp/data.json"])` |
| Prompt functions | MCP prompts | `summarize([text: $content])` |
| Introspection | Always present | `list_tools()`, `list_resources()`, `list_prompts()` |

Function names and parameters derive from server metadata. Use introspection to discover capabilities:

```rill
fs::list_tools() => $tools
$tools -> each { "{$.name}: {$.description}" -> log }
```

## Examples

### Filesystem MCP Server

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
});
```

```rill
fs::list_tools() => $tools
$tools -> log

fs::read_file([path: "/tmp/test.txt"]) => $content
$content.content -> log
```

### Multi-Server Composition

Compose capabilities from multiple servers with different prefixes:

```typescript
const ghExt = await createMcpExtension({
  transport: { type: 'stdio', command: 'mcp-server-github' },
});

const pgExt = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'mcp-server-postgres',
    env: { DATABASE_URL: process.env.PG_URL },
  },
});

const ctx = createRuntimeContext({
  functions: {
    ...prefixFunctions('gh', ghExt),
    ...prefixFunctions('pg', pgExt),
  },
});
```

```rill
gh::list_pull_requests([state: "open"]) => $prs
$prs -> each {
  pg::query([sql: "SELECT status FROM deployments WHERE pr_id = {$.number}"]) => $deploy
  "PR {$.number}: {$.title} — deploy: {$deploy.status}" -> log
}
```

### Database + LLM Composition

Combine database queries with LLM analysis:

```typescript
const dbExt = await createMcpExtension({
  transport: { type: 'stdio', command: 'mcp-server-postgres' },
});

const aiExt = await createMcpExtension({
  transport: { type: 'stdio', command: 'mcp-server-claude' },
});

const ctx = createRuntimeContext({
  functions: {
    ...prefixFunctions('db', dbExt),
    ...prefixFunctions('ai', aiExt),
  },
});
```

```rill
db::read_query([sql: "SELECT name, revenue FROM companies ORDER BY revenue DESC LIMIT 10"]) => $top
$top -> map { "{$.name}: {$.revenue}" } -> .join("\n") => $summary
"Analyze these top companies:\n{$summary}" -> ai::message() => $analysis
$analysis.content -> log
```

## Filters

Restrict exposed capabilities with filters:

```typescript
const ext = await createMcpExtension({
  transport: { /* ... */ },
  toolFilter: ['read_file', 'write_file'], // only file operations
  resourceFilter: ['file:///logs/*'],      // only log files
  promptFilter: ['summarize', 'analyze'],  // specific prompts
});
```

Introspection functions (`list_tools`, `list_resources`, `list_prompts`) return all server capabilities regardless of filter settings.

## Error Behavior

**Connection errors** during `createMcpExtension()`:

- Config validation → `transport.command is required for stdio`
- Process exit → `mcp: failed to connect -- server process exited with code 1`
- Connection refused → `mcp: failed to connect -- connection refused at https://...`
- Auth required → `mcp: server requires authentication -- complete OAuth flow`

**Runtime errors** during script execution (halts execution with `RuntimeError RILL-R004`):

- Tool execution → `mcp tool "read_file": file not found`
- Protocol error → `mcp: protocol error -- invalid tool name`
- Timeout → `mcp: timeout calling tool "slow_query"`
- Connection lost → `mcp: connection lost to server`
- Auth failed → `mcp: authentication failed`

rill scripts have no exception handling. Design error-resilient workflows:

```rill
fs::list_tools() => $tools
$tools -> map { $.name } => $names
$names -> .has("read_file") => $has_read
$has_read ? {
  fs::read_file([path: "/tmp/test.txt"]) -> log
} ! {
  "read_file tool not available" -> log
}
```

## Lifecycle

Call `dispose()` to close connections and clean up resources:

```typescript
const ext = await createMcpExtension({ /* ... */ });
const prefixed = prefixFunctions('mcp', ext);

// Use extension...

await prefixed.dispose?.();
```

Dispose is idempotent. Always call before process exit to prevent resource leaks.

## See Also

- [Bundled Extensions](bundled-extensions.md) — All shipped extensions
- [Developing Extensions](integration-extensions.md) — Writing custom extensions
- [Host Integration](integration-host.md) — Embedding API
- [Reference](ref-language.md) — Language specification
