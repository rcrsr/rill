import type {
  AgentCard,
  InputSchema,
  OutputSchema,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration for the registry client.
 */
export interface RegistryClientConfig {
  /** Registry base URL, e.g. "http://registry:8080/api/registry" */
  readonly url: string;
  /** Bearer token for Authorization header */
  readonly auth?: string | undefined;
}

// ============================================================
// REQUEST / RESPONSE TYPES
// ============================================================

/**
 * Payload sent when registering an agent with the registry.
 */
export interface RegistrationPayload {
  readonly name: string;
  readonly version: string;
  readonly endpoint: string;
  readonly card: AgentCard;
  readonly dependencies: string[];
}

/**
 * Agent record returned by the registry for resolve and list operations.
 */
export interface ResolvedAgent {
  readonly name: string;
  readonly version: string;
  readonly endpoint: string;
  readonly input?: InputSchema | undefined;
  readonly output?: OutputSchema | undefined;
  readonly status: 'active' | 'stale' | 'draining';
  /** ISO 8601 timestamp of the last received heartbeat */
  readonly lastHeartbeat: string;
}

// ============================================================
// CLIENT INTERFACE
// ============================================================

/**
 * Client for interacting with a rill agent registry over HTTP.
 */
export interface RegistryClient {
  /** Register this agent with the registry. Throws on HTTP 409 or network failure. */
  register(payload: RegistrationPayload): Promise<void>;
  /** Deregister an agent by name. HTTP 404 is silently ignored. */
  deregister(name: string): Promise<void>;
  /** Send a single heartbeat POST. Errors are logged, not thrown. */
  heartbeat(name: string): Promise<void>;
  /** Resolve an agent by name. Throws if not found. */
  resolve(name: string): Promise<ResolvedAgent>;
  /** List all registered agents. Throws on network failure. */
  list(): Promise<ResolvedAgent[]>;
  /** Clean up any internal resources (e.g. a heartbeat interval). */
  dispose(): Promise<void>;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Creates a RegistryClient pointed at the given registry URL.
 *
 * Throws synchronously if `config.url` is absent or not a valid HTTP/HTTPS URL.
 * Trailing slash on the URL is stripped automatically (AC-32).
 *
 * @param config - Registry connection configuration
 * @returns RegistryClient implementation
 *
 * @throws {Error} EC-9: config.url is absent or malformed
 */
export function createRegistryClient(
  config: RegistryClientConfig
): RegistryClient {
  // EC-9: validate url presence
  if (!config.url || config.url.trim() === '') {
    throw new Error('registry client requires a url');
  }

  // EC-9: validate url structure
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(config.url);
  } catch {
    throw new Error(`registry client url is malformed: "${config.url}"`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `registry client url must use http or https: "${config.url}"`
    );
  }

  // AC-32: strip trailing slash once so all URL construction is consistent.
  const baseUrl = config.url.replace(/\/+$/, '');

  // Build request headers, including optional Authorization bearer token.
  function buildHeaders(
    extra?: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (config.auth) {
      headers['Authorization'] = `Bearer ${config.auth}`;
    }
    return headers;
  }

  // Map a non-ok response to an error for shared non-heartbeat error handling.
  async function mapHttpError(res: Response, name?: string): Promise<never> {
    if (res.status === 401) {
      throw new Error('unauthorized — check auth token');
    }
    if (res.status === 409) {
      throw new Error('agent already registered');
    }
    if (res.status === 404 && name !== undefined) {
      throw new Error(`agent not found: ${name}`);
    }
    throw new Error('registry connection failed');
  }

  // Disposed flag: after dispose(), heartbeat() becomes a no-op.
  let disposed = false;

  return {
    async register(payload: RegistrationPayload): Promise<void> {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/register`, {
          method: 'POST',
          headers: buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
      } catch {
        throw new Error('registry connection failed');
      }
      if (!res.ok) {
        await mapHttpError(res);
      }
    },

    async deregister(name: string): Promise<void> {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/${name}`, {
          method: 'DELETE',
          headers: buildHeaders(),
        });
      } catch {
        throw new Error('registry connection failed');
      }
      // EC-12: 404 means agent is already gone — silently ignored.
      if (res.status === 404) return;
      if (!res.ok) {
        await mapHttpError(res);
      }
    },

    async heartbeat(name: string): Promise<void> {
      // AC-28/AC-31: no-op after dispose().
      if (disposed) return;
      try {
        const res = await fetch(`${baseUrl}/${name}/heartbeat`, {
          method: 'POST',
          headers: buildHeaders(),
        });
        if (!res.ok) {
          console.warn(
            `[registry-client] heartbeat failed for "${name}": HTTP ${res.status}`
          );
        }
      } catch (err) {
        // EC-13: log errors, never throw.
        console.warn(
          `[registry-client] heartbeat network error for "${name}":`,
          err
        );
      }
    },

    async resolve(name: string): Promise<ResolvedAgent> {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/${name}`, {
          method: 'GET',
          headers: buildHeaders(),
        });
      } catch {
        throw new Error('registry connection failed');
      }
      // EC-14: 404 → throw with agent name.
      if (res.status === 404) {
        throw new Error(`agent not found: ${name}`);
      }
      if (!res.ok) {
        await mapHttpError(res);
      }
      return res.json() as Promise<ResolvedAgent>;
    },

    async list(): Promise<ResolvedAgent[]> {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/`, {
          method: 'GET',
          headers: buildHeaders(),
        });
      } catch {
        // EC-15: network error → throw.
        throw new Error('registry connection failed');
      }
      if (!res.ok) {
        await mapHttpError(res);
      }
      return res.json() as Promise<ResolvedAgent[]>;
    },

    async dispose(): Promise<void> {
      // AC-31: safe to call before any heartbeat fires.
      // AC-28: after this, heartbeat() becomes a no-op.
      disposed = true;
    },
  };
}
