/**
 * Stream Type Tests
 *
 * Tests for RillStream interface, isStream guard, createRillStream factory,
 * isRillStream alias, stream TypeDefinition registration, and
 * structureMatches stream branch.
 */

import { describe, it, expect } from 'vitest';
import {
  callable,
  createRillStream,
  isStream,
  isRillStream,
  isIterator,
  isDict,
  BUILT_IN_TYPES,
  structureMatches,
  formatStructure,
  inferType,
  formatValue,
  inferStructure,
  structureEquals,
  type RillValue,
  type RillStream,
  type TypeStructure,
} from '@rcrsr/rill';
import { YieldSignal } from '@rcrsr/rill';

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
// IR-1: isStream TYPE GUARD
// ============================================================

describe('isStream', () => {
  it('returns true for a valid RillStream object', () => {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'chunk1',
      next: callable(() => null),
    };
    expect(isStream(stream)).toBe(true);
  });

  it('returns false for a plain dict', () => {
    expect(isStream({ name: 'test' })).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isStream('hello')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isStream(42)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isStream(null)).toBe(false);
  });

  it('returns false for a list', () => {
    expect(isStream([1, 2, 3])).toBe(false);
  });

  it('returns false for a boolean', () => {
    expect(isStream(true)).toBe(false);
  });

  it('returns false for an iterator-shaped dict', () => {
    const iterator = {
      done: false,
      value: 1,
      next: callable(() => ({ done: true, next: callable(() => null) })),
    };
    expect(isStream(iterator)).toBe(false);
  });

  it('returns false when __rill_stream is not true', () => {
    const fake = {
      __rill_stream: false,
      done: false,
      next: callable(() => null),
    };
    expect(isStream(fake as unknown as RillValue)).toBe(false);
  });
});

// ============================================================
// IR-3: isRillStream ALIAS
// ============================================================

describe('isRillStream', () => {
  it('is the same function reference as isStream', () => {
    expect(isRillStream).toBe(isStream);
  });

  it('returns true for a valid stream', () => {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'x',
      next: callable(() => null),
    };
    expect(isRillStream(stream)).toBe(true);
  });

  it('returns false for non-stream values', () => {
    expect(isRillStream(42)).toBe(false);
  });
});

// ============================================================
// IR-1 DISPATCH ORDER: isStream precedes isIterator
// ============================================================

describe('dispatch order', () => {
  it('isStream returns true before isIterator for stream values', () => {
    // A stream also has done + next + value, satisfying iterator shape.
    // isStream must match first.
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'chunk',
      next: callable(() => null),
    };
    expect(isStream(stream)).toBe(true);
    // isIterator should also match (streams satisfy iterator shape)
    expect(isIterator(stream)).toBe(true);
    // isDict should also match
    expect(isDict(stream)).toBe(true);
  });

  it('inferType returns stream for stream values, not iterator or dict', () => {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'chunk',
      next: callable(() => null),
    };
    expect(inferType(stream)).toBe('stream');
  });
});

// ============================================================
// IR-2: createRillStream FACTORY
// ============================================================

