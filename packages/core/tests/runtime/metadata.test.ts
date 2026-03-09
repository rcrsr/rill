/**
 * Rill Runtime Tests: RuntimeContext metadata (IC-11)
 *
 * Verifies that metadata supplied via RuntimeOptions is propagated
 * into the RuntimeContext and is accessible to host functions.
 */

import { createRuntimeContext, type RuntimeContext } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: metadata (IC-11)', () => {
  describe('createRuntimeContext', () => {
    it('sets metadata on context when provided in options', () => {
      const ctx = createRuntimeContext({
        metadata: { requestId: 'req-123', userId: 'user-456' },
      });

      expect(ctx.metadata).toEqual({
        requestId: 'req-123',
        userId: 'user-456',
      });
    });

    it('sets metadata to undefined when not provided in options', () => {
      const ctx = createRuntimeContext({});

      expect(ctx.metadata).toBeUndefined();
    });

    it('sets metadata to undefined when options omitted entirely', () => {
      const ctx = createRuntimeContext();

      expect(ctx.metadata).toBeUndefined();
    });

    it('sets metadata to empty object when provided as empty object', () => {
      const ctx = createRuntimeContext({ metadata: {} });

      expect(ctx.metadata).toEqual({});
    });
  });

  describe('host function access', () => {
    it('host function reads metadata.testKey from context', async () => {
      let capturedMetadata: Record<string, string> | undefined;

      const result = await run('"trigger" -> readMeta', {
        metadata: { testKey: 'hello-from-metadata' },
        functions: {
          readMeta: {
            params: [{ name: 'input', type: { type: 'string' }, defaultValue: undefined, annotations: {} }],
            fn: (_args, ctx) => {
              capturedMetadata = (ctx as RuntimeContext).metadata;
              return (ctx as RuntimeContext).metadata?.['testKey'] ?? '';
            },
          },
        },
      });

      expect(result).toBe('hello-from-metadata');
      expect(capturedMetadata).toEqual({ testKey: 'hello-from-metadata' });
    });

    it('metadata is available in nested scope (inside conditional branch)', async () => {
      let seen: string | undefined;

      // Use rill conditional syntax: condition ? then-expr
      await run('true ? ("x" -> readMeta)', {
        metadata: { env: 'test' },
        functions: {
          readMeta: {
            params: [{ name: 'input', type: { type: 'string' }, defaultValue: undefined, annotations: {} }],
            fn: (_args, ctx) => {
              seen = (ctx as RuntimeContext).metadata?.['env'];
              return seen ?? '';
            },
          },
        },
      });

      expect(seen).toBe('test');
    });

    it('multiple metadata keys are all accessible', async () => {
      const collected: Record<string, string> = {};

      await run('"x" -> collectMeta', {
        metadata: { a: '1', b: '2', c: '3' },
        functions: {
          collectMeta: {
            params: [{ name: 'input', type: { type: 'string' }, defaultValue: undefined, annotations: {} }],
            fn: (_args, ctx) => {
              const md = (ctx as RuntimeContext).metadata ?? {};
              Object.assign(collected, md);
              return null;
            },
          },
        },
      });

      expect(collected).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('metadata is undefined in host function when not set in options', async () => {
      let seen: Record<string, string> | undefined = { sentinel: 'present' };

      await run('"x" -> checkMeta', {
        functions: {
          checkMeta: {
            params: [{ name: 'input', type: { type: 'string' }, defaultValue: undefined, annotations: {} }],
            fn: (_args, ctx) => {
              seen = (ctx as RuntimeContext).metadata;
              return null;
            },
          },
        },
      });

      expect(seen).toBeUndefined();
    });
  });

  describe('backward compatibility', () => {
    it('existing RuntimeOptions without metadata compile and run without error', async () => {
      const result = await run('"hello"', {
        timeout: 5000,
        autoExceptions: [],
        maxCallStackDepth: 50,
      });

      expect(result).toBe('hello');
    });

    it('metadata field is optional — existing context objects remain valid', () => {
      // createRuntimeContext with no metadata must not throw
      expect(() => createRuntimeContext()).not.toThrow();
    });
  });
});
