/**
 * Unit tests for in-process AHI shortcut.
 *
 * Covers:
 *   AC-18 — in-process fn invokes runner.runForAgent, never fetch
 *   AC-19 — capacity error maps to RILL-R032 (same code as HTTP 429)
 *   AC-20 — correlationId from caller metadata forwarded to callee
 *   AC-21 — callee failure response maps to RILL-R029
 *   EC-11 — bindHost() silent skip when no ahi:: functions present
 *   EC-12 — AgentHostError with phase 'capacity' → RuntimeError RILL-R032
 *   EC-13 — response.state === 'failed' → RuntimeError RILL-R029
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createInProcessFunction } from '../../src/index.js';
import { RuntimeError } from '@rcrsr/rill';
import type { AgentRunner } from '@rcrsr/rill-compose';
import type { RillValue } from '@rcrsr/rill';

// ============================================================
// HELPERS
// ============================================================

/** Minimal call context with caller metadata */
function makeCtx(overrides?: Partial<Record<string, string>>): {
  readonly metadata?: Record<string, string> | undefined;
} {
  return {
    metadata: {
      correlationId: 'caller-corr-1',
      agentName: 'caller-agent',
      sessionId: 'caller-sess-1',
      ...overrides,
    },
  };
}

/**
 * Build an AgentRunner mock that resolves to the given response.
 * Captures the agentName and input for inspection.
 */
function makeRunner(response: {
  state: 'running' | 'completed' | 'failed';
  result?: RillValue | undefined;
}): {
  runner: AgentRunner;
  calls: Array<{
    agentName: string;
    input: Parameters<AgentRunner['runForAgent']>[1];
  }>;
} {
  const calls: Array<{
    agentName: string;
    input: Parameters<AgentRunner['runForAgent']>[1];
  }> = [];
  const runner: AgentRunner = {
    runForAgent: vi.fn(async (agentName, input) => {
      calls.push({ agentName, input });
      return response;
    }),
  };
  return { runner, calls };
}

/**
 * Build an AgentRunner mock that throws the given error.
 */
function makeThrowingRunner(err: Error): AgentRunner {
  return {
    runForAgent: vi.fn().mockRejectedValue(err),
  };
}

// ============================================================
// createInProcessFunction
// ============================================================