describe('createRillStream', () => {
  it('creates a valid stream from AsyncIterable and resolve function', () => {
    const chunks = asyncIterableFrom(['a', 'b', 'c']);
    const stream = createRillStream({
      chunks,
      resolve: async () => 'done',
    });
    expect(isStream(stream)).toBe(true);
    expect(stream.__rill_stream).toBe(true);
    expect(stream.done).toBe(false);
  });

  it('throws RILL-R003 when chunks is not an AsyncIterable', () => {
    expect(() =>
      createRillStream({
        chunks: 'not-async-iterable' as unknown as AsyncIterable<RillValue>,
        resolve: async () => null,
      })
    ).toThrow('createRillStream requires AsyncIterable chunks');
  });

  it('throws RILL-R003 when chunks is null', () => {
    expect(() =>
      createRillStream({
        chunks: null as unknown as AsyncIterable<RillValue>,
        resolve: async () => null,
      })
    ).toThrow('createRillStream requires AsyncIterable chunks');
  });

  it('throws RILL-R003 when resolve is not a function', () => {
    const chunks = asyncIterableFrom([]);
    expect(() =>
      createRillStream({
        chunks,
        resolve: 'not-a-function' as unknown as () => Promise<RillValue>,
      })
    ).toThrow('createRillStream requires resolve function');
  });

  it('accepts optional dispose without error', () => {
    const chunks = asyncIterableFrom(['x']);
    const stream = createRillStream({
      chunks,
      resolve: async () => null,
      dispose: () => {},
    });
    expect(isStream(stream)).toBe(true);
  });

  it('accepts omitted dispose without error', () => {
    const chunks = asyncIterableFrom(['x']);
    const stream = createRillStream({
      chunks,
      resolve: async () => null,
    });
    expect(isStream(stream)).toBe(true);
  });

  describe('stream iteration', () => {
    it('advances through chunks via next()', async () => {
      const chunks = asyncIterableFrom(['a', 'b']);
      const stream = createRillStream({
        chunks,
        resolve: async () => 'resolved',
      });

      // First .next call initializes iteration
      const step1 = (await stream.next.fn(
        {},
        {} as never
      )) as unknown as RillStream;
      expect(step1.done).toBe(false);
      expect(step1.value).toBe('a');

      // Advance to second chunk
      const step2 = (await step1.next.fn(
        {},
        {} as never
      )) as unknown as RillStream;
      expect(step2.done).toBe(false);
      expect(step2.value).toBe('b');

      // Exhaust the stream
      const step3 = (await step2.next.fn(
        {},
        {} as never
      )) as unknown as RillStream;
      expect(step3.done).toBe(true);
    });

    it('throws RILL-R002 on re-iteration of exhausted stream', async () => {
      const chunks = asyncIterableFrom(['only']);
      const stream = createRillStream({
        chunks,
        resolve: async () => null,
      });

      // Consume the stream
      const step1 = (await stream.next.fn(
        {},
        {} as never
      )) as unknown as RillStream;
      const step2 = (await step1.next.fn(
        {},
        {} as never
      )) as unknown as RillStream;
      expect(step2.done).toBe(true);

      // Attempting to call next on done step throws (sync callable)
      expect(() => step2.next.fn({}, {} as never)).toThrow(
        'Stream already consumed; cannot re-iterate'
      );
    });

    it('throws RILL-R002 when calling next on stale step', async () => {
      const chunks = asyncIterableFrom(['a', 'b', 'c']);
      const stream = createRillStream({
        chunks,
        resolve: async () => null,
      });

      const step1 = (await stream.next.fn(
        {},
        {} as never
      )) as unknown as RillStream;

      // Advance past step1
      await step1.next.fn({}, {} as never);

      // Calling next on stale step1 again throws
      await expect(step1.next.fn({}, {} as never)).rejects.toThrow(
        'Stream already consumed; cannot re-iterate'
      );
    });

    it('throws RILL-R002 when calling initial next twice', async () => {
      const chunks = asyncIterableFrom(['a']);
      const stream = createRillStream({
        chunks,
        resolve: async () => null,
      });

      // First call succeeds
      await stream.next.fn({}, {} as never);

      // Second call on initial stream throws
      await expect(stream.next.fn({}, {} as never)).rejects.toThrow(
        'Stream already consumed; cannot re-iterate'
      );
    });
  });

  describe('resolve', () => {
    it('caches resolution value for idempotent access', async () => {
      let callCount = 0;
      const chunks = asyncIterableFrom([]);
      const stream = createRillStream({
        chunks,
        resolve: async () => {
          callCount++;
          return 'resolved-value';
        },
      });

      // Access the hidden resolve function
      const resolveFn = (
        stream as unknown as Record<string, () => Promise<RillValue>>
      )['__rill_stream_resolve']!;

      const result1 = await resolveFn();
      const result2 = await resolveFn();

      expect(result1).toBe('resolved-value');
      expect(result2).toBe('resolved-value');
      expect(callCount).toBe(1);
    });
  });

  describe('dispose', () => {
    it('calls dispose when stream is exhausted', async () => {
      let disposed = false;
      const chunks = asyncIterableFrom(['x']);
      const stream = createRillStream({
        chunks,
        resolve: async () => null,
        dispose: () => {
          disposed = true;
        },
      });

      // Consume all chunks
      const step1 = (await stream.next.fn(
        {},
        {} as never
      )) as unknown as RillStream;
      expect(disposed).toBe(false);

      // Exhaust the stream
      await step1.next.fn({}, {} as never);
      expect(disposed).toBe(true);
    });
  });
});

