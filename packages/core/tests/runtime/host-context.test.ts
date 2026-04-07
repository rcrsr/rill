/**
 * Rill Runtime Tests: RuntimeContext hostContext
 *
 * Verifies that hostContext supplied via RuntimeOptions is propagated
 * into the RuntimeContext and is accessible to host functions.
 * Unlike metadata (string-only, optional), hostContext supports
 * arbitrary values (functions, objects) and defaults to {}.
 */

import { createRuntimeContext, type RuntimeContext } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: hostContext', () => {
  describe('createRuntimeContext', () => {
    it('sets hostContext on context when provided in options', () => {
      const ctx = createRuntimeContext({
        hostContext: { router: 'main', version: 2 },
      });

      expect(ctx.hostContext).toEqual({ router: 'main', version: 2 });
    });

    it('defaults hostContext to empty object when not provided in options', () => {
      const ctx = createRuntimeContext({});

      expect(ctx.hostContext).toEqual({});
    });

    it('defaults hostContext to empty object when options omitted entirely', () => {
      const ctx = createRuntimeContext();

      expect(ctx.hostContext).toEqual({});
    });
  });

  describe('host function access', () => {
    it('host function reads hostContext string value from context', async () => {
      let capturedHostContext: Record<string, unknown> | undefined;

      const result = await run('"trigger" -> readCtx', {
        hostContext: { region: 'us-east-1' },
        functions: {
          readCtx: {
            params: [
              {
                name: 'input',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, ctx) => {
              capturedHostContext = (ctx as RuntimeContext).hostContext;
              return String(
                (ctx as RuntimeContext).hostContext['region'] ?? ''
              );
            },
          },
        },
      });

      expect(result).toBe('us-east-1');
      expect(capturedHostContext).toEqual({ region: 'us-east-1' });
    });

    it('host function reads hostContext function value and invokes it', async () => {
      const resolveRoute = (path: string) => `/api/v2${path}`;
      let resolved: string | undefined;

      await run('"trigger" -> useRouter', {
        hostContext: { resolveRoute },
        functions: {
          useRouter: {
            params: [
              {
                name: 'input',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, ctx) => {
              const hc = (ctx as RuntimeContext).hostContext;
              const resolve = hc['resolveRoute'] as (path: string) => string;
              resolved = resolve('/users');
              return resolved;
            },
          },
        },
      });

      expect(resolved).toBe('/api/v2/users');
    });

    it('hostContext is available in nested scope (inside conditional branch)', async () => {
      let seen: unknown;

      await run('true ? ("x" -> readCtx)', {
        hostContext: { env: 'test' },
        functions: {
          readCtx: {
            params: [
              {
                name: 'input',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, ctx) => {
              seen = (ctx as RuntimeContext).hostContext['env'];
              return String(seen ?? '');
            },
          },
        },
      });

      expect(seen).toBe('test');
    });

    it('hostContext is empty object in host function when not set in options', async () => {
      let seen: Record<string, unknown> | undefined;

      await run('"x" -> checkCtx', {
        functions: {
          checkCtx: {
            params: [
              {
                name: 'input',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, ctx) => {
              seen = (ctx as RuntimeContext).hostContext;
              return null;
            },
          },
        },
      });

      expect(seen).toEqual({});
    });
  });

  describe('child context propagation', () => {
    it('child context shares same hostContext reference as parent', async () => {
      const refs: Record<string, unknown>[] = [];
      const sharedContext = { key: 'shared-value' };

      // First call captures hostContext in outer scope, second in nested (child) scope
      const script = `"a" -> capture
true ? ("b" -> capture)`;
      await run(script, {
        hostContext: sharedContext,
        functions: {
          capture: {
            params: [
              {
                name: 'input',
                type: { kind: 'string' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, ctx) => {
              refs.push((ctx as RuntimeContext).hostContext);
              return null;
            },
          },
        },
      });

      expect(refs).toHaveLength(2);
      expect(refs[0]).toBe(refs[1]); // Same object reference
      expect(refs[0]).toBe(sharedContext); // Same as original object
    });
  });

  describe('backward compatibility', () => {
    it('existing RuntimeOptions without hostContext compile and run without error', async () => {
      const result = await run('"hello"', {
        timeout: 5000,
        autoExceptions: [],
        maxCallStackDepth: 50,
      });

      expect(result).toBe('hello');
    });

    it('hostContext field is optional on options — existing code remains valid', () => {
      expect(() => createRuntimeContext()).not.toThrow();
    });
  });
});
