# @rcrsr/rill-ext-mcp

*rill extension for Model Context Protocol (MCP) integration*

[rill](https://rill.run) extension for [Model Context Protocol (MCP)](https://modelcontextprotocol.io) integration. Provides dynamic host functions generated from MCP server capabilities. Supports stdio and HTTP transports with static and dynamic authentication.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-mcp
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
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

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `fs::list_tools() -> log`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Host Functions

The extension generates host functions dynamically from MCP server capabilities:

- **Tool functions**: One function per MCP tool (e.g., `read_file`, `write_file`)
- **Resource functions**: `read_resource(uri)` for static resources, plus template functions (e.g., `file_resource(path)`)
- **Prompt functions**: One function per MCP prompt with argument mapping
- **Introspection functions**: `list_tools()`, `list_resources()`, `list_prompts()`

Function names and parameters are automatically generated from server metadata. Use introspection functions to discover available capabilities.

## Examples

### Filesystem MCP Server (AC-1)

Connect to the official filesystem MCP server:

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

### HTTP Transport with Static Headers

Connect to an HTTP-based MCP server with API key authentication:

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'http',
    url: 'https://mcp.example.com',
    headers: {
      'Authorization': `Bearer ${process.env.API_KEY}`,
      'Content-Type': 'application/json',
    },
  },
});
```

### Dynamic Token Refresh (AC-4)

Use a header function for dynamic token refresh with OAuth-protected APIs:

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

The header function runs before each MCP request, enabling token refresh without reconnection.

### Multi-Server Composition (AC-3)

Compose multiple MCP servers with different prefixes:

```typescript
const ghExt = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'mcp-server-github',
  },
});

const pgExt = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'mcp-server-postgres',
    env: { DATABASE_URL: process.env.PG_URL },
  },
});

const slackExt = await createMcpExtension({
  transport: {
    type: 'http',
    url: 'https://mcp-slack.internal',
  },
});

const ctx = createRuntimeContext({
  functions: {
    ...prefixFunctions('gh', ghExt),
    ...prefixFunctions('pg', pgExt),
    ...prefixFunctions('slack', slackExt),
  },
});
```

```rill
gh::list_pull_requests([state: "open"]) => $prs
$prs -> each {
  pg::query([sql: "SELECT status FROM deployments WHERE pr_id = {$.number}"]) => $deploy
  "PR {$.number}: {$.title} — deploy: {$deploy.status}" -> log
}
$prs -> .len => $count
slack::post_message([channel: "#engineering", text: "{$count} open PRs reviewed"])
```

### Database + LLM Composition (AC-2)

Combine database query with LLM analysis:

```typescript
const dbExt = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'mcp-server-postgres',
  },
});

const aiExt = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'mcp-server-claude',
  },
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

### stdio Transport

```typescript
interface McpStdioTransportConfig {
  type: 'stdio';
  command: string;              // executable name or path
  args?: string[];              // command-line arguments
  env?: Record<string, string>; // environment variables
}
```

**Example:**

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

```typescript
interface McpHttpTransportConfig {
  type: 'http';
  url: string;                  // HTTP endpoint URL
  headers?:                     // static headers, sync/async function
    | HeadersInit
    | (() => HeadersInit | Promise<HeadersInit>);
}
```

**Example:**

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'http',
    url: 'https://mcp.example.com/v1',
    headers: {
      'X-API-Key': process.env.API_KEY,
      'User-Agent': 'rill-app/1.0',
    },
  },
});
```

### Filters

Use filters to expose only specific capabilities as host functions:

```typescript
const ext = await createMcpExtension({
  transport: { /* ... */ },
  toolFilter: ['read_file', 'write_file'], // only file operations
  resourceFilter: ['file:///logs/*'],      // only log files
  promptFilter: ['summarize', 'analyze'],  // specific prompts
});
```

Introspection functions (`list_tools`, `list_resources`, `list_prompts`) always return all server capabilities regardless of filters.

## Authentication Patterns

### Level 1: Static Credentials

API keys, bearer tokens, or basic auth via static headers:

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'http',
    url: 'https://mcp.example.com',
    headers: {
      'Authorization': `Bearer ${process.env.API_KEY}`,
    },
  },
});
```

For stdio servers, pass credentials via environment variables:

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'mcp-server-database',
    env: {
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
    },
  },
});
```

### Level 2: Dynamic Token Refresh

OAuth-protected APIs with short-lived tokens. Use a header function to refresh tokens before each request:

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'http',
    url: 'https://mcp.example.com',
    headers: async () => {
      const token = await getValidToken(userId, 'mcp-server');
      return {
        Authorization: `Bearer ${token}`,
      };
    },
  },
});
```

The header function executes before each MCP protocol request. Implement token caching and refresh logic in `getValidToken()`.

### Level 3: MCP Protocol-Level OAuth

For OAuth flows requiring browser interaction, the host application handles authentication before extension creation. The MCP SDK will provide OAuth-specific transport configurations in a future release.

Workaround: Complete OAuth flow in host app, store tokens, and use Level 2 pattern with token refresh.

