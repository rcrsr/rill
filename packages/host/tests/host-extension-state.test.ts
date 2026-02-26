/**
 * Tests for extension suspend/restore lifecycle in AgentHost.
 *
 * Covered:
 *   AC-33  suspend() called on implementing extensions during collectExtensionState()
 *   AC-34  restore(state) called with correct saved state per alias
 *   AC-35  extensions without suspend excluded from collectExtensionState() result
 *   AC-36  extensions without restore skipped during applyExtensionState()
 *   AC-37  non-JSON-serializable suspend() return throws descriptive error (EC-21)
 *   EC-21  suspend() returns non-serializable → Error with descriptive message
 *   EC-22  suspend() throws → error propagates from collectExtensionState()
 *   EC-23  restore() throws → error propagates from applyExtensionState()
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { ExtensionResult } from '@rcrsr/rill';
import { createAgentHost } from '../src/index.js';
import type { ComposedAgent, AgentHost } from '../src/index.js';
import { mockComposedAgent } from './helpers/host.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Creates a ComposedAgent mock with custom extensions by spreading
 * the real base agent and overriding the extensions field.
 */
async function mockAgentWithExtensions(
  extensions: Record<string, ExtensionResult>
): Promise<ComposedAgent> {
  const base = await mockComposedAgent();
  return { ...base, extensions };
}

// ============================================================
// TEARDOWN REGISTRY
// ============================================================

const hostsToClean: AgentHost[] = [];

afterEach(async () => {
  for (const host of hostsToClean.splice(0)) {
    await host.close().catch(() => undefined);
    if (host.phase === 'ready' || host.phase === 'running') {
      await host.stop().catch(() => undefined);
    }
  }
});

// ============================================================
// collectExtensionState()
// ============================================================

