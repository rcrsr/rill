/**
 * AHI Extension Factory
 *
 * Provides agent-to-agent HTTP invocation via the Agent Host Interface (AHI).
 * Static URL mode: agents are configured with explicit endpoint URLs.
 * Registry mode (Phase 4): agents array resolved via a registry service.
 */

import type { ExtensionResult, HostFunctionDefinition } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';
import { isDict, RuntimeError } from '@rcrsr/rill';
import type { InputSchema } from '@rcrsr/rill-compose';
import {
  createRegistryClient,
  type RegistryClient,
} from '@rcrsr/rill-registry-client';

// ============================================================
// TYPES
// ============================================================

/** Configuration for a single AHI agent endpoint */
export interface AhiAgentConfig {
  /** Resolved endpoint URL (after env substitution) */
  url: string;
}

/** AHI extension configuration */
export interface AhiExtensionConfig {
  /** Registry URL (required when agents is an array) */
  registry?: string | undefined;
  /** Agent map (static mode) or agent name list (registry mode) */
  agents: Record<string, AhiAgentConfig> | string[];
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number | undefined;
}

// ============================================================
// HELPERS
// ============================================================

/** ENV_VAR_PATTERN matches ${VAR_NAME} substitution tokens */
const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Resolve all ${VAR} tokens in a URL string using process.env.
 * Throws synchronously if any referenced variable is unset.
 */
function resolveEnvVars(url: string): string {
  return url.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`AHI: environment variable ${varName} is not set`);
    }
    return value;
  });
}

/**
 * Convert the first rill argument to a JSON-serializable params object.
 * If args[0] is a dict, spread it into a plain object.
 * Otherwise return an empty object.
 */
function extractParams(args: RillValue[]): Record<string, RillValue> {
  const first = args[0];
  if (first !== undefined && isDict(first)) {
    return { ...first };
  }
  return {};
}

// ============================================================
// SHARED HTTP INVOCATION
// ============================================================

/**
 * Perform the HTTP POST to a resolved agent endpoint.
 * Shared by both static URL mode and registry mode.
 *
 * @param agentUrl - Resolved base URL of the agent
 * @param agentTimeout - Effective timeout in ms (0 = unlimited)
 * @param args - Rill call arguments
 * @param ctx - Rill call context (metadata forwarded as headers)
 * @param inFlight - Set of active AbortControllers for dispose tracking
 * @returns Rill value from downstream agent
 */
