/**
 * Tests for CoreMixin Error Contracts
 *
 * Tests error handling in CoreMixin:
 * - EC-4: Unsupported expression types throw RuntimeError
 * - EC-5: RuntimeHaltSignal (code=DISPOSED) when context signal aborted
 */

import { describe, it, expect } from 'vitest';
import {
  atomName,
  getStatus,
  RuntimeError,
  RuntimeHaltSignal,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

/**
 * Asserts the thrown error is an abort halt:
 * RuntimeHaltSignal with status.code=#DISPOSED, non-catchable.
 */
async function expectAbortHalt(
  exec: () => Promise<unknown>
): Promise<RuntimeHaltSignal> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RuntimeHaltSignal);
  const signal = caught as RuntimeHaltSignal;
  expect(signal.name).toBe('RuntimeHaltSignal');
  expect(signal.catchable).toBe(false);
  const status = getStatus(signal.value);
  expect(atomName(status.code)).toBe('DISPOSED');
  return signal;
}

describe('CoreMixin Error Contracts', () => {
  describe('EC-4: Unsupported expression types', () => {
    it('RuntimeError shape for unsupported primary node type', async () => {
      // This is a structural check on RuntimeError construction.
      // Sites that previously raised RILL-R004 now throw RuntimeHaltSignal
      // via throwTypeHalt (see evaluator-core-annotations.test.ts).
      const error = new RuntimeError(
        'RILL-R002',
        'Unsupported expression type: InvalidType',
        { line: 1, column: 1, offset: 0 }
      );

      expect(error.errorId).toBe('RILL-R002');
      expect(error.message).toContain('Unsupported expression type');
    });

    it('RuntimeError shape for unsupported pipe target type', async () => {
      // Structural check only; see evaluator-core-annotations.test.ts for
      // the live-throw assertion via typed-atom halt.
      const error = new RuntimeError(
        'RILL-R002',
        'Unsupported pipe target type: InvalidTarget',
        { line: 1, column: 1, offset: 0 }
      );

      expect(error.errorId).toBe('RILL-R002');
      expect(error.message).toContain('Unsupported pipe target type');
    });
  });

  describe('EC-5: Context signal aborted', () => {
    it('halts when aborted before execution', async () => {
      const controller = new AbortController();
      controller.abort();

      await expectAbortHalt(() =>
        run('"hello"', { signal: controller.signal })
      );
    });

    it('halts when aborted during pipe chain evaluation', async () => {
      const controller = new AbortController();

      // Abort during execution
      setTimeout(() => controller.abort(), 10);

      await expectAbortHalt(() =>
        run('"test" -> slow() -> slow()', {
          functions: {
            slow: {
              params: [
                {
                  name: '_',
                  type: undefined,
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: async () => {
                await new Promise((r) => setTimeout(r, 30));
                return 'done';
              },
            },
          },
          signal: controller.signal,
        })
      );
    });

    it('halts when aborted during expression evaluation', async () => {
      const controller = new AbortController();

      // Abort after first function call, before second
      let callCount = 0;
      await expectAbortHalt(() =>
        run('first() -> second()', {
          functions: {
            first: {
              params: [],
              fn: async () => {
                callCount++;
                await new Promise((r) => setTimeout(r, 5));
                controller.abort();
                return 'first';
              },
            },
            second: {
              params: [],
              fn: async () => {
                callCount++;
                return 'second';
              },
            },
          },
          signal: controller.signal,
        })
      );

      // First function should have completed
      expect(callCount).toBe(1);
    });

    it('abort halt carries DISPOSED code, non-catchable, with aborted message', async () => {
      const controller = new AbortController();
      controller.abort();

      const signal = await expectAbortHalt(() =>
        run('"test"', { signal: controller.signal })
      );
      const status = getStatus(signal.value);
      expect(status.provider).toBe('runtime');
      expect(status.message).toContain('abort');
    });

    it('checks abort during postfix expression evaluation', async () => {
      const controller = new AbortController();

      await expect(
        run('"hello".upper.lower', {
          signal: controller.signal,
        })
      ).resolves.toBe('hello');

      // Now with abort
      controller.abort();

      await expectAbortHalt(() =>
        run('"hello".upper.lower', {
          signal: controller.signal,
        })
      );
    });

    it('checks abort during primary evaluation', async () => {
      const controller = new AbortController();

      // Test various primary types with abort
      controller.abort();

      await expectAbortHalt(() =>
        run('"string"', { signal: controller.signal })
      );

      await expectAbortHalt(() => run('42', { signal: controller.signal }));

      await expectAbortHalt(() => run('true', { signal: controller.signal }));

      await expectAbortHalt(() =>
        run('list[1, 2, 3]', { signal: controller.signal })
      );

      await expectAbortHalt(() =>
        run('dict[a: 1, b: 2]', { signal: controller.signal })
      );
    });

    it('checks abort during pipe target evaluation', async () => {
      const controller = new AbortController();

      // Abort during pipe target processing
      let callCount = 0;
      await expectAbortHalt(() =>
        run('list[1, 2, 3] -> each { count() }', {
          functions: {
            count: {
              params: [
                {
                  name: '_',
                  type: undefined,
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: () => {
                callCount++;
                if (callCount >= 2) {
                  controller.abort();
                }
                return callCount;
              },
            },
          },
          signal: controller.signal,
        })
      );

      expect(callCount).toBeLessThan(5);
    });

    it('checks abort during argument evaluation', async () => {
      const controller = new AbortController();

      await expectAbortHalt(() =>
        run('fn(a(), b())', {
          functions: {
            fn: {
              params: [
                {
                  name: 'x',
                  type: { kind: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['x'],
            },
            a: {
              params: [],
              fn: () => {
                controller.abort();
                return 1;
              },
            },
            b: { params: [], fn: () => 2 },
          },
          signal: controller.signal,
        })
      );
    });

    it('preserves pipe value during abort', async () => {
      const controller = new AbortController();
      controller.abort();

      // Even when aborted, the error should maintain context
      await expectAbortHalt(() =>
        run('"test" -> .upper', { signal: controller.signal })
      );
    });
  });

  describe('CoreMixin method behavior', () => {
    it('evaluateExpression delegates to evaluatePipeChain', async () => {
      const result = await run('"hello"');
      expect(result).toBe('hello');
    });

    it('evaluatePipeChain isolates pipe value', async () => {
      // Pipe chains don't leak $ to parent scope
      const result = await run('"outer" => $x\n"inner" -> .upper\n$x');
      expect(result).toBe('outer');
    });

    it('evaluatePipeChain handles capture terminator', async () => {
      const result = await run('"value" => $x\n$x');
      expect(result).toBe('value');
    });

    it('evaluatePipeChain handles break terminator', async () => {
      const result = await run(
        'list[1, 2, 3] -> each { ($ == 2) ? ($ -> break)\n$ }'
      );
      expect(result).toEqual([1]);
    });

    it('evaluatePipeChain handles return terminator', async () => {
      const result = await run('"" -> { "a" -> return\n"b" }');
      expect(result).toBe('a');
    });

    it('evaluatePostfixExpr chains methods correctly', async () => {
      const result = await run('"  hello  ".trim.upper');
      expect(result).toBe('HELLO');
    });

    it('evaluatePrimary handles all literal types', async () => {
      expect(await run('"string"')).toBe('string');
      expect(await run('42')).toBe(42);
      expect(await run('true')).toBe(true);
      expect(await run('list[1, 2, 3]')).toEqual([1, 2, 3]);
      expect(await run('dict[a: 1]')).toEqual({ a: 1 });
    });

    it('evaluatePipeTarget sets pipe value', async () => {
      const result = await run('5 -> ($ * 2)');
      expect(result).toBe(10);
    });

    it('evaluateArgs preserves pipe value', async () => {
      const result = await run('10 -> add($, 5)', {
        functions: {
          add: {
            params: [
              {
                name: 'a',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
              {
                name: 'b',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) =>
              (typeof args['a'] === 'number' ? args['a'] : 0) +
              (typeof args['b'] === 'number' ? args['b'] : 0),
          },
        },
      });
      expect(result).toBe(15);
    });
  });
});
