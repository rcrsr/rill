export type HarnessType = 'http' | 'stdio' | 'gateway' | 'worker';

export const TEMPLATES: Record<HarnessType, string> = {
  http: `import { handlers } from './handlers.js';
import { createHttpHarness } from '@rcrsr/rill-agent-harness/http';
const harness = createHttpHarness(handlers, { port: parseInt(process.env.PORT ?? '3000', 10) });
await harness.listen();
`,
  stdio: `import { handlers } from './handlers.js';
import { createStdioHarness } from '@rcrsr/rill-agent-harness/stdio';
const harness = createStdioHarness(handlers);
await harness.start();
`,
  gateway: `import { handlers } from './handlers.js';
import { createGatewayHarness } from '@rcrsr/rill-agent-harness/gateway';
export const handler = createGatewayHarness(handlers);
`,
  worker: `import { handlers } from './handlers.js';
import { createWorkerHarness } from '@rcrsr/rill-agent-harness/worker';
export default createWorkerHarness(handlers);
`,
};

export function getTemplate(harnessType: HarnessType): string {
  return TEMPLATES[harnessType];
}