describe('collectExtensionState()', () => {
  // ----------------------------------------------------------
  // AC-33: suspend() called on implementing extensions
  // ----------------------------------------------------------
  describe('AC-33: suspend() called on implementing extensions', () => {
    it('calls suspend() on each extension that implements it (AC-33)', async () => {
      const suspendCalled: string[] = [];

      const agent = await mockAgentWithExtensions({
        kv: {
          suspend: () => {
            suspendCalled.push('kv');
            return { count: 42 };
          },
        } as unknown as ExtensionResult,
        cache: {
          suspend: () => {
            suspendCalled.push('cache');
            return { hits: 7 };
          },
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await host.collectExtensionState();

      expect(suspendCalled).toContain('kv');
      expect(suspendCalled).toContain('cache');
    });

    it('includes suspend() return values in state keyed by alias (AC-33)', async () => {
      const agent = await mockAgentWithExtensions({
        kv: {
          suspend: () => ({ count: 42, keys: ['a', 'b'] }),
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      const state = await host.collectExtensionState();

      expect(state['kv']).toEqual({ count: 42, keys: ['a', 'b'] });
    });
  });

  // ----------------------------------------------------------
  // AC-35: extensions without suspend excluded from result
  // ----------------------------------------------------------
  describe('AC-35: extensions without suspend excluded from result', () => {
    it('omits extensions that do not have a suspend function (AC-35)', async () => {
      const agent = await mockAgentWithExtensions({
        kv: {
          suspend: () => ({ count: 1 }),
        } as unknown as ExtensionResult,
        noop: {
          // no suspend, no restore
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      const state = await host.collectExtensionState();

      expect('kv' in state).toBe(true);
      expect('noop' in state).toBe(false);
    });

    it('returns empty object when no extensions implement suspend (AC-35)', async () => {
      const agent = await mockAgentWithExtensions({
        plain: {} as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      const state = await host.collectExtensionState();

      expect(state).toEqual({});
    });

    it('returns empty object when extensions record is empty (AC-35)', async () => {
      const agent = await mockAgentWithExtensions({});

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      const state = await host.collectExtensionState();

      expect(state).toEqual({});
    });
  });

  // ----------------------------------------------------------
  // AC-37 / EC-21: non-serializable suspend() return throws
  // ----------------------------------------------------------
  describe('AC-37 / EC-21: non-JSON-serializable suspend() return throws', () => {
    it('throws a descriptive error when suspend() returns a BigInt (AC-37, EC-21)', async () => {
      // BigInt values cause JSON.stringify() to throw a TypeError.
      // Functions and undefined are silently dropped by JSON.stringify, so they
      // do not trigger the serialization guard. BigInt is the canonical test case.
      const agent = await mockAgentWithExtensions({
        bad: {
          suspend: () => BigInt(42),
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await expect(host.collectExtensionState()).rejects.toThrow(
        'suspend() returned non-JSON-serializable value'
      );
    });

    it('error message includes the extension alias (EC-21)', async () => {
      // Create a truly circular object
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;

      const agent2 = await mockAgentWithExtensions({
        my_ext: {
          suspend: () => circular,
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent2);
      hostsToClean.push(host);

      let thrown: unknown;
      try {
        await host.collectExtensionState();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain('my_ext');
      expect(message).toContain('non-JSON-serializable');
    });

    it('throws when suspend() returns an object with circular reference (EC-21)', async () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;

      const agent = await mockAgentWithExtensions({
        circ: {
          suspend: () => circular,
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await expect(host.collectExtensionState()).rejects.toThrow(
        'non-JSON-serializable'
      );
    });
  });

  // ----------------------------------------------------------
  // EC-22: suspend() throws → error propagates
  // ----------------------------------------------------------
  describe('EC-22: suspend() throws → error propagates', () => {
    it('propagates error thrown by suspend() (EC-22)', async () => {
      const agent = await mockAgentWithExtensions({
        failing: {
          suspend: () => {
            throw new Error('suspend exploded');
          },
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await expect(host.collectExtensionState()).rejects.toThrow(
        'suspend exploded'
      );
    });

    it('propagates async rejection from suspend() (EC-22)', async () => {
      const agent = await mockAgentWithExtensions({
        async_failing: {
          suspend: async () => {
            throw new Error('async suspend failed');
          },
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await expect(host.collectExtensionState()).rejects.toThrow(
        'async suspend failed'
      );
    });
  });
});

// ============================================================
// applyExtensionState()
// ============================================================

describe('applyExtensionState()', () => {
  // ----------------------------------------------------------
  // AC-34: restore(state) called with correct value per alias
  // ----------------------------------------------------------
  describe('AC-34: restore(state) called with correct saved state', () => {
    it('calls restore() on each implementing extension with saved state (AC-34)', async () => {
      const restoreCalled: Array<{ alias: string; state: unknown }> = [];

      const agent = await mockAgentWithExtensions({
        kv: {
          suspend: () => ({ count: 42 }),
          restore: (state: unknown) => {
            restoreCalled.push({ alias: 'kv', state });
          },
        } as unknown as ExtensionResult,
        cache: {
          suspend: () => ({ hits: 7 }),
          restore: (state: unknown) => {
            restoreCalled.push({ alias: 'cache', state });
          },
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      const savedState = await host.collectExtensionState();
      await host.applyExtensionState(savedState);

      expect(restoreCalled).toHaveLength(2);
      const kvEntry = restoreCalled.find((r) => r.alias === 'kv');
      const cacheEntry = restoreCalled.find((r) => r.alias === 'cache');
      expect(kvEntry?.state).toEqual({ count: 42 });
      expect(cacheEntry?.state).toEqual({ hits: 7 });
    });

    it('passes the exact saved state value to restore() (AC-34)', async () => {
      let capturedState: unknown;

      const agent = await mockAgentWithExtensions({
        kv: {
          suspend: () => ({ count: 42 }),
          restore: (state: unknown) => {
            capturedState = state;
          },
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      const savedState = await host.collectExtensionState();
      await host.applyExtensionState(savedState);

      expect(capturedState).toEqual({ count: 42 });
    });

    it('passes undefined to restore() when alias has no saved state (AC-34)', async () => {
      let capturedState: unknown = 'sentinel';

      const agent = await mockAgentWithExtensions({
        kv: {
          restore: (state: unknown) => {
            capturedState = state;
          },
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      // Apply an empty state — kv alias has no entry
      await host.applyExtensionState({});

      expect(capturedState).toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // AC-36: extensions without restore are skipped
  // ----------------------------------------------------------
  describe('AC-36: extensions without restore are skipped', () => {
    it('does not call restore on extensions without the method (AC-36)', async () => {
      let restoreCalledCount = 0;

      const agent = await mockAgentWithExtensions({
        with_restore: {
          restore: (_state: unknown) => {
            restoreCalledCount++;
          },
        } as unknown as ExtensionResult,
        no_restore: {
          // no restore method
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await host.applyExtensionState({ with_restore: { value: 1 } });

      // Only with_restore should have been called
      expect(restoreCalledCount).toBe(1);
    });

    it('completes without error when no extensions implement restore (AC-36)', async () => {
      const agent = await mockAgentWithExtensions({
        plain: {} as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await expect(
        host.applyExtensionState({ plain: { data: 1 } })
      ).resolves.toBeUndefined();
    });

    it('completes without error when extensions record is empty (AC-36)', async () => {
      const agent = await mockAgentWithExtensions({});

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await expect(host.applyExtensionState({})).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // EC-23: restore() throws → error propagates
  // ----------------------------------------------------------
  describe('EC-23: restore() throws → error propagates', () => {
    it('propagates error thrown by restore() (EC-23)', async () => {
      const agent = await mockAgentWithExtensions({
        failing: {
          restore: (_state: unknown) => {
            throw new Error('restore exploded');
          },
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await expect(host.applyExtensionState({ failing: {} })).rejects.toThrow(
        'restore exploded'
      );
    });

    it('propagates async rejection from restore() (EC-23)', async () => {
      const agent = await mockAgentWithExtensions({
        async_failing: {
          restore: async (_state: unknown) => {
            throw new Error('async restore failed');
          },
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      await expect(
        host.applyExtensionState({ async_failing: {} })
      ).rejects.toThrow('async restore failed');
    });
  });

  // ----------------------------------------------------------
  // Round-trip: collectExtensionState → applyExtensionState
  // ----------------------------------------------------------
  describe('round-trip: collect then apply', () => {
    it('round-trips state through suspend() and restore() (AC-33, AC-34)', async () => {
      const suspendCalled: string[] = [];
      const restoreCalled: Array<{ alias: string; state: unknown }> = [];

      const agent = await mockAgentWithExtensions({
        kv: {
          suspend: () => {
            suspendCalled.push('kv');
            return { count: 42 };
          },
          restore: (state: unknown) => {
            restoreCalled.push({ alias: 'kv', state });
          },
        } as unknown as ExtensionResult,
        noop: {
          // no suspend, no restore — must not appear in state or restore calls
        } as unknown as ExtensionResult,
      });

      const host = createAgentHost(agent);
      hostsToClean.push(host);

      // Collect
      const state = await host.collectExtensionState();
      expect(suspendCalled).toContain('kv');
      expect(state['kv']).toEqual({ count: 42 });
      expect('noop' in state).toBe(false);

      // Apply
      await host.applyExtensionState(state);
      expect(restoreCalled[0]).toEqual({ alias: 'kv', state: { count: 42 } });
    });
  });
});
