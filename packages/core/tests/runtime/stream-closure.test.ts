/**
 * Stream Closure Execution Tests
 *
 * Tests for IR-6 (yield evaluation in stream closures) and IR-13
 * (stream closure invocation produces RillStream).
 *
 * Covers:
 * - Calling a stream closure returns a RillStream
 * - Yielded chunks are consumable via next
 * - Chunk type mismatch at yield throws
 * - Resolution type mismatch throws
 * - Each invocation produces a new independent stream
 * - Re-yielding via each { yield } emits multiple chunks
 */

import { describe, expect, it } from 'vitest';
import { isStream, type RillStream, type RillValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Consume all chunks from a RillStream by calling .next() repeatedly.
 * Returns the list of chunk values.
 */
async function collectStreamChunks(stream: RillStream): Promise<RillValue[]> {
  const chunks: RillValue[] = [];

  // Call next to get the first step (initial stream has no value)
  let step = (await stream.next.fn({}, {} as never)) as unknown as RillStream;

  while (!step.done) {
    if (step.value !== undefined) {
      chunks.push(step.value);
    }
    step = (await step.next.fn({}, {} as never)) as unknown as RillStream;
  }

  return chunks;
}

// ============================================================
// IR-13: CALLING STREAM CLOSURE RETURNS RillStream
// ============================================================

describe('Stream Closure Execution', () => {
  describe('stream closure returns RillStream', () => {
    it('returns a RillStream when calling a stream closure', async () => {
      const script = `
        |x| ($x -> yield) :stream() => $gen
        $gen(42)
      `;
      const result = await run(script);
      expect(isStream(result)).toBe(true);
    });

    it('returned stream has done false before consumption', async () => {
      const script = `
        |x| ($x -> yield) :stream() => $gen
        $gen(1)
      `;
      const result = (await run(script)) as unknown as RillStream;
      expect(result.done).toBe(false);
    });
  });

  // ============================================================
  // IR-6: YIELDED CHUNKS CONSUMABLE VIA NEXT
  // ============================================================

  describe('yielded chunks consumable via next', () => {
    it('consumes single yielded chunk via next', async () => {
      const script = `
        |x| ($x -> yield) :stream() => $gen
        $gen(42)
      `;
      const result = (await run(script)) as unknown as RillStream;
      const chunks = await collectStreamChunks(result);
      expect(chunks).toEqual([42]);
    });

    it('consumes multiple yielded chunks via next', async () => {
      const script = `
        || {
          1 -> yield
          2 -> yield
          3 -> yield
        } :stream() => $gen
        $gen()
      `;
      const result = (await run(script)) as unknown as RillStream;
      const chunks = await collectStreamChunks(result);
      expect(chunks).toEqual([1, 2, 3]);
    });

    it('consumes string chunks', async () => {
      const script = `
        || {
          "hello" -> yield
          "world" -> yield
        } :stream(string) => $gen
        $gen()
      `;
      const result = (await run(script)) as unknown as RillStream;
      const chunks = await collectStreamChunks(result);
      expect(chunks).toEqual(['hello', 'world']);
    });
  });

  // ============================================================
  // IR-6: CHUNK TYPE MISMATCH AT YIELD
  // ============================================================

  describe('chunk type mismatch at yield', () => {
    it('halts when yielded value does not match declared chunk type', async () => {
      const script = `
        || {
          42 -> yield
        } :stream(string) => $gen
        $gen()
      `;
      // Stream is created lazily; consuming triggers the type check
      const result = (await run(script)) as unknown as RillStream;
      await expectHaltMessage(
        () => collectStreamChunks(result),
        'Yielded value type mismatch'
      );
    });

    it('halts on second chunk when type mismatches', async () => {
      const script = `
        || {
          "valid" -> yield
          123 -> yield
        } :stream(string) => $gen
        $gen()
      `;
      const result = (await run(script)) as unknown as RillStream;
      await expectHaltMessage(
        () => collectStreamChunks(result),
        'Yielded value type mismatch'
      );
    });
  });

  // ============================================================
  // IR-13: RESOLUTION TYPE MISMATCH
  // ============================================================

  describe('resolution type mismatch', () => {
    it('halts when body result does not match declared resolution type', async () => {
      const script = `
        || {
          1 -> yield
          "not-a-number"
        } :stream():number => $gen
        $gen()
      `;
      // Resolution type check fires when the body completes after all chunks.
      // Consuming the stream triggers the body to finish and validate.
      const result = (await run(script)) as unknown as RillStream;
      await expectHaltMessage(
        () => collectStreamChunks(result),
        'Stream resolution type mismatch'
      );
    });
  });

  // ============================================================
  // IR-13: EACH INVOCATION PRODUCES NEW INDEPENDENT STREAM
  // ============================================================

  describe('independent stream instances', () => {
    it('produces a new stream on each invocation', async () => {
      // Create and consume streams sequentially to avoid concurrent
      // body execution sharing evaluator state.
      const script1 = `
        || {
          1 -> yield
          2 -> yield
        } :stream() => $gen
        $gen()
      `;
      const stream1 = (await run(script1)) as unknown as RillStream;
      const chunks1 = await collectStreamChunks(stream1);

      const script2 = `
        || {
          1 -> yield
          2 -> yield
        } :stream() => $gen
        $gen()
      `;
      const stream2 = (await run(script2)) as unknown as RillStream;
      const chunks2 = await collectStreamChunks(stream2);

      // Both produce identical, independent chunk sequences
      expect(chunks1).toEqual([1, 2]);
      expect(chunks2).toEqual([1, 2]);
    });

    it('each stream is an independent RillStream instance', async () => {
      const script = `
        || {
          1 -> yield
        } :stream() => $gen
        $gen()
      `;
      const stream1 = (await run(script)) as unknown as RillStream;
      const stream2 = (await run(script)) as unknown as RillStream;

      expect(isStream(stream1)).toBe(true);
      expect(isStream(stream2)).toBe(true);
      // Different object references confirm independent instances
      expect(stream1).not.toBe(stream2);
    });
  });

  // ============================================================
  // IR-6: RE-YIELDING VIA each { yield }
  // ============================================================

  describe('re-yielding via each { yield }', () => {
    it('emits multiple chunks when re-yielding list elements', async () => {
      const script = `
        || {
          list[10, 20, 30] -> each { $ -> yield }
        } :stream() => $gen
        $gen()
      `;
      const result = (await run(script)) as unknown as RillStream;
      const chunks = await collectStreamChunks(result);
      expect(chunks).toEqual([10, 20, 30]);
    });

    it('emits chunks from range via each { yield }', async () => {
      const script = `
        || {
          range(1, 4) -> each { $ -> yield }
        } :stream(number) => $gen
        $gen()
      `;
      const result = (await run(script)) as unknown as RillStream;
      const chunks = await collectStreamChunks(result);
      expect(chunks).toEqual([1, 2, 3]);
    });
  });
});