// ============================================================
// YieldSignal
// ============================================================

describe('YieldSignal', () => {
  it('extends Error with value property', () => {
    const signal = new YieldSignal('chunk-value');
    expect(signal).toBeInstanceOf(Error);
    expect(signal.value).toBe('chunk-value');
    expect(signal.name).toBe('YieldSignal');
    expect(signal.message).toBe('yield');
  });
});

// ============================================================
// IR-7: STREAM TYPE REGISTRATION
// ============================================================

describe('stream TypeDefinition', () => {
  const streamDef = BUILT_IN_TYPES.find((t) => t.name === 'stream');

  it('exists in BUILT_IN_TYPES', () => {
    expect(streamDef).toBeDefined();
  });

  it('is registered before iterator (streams satisfy iterator shape)', () => {
    const names = BUILT_IN_TYPES.map((t) => t.name);
    const iteratorIndex = names.indexOf('iterator');
    const streamIndex = names.indexOf('stream');
    const listIndex = names.indexOf('list');
    expect(streamIndex).toBeLessThan(iteratorIndex);
    expect(streamIndex).toBeLessThan(listIndex);
  });

  it('has isLeaf false (parameterized type)', () => {
    expect(streamDef!.isLeaf).toBe(false);
  });

  it('has immutable true', () => {
    expect(streamDef!.immutable).toBe(true);
  });

  it('identity detects stream values', () => {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'x',
      next: callable(() => null),
    };
    expect(streamDef!.identity(stream)).toBe(true);
    expect(streamDef!.identity('not-a-stream')).toBe(false);
  });

  it('format produces type(stream) representation', () => {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'x',
      next: callable(() => null),
    };
    expect(formatValue(stream)).toBe('type(stream)');
  });

  it('structure returns { kind: stream }', () => {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'x',
      next: callable(() => null),
    };
    expect(streamDef!.protocol.structure).toBeDefined();
    const structure = streamDef!.protocol.structure!(stream);
    expect(structure.kind).toBe('stream');
  });
});

// ============================================================
// STREAM TYPE STRUCTURE FORMAT
// ============================================================

describe('formatStructure for stream', () => {
  it('formats bare stream as "stream"', () => {
    const ts: TypeStructure = { kind: 'stream' };
    expect(formatStructure(ts)).toBe('stream');
  });

  it('formats stream(string) with chunk type', () => {
    const ts: TypeStructure = {
      kind: 'stream',
      chunk: { kind: 'string' },
    };
    expect(formatStructure(ts)).toBe('stream(string)');
  });

  it('formats stream(string):dict with chunk and ret types', () => {
    const ts: TypeStructure = {
      kind: 'stream',
      chunk: { kind: 'string' },
      ret: { kind: 'dict' },
    };
    expect(formatStructure(ts)).toBe('stream(string):dict');
  });

  it('formats stream with only ret type', () => {
    const ts: TypeStructure = {
      kind: 'stream',
      ret: { kind: 'number' },
    };
    expect(formatStructure(ts)).toBe('stream(any):number');
  });
});