## Error Handling

### Connection Errors (Factory)

Thrown during `createMcpExtension()` as plain `Error` instances:

| Error | Cause | Example |
|-------|-------|---------|
| Config validation | Missing required transport fields | `transport.command is required for stdio` |
| Process exit | stdio server exits with non-zero code | `mcp: failed to connect -- server process exited with code 1` |
| Connection refused | HTTP server unreachable | `mcp: failed to connect -- connection refused at https://...` |
| Auth required | Server requires OAuth (401/403) | `mcp: server requires authentication -- complete OAuth flow` |

**Handling:**

```typescript
try {
  const ext = await createMcpExtension({ transport });
} catch (error) {
  if (error.message.includes('mcp: failed to connect')) {
    console.error('MCP server connection failed:', error.message);
  } else {
    console.error('Configuration error:', error.message);
  }
}
```

### Runtime Errors (Execution)

Thrown during rill script execution as `RuntimeError` with code `RILL-R004`:

| Error | Cause | Example |
|-------|-------|---------|
| Tool execution | MCP tool returns error | `mcp tool "read_file": file not found` |
| Protocol error | Invalid MCP request/response | `mcp: protocol error -- invalid tool name` |
| Timeout | Tool call exceeds timeout | `mcp: timeout calling tool "slow_query"` |
| Connection lost | Transport disconnects during call | `mcp: connection lost to server` |
| Auth failed | Token expired or invalid | `mcp: authentication failed` |

**Handling:**

Runtime errors halt rill script execution. Use try-catch in host code around `execute()`:

```typescript
try {
  const result = await execute(parse(script), ctx);
  console.log('Success:', result);
} catch (error) {
  if (error instanceof RuntimeError && error.code === 'RILL-R004') {
    console.error('MCP runtime error:', error.message);
    console.error('Context:', error.context);
  }
}
```

rill has no exception handling within scripts. Design error-resilient workflows:

```rill
# Check before operation
fs::list_tools() -> .map { $.name } -> .contains("read_file") => $has_read
$has_read -> if {
  fs::read_file([path: "/tmp/test.txt"]) -> log
} else {
  "read_file tool not available" -> log
}
```

## Lifecycle

Call `dispose()` on the extension to close connections and clean up resources:

```typescript
const ext = await createMcpExtension({ /* ... */ });
const prefixed = prefixFunctions('mcp', ext);

// Use extension...

await prefixed.dispose?.();
```

Dispose is idempotent. Subsequent calls no-op. Always call dispose before process exit to prevent resource leaks.

## Introspection

Use introspection functions to discover server capabilities:

```rill
# List all available tools
mcp::list_tools() => $tools
$tools -> each { "{$.name}: {$.description}" -> log }

# List all resources (static + templates)
mcp::list_resources() => $resources
$resources -> each {
  $.uri -> if {
    "Static: {$.uri} ({$.mime})" -> log
  } else {
    "Template: {$.uriTemplate}" -> log
  }
}

# List all prompts
mcp::list_prompts() => $prompts
$prompts -> each { "{$.name} - args: {$.arguments}" -> log }
```

Introspection functions return all server capabilities regardless of filter settings. Use them to audit available functionality or generate documentation.

## Troubleshooting

### stdio Server Not Found

```
Error: mcp: failed to connect -- server process exited with code 127
```

**Cause:** Command not in PATH or missing binary.

**Solution:** Use absolute path or verify command is executable:

```typescript
const ext = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: '/usr/local/bin/mcp-server',
    // or verify: which mcp-server
  },
});
```

### HTTP Connection Refused

```
Error: mcp: failed to connect -- connection refused at https://mcp.example.com
```

**Cause:** Server not running or network unreachable.

**Solution:** Verify URL and network connectivity. Check firewall rules.

### Tool Name Collision

When using multiple servers, prefixes prevent name collisions:

```typescript
// Without prefixes (collision risk)
const ctx = createRuntimeContext({
  functions: { ...ext1, ...ext2 }, // ext2 overwrites ext1 if same names
});

// With prefixes (safe)
const ctx = createRuntimeContext({
  functions: {
    ...prefixFunctions('server1', ext1),
    ...prefixFunctions('server2', ext2),
  },
});
```

### Token Refresh Loops

If header function throws or returns expired tokens repeatedly:

```typescript
let refreshInProgress = false;

const ext = await createMcpExtension({
  transport: {
    type: 'http',
    url: 'https://mcp.example.com',
    headers: async () => {
      if (refreshInProgress) {
        throw new Error('Token refresh already in progress');
      }
      refreshInProgress = true;
      try {
        const token = await refreshToken();
        return { Authorization: `Bearer ${token}` };
      } finally {
        refreshInProgress = false;
      }
    },
  },
});
```

## Documentation

| Document | Description |
|----------|-------------|
| [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) | Extension contract and patterns |
| [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) | Runtime context and host functions |
| [MCP Specification](https://spec.modelcontextprotocol.io) | Model Context Protocol documentation |

## License

MIT
