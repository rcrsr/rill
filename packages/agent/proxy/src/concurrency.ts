/**
 * Concurrency limiter for rill-agent-proxy.
 * Enforces global and per-agent concurrent request limits.
 */

import type { ConcurrencyConfig } from './config.js';
import { ProxyError, PROXY_CONCURRENCY_LIMIT } from './errors.js';

// ============================================================
// TYPES
// ============================================================

/** Token held by an active request. Release it when the request completes. */
export interface ConcurrencyToken {
  readonly agentName: string;
  readonly acquiredAt: number;
}

/** Snapshot of current limiter state. */
export interface ConcurrencyStats {
  readonly active: number;
  readonly activeByAgent: Record<string, number>;
  readonly queued: number;
  readonly rejected: number;
}

/** Controls concurrent request throughput across all agents and per agent. */
export interface ConcurrencyLimiter {
  acquire(agentName: string): Promise<ConcurrencyToken>;
  release(token: ConcurrencyToken): void;
  readonly stats: ConcurrencyStats;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a ConcurrencyLimiter enforcing global and per-agent limits.
 *
 * AC-29: maxConcurrent enforced globally.
 * AC-30: maxConcurrentPerAgent enforced per agent.
 * AC-62: queueSize=0 rejects immediately when at capacity.
 * EC-9: Rejection throws ProxyError with PROXY_CONCURRENCY_LIMIT.
 *
 * Phase 4 note: queuing (queueSize > 0) is deferred to Phase 5.
 * All requests exceeding limits are rejected immediately regardless of queueSize.
 */
export function createConcurrencyLimiter(
  config: ConcurrencyConfig
): ConcurrencyLimiter {
  let active = 0;
  const activeByAgent = new Map<string, number>();
  let rejected = 0;

  function getAgentCount(agentName: string): number {
    return activeByAgent.get(agentName) ?? 0;
  }

  function acquire(agentName: string): Promise<ConcurrencyToken> {
    if (active >= config.maxConcurrent) {
      rejected++;
      return Promise.reject(
        new ProxyError(
          `Global concurrency limit of ${config.maxConcurrent} reached`,
          PROXY_CONCURRENCY_LIMIT,
          agentName
        )
      );
    }

    const agentCount = getAgentCount(agentName);
    if (agentCount >= config.maxConcurrentPerAgent) {
      rejected++;
      return Promise.reject(
        new ProxyError(
          `Per-agent concurrency limit of ${config.maxConcurrentPerAgent} reached for agent "${agentName}"`,
          PROXY_CONCURRENCY_LIMIT,
          agentName
        )
      );
    }

    active++;
    activeByAgent.set(agentName, agentCount + 1);

    const token: ConcurrencyToken = {
      agentName,
      acquiredAt: Date.now(),
    };

    return Promise.resolve(token);
  }

  function release(token: ConcurrencyToken): void {
    const { agentName } = token;
    const agentCount = getAgentCount(agentName);

    if (agentCount <= 0 || active <= 0) {
      return;
    }

    active--;
    const next = agentCount - 1;
    if (next === 0) {
      activeByAgent.delete(agentName);
    } else {
      activeByAgent.set(agentName, next);
    }
  }

  return {
    acquire,
    release,
    get stats(): ConcurrencyStats {
      const snapshot: Record<string, number> = {};
      for (const [name, count] of activeByAgent) {
        snapshot[name] = count;
      }
      return {
        active,
        activeByAgent: snapshot,
        queued: 0,
        rejected,
      };
    },
  };
}
