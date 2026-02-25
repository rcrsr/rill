# @rcrsr/rill-compose

Manifest-based composition for rill agents.

## Install

```bash
npm install @rcrsr/rill-compose
```

## Quick Start

```typescript
import { readFileSync } from 'node:fs';
import { validateManifest, composeAgent } from '@rcrsr/rill-compose';

const json = JSON.parse(readFileSync('./agent.json', 'utf-8'));
const manifest = validateManifest(json);
const agent = await composeAgent(manifest, { basePath: import.meta.dirname });

// agent.context, agent.ast, agent.modules are ready
await agent.dispose();
```

## CLI

```bash
# Scaffold a new project
rill-compose init my-agent --extensions anthropic,kv

# Build for deployment
rill-compose agent.json --target container --output dist/
```

## What It Does

- Validates `agent.json` manifests with structured error reporting
- Resolves npm, local, and built-in extensions
- Compiles custom TypeScript host functions via esbuild
- Builds agents for container, Lambda, Cloudflare Worker, or local targets

## See Also

Full documentation: https://rill.run/docs/integration/compose/
