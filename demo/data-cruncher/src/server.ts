import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '@rcrsr/rill-compose';
import { createAgentHost } from '@rcrsr/rill-host';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.resolve(__dirname, '..');

// Load and resolve manifest paths to absolute
const raw = readFileSync(path.join(demoDir, 'agent.json'), 'utf-8');
const json = JSON.parse(raw) as Record<string, unknown>;

// Make entry path absolute so composeAgent resolves it regardless of cwd
json['entry'] = path.resolve(demoDir, json['entry'] as string);

// Make KV store path absolute
const extensions = json['extensions'] as Record<
  string,
  { config: Record<string, unknown> }
>;
if (extensions?.['kv']?.config?.['store']) {
  extensions['kv'].config['store'] = path.resolve(
    demoDir,
    extensions['kv'].config['store'] as string
  );
}

const manifest = validateManifest(json);
const port = 3000;

const host = createAgentHost(manifest, { port });

await host.init();
await host.listen(port);

console.log(`rill demo-agent running on http://localhost:${port}`);
console.log('');
console.log('Endpoints:');
console.log(`  POST http://localhost:${port}/run`);
console.log(`  GET  http://localhost:${port}/healthz`);
console.log(`  GET  http://localhost:${port}/sessions`);
console.log(`  GET  http://localhost:${port}/.well-known/agent-card.json`);