async function invokeAgent(
  agentUrl: string,
  agentTimeout: number,
  args: RillValue[],
  ctx: { readonly metadata?: Record<string, string> | undefined },
  inFlight: Set<AbortController>
): Promise<RillValue> {
  const params = extractParams(args);
  const metadata = ctx.metadata ?? {};

  // AC-5 / AC-22: forward remaining budget when it is less than the
  // configured default. Read timeoutDeadline set by host.ts / handler.ts.
  const deadlineRaw = metadata['timeoutDeadline'];
  const deadlineMs =
    deadlineRaw !== undefined ? parseInt(deadlineRaw, 10) : undefined;

  let effectiveTimeout = agentTimeout;
  if (deadlineMs !== undefined && !isNaN(deadlineMs)) {
    const remaining = deadlineMs - Date.now();
    // If deadline has already passed, send 1 ms (not 0, which means no timeout).
    // If remaining < configured default (or default is 0 = unlimited), use remaining.
    if (agentTimeout === 0 || remaining < agentTimeout) {
      effectiveTimeout = remaining > 0 ? remaining : 1;
    }
  }

  const body = JSON.stringify({
    params,
    trigger: {
      type: 'agent',
      agentName: metadata['agentName'] ?? '',
      sessionId: metadata['sessionId'] ?? '',
    },
    timeout: effectiveTimeout,
  });

  // Build AbortController only when a non-zero timeout is configured.
  // AC-21: timeout 0 means no deadline — skip AbortController entirely.
  let controller: AbortController | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  if (effectiveTimeout !== 0) {
    controller = new AbortController();
    timeoutHandle = setTimeout(() => {
      controller!.abort();
    }, effectiveTimeout);
  }

  // Track controller for dispose cancellation
  if (controller !== undefined) {
    inFlight.add(controller);
  }

  try {
    const response = await fetch(`${agentUrl}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': metadata['correlationId'] ?? '',
      },
      body,
      signal: controller?.signal ?? null,
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 400) {
        const text = await response.text();
        throw new RuntimeError('RILL-R027', `AHI: validation failed: ${text}`);
      }
      if (status === 404) {
        throw new RuntimeError('RILL-R028', 'AHI: agent unreachable');
      }
      if (status === 429) {
        throw new RuntimeError('RILL-R032', 'AHI: rate limited');
      }
      if (status === 500) {
        throw new RuntimeError('RILL-R029', 'AHI: downstream execution failed');
      }
      throw new RuntimeError(
        'RILL-R034',
        `AHI: downstream error: HTTP ${status}`
      );
    }

    const json = (await response.json()) as { result: RillValue };
    return json.result;
  } catch (err) {
    // Re-throw structured errors immediately
    if (err instanceof RuntimeError) {
      throw err;
    }
    // EC-7: AbortController signal fired → timeout exceeded
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RuntimeError('RILL-R030', 'AHI: timeout exceeded');
    }
    // EC-8: Network failure (DNS, connection refused)
    if (err instanceof TypeError) {
      throw new RuntimeError('RILL-R031', 'AHI: connection refused');
    }
    throw err;
  } finally {
    if (controller !== undefined) {
      inFlight.delete(controller);
    }
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

// ============================================================
// INPUT VALIDATION (AC-16)
// ============================================================

/**
 * Validate a params dict against an InputSchema.
 * Returns a string describing the first failure, or null when valid.
 *
 * Mirrors the logic in packages/host/src/routes.ts validateInputParams(),
 * inlined here because @rcrsr/rill-host is not a dependency of this package.
 */
function validateAgentParams(
  params: Record<string, RillValue>,
  inputSchema: InputSchema
): string | null {
  for (const [param, descriptor] of Object.entries(inputSchema)) {
    const provided = Object.prototype.hasOwnProperty.call(params, param);
    const value = params[param];

    if (descriptor.required === true) {
      if (!provided || value === null) {
        return `param "${param}" is required`;
      }
    }

    if (provided && value !== null && value !== undefined) {
      const ok = checkRillType(value, descriptor.type);
      if (!ok) {
        const got = rillValueLabel(value);
        const expected =
          descriptor.type === 'bool' ? 'boolean' : descriptor.type;
        return `param "${param}": expected ${expected}, got ${got}`;
      }
    }
  }
  return null;
}

/** Returns true when value matches the declared Rill type. */
function checkRillType(
  value: RillValue,
  rillType: 'string' | 'number' | 'bool' | 'list' | 'dict'
): boolean {
  switch (rillType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'bool':
      return typeof value === 'boolean';
    case 'list':
      return Array.isArray(value);
    case 'dict':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
  }
}

/** Maps a RillValue to a human-readable type label for error messages. */
function rillValueLabel(value: RillValue): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object' && value !== null) return 'dict';
  return typeof value;
}

// ============================================================
// REGISTRY MODE
// ============================================================

/** Cached resolution result for a registry agent. */
interface ResolvedEntry {
  readonly endpoint: string;
  readonly input?: InputSchema | undefined;
}

/**
 * Build an ExtensionResult for registry mode (agents is a string[]).
 *
 * AC-12: At boot, resolve(name) is called for each symbolic agent name.
 * AC-13: Success → cache endpoint; register ahi::<name> with cached URL.
 * AC-14: Failure → log warning; register ahi::<name> with lazy flag.
 * AC-15 / EC-3: On first call to a lazy-flagged agent, retry resolve().
 *               If retry fails, throw runtime error RILL-R035.
 * AC-16: When input contract is present, validate params before HTTP call.
 */
function createRegistryModeExtension(
  names: string[],
  registryUrl: string,
  timeout: number
): ExtensionResult {
  const client: RegistryClient = createRegistryClient({ url: registryUrl });
  const inFlight = new Set<AbortController>();
  let disposed = false;

  // Per-agent resolution state.
  // bootPromise resolves to { endpoint, input } on success, or null on failure.
  const bootPromises = new Map<string, Promise<ResolvedEntry | null>>();

  // AC-12: kick off eager resolution for every symbolic name at boot
  for (const name of names) {
    const promise = client
      .resolve(name)
      .then((agent) => ({ endpoint: agent.endpoint, input: agent.input }))
      .catch((err: unknown) => {
        // AC-14: log warning on boot failure; agent flagged as lazy
        console.warn(
          `[ahi] boot resolve failed for "${name}":`,
          err instanceof Error ? err.message : String(err)
        );
        return null;
      });
    bootPromises.set(name, promise);
  }

  const functions: Record<string, ExtensionResult[string]> = {};

  for (const name of names) {
    // Capture per-agent boot promise in closure
    const agentName = name;
    const bootPromise = bootPromises.get(name)!;

    // AC-15: lazily-resolved promise, set on first call when boot failed.
    // Subsequent calls await the same promise — client.resolve() fires once.
    let lazyPromise: Promise<ResolvedEntry> | undefined;

    const fn = async (
      args: RillValue[],
      ctx: { readonly metadata?: Record<string, string> | undefined }
    ): Promise<RillValue> => {
      // AC-11: reject calls after dispose
      if (disposed) {
        throw new RuntimeError('RILL-R033', 'AHI: extension disposed');
      }

      // AC-13 / AC-15: resolve entry — await boot result first
      let entry = await bootPromise;

      if (entry === null) {
        // AC-15: boot failed — retry resolve() on first call and cache result.
        // lazyPromise is shared across all calls; client.resolve() fires once.
        if (lazyPromise === undefined) {
          lazyPromise = client
            .resolve(agentName)
            .then((agent) => ({ endpoint: agent.endpoint, input: agent.input }))
            .catch(() => {
              // Reset so a future dispose-then-recreate scenario is clean,
              // but keep the rejected promise so awaiting callers get EC-3.
              return Promise.reject(
                new RuntimeError(
                  'RILL-R035',
                  `Agent ${agentName} could not be resolved`
                )
              );
            });
        }
        // EC-3: if lazyPromise rejects, the RuntimeError propagates to caller
        entry = await lazyPromise;
      }

      // AC-16: validate params against InputSchema when contract is present
      if (entry.input !== undefined) {
        const params = extractParams(args);
        const failure = validateAgentParams(params, entry.input);
        if (failure !== null) {
          throw new RuntimeError('RILL-R027', `AHI: ${failure}`);
        }
      }

      return invokeAgent(entry.endpoint, timeout, args, ctx, inFlight);
    };

    functions[`ahi::${agentName}`] = {
      params: [
        {
          name: 'params',
          type: 'any',
          description: `Parameters forwarded to agent ${agentName}`,
        },
      ],
      fn,
      description: `Invoke AHI agent: ${agentName}`,
      returnType: 'any',
    };
  }

  // AC-11: cancel all in-flight requests and block further calls
  const dispose = (): void => {
    disposed = true;
    for (const ctrl of inFlight) {
      ctrl.abort();
    }
    inFlight.clear();
    client.dispose();
  };

  const result: ExtensionResult = { ...functions };
  result.dispose = dispose;
  return result;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create AHI extension for agent-to-agent HTTP invocation.
 *
 * Static URL mode: pass agents as a Record<string, AhiAgentConfig>.
 * Registry mode: pass agents as a string[] with registry URL set.
 * Each agent name registers an `ahi::<name>` host function.
 *
 * @param config - AHI extension configuration
 * @returns ExtensionResult with one function per agent
 * @throws Error if agents is an array without a registry URL (EC-1)
 * @throws Error if any agent URL contains an unset env variable (EC-2)
 *
 * @example
 * ```typescript
 * const ahiExt = createAhiExtension({
 *   agents: {
 *     parser: { url: 'http://localhost:4001' },
 *   },
 * });
 * ```
 */
export function createAhiExtension(
  config: AhiExtensionConfig
): ExtensionResult {
  const { agents, registry, timeout = 30000 } = config;

  // EC-1: Array form requires registry
  if (Array.isArray(agents)) {
    if (registry === undefined || registry === '') {
      throw new Error(
        'AHI extension requires registry URL when agents is an array'
      );
    }
    // AC-12–AC-15: registry mode with eager boot + lazy fallback
    return createRegistryModeExtension(agents, registry, timeout);
  }

  // Static URL mode: validate and resolve env vars in each agent URL
  const resolvedAgents = new Map<string, { url: string }>();

  for (const [name, agentConfig] of Object.entries(agents)) {
    const resolvedUrl = resolveEnvVars(agentConfig.url);
    resolvedAgents.set(name, { url: resolvedUrl });
  }

  // ============================================================
  // IN-FLIGHT TRACKING (factory-level, shared across all agents)
  // ============================================================

  const inFlight = new Set<AbortController>();
  let disposed = false;

  // ============================================================
  // FUNCTION REGISTRATION
  // ============================================================

  const functions: Record<string, ExtensionResult[string]> = {};

  for (const [name, agent] of resolvedAgents) {
    // Capture agent state for this closure
    const agentUrl = agent.url;

    functions[`ahi::${name}`] = {
      params: [
        {
          name: 'params',
          type: 'any',
          description: `Parameters forwarded to agent ${name}`,
        },
      ],
      fn: (
        args: RillValue[],
        ctx: { readonly metadata?: Record<string, string> | undefined }
      ): Promise<RillValue> => {
        // AC-11: reject calls after dispose
        if (disposed) {
          throw new RuntimeError('RILL-R033', 'AHI: extension disposed');
        }
        return invokeAgent(agentUrl, timeout, args, ctx, inFlight);
      },
      description: `Invoke AHI agent: ${name}`,
      returnType: 'any',
    };
  }

  // ============================================================
  // DISPOSE
  // ============================================================

  // AC-11: cancel all in-flight requests and block further calls
  const dispose = (): void => {
    disposed = true;
    for (const ctrl of inFlight) {
      ctrl.abort();
    }
    inFlight.clear();
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const result: ExtensionResult = { ...functions };
  result.dispose = dispose;

  return result;
}

export default createAhiExtension;

// ============================================================
// IN-PROCESS RUNNER INTERFACE
// ============================================================

/**
 * Interface for an in-process agent host accepted by createInProcessFunction.
 * Aliased from AgentRunner in @rcrsr/rill-compose to avoid duplication (AC-20).
 */
import type { AgentRunner as InProcessRunner } from '@rcrsr/rill-compose';
export type { InProcessRunner };

// ============================================================
// IN-PROCESS CALL (TASK 3.2)
// ============================================================

/**
 * Create a CallableFn that invokes a target agent in-process via runner.
 *
 * IR-9: Calls runner.runForAgent() with caller trigger metadata and
 * propagated timeout deadline. Maps capacity errors to RILL-R032 and
 * failed state to RILL-R029.
 *
 * @param runner - In-process agent runner
 * @param targetAgentName - Name of the target agent to invoke
 * @param defaultTimeout - Default timeout in ms (0 = unlimited)
 */
function createInProcessCallFn(
  runner: InProcessRunner,
  targetAgentName: string,
  defaultTimeout: number
): (
  args: RillValue[],
  ctx: { readonly metadata?: Record<string, string> | undefined }
) => Promise<RillValue> {
  return async (
    args: RillValue[],
    ctx: { readonly metadata?: Record<string, string> | undefined }
  ): Promise<RillValue> => {
    const params = extractParams(args);
    const metadata = ctx.metadata ?? {};

    const callerAgentName = metadata['agentName'] ?? '';
    const callerSessionId = metadata['sessionId'] ?? '';
    const callerCorrelationId = metadata['correlationId'];

    // AC-5 / AC-22: propagate remaining budget when it is less than the
    // configured default. Mirror the same logic used in invokeAgent().
    const deadlineRaw = metadata['timeoutDeadline'];
    const deadlineMs =
      deadlineRaw !== undefined ? parseInt(deadlineRaw, 10) : undefined;

    let effectiveTimeout = defaultTimeout;
    if (deadlineMs !== undefined && !isNaN(deadlineMs)) {
      const remaining = deadlineMs - Date.now();
      if (defaultTimeout === 0 || remaining < defaultTimeout) {
        effectiveTimeout = remaining > 0 ? remaining : 1;
      }
    }

    let response: {
      state: 'running' | 'completed' | 'failed';
      result?: RillValue | undefined;
    };

    try {
      response = await runner.runForAgent(targetAgentName, {
        params,
        correlationId: callerCorrelationId,
        trigger: {
          type: 'agent',
          agentName: callerAgentName,
          sessionId: callerSessionId,
        },
        timeout: effectiveTimeout,
      });
    } catch (err) {
      // EC-12: capacity error from host → RILL-R032 rate limited
      // Duck-type check: ahi cannot import AgentHostError directly.
      if (
        err instanceof Error &&
        (('phase' in err &&
          (err as unknown as { phase: string }).phase === 'capacity') ||
          err.message.includes('capacity'))
      ) {
        throw new RuntimeError('RILL-R032', 'AHI: rate limited');
      }
      throw err;
    }

    // EC-13: downstream execution failed → RILL-R029
    if (response.state === 'failed') {
      throw new RuntimeError('RILL-R029', 'AHI: downstream execution failed');
    }

    return response.result ?? null;
  };
}

// ============================================================
// IN-PROCESS FUNCTION FACTORY (TASK 3.3)
// ============================================================

/**
 * Create a HostFunctionDefinition for in-process AHI invocation.
 *
 * IC-13: Used by bindHost() in compose.ts to register ahi::<name>
 * functions that bypass HTTP and call the agent directly.
 *
 * @param runner - In-process agent runner (AgentRunner-compatible)
 * @param targetAgentName - Name of the target agent
 * @param timeout - Default request timeout in ms (0 = unlimited)
 * @returns HostFunctionDefinition ready for registration
 */
export function createInProcessFunction(
  runner: InProcessRunner,
  targetAgentName: string,
  timeout: number
): HostFunctionDefinition {
  return {
    params: [
      {
        name: 'params',
        type: 'any',
        description: `Parameters forwarded to agent ${targetAgentName}`,
      },
    ],
    fn: createInProcessCallFn(runner, targetAgentName, timeout),
    description: `Invoke AHI agent in-process: ${targetAgentName}`,
    returnType: 'any',
  };
}