// ============================================================
// INFER STRUCTURE FOR STREAM
// ============================================================

describe('inferStructure for stream', () => {
  it('infers { kind: stream } for stream values', () => {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'x',
      next: callable(() => null),
    };
    const structure = inferStructure(stream);
    expect(structure.kind).toBe('stream');
  });
});

// ============================================================
// STRUCTURE EQUALS FOR STREAM
// ============================================================

describe('structureEquals for stream', () => {
  it('bare stream equals bare stream', () => {
    expect(structureEquals({ kind: 'stream' }, { kind: 'stream' })).toBe(true);
  });

  it('stream(string) equals stream(string)', () => {
    expect(
      structureEquals(
        { kind: 'stream', chunk: { kind: 'string' } },
        { kind: 'stream', chunk: { kind: 'string' } }
      )
    ).toBe(true);
  });

  it('stream(string) differs from stream(number)', () => {
    expect(
      structureEquals(
        { kind: 'stream', chunk: { kind: 'string' } },
        { kind: 'stream', chunk: { kind: 'number' } }
      )
    ).toBe(false);
  });

  it('stream with ret equals stream with same ret', () => {
    expect(
      structureEquals(
        { kind: 'stream', ret: { kind: 'dict' } },
        { kind: 'stream', ret: { kind: 'dict' } }
      )
    ).toBe(true);
  });

  it('stream with ret differs from stream without ret', () => {
    expect(
      structureEquals(
        { kind: 'stream', ret: { kind: 'dict' } },
        { kind: 'stream' }
      )
    ).toBe(false);
  });
});

// ============================================================
// IR-8: structureMatches STREAM BRANCH
// ============================================================

describe('structureMatches stream', () => {
  const stream: RillStream = {
    __rill_stream: true,
    done: false,
    value: 'x',
    next: callable(() => null),
  };

  it('any stream matches bare stream type', () => {
    expect(structureMatches(stream, { kind: 'stream' })).toBe(true);
  });

  it('stream matches stream with chunk constraint', () => {
    expect(
      structureMatches(stream, {
        kind: 'stream',
        chunk: { kind: 'string' },
      })
    ).toBe(true);
  });

  it('stream matches stream with ret constraint', () => {
    expect(
      structureMatches(stream, {
        kind: 'stream',
        ret: { kind: 'dict' },
      })
    ).toBe(true);
  });

  it('stream matches stream with both chunk and ret constraints', () => {
    expect(
      structureMatches(stream, {
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: { kind: 'dict' },
      })
    ).toBe(true);
  });

  it('non-stream value does not match stream type', () => {
    expect(structureMatches('hello', { kind: 'stream' })).toBe(false);
    expect(structureMatches(42, { kind: 'stream' })).toBe(false);
    expect(structureMatches({ a: 1 }, { kind: 'stream' })).toBe(false);
  });

  it('stream does not match non-stream types', () => {
    expect(structureMatches(stream, { kind: 'dict' })).toBe(false);
    expect(structureMatches(stream, { kind: 'string' })).toBe(false);
  });
});

// ============================================================
// structureMatches TYPED STREAM (with embedded type metadata)
// ============================================================