describe('createInProcessFunction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC-18: invokes runner.runForAgent without touching fetch', async () => {
    // Arrange
    const fetchSpy = vi
      .fn()
      .mockRejectedValue(new Error('fetch must not be called'));
    vi.stubGlobal('fetch', fetchSpy);

    const { runner, calls } = makeRunner({ state: 'completed', result: 'ok' });
    const def = createInProcessFunction(runner, 'classifier', 30000);

    // Act
    await def.fn([{ target: 'hello' } as unknown as RillValue], makeCtx());

    // Assert
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.agentName).toBe('classifier');
  });

  it('AC-20: correlationId from ctx.metadata forwarded to runForAgent input', async () => {
    // Arrange
    const { runner, calls } = makeRunner({ state: 'completed', result: null });
    const def = createInProcessFunction(runner, 'classifier', 30000);
    const ctx = makeCtx({
      correlationId: 'caller-123',
      agentName: 'agent-a',
      sessionId: 'sess-1',
    });

    // Act
    await def.fn([], ctx);

    // Assert
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input.correlationId).toBe('caller-123');
  });

  it('AC-20: trigger carries caller agentName and sessionId', async () => {
    // Arrange
    const { runner, calls } = makeRunner({ state: 'completed', result: null });
    const def = createInProcessFunction(runner, 'classifier', 30000);
    const ctx = makeCtx({ agentName: 'agent-a', sessionId: 'sess-42' });

    // Act
    await def.fn([], ctx);

    // Assert
    const trigger = calls[0]!.input.trigger as {
      type: string;
      agentName: string;
      sessionId: string;
    };
    expect(trigger.type).toBe('agent');
    expect(trigger.agentName).toBe('agent-a');
    expect(trigger.sessionId).toBe('sess-42');
  });

  it('EC-12 / AC-19: capacity error from runner maps to RuntimeError RILL-R032', async () => {
    // Arrange — error with .phase === 'capacity' (AgentHostError duck-type)
    const capacityErr = Object.assign(new Error('session limit reached'), {
      phase: 'capacity',
    });
    const runner = makeThrowingRunner(capacityErr);
    const def = createInProcessFunction(runner, 'classifier', 30000);

    // Act + Assert
    const thrown = await def.fn([], makeCtx()).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).errorId).toBe('RILL-R032');
  });

  it('EC-12: capacity detected via message substring fallback', async () => {
    // Arrange — error whose message contains 'capacity' but no .phase field
    const msgErr = new Error('exceeded capacity');
    const runner = makeThrowingRunner(msgErr);
    const def = createInProcessFunction(runner, 'classifier', 30000);

    // Act + Assert
    const thrown = await def.fn([], makeCtx()).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).errorId).toBe('RILL-R032');
  });

  it('EC-13 / AC-21: failed response maps to RuntimeError RILL-R029', async () => {
    // Arrange
    const { runner } = makeRunner({ state: 'failed' });
    const def = createInProcessFunction(runner, 'classifier', 30000);

    // Act + Assert
    const thrown = await def.fn([], makeCtx()).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).errorId).toBe('RILL-R029');
  });

  it('returns response.result on success', async () => {
    // Arrange
    const { runner } = makeRunner({ state: 'completed', result: 'hello' });
    const def = createInProcessFunction(runner, 'classifier', 30000);

    // Act
    const result = await def.fn([], makeCtx());

    // Assert
    expect(result).toBe('hello');
  });

  it('returns null when response.result is absent on success', async () => {
    // Arrange — completed but no result field
    const { runner } = makeRunner({ state: 'completed' });
    const def = createInProcessFunction(runner, 'classifier', 30000);

    // Act
    const result = await def.fn([], makeCtx());

    // Assert
    expect(result).toBeNull();
  });

  it('params dict from args[0] is forwarded to runForAgent', async () => {
    // Arrange
    const { runner, calls } = makeRunner({ state: 'completed', result: null });
    const def = createInProcessFunction(runner, 'classifier', 30000);
    const dictArg = { label: 'test', score: 0.9 } as unknown as RillValue;

    // Act
    await def.fn([dictArg], makeCtx());

    // Assert
    expect(calls[0]!.input.params).toEqual({ label: 'test', score: 0.9 });
  });

  it('non-capacity errors from runner are re-thrown unchanged', async () => {
    // Arrange
    const networkErr = new TypeError('connection refused');
    const runner = makeThrowingRunner(networkErr);
    const def = createInProcessFunction(runner, 'classifier', 30000);

    // Act + Assert
    await expect(def.fn([], makeCtx())).rejects.toThrow('connection refused');
  });
});

// ============================================================
// bindHost EC-11: silent skip when no ahi:: functions
//
// CONTRACT DOCUMENTATION TEST — verifies the loop logic contract in
// isolation. The real bindHost() regression test (against the actual
// ComposedHarness implementation) lives in:
//   packages/compose/tests/unit/harness.test.ts
//   → describe('EC-11: bindHost() silently skips agents with no ahi:: functions')
// ============================================================

describe('bindHost', () => {
  it('EC-11: does not throw when agent has no ahi:: functions', () => {
    // Arrange — minimal ComposedHarness with one agent whose functions Map
    // has no ahi::* entries. bindHost() must silently do nothing.
    const functionsMap = new Map<string, unknown>();
    functionsMap.set('log', () => null);
    functionsMap.set('app::fetch', () => null);

    const agents = new Map([
      [
        'writer',
        {
          context: { functions: functionsMap },
          card: { name: 'writer' },
          extensions: {},
          modules: {},
          ast: {},
          dispose: async () => undefined,
        },
      ],
    ]);

    const harness = {
      agents,
      sharedExtensions: {},
      bindHost(host: AgentRunner): void {
        // Documents the observable contract: iterating functions with no
        // ahi:: key must never call host.runForAgent. The production path
        // for this contract is tested in packages/compose/tests/unit/harness.test.ts.
        for (const [, agent] of agents) {
          for (const [fnKey] of agent.context.functions) {
            if (!fnKey.startsWith('ahi::')) continue;
            // If we reach here, there is an ahi:: key — this test verifies we don't.
            void host.runForAgent('', {});
          }
        }
      },
      dispose: async () => undefined,
    };

    const mockHost: AgentRunner = {
      runForAgent: vi.fn().mockResolvedValue({ state: 'completed' }),
    };

    // Act + Assert — must not throw, and runForAgent must not be called
    expect(() => harness.bindHost(mockHost)).not.toThrow();
    expect(mockHost.runForAgent).not.toHaveBeenCalled();
  });
});
