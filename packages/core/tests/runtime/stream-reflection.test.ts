/**
 * Stream Reflection, Invocation, and Scope Exit Cleanup Tests
 *
 * Covers:
 * - IR-11: ^chunk and ^output reflection on streams
 * - IR-11: :>stream halts with RILL-R003
 * - IR-12: $s() invocation returns resolution value
 * - IR-12: $s() is idempotent (cached after first call)
 * - IR-14: Scope exit disposes unconsumed streams in reverse order
 * - IR-14: Streams without dispose produce no error on scope exit
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  isTypeValue,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// ============================================================
// HELPERS
// ============================================================

/** Create a simple async iterable from an array of values. */
function asyncIterableFrom(values: RillValue[]): AsyncIterable<RillValue> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < values.length) {
            return { value: values[index++]!, done: false as const };
          }
          return { value: undefined, done: true as const };
        },
      };
    },
  };
}

// ============================================================
// IR-11: STREAM REFLECTION (^chunk, ^output)
// ============================================================

describe('Stream Reflection', () => {
  describe('^chunk', () => {
    it('returns chunk TypeStructure as RillTypeValue', async () => {
      const script = `
        || ("hello" -> yield) :stream(string) => $gen
        $gen() => $s
        $s.^chunk
      `;
      const result = await run(script);
      expect(isTypeValue(result)).toBe(true);
      expect((result as { typeName: string }).typeName).toBe('string');
    });

    it('returns any type when chunk is unconstrained', async () => {
      const script = `
        || ("hello" -> yield) :stream() => $gen
        $gen() => $s
        $s.^chunk
      `;
      const result = await run(script);
      expect(isTypeValue(result)).toBe(true);
      expect((result as { typeName: string }).typeName).toBe('any');
    });
  });

  describe('^output', () => {
    it('returns resolution TypeStructure as RillTypeValue', async () => {
      const script = `
        || {
          "hello" -> yield
          42
        } :stream(string):number => $gen
        $gen() => $s
        $s.^output
      `;
      const result = await run(script);
      expect(isTypeValue(result)).toBe(true);
      expect((result as { typeName: string }).typeName).toBe('number');
    });

    it('returns any type when ret is unconstrained', async () => {
      const script = `
        || ("hello" -> yield) :stream(string) => $gen
        $gen() => $s
        $s.^output
      `;
      const result = await run(script);
      expect(isTypeValue(result)).toBe(true);
      expect((result as { typeName: string }).typeName).toBe('any');
    });
  });

  describe(':?stream type check (IR-11)', () => {
    it('returns true for a stream value', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s :?stream
        `,
        {
          functions: {
            make_stream: {
              params: [],
              returnType: anyTypeValue,
              fn: () => {
                return createRillStream({
                  chunks: asyncIterableFrom(['a']),
                  resolve: async () => 'done',
                });
              },
            },
          },
        }
      );
      expect(result).toBe(true);
    });

    it('returns false for a non-stream value', async () => {
      const result = await run('42 :?stream');
      expect(result).toBe(false);
    });
  });

  describe(':>stream error', () => {
    it('halts with RILL-R003 on :>stream conversion', async () => {
      const script = '42 -> :>stream';
      await expect(run(script)).rejects.toThrow(
        'Type conversion not supported for stream type'
      );
    });
  });
});

// ============================================================
// IR-12: STREAM INVOCATION ($s())
// ============================================================

describe('Stream Invocation', () => {
  it('returns resolution value when invoked', async () => {
    const result = await run(
      `
        make_stream() => $s
        $s()
      `,
      {
        functions: {
          make_stream: {
            params: [],
            returnType: anyTypeValue,
            fn: () => {
              return createRillStream({
                chunks: asyncIterableFrom([1, 2]),
                resolve: async () => 'done',
              });
            },
          },
        },
      }
    );
    expect(result).toBe('done');
  });

  it('returns cached resolution on subsequent calls (idempotent)', async () => {
    const result = await run(
      `
        make_stream() => $s
        $s() => $first
        $s() => $second
        $first == $second
      `,
      {
        functions: {
          make_stream: {
            params: [],
            returnType: anyTypeValue,
            fn: () => {
              return createRillStream({
                chunks: asyncIterableFrom([1, 2]),
                resolve: async () => 'resolved',
              });
            },
          },
        },
      }
    );
    expect(result).toBe(true);
  });

  it('propagates resolution failure as error (EC-13)', async () => {
    await expect(
      run(
        `
          make_stream() => $s
          $s()
        `,
        {
          functions: {
            make_stream: {
              params: [],
              returnType: anyTypeValue,
              fn: () => {
                return createRillStream({
                  chunks: asyncIterableFrom([1]),
                  resolve: async () => {
                    throw new Error('resolution failed');
                  },
                });
              },
            },
          },
        }
      )
    ).rejects.toThrow('resolution failed');
  });

  it('works with createRillStream directly via resolve', async () => {
    let resolveCount = 0;
    const stream = createRillStream({
      chunks: asyncIterableFrom(['a', 'b']),
      resolve: async () => {
        resolveCount++;
        return 'resolved';
      },
    });

    // Access resolve via hidden property
    const resolveFn = (
      stream as unknown as Record<string, () => Promise<RillValue>>
    )['__rill_stream_resolve']!;

    const result1 = await resolveFn();
    const result2 = await resolveFn();

    expect(result1).toBe('resolved');
    expect(result2).toBe('resolved');
    expect(resolveCount).toBe(1);
  });
});

// ============================================================
// IR-14: SCOPE EXIT CLEANUP
// ============================================================

describe('Scope Exit Cleanup', () => {
  it('calls dispose on unconsumed stream at scope exit', async () => {
    let disposed = false;

    const result = await run(
      `
        "x" -> {
          make_stream() => $s
          "block-done"
        }
      `,
      {
        functions: {
          make_stream: {
            params: [{ name: '_', type: { kind: 'any' } }],
            returnType: anyTypeValue,
            fn: () => {
              return createRillStream({
                chunks: asyncIterableFrom(['a', 'b']),
                resolve: async () => 'resolved',
                dispose: () => {
                  disposed = true;
                },
              });
            },
          },
        },
      }
    );

    expect(result).toBe('block-done');
    expect(disposed).toBe(true);
  });

  it('produces no error for streams without dispose', async () => {
    const result = await run(
      `
        "x" -> {
          make_stream() => $s
          "ok"
        }
      `,
      {
        functions: {
          make_stream: {
            params: [{ name: '_', type: { kind: 'any' } }],
            returnType: anyTypeValue,
            fn: () => {
              return createRillStream({
                chunks: asyncIterableFrom(['a']),
                resolve: async () => 'resolved',
              });
            },
          },
        },
      }
    );

    expect(result).toBe('ok');
  });

  it('calls dispose in reverse creation order', async () => {
    const disposeOrder: string[] = [];

    await run(
      `
        "x" -> {
          make_stream("first") => $s1
          make_stream("second") => $s2
          "done"
        }
      `,
      {
        functions: {
          make_stream: {
            params: [{ name: 'label', type: { kind: 'string' } }],
            returnType: anyTypeValue,
            fn: (args: Record<string, RillValue>) => {
              const label = args['label'] as string;
              return createRillStream({
                chunks: asyncIterableFrom([label]),
                resolve: async () => 'resolved',
                dispose: () => {
                  disposeOrder.push(label);
                },
              });
            },
          },
        },
      }
    );

    expect(disposeOrder).toEqual(['second', 'first']);
  });

  it('propagates dispose errors as RILL-R002', async () => {
    await expect(
      run(
        `
          "x" -> {
            make_stream() => $s
            "done"
          }
        `,
        {
          functions: {
            make_stream: {
              params: [{ name: '_', type: { kind: 'any' } }],
              returnType: anyTypeValue,
              fn: () => {
                return createRillStream({
                  chunks: asyncIterableFrom(['a']),
                  resolve: async () => 'resolved',
                  dispose: () => {
                    throw new Error('cleanup failed');
                  },
                });
              },
            },
          },
        }
      )
    ).rejects.toThrow('cleanup failed');
  });
});