describe('structureMatches typed stream', () => {
  function makeTypedStream(
    chunkType?: TypeStructure,
    retType?: TypeStructure
  ): RillStream {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'x',
      next: callable(() => null),
    };
    if (chunkType !== undefined) {
      Object.defineProperty(stream, '__rill_stream_chunk_type', {
        value: chunkType,
        enumerable: false,
      });
    }
    if (retType !== undefined) {
      Object.defineProperty(stream, '__rill_stream_ret_type', {
        value: retType,
        enumerable: false,
      });
    }
    return stream;
  }

  it('typed stream with matching chunk type passes chunk assertion', () => {
    const stream = makeTypedStream({ kind: 'string' });
    expect(
      structureMatches(stream, { kind: 'stream', chunk: { kind: 'string' } })
    ).toBe(true);
  });

  it('typed stream with mismatching chunk type fails chunk assertion', () => {
    const stream = makeTypedStream({ kind: 'string' });
    expect(
      structureMatches(stream, { kind: 'stream', chunk: { kind: 'number' } })
    ).toBe(false);
  });

  it('typed stream with matching ret type passes ret assertion', () => {
    const stream = makeTypedStream(undefined, { kind: 'dict' });
    expect(
      structureMatches(stream, { kind: 'stream', ret: { kind: 'dict' } })
    ).toBe(true);
  });

  it('typed stream with mismatching ret type fails ret assertion', () => {
    const stream = makeTypedStream(undefined, { kind: 'dict' });
    expect(
      structureMatches(stream, { kind: 'stream', ret: { kind: 'string' } })
    ).toBe(false);
  });

  it('typed stream with both matching chunk and ret passes both assertion', () => {
    const stream = makeTypedStream({ kind: 'string' }, { kind: 'dict' });
    expect(
      structureMatches(stream, {
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: { kind: 'dict' },
      })
    ).toBe(true);
  });

  it('typed stream with chunk mismatch fails even when ret matches', () => {
    const stream = makeTypedStream({ kind: 'number' }, { kind: 'dict' });
    expect(
      structureMatches(stream, {
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: { kind: 'dict' },
      })
    ).toBe(false);
  });

  it('typed stream with ret mismatch fails even when chunk matches', () => {
    const stream = makeTypedStream({ kind: 'string' }, { kind: 'number' });
    expect(
      structureMatches(stream, {
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: { kind: 'dict' },
      })
    ).toBe(false);
  });

  it('typed stream passes bare stream assertion', () => {
    const stream = makeTypedStream({ kind: 'string' }, { kind: 'dict' });
    expect(structureMatches(stream, { kind: 'stream' })).toBe(true);
  });

  it('untyped stream still passes parameterized assertions', () => {
    const stream = makeTypedStream();
    expect(
      structureMatches(stream, {
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: { kind: 'dict' },
      })
    ).toBe(true);
  });
});

// ============================================================
// inferStructure TYPED STREAM
// ============================================================

describe('inferStructure typed stream', () => {
  function makeTypedStream(
    chunkType?: TypeStructure,
    retType?: TypeStructure
  ): RillStream {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'x',
      next: callable(() => null),
    };
    if (chunkType !== undefined) {
      Object.defineProperty(stream, '__rill_stream_chunk_type', {
        value: chunkType,
        enumerable: false,
      });
    }
    if (retType !== undefined) {
      Object.defineProperty(stream, '__rill_stream_ret_type', {
        value: retType,
        enumerable: false,
      });
    }
    return stream;
  }

  it('returns structure with chunk and ret for typed stream', () => {
    const stream = makeTypedStream({ kind: 'string' }, { kind: 'dict' });
    const structure = inferStructure(stream);
    expect(structure.kind).toBe('stream');
    const s = structure as {
      kind: 'stream';
      chunk?: TypeStructure;
      ret?: TypeStructure;
    };
    expect(s.chunk).toEqual({ kind: 'string' });
    expect(s.ret).toEqual({ kind: 'dict' });
  });

  it('returns bare { kind: stream } for untyped stream', () => {
    const stream = makeTypedStream();
    const structure = inferStructure(stream);
    expect(structure).toEqual({ kind: 'stream' });
  });

  it('returns { kind: stream, chunk } for chunk-only typed stream', () => {
    const stream = makeTypedStream({ kind: 'number' });
    const structure = inferStructure(stream);
    expect(structure.kind).toBe('stream');
    const s = structure as {
      kind: 'stream';
      chunk?: TypeStructure;
      ret?: TypeStructure;
    };
    expect(s.chunk).toEqual({ kind: 'number' });
    expect(s.ret).toBeUndefined();
  });
});
