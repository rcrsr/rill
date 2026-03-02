import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeHarness,
  createAgentHost,
  type LogLevel,
} from '@rcrsr/rill-agent-harness';
import { validateHarnessManifest } from '@rcrsr/rill-agent-shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

const raw = JSON.parse(readFileSync(join(__dirname, 'harness.json'), 'utf-8'));
const manifest = validateHarnessManifest(raw);

const harness = await composeHarness(manifest, {
  basePath: __dirname,
  env: process.env as Record<string, string>,
});

const port = manifest.host?.port ?? 4002;
const logLevel = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
const host = createAgentHost(harness.agents, { port, logLevel });

harness.bindHost(host);

await host.listen(port);
console.log(`Content pipeline running on http://localhost:${port}`);
console.log('Agents: orchestrator, classifier, summarizer');
console.log(`  POST http://localhost:${port}/orchestrator/run`);
console.log(`  POST http://localhost:${port}/classifier/run`);
console.log(`  POST http://localhost:${port}/summarizer/run`);
