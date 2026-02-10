/**
 * Test suite for disposal lifecycle utilities.
 * Validates disposal state management (EC-15, EC-16, AC-4, AC-11, AC-15, AC-21).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createDisposalState,
  checkDisposed,
  dispose,
} from '../src/disposal.js';
import { RuntimeError } from '@rcrsr/rill';

describe('createDisposalState', () => {
  it('returns initial state with isDisposed false (IR-4)', () => {
    const state = createDisposalState('test-provider');

    expect(state).toEqual({ isDisposed: false });
  });

  it('creates independent state objects', () => {
    const state1 = createDisposalState('provider-1');
    const state2 = createDisposalState('provider-2');

    expect(state1).not.toBe(state2);
    expect(state1.isDisposed).toBe(false);
    expect(state2.isDisposed).toBe(false);
  });
});

describe('checkDisposed', () => {
  const provider = 'test-db';

  describe('EC-15, AC-11: isDisposed === true throws RuntimeError', () => {
    it('throws RuntimeError with RILL-R004 code', () => {
      const state = { isDisposed: true };

      expect(() => checkDisposed(state, provider)).toThrow(RuntimeError);

      try {
        checkDisposed(state, provider);
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
        expect((error as RuntimeError).message).toBe(
          `${provider}: operation cancelled`
        );
      }
    });

    it('includes provider name in error message', () => {
      const state = { isDisposed: true };
      const customProvider = 'my-custom-provider';

      expect(() => checkDisposed(state, customProvider)).toThrow(
        `${customProvider}: operation cancelled`
      );
    });
  });

  describe('IR-5: isDisposed === false returns void', () => {
    it('returns void without throwing', () => {
      const state = { isDisposed: false };

      expect(() => checkDisposed(state, provider)).not.toThrow();
      const result = checkDisposed(state, provider);
      expect(result).toBeUndefined();
    });
  });
});

describe('dispose', () => {
  describe('AC-4: Success case - calls cleanup once and sets flag', () => {
    it('calls cleanup callback once', async () => {
      const state = createDisposalState('test-provider');
      const cleanup = vi.fn(async () => {});

      await dispose(state, cleanup);

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(state.isDisposed).toBe(true);
    });

    it('sets isDisposed to true after cleanup', async () => {
      const state = createDisposalState('test-provider');
      const cleanup = vi.fn(async () => {});

      expect(state.isDisposed).toBe(false);
      await dispose(state, cleanup);
      expect(state.isDisposed).toBe(true);
    });

    it('works without cleanup callback', async () => {
      const state = createDisposalState('test-provider');

      await dispose(state);

      expect(state.isDisposed).toBe(true);
    });
  });

  describe('AC-4, AC-21: Second and subsequent calls are no-ops', () => {
    it('does not call cleanup on second call', async () => {
      const state = createDisposalState('test-provider');
      const cleanup = vi.fn(async () => {});

      await dispose(state, cleanup);
      await dispose(state, cleanup);

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('remains disposed after second call', async () => {
      const state = createDisposalState('test-provider');

      await dispose(state);
      await dispose(state);

      expect(state.isDisposed).toBe(true);
    });

    it('handles three dispose calls: first sets flag, rest are no-ops (AC-21)', async () => {
      const state = createDisposalState('test-provider');
      const cleanup = vi.fn(async () => {});

      // First call should invoke cleanup
      await dispose(state, cleanup);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(state.isDisposed).toBe(true);

      // Second call should not invoke cleanup
      await dispose(state, cleanup);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(state.isDisposed).toBe(true);

      // Third call should not invoke cleanup
      await dispose(state, cleanup);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(state.isDisposed).toBe(true);
    });
  });

  describe('EC-16, AC-15: Cleanup errors are logged but do not propagate', () => {
    it('logs warning when cleanup throws', async () => {
      const state = createDisposalState('test-provider');
      const cleanupError = new Error('Cleanup failed');
      const cleanup = vi.fn(async () => {
        throw cleanupError;
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await dispose(state, cleanup);

      expect(warnSpy).toHaveBeenCalledWith('Cleanup failed: Cleanup failed');
      expect(state.isDisposed).toBe(true);

      warnSpy.mockRestore();
    });

    it('still sets isDisposed flag when cleanup fails', async () => {
      const state = createDisposalState('test-provider');
      const cleanup = vi.fn(async () => {
        throw new Error('Cleanup error');
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(state.isDisposed).toBe(false);
      await dispose(state, cleanup);
      expect(state.isDisposed).toBe(true);

      warnSpy.mockRestore();
    });

    it('handles non-Error cleanup throws', async () => {
      const state = createDisposalState('test-provider');
      const cleanup = vi.fn(async () => {
        throw 'string error';
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await dispose(state, cleanup);

      expect(warnSpy).toHaveBeenCalledWith('Cleanup failed: Unknown error');
      expect(state.isDisposed).toBe(true);

      warnSpy.mockRestore();
    });

    it('does not throw when cleanup fails', async () => {
      const state = createDisposalState('test-provider');
      const cleanup = vi.fn(async () => {
        throw new Error('Cleanup error');
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(dispose(state, cleanup)).resolves.toBeUndefined();

      warnSpy.mockRestore();
    });
  });

  describe('Integration: checkDisposed after dispose', () => {
    it('throws when checking disposed state', async () => {
      const provider = 'test-provider';
      const state = createDisposalState(provider);

      await dispose(state);

      expect(() => checkDisposed(state, provider)).toThrow(RuntimeError);
      expect(() => checkDisposed(state, provider)).toThrow(
        `${provider}: operation cancelled`
      );
    });
  });
});
