/**
 * Execution worker for Rill Fiddle
 *
 * Runs executeRill off the main thread. Receives { source } via postMessage,
 * rebuilds the same resolverConfig App.tsx builds for the main-thread path,
 * runs executeRill, and posts back the resulting ExecutionState. No log
 * streaming: logs return inside ExecutionState.logs on completion.
 */

import { contextResolver } from '@rcrsr/rill';
import { DEMO_CONTEXT_VALUES } from './context.js';
import { executeRill, type FiddleResolverConfig } from './execution.js';

self.addEventListener('message', (event: MessageEvent<{ source: string }>) => {
  // This is a dedicated worker spawned by the app's own page, so it only
  // ever receives messages from that same origin. Reject anything else
  // rather than trusting postMessage's default any-origin delivery.
  if (event.origin !== '' && event.origin !== self.location.origin) {
    return;
  }

  const { source } = event.data;

  const resolverConfig: FiddleResolverConfig = {
    resolvers: {
      context: (resource: string) =>
        contextResolver(resource, DEMO_CONTEXT_VALUES),
    },
    configurations: { resolvers: { context: DEMO_CONTEXT_VALUES } },
  };

  executeRill(source, resolverConfig)
    .then((state) => {
      self.postMessage(state);
    })
    .catch((err: unknown) => {
      // executeRill converts errors into an error state internally, so a
      // rejection here is unexpected. Surface it rather than leaving the
      // main thread waiting forever.
      self.postMessage({
        status: 'error',
        result: null,
        error: {
          message: err instanceof Error ? err.message : String(err),
          category: 'runtime',
          line: null,
          column: null,
          errorId: null,
          statusCode: null,
          statusMessage: null,
          statusProvider: null,
          statusTrace: null,
        },
        duration: null,
        logs: [],
      });
    });
});
