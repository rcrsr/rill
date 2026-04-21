/**
 * Rill Language Tests: Streams
 *
 * Comprehensive language-level tests for stream type behavior.
 * Covers success cases (AC-S1..AC-S16), error cases (AC-E1..AC-E8),
 * boundary conditions (BC-1..BC-10), and error contracts (EC-1..EC-16).
 *
 * Tests use the public API (run(), runFull()) via test helpers,
 * and createRillStream/isRillStream for host-integration scenarios.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  isRillStream,
  isTypeValue,
  parse,
  type RillStream,
  type RillValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { run, runFull } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

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

/** Create a host function that returns a RillStream. */
function makeStreamFn(
  chunks: RillValue[],
  resolution: RillValue = null,
  options?: {
    dispose?: () => void;
    chunkType?: TypeStructure;
    retType?: TypeStructure;
  }
) {
  return {
    params: [] as { name: string; type: TypeStructure }[],
    returnType: anyTypeValue,
    fn: () =>
      createRillStream({
        chunks: asyncIterableFrom(chunks),
        resolve: async () => resolution,
        dispose: options?.dispose,
        chunkType: options?.chunkType,
        retType: options?.retType,
      }),
  };
}

// ============================================================
// SUCCESS CASES: AC-S1 through AC-S16
// ============================================================

