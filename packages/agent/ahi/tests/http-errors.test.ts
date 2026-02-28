import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAhiExtension } from '../src/index.js';
import type { RillValue } from '@rcrsr/rill';

// ============================================================
// HELPERS
// ============================================================

/** Create an extension with one downstream agent */
function makeExt(): ReturnType<typeof createAhiExtension> {
  return createAhiExtension({
    agents: { downstream: { url: 'http://downstream:8080' } },
  });
}

/** Build a minimal call context with required metadata */
function makeCtx(overrides?: Partial<Record<string, string>>): {
  metadata: Record<string, string>;
} {
  return {
    metadata: {
      correlationId: 'test-corr',
      sessionId: 'test-sess',
      agentName: 'test-agent',
      ...overrides,
    },
  };
}

/** Invoke ahi::downstream from an extension instance */
async function callDownstream(
  ext: ReturnType<typeof createAhiExtension>,
  args: RillValue[] = []
): Promise<RillValue> {
  const fn = (ext as Record<string, unknown>)['downstream'] as {
    fn: (
      args: RillValue[],
      ctx: { metadata: Record<string, string> }
    ) => Promise<RillValue>;
  };
  return fn.fn(args, makeCtx());
}

// ============================================================
// EC-4 / AC-6: HTTP 400 → RILL-R027, message includes body text
// ============================================================

describe('AHI error mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('EC-4 / AC-6: HTTP 400 maps to RILL-R027', () => {
    it('throws RuntimeError with code RILL-R027 on HTTP 400', async () => {
      const mockResponse = new Response(
        'Invalid input: missing field "prompt"',
        {
          status: 400,
        }
      );
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R027',
      });
    });

    it('includes the response body text in the error message on HTTP 400', async () => {
      const bodyText = 'Invalid input: missing field "prompt"';
      const mockResponse = new Response(bodyText, { status: 400 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toThrow(bodyText);
    });
  });

  // ============================================================
  // EC-5 / AC-7: HTTP 404 → RILL-R028, message contains "unreachable"
  // ============================================================

  describe('EC-5 / AC-7: HTTP 404 maps to RILL-R028', () => {
    it('throws RuntimeError with code RILL-R028 on HTTP 404', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status: 404 }))
      );

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R028',
      });
    });

    it('message contains "unreachable" on HTTP 404', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status: 404 }))
      );

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toThrow('unreachable');
    });
  });

  // ============================================================
  // EC-6 / AC-8: HTTP 500 → RILL-R029, message contains "downstream"
  // ============================================================

  describe('EC-6 / AC-8: HTTP 500 maps to RILL-R029', () => {
    it('throws RuntimeError with code RILL-R029 on HTTP 500', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status: 500 }))
      );

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R029',
      });
    });

    it('message contains "downstream" on HTTP 500', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status: 500 }))
      );

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toThrow('downstream');
    });
  });

  // ============================================================
  // AC-19: HTTP 429 → RILL-R032, message contains "rate limited"
  // ============================================================

  describe('AC-19: HTTP 429 maps to RILL-R032', () => {
    it('throws RuntimeError with code RILL-R032 on HTTP 429', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status: 429 }))
      );

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R032',
      });
    });

    it('message contains "rate limited" on HTTP 429', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status: 429 }))
      );

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toThrow('rate limited');
    });
  });

  // ============================================================
  // EC-7 / AC-9: AbortError → RILL-R030, message contains "timeout"
  // ============================================================

  describe('EC-7 / AC-9: AbortError maps to RILL-R030', () => {
    it('throws RuntimeError with code RILL-R030 on AbortError', async () => {
      const abortErr = Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
      });
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R030',
      });
    });

    it('message contains "timeout" on AbortError', async () => {
      const abortErr = Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
      });
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toThrow('timeout');
    });
  });

  // ============================================================
  // EC-8 / AC-10: TypeError → RILL-R031, message contains "connection refused"
  // ============================================================

  describe('EC-8 / AC-10: TypeError maps to RILL-R031', () => {
    it('throws RuntimeError with code RILL-R031 on TypeError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
      );

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R031',
      });
    });

    it('message contains "connection refused" on TypeError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
      );

      const ext = makeExt();

      await expect(callDownstream(ext)).rejects.toThrow('connection refused');
    });
  });

  // ============================================================
  // AC-11 part 1: call after dispose → RILL-R033
  // ============================================================

  describe('AC-11: call after dispose throws RILL-R033', () => {
    it('throws RuntimeError with code RILL-R033 when called after dispose', async () => {
      const ext = makeExt();
      await ext.dispose!();

      await expect(callDownstream(ext)).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R033',
      });
    });

    it('throws immediately without invoking fetch after dispose', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const ext = makeExt();
      await ext.dispose!();

      await expect(callDownstream(ext)).rejects.toMatchObject({
        errorId: 'RILL-R033',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // AC-11 part 2: dispose aborts in-flight requests → RILL-R030
  // ============================================================

  describe('AC-11: dispose aborts in-flight requests', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('in-flight call rejects with RILL-R030 after dispose triggers abort', async () => {
      let rejectFetch!: (err: unknown) => void;

      // fetch that hangs until we manually reject it (simulating abort signal fire)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          () =>
            new Promise<never>((_, reject) => {
              rejectFetch = reject;
            })
        )
      );

      const ext = makeExt();

      const fn = (ext as Record<string, unknown>)['downstream'] as {
        fn: (
          args: RillValue[],
          ctx: { metadata: Record<string, string> }
        ) => Promise<RillValue>;
      };

      // Start a call but do not await — it is now in-flight
      const callPromise = fn.fn([], makeCtx());

      // dispose() marks as disposed and aborts all in-flight controllers
      await ext.dispose!();

      // Simulate the fetch network layer firing the AbortError
      const abortErr = Object.assign(new Error('aborted'), {
        name: 'AbortError',
      });
      rejectFetch(abortErr);

      await expect(callPromise).rejects.toMatchObject({
        name: 'RuntimeError',
        errorId: 'RILL-R030',
      });

      await expect(callPromise).rejects.toThrow('timeout exceeded');
    });
  });
});