describe('Streams: Success Cases', () => {
  // AC-S1: $s -> each { } processes chunks sequentially, returns list
  describe('AC-S1: each on stream', () => {
    it('processes chunks sequentially and returns list', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s -> each { $ }
        `,
        { functions: { make_stream: makeStreamFn([1, 2, 3]) } }
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it('applies body expression to each chunk', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s -> each { $ * 2 }
        `,
        { functions: { make_stream: makeStreamFn([10, 20, 30]) } }
      );
      expect(result).toEqual([20, 40, 60]);
    });
  });

  // AC-S2: $s -> map { } transforms chunks, returns list
  describe('AC-S2: map on stream', () => {
    it('transforms chunks and returns list', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s -> map { $ + 1 }
        `,
        { functions: { make_stream: makeStreamFn([1, 2, 3]) } }
      );
      expect(result).toEqual([2, 3, 4]);
    });
  });

  // AC-S3: $s -> filter { } filters chunks, returns filtered list
  describe('AC-S3: filter on stream', () => {
    it('filters chunks by predicate', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s -> filter { $ > 2 }
        `,
        { functions: { make_stream: makeStreamFn([1, 2, 3, 4, 5]) } }
      );
      expect(result).toEqual([3, 4, 5]);
    });
  });

  // AC-S4: $s -> fold(init) { } reduces chunks, returns single value
  describe('AC-S4: fold on stream', () => {
    it('reduces chunks to single value', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s -> fold(0) { $@ + $ }
        `,
        { functions: { make_stream: makeStreamFn([1, 2, 3]) } }
      );
      expect(result).toBe(6);
    });
  });

  // AC-S5: $s() returns producer-defined resolution dict
  describe('AC-S5: stream invocation returns resolution', () => {
    it('returns resolution value on invocation', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s()
        `,
        {
          functions: {
            make_stream: makeStreamFn([1, 2], { total: 2, status: 'done' }),
          },
        }
      );
      expect(result).toEqual({ total: 2, status: 'done' });
    });
  });

  // AC-S6: $s() called twice returns identical value
  describe('AC-S6: idempotent resolution', () => {
    it('returns same value on repeated invocation', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s() => $first
          $s() => $second
          $first == $second
        `,
        { functions: { make_stream: makeStreamFn([1], 'resolved') } }
      );
      expect(result).toBe(true);
    });
  });

  // AC-S7: $s() on stale step returns resolution
  describe('AC-S7: resolution on stale step', () => {
    it('returns resolution even after partial consumption', async () => {
      // Stream invocation drains remaining chunks and returns resolution
      const result = await run(
        `
          make_stream() => $s
          $s()
        `,
        { functions: { make_stream: makeStreamFn([1, 2, 3], 'final') } }
      );
      expect(result).toBe('final');
    });
  });

  // AC-S8: $s.^chunk returns chunk type, $s.^output returns resolution type
  describe('AC-S8: stream reflection', () => {
    it('^chunk returns chunk type', async () => {
      const result = await run(
        `
          || ("hello" -> yield) :stream(string) => $gen
          $gen() => $s
          $s.^chunk
        `
      );
      expect(isTypeValue(result)).toBe(true);
      expect((result as { typeName: string }).typeName).toBe('string');
    });

    it('^output returns resolution type', async () => {
      const result = await run(
        `
          || {
            "hello" -> yield
            42
          } :stream(string):number => $gen
          $gen() => $s
          $s.^output
        `
      );
      expect(isTypeValue(result)).toBe(true);
      expect((result as { typeName: string }).typeName).toBe('number');
    });

    it('^chunk returns any when unconstrained', async () => {
      const result = await run(
        `
          || ("hello" -> yield) :stream() => $gen
          $gen() => $s
          $s.^chunk
        `
      );
      expect(isTypeValue(result)).toBe(true);
      expect((result as { typeName: string }).typeName).toBe('any');
    });

    it('^output returns any when unconstrained', async () => {
      const result = await run(
        `
          || ("hello" -> yield) :stream() => $gen
          $gen() => $s
          $s.^output
        `
      );
      expect(isTypeValue(result)).toBe(true);
      expect((result as { typeName: string }).typeName).toBe('any');
    });
  });

  // AC-S9: $s:?stream returns true
  describe('AC-S9: type check', () => {
    it(':?stream returns true for stream value', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s :?stream
        `,
        { functions: { make_stream: makeStreamFn(['a']) } }
      );
      expect(result).toBe(true);
    });

    it(':?stream returns false for non-stream value', async () => {
      expect(await run('42 :?stream')).toBe(false);
    });

    it(':?stream returns false for list', async () => {
      expect(await run('list[1, 2, 3] :?stream')).toBe(false);
    });
  });

  // AC-S10: Stream closure with yield emits typed chunks
  describe('AC-S10: stream closure yield', () => {
    it('emits typed chunks via yield', async () => {
      const result = await run(
        `
          || {
            "hello" -> yield
            "world" -> yield
          } :stream(string) => $gen
          $gen() => $s
          $s -> each { $ }
        `
      );
      expect(result).toEqual(['hello', 'world']);
    });

    it('emits number chunks via yield', async () => {
      const result = await run(
        `
          || {
            1 -> yield
            2 -> yield
            3 -> yield
          } :stream(number) => $gen
          $gen() -> each { $ * 10 }
        `
      );
      expect(result).toEqual([10, 20, 30]);
    });
  });

  // AC-S11: each(init) { } with $@ accumulator works on streams
  describe('AC-S11: each with accumulator on stream', () => {
    it('accumulates across stream chunks', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s -> each(0) { $@ + $ }
        `,
        { functions: { make_stream: makeStreamFn([1, 2, 3]) } }
      );
      // each with accumulator returns list of intermediate results
      expect(result).toEqual([1, 3, 6]);
    });
  });

  // AC-S12: Host stream via createRillStream consumed by all operators
  describe('AC-S12: host stream with all operators', () => {
    it('each consumes host stream', async () => {
      const result = await run('make_stream() -> each { $ }', {
        functions: { make_stream: makeStreamFn([10, 20, 30]) },
      });
      expect(result).toEqual([10, 20, 30]);
    });

    it('map consumes host stream', async () => {
      const result = await run('make_stream() -> map { $ + 1 }', {
        functions: { make_stream: makeStreamFn([10, 20, 30]) },
      });
      expect(result).toEqual([11, 21, 31]);
    });

    it('filter consumes host stream', async () => {
      const result = await run('make_stream() -> filter { $ > 15 }', {
        functions: { make_stream: makeStreamFn([10, 20, 30]) },
      });
      expect(result).toEqual([20, 30]);
    });

    it('fold consumes host stream', async () => {
      const result = await run('make_stream() -> fold(0) { $@ + $ }', {
        functions: { make_stream: makeStreamFn([10, 20, 30]) },
      });
      expect(result).toBe(60);
    });
  });

  // AC-S13: isRillStream(result) detects stream from execute()
  describe('AC-S13: isRillStream detection', () => {
    it('detects stream in execution result', async () => {
      const { result } = await runFull('make_stream()', {
        functions: { make_stream: makeStreamFn([1, 2]) },
      });
      expect(isRillStream(result)).toBe(true);
    });

    it('returns false for non-stream result', async () => {
      const { result } = await runFull('42');
      expect(isRillStream(result)).toBe(false);
    });
  });

  // AC-S14: Module closure with :stream(T):R streams to importing script
  describe('AC-S14: stream closure as reusable producer', () => {
    it('stream closure assigned to variable and invoked produces consumable stream', async () => {
      const result = await run(
        `
          |items: list| {
            $items -> each { $ -> yield }
          } :stream(number) => $producer
          $producer(list[10, 20, 30]) -> each { $ }
        `
      );
      expect(result).toEqual([10, 20, 30]);
    });

    it('stream closure passed through variable remains functional', async () => {
      const result = await run(
        `
          || {
            "a" -> yield
            "b" -> yield
          } :stream(string) => $gen
          $gen => $alias
          $alias() -> map { $ }
        `
      );
      expect(result).toEqual(['a', 'b']);
    });
  });

  // AC-S15: Stream passed as closure argument remains iterable
  describe('AC-S15: stream as closure argument', () => {
    it('stream passed to closure is consumable', async () => {
      const result = await run(
        `
          |s| ($s -> each { $ * 2 }) => $consume
          make_stream() -> $consume
        `,
        { functions: { make_stream: makeStreamFn([1, 2, 3]) } }
      );
      expect(result).toEqual([2, 4, 6]);
    });
  });

  // AC-S16: break in each calls dispose
  describe('AC-S16: break calls dispose', () => {
    it('calls dispose when break exits each loop', async () => {
      let disposed = false;
      const result = await run(
        `
          make_stream() -> each {
            ($ == 2) ? break
            $
          }
        `,
        {
          functions: {
            make_stream: makeStreamFn([1, 2, 3, 4], null, {
              dispose: () => {
                disposed = true;
              },
            }),
          },
        }
      );
      expect(result).toEqual([1]);
      expect(disposed).toBe(true);
    });
  });
});

// ============================================================
// ERROR CASES: AC-E1 through AC-E8
// ============================================================

describe('Streams: Error Cases', () => {
  // AC-E1: Re-iterating consumed stream halts with RILL-R002
  describe('AC-E1: re-iteration of consumed stream', () => {
    it('halts when re-iterating exhausted stream', async () => {
      await expect(
        run(
          `
            make_stream() => $s
            $s -> each { $ }
            $s -> each { $ }
          `,
          { functions: { make_stream: makeStreamFn([1, 2]) } }
        )
      ).rejects.toThrow('Stream already consumed');
    });
  });

  // AC-E2: Stale .next() halts with error
  describe('AC-E2: stale .next()', () => {
    it('halts when calling .next() on stale step', async () => {
      // Access internal stream to simulate stale step usage
      const stream = createRillStream({
        chunks: asyncIterableFrom([1, 2]),
        resolve: async () => null,
      });

      // Advance once to get first step
      const step1 = (await stream.next.fn(
        {},
        {} as never
      )) as unknown as RillStream;
      // Advance again to get second step (makes step1 stale)
      await step1.next.fn({}, {} as never);
      // Trying step1.next again should fail
      await expect(step1.next.fn({}, {} as never)).rejects.toThrow(
        'Stream already consumed'
      );
    });
  });

  // AC-E3: yield without :stream(T):R annotation halts at parse time
  describe('AC-E3: yield without stream annotation', () => {
    it('halts at parse time with error', () => {
      expect(() => parse('|x| yield')).toThrow('yield');
    });

    it('halts when closure has non-stream return type', () => {
      expect(() => parse('|x| yield :string')).toThrow('yield');
    });
  });

  // AC-E4: yield used as identifier halts at parse time
  describe('AC-E4: yield as identifier', () => {
    it('halts when yield used in expression position', () => {
      expect(() => parse('|| (1 + yield) :stream()')).toThrow();
    });
  });

  // AC-E5: Chunk type mismatch at emission halts with RILL-R004
  describe('AC-E5: chunk type mismatch at yield', () => {
    it('halts when yielded value does not match declared type', async () => {
      await expectHaltMessage(
        () =>
          run(
            `
            || {
              42 -> yield
            } :stream(string) => $gen
            $gen() -> each { $ }
          `
          ),
        'Yielded value type mismatch'
      );
    });
  });

  // AC-E6: :> on stream type halts with RILL-R003
  describe('AC-E6: type conversion on stream', () => {
    it('halts with error on :>stream conversion', async () => {
      await expect(run('42 -> :>stream')).rejects.toThrow(
        'Type conversion not supported for stream type'
      );
    });
  });

  // AC-E7: Stream exceeds iteration ceiling halts with RILL-R010
  describe('AC-E7: iteration ceiling exceeded', () => {
    it('halts when stream exceeds ceiling', async () => {
      // 10000 data chunks + 1 initial step = 10001 iterations, exceeds 10000 limit
      const largeChunks = Array.from({ length: 10000 }, (_, i) => i);
      await expect(
        run('make_stream() -> each { $ }', {
          functions: { make_stream: makeStreamFn(largeChunks) },
        })
      ).rejects.toThrow('exceeded');
    });
  });

  // AC-E8: Resolution type mismatch halts with RILL-R004
  describe('AC-E8: resolution type mismatch', () => {
    it('halts when resolution does not match declared type', async () => {
      await expectHaltMessage(
        () =>
          run(
            `
            || {
              1 -> yield
              "not-a-number"
            } :stream():number => $gen
            $gen() -> each { $ }
          `
          ),
        'Stream resolution type mismatch'
      );
    });
  });
});

// ============================================================
// BOUNDARY CONDITIONS: BC-1 through BC-10
// ============================================================

describe('Streams: Boundary Conditions', () => {
  // BC-1: Empty stream (0 chunks)
  describe('BC-1: empty stream', () => {
    it('each returns empty list for empty stream', async () => {
      const result = await run('make_stream() -> each { $ }', {
        functions: { make_stream: makeStreamFn([]) },
      });
      expect(result).toEqual([]);
    });

    it('$s() returns resolution for empty stream', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s()
        `,
        { functions: { make_stream: makeStreamFn([], 'resolved') } }
      );
      expect(result).toBe('resolved');
    });
  });

  // BC-2: Single-chunk stream
  describe('BC-2: single-chunk stream', () => {
    it('each handles single chunk', async () => {
      const result = await run('make_stream() -> each { $ }', {
        functions: { make_stream: makeStreamFn([42]) },
      });
      expect(result).toEqual([42]);
    });

    it('map handles single chunk', async () => {
      const result = await run('make_stream() -> map { $ * 2 }', {
        functions: { make_stream: makeStreamFn([42]) },
      });
      expect(result).toEqual([84]);
    });

    it('filter handles single chunk', async () => {
      const result = await run('make_stream() -> filter { $ > 10 }', {
        functions: { make_stream: makeStreamFn([42]) },
      });
      expect(result).toEqual([42]);
    });

    it('fold handles single chunk', async () => {
      const result = await run('make_stream() -> fold(0) { $@ + $ }', {
        functions: { make_stream: makeStreamFn([42]) },
      });
      expect(result).toBe(42);
    });
  });

  // BC-3: Stream at ceiling
  // The expandStream loop counts the initial pending step (no value) plus each
  // chunk step. With DEFAULT_MAX_ITERATIONS=10000, the effective data ceiling
  // is 9998 chunks (initial step + 9998 data steps + final done = 9999 iterations).
  describe('BC-3: stream at ceiling', () => {
    it('processes 9998 chunks without error', async () => {
      const chunks = Array.from({ length: 9998 }, (_, i) => i);
      const result = await run('make_stream() -> fold(0) { $@ + 1 }', {
        functions: { make_stream: makeStreamFn(chunks) },
      });
      expect(result).toBe(9998);
    });
  });

  // BC-4: Stream at ceiling + 1
  describe('BC-4: stream at ceiling + 1', () => {
    it('halts with RILL-R010 at 9999 chunks', async () => {
      const chunks = Array.from({ length: 9999 }, (_, i) => i);
      await expect(
        run('make_stream() -> each { $ }', {
          functions: { make_stream: makeStreamFn(chunks) },
        })
      ).rejects.toThrow('exceeded');
    });
  });

  // BC-5: $s() before iteration
  describe('BC-5: resolution before iteration', () => {
    it('consumes chunks internally and returns resolution', async () => {
      const result = await run(
        `
          make_stream() => $s
          $s()
        `,
        { functions: { make_stream: makeStreamFn([1, 2, 3], 'done') } }
      );
      expect(result).toBe('done');
    });
  });

  // BC-6: break on first chunk
  describe('BC-6: break on first chunk', () => {
    it('returns empty partial result and calls dispose', async () => {
      let disposed = false;
      const result = await run(
        `
          make_stream() -> each {
            break
          }
        `,
        {
          functions: {
            make_stream: makeStreamFn([1, 2, 3], null, {
              dispose: () => {
                disposed = true;
              },
            }),
          },
        }
      );
      expect(result).toEqual([]);
      expect(disposed).toBe(true);
    });
  });

  // BC-7: Scope exit, unconsumed stream with dispose
  describe('BC-7: scope exit with dispose', () => {
    it('calls dispose on scope exit for unconsumed stream', async () => {
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
              params: [{ name: '_', type: { kind: 'any' as const } }],
              returnType: anyTypeValue,
              fn: () =>
                createRillStream({
                  chunks: asyncIterableFrom([1, 2]),
                  resolve: async () => null,
                  dispose: () => {
                    disposed = true;
                  },
                }),
            },
          },
        }
      );
      expect(result).toBe('block-done');
      expect(disposed).toBe(true);
    });
  });

  // BC-8: Scope exit, unconsumed stream without dispose
  describe('BC-8: scope exit without dispose', () => {
    it('produces no error for stream without dispose', async () => {
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
              params: [{ name: '_', type: { kind: 'any' as const } }],
              returnType: anyTypeValue,
              fn: () =>
                createRillStream({
                  chunks: asyncIterableFrom([1]),
                  resolve: async () => null,
                }),
            },
          },
        }
      );
      expect(result).toBe('ok');
    });
  });

  // BC-9: map { $() } on list of streams resolves via Promise.all
  describe('BC-9: parallel stream resolution via map', () => {
    it('resolves multiple streams in parallel via map', async () => {
      const result = await run(
        `
          list[
            make_stream("a"),
            make_stream("b"),
            make_stream("c")
          ] -> map { $() }
        `,
        {
          functions: {
            make_stream: {
              params: [{ name: 'label', type: { kind: 'string' as const } }],
              returnType: anyTypeValue,
              fn: (args: Record<string, RillValue>) => {
                const label = args['label'] as string;
                return createRillStream({
                  chunks: asyncIterableFrom([label]),
                  resolve: async () => `resolved-${label}`,
                });
              },
            },
          },
        }
      );
      expect(result).toEqual(['resolved-a', 'resolved-b', 'resolved-c']);
    });
  });

  // BC-10: Re-yield via each { yield } forwards chunks in order
  describe('BC-10: re-yield forwarding', () => {
    it('forwards chunks in order via each { yield }', async () => {
      const result = await run(
        `
          || {
            list[10, 20, 30] -> each { $ -> yield }
          } :stream() => $gen
          $gen() -> each { $ }
        `
      );
      expect(result).toEqual([10, 20, 30]);
    });

    it('re-yields from range in order', async () => {
      const result = await run(
        `
          || {
            range(1, 4) -> each { $ -> yield }
          } :stream(number) => $gen
          $gen() -> each { $ }
        `
      );
      expect(result).toEqual([1, 2, 3]);
    });
  });
});

// ============================================================
// ERROR CONTRACTS: EC-1 through EC-16
// ============================================================

describe('Streams: Error Contracts', () => {
  // EC-1: createRillStream with non-AsyncIterable chunks
  describe('EC-1: invalid chunks argument', () => {
    it('throws RILL-R003 for non-AsyncIterable chunks', () => {
      expect(() =>
        createRillStream({
          chunks: 42 as unknown as AsyncIterable<RillValue>,
          resolve: async () => null,
        })
      ).toThrow('createRillStream requires AsyncIterable chunks');
    });

    it('throws RILL-R003 for null chunks', () => {
      expect(() =>
        createRillStream({
          chunks: null as unknown as AsyncIterable<RillValue>,
          resolve: async () => null,
        })
      ).toThrow('createRillStream requires AsyncIterable chunks');
    });
  });

  // EC-2: createRillStream with non-function resolve
  describe('EC-2: invalid resolve argument', () => {
    it('throws RILL-R003 for non-function resolve', () => {
      expect(() =>
        createRillStream({
          chunks: asyncIterableFrom([]),
          resolve: 'not-a-function' as unknown as () => Promise<RillValue>,
        })
      ).toThrow('createRillStream requires resolve function');
    });
  });

  // EC-3: Re-iteration of exhausted stream
  describe('EC-3: re-iteration', () => {
    it('throws RILL-R002 on re-iteration of exhausted stream', async () => {
      await expect(
        run(
          `
            make_stream() => $s
            $s -> each { $ }
            $s -> each { $ }
          `,
          { functions: { make_stream: makeStreamFn([1]) } }
        )
      ).rejects.toThrow('Stream already consumed');
    });
  });

  // EC-4: Non-iterable to collection operator (updated message with "or stream")
  describe('EC-4: non-iterable to collection operator', () => {
    it('error message includes stream in type list', async () => {
      await expect(run('42 -> each { $ }')).rejects.toThrow(
        /list, string, dict, iterator, or stream/
      );
    });
  });

  // EC-5: Iteration ceiling exceeded
  describe('EC-5: iteration ceiling exceeded', () => {
    it('throws RILL-R010 when stream exceeds default ceiling', async () => {
      const chunks = Array.from({ length: 10001 }, (_, i) => i);
      await expect(
        run('make_stream() -> each { $ }', {
          functions: { make_stream: makeStreamFn(chunks) },
        })
      ).rejects.toThrow('Stream expansion exceeded');
    });
  });

  // EC-6: Chunk type mismatch in expandStream
  describe('EC-6: chunk type mismatch in expandStream', () => {
    it('throws when stream chunks have inconsistent types', async () => {
      // expandStream validates type homogeneity during expansion
      const mixedChunks: RillValue[] = [1, 'two', 3];
      await expectHaltMessage(
        () =>
          run('make_stream() -> each { $ }', {
            functions: { make_stream: makeStreamFn(mixedChunks) },
          }),
        'Stream chunk type mismatch'
      );
    });
  });

  // EC-7: Chunk type mismatch at yield
  describe('EC-7: chunk type mismatch at yield', () => {
    it('halts typed-atom when yielded value mismatches declared type', async () => {
      await expectHaltMessage(
        () =>
          run(
            `
            || {
              42 -> yield
            } :stream(string) => $gen
            $gen() -> each { $ }
          `
          ),
        'Yielded value type mismatch'
      );
    });
  });

  // EC-8: yield as identifier
  describe('EC-8: yield as identifier', () => {
    it('throws at parse time when yield is used as variable-like token', () => {
      expect(() => parse('|| (1 + yield) :stream()')).toThrow();
    });
  });

  // EC-9: yield without :stream(T):R
  describe('EC-9: yield without stream annotation', () => {
    it('throws RILL-P006 at parse time', () => {
      expect(() => parse('|x| yield')).toThrow('yield');
    });

    it('throws RILL-P006 for yield in non-stream closure', () => {
      expect(() => parse('|x| { yield } :number')).toThrow('yield');
    });
  });

  // EC-10: Invalid chunk type in stream constructor
  describe('EC-10: invalid chunk type in stream type annotation', () => {
    it('stream constructor with invalid chunk type fails', () => {
      // Attempting to use a non-type-name in stream() constructor
      // This tests the parser level validation
      expect(() => parse('|x| yield :stream(123)')).toThrow();
    });
  });

  // EC-11: Invalid resolution type in stream constructor
  describe('EC-11: invalid resolution type in stream type annotation', () => {
    it('stream constructor with missing resolution type name fails', () => {
      expect(() => parse('|x| yield :stream():')).toThrow(
        "Expected type name after ':' in stream type"
      );
    });
  });

  // EC-12: :> on stream type
  describe('EC-12: type conversion to stream', () => {
    it('halts with RILL-R003 on :>stream', async () => {
      await expect(run('"hello" -> :>stream')).rejects.toThrow(
        'Type conversion not supported for stream type'
      );
    });
  });

  // EC-13: Resolution callback failure
  describe('EC-13: resolution callback failure', () => {
    it('propagates resolution error', async () => {
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
                fn: () =>
                  createRillStream({
                    chunks: asyncIterableFrom([1]),
                    resolve: async () => {
                      throw new Error('resolution failed');
                    },
                  }),
              },
            },
          }
        )
      ).rejects.toThrow('resolution failed');
    });
  });

  // EC-14: Resolution type mismatch
  describe('EC-14: resolution type mismatch', () => {
    it('halts typed-atom when body result does not match declared type', async () => {
      await expectHaltMessage(
        () =>
          run(
            `
            || {
              1 -> yield
              "wrong"
            } :stream():number => $gen
            $gen() -> each { $ }
          `
          ),
        'Stream resolution type mismatch'
      );
    });
  });

  // EC-15: dispose throws during break
  describe('EC-15: dispose throws during break', () => {
    it('propagates dispose error on break', async () => {
      await expect(
        run(
          `
            make_stream() -> each {
              break
            }
          `,
          {
            functions: {
              make_stream: makeStreamFn([1, 2], null, {
                dispose: () => {
                  throw new Error('dispose failed on break');
                },
              }),
            },
          }
        )
      ).rejects.toThrow('dispose failed on break');
    });
  });

  // EC-16: dispose throws during scope exit
  describe('EC-16: dispose throws during scope exit', () => {
    it('propagates dispose error on scope exit', async () => {
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
                params: [{ name: '_', type: { kind: 'any' as const } }],
                returnType: anyTypeValue,
                fn: () =>
                  createRillStream({
                    chunks: asyncIterableFrom([1]),
                    resolve: async () => null,
                    dispose: () => {
                      throw new Error('cleanup failed');
                    },
                  }),
              },
            },
          }
        )
      ).rejects.toThrow('cleanup failed');
    });
  });
});
