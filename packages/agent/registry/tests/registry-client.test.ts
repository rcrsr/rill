import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRegistryClient,
  type RegistryClient,
  type RegistrationPayload,
  type ResolvedAgent,
} from '../src/index.js';

// ============================================================
// MOCK FETCH
// ============================================================

type MockCall = {
  url: string;
  options: Record<string, unknown> | undefined;
};

type MockResponse = {
  status: number;
  body: unknown;
};

let mockResponses: MockResponse[] = [];
let mockCalls: MockCall[] = [];

function mockFetch(
  url: string,
  options?: Record<string, unknown>
): Promise<Response> {
  mockCalls.push({ url, options });

  const mockResponse = mockResponses.shift();
  if (!mockResponse) {
    return Promise.reject(new TypeError('Network error: no mock response'));
  }

  const body = JSON.stringify(mockResponse.body);
  const response = {
    ok: mockResponse.status >= 200 && mockResponse.status < 300,
    status: mockResponse.status,
    json: async () => JSON.parse(body) as unknown,
    text: async () => body,
  } as Response;

  return Promise.resolve(response);
}

beforeEach(() => {
  mockResponses = [];
  mockCalls = [];
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// FIXTURES
// ============================================================

const sampleAgent: ResolvedAgent = {
  name: 'parser',
  version: '1.0.0',
  endpoint: 'http://parser:8080',
  status: 'active',
  lastHeartbeat: '2026-02-26T00:00:00.000Z',
};

const sampleCard = {
  name: 'parser',
  description: 'A parsing agent',
  version: '1.0.0',
  url: 'http://parser:8080',
  capabilities: { streaming: false, pushNotifications: false },
  skills: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['application/json'],
};

const samplePayload: RegistrationPayload = {
  name: 'parser',
  version: '1.0.0',
  endpoint: 'http://parser:8080',
  card: sampleCard,
  dependencies: [],
};

describe('register() (AC-23)', () => {
  it('sends POST to ${baseUrl}/register', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.register(samplePayload);
    expect(mockCalls[0]?.url).toBe('http://registry:8080/register');
    expect(mockCalls[0]?.options?.method).toBe('POST');
  });

  it('sets Content-Type: application/json header', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.register(samplePayload);
    const headers = mockCalls[0]?.options?.headers as Record<string, string>;
    expect(headers?.['Content-Type']).toBe('application/json');
  });

  it('sends JSON-serialized RegistrationPayload as body', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.register(samplePayload);
    expect(mockCalls[0]?.options?.body).toBe(JSON.stringify(samplePayload));
  });

  it('includes Authorization header when auth is configured', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({
      url: 'http://registry:8080',
      auth: 'secret-token',
    });
    await client.register(samplePayload);
    const headers = mockCalls[0]?.options?.headers as Record<string, string>;
    expect(headers?.['Authorization']).toBe('Bearer secret-token');
  });

  it('omits Authorization header when auth is not configured', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.register(samplePayload);
    const headers = mockCalls[0]?.options?.headers as Record<string, string>;
    expect(headers?.['Authorization']).toBeUndefined();
  });
});

describe('deregister() (AC-24)', () => {
  it('sends DELETE to ${baseUrl}/${name}', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.deregister('parser');
    expect(mockCalls[0]?.url).toBe('http://registry:8080/parser');
    expect(mockCalls[0]?.options?.method).toBe('DELETE');
  });

  it('resolves without error on HTTP 200', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await expect(client.deregister('parser')).resolves.toBeUndefined();
  });

  it('silently ignores HTTP 404', async () => {
    mockResponses.push({ status: 404, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await expect(client.deregister('parser')).resolves.toBeUndefined();
  });

  it('includes Authorization header when auth is configured', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({
      url: 'http://registry:8080',
      auth: 'secret-token',
    });
    await client.deregister('parser');
    const headers = mockCalls[0]?.options?.headers as Record<string, string>;
    expect(headers?.['Authorization']).toBe('Bearer secret-token');
  });
});

describe('heartbeat() (AC-25)', () => {
  it('sends POST to ${baseUrl}/${name}/heartbeat', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.heartbeat('parser');
    expect(mockCalls[0]?.url).toBe('http://registry:8080/parser/heartbeat');
    expect(mockCalls[0]?.options?.method).toBe('POST');
  });

  it('resolves without error on HTTP 200', async () => {
    mockResponses.push({ status: 200, body: null });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await expect(client.heartbeat('parser')).resolves.toBeUndefined();
  });

  it('resolves immediately without HTTP call after dispose() (AC-28)', async () => {
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.dispose();
    await expect(client.heartbeat('parser')).resolves.toBeUndefined();
    expect(mockCalls).toHaveLength(0);
  });
});

describe('resolve() (AC-26)', () => {
  it('sends GET to ${baseUrl}/${name}', async () => {
    mockResponses.push({ status: 200, body: sampleAgent });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.resolve('parser');
    expect(mockCalls[0]?.url).toBe('http://registry:8080/parser');
    expect(mockCalls[0]?.options?.method).toBe('GET');
  });

  it('returns parsed ResolvedAgent from response JSON', async () => {
    mockResponses.push({ status: 200, body: sampleAgent });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    const result = await client.resolve('parser');
    expect(result).toEqual(sampleAgent);
  });

  it('includes Authorization header when auth is configured', async () => {
    mockResponses.push({ status: 200, body: sampleAgent });
    const client = createRegistryClient({
      url: 'http://registry:8080',
      auth: 'secret-token',
    });
    await client.resolve('parser');
    const headers = mockCalls[0]?.options?.headers as Record<string, string>;
    expect(headers?.['Authorization']).toBe('Bearer secret-token');
  });
});

describe('list() (AC-27)', () => {
  it('sends GET to ${baseUrl}/ (root with trailing slash)', async () => {
    mockResponses.push({ status: 200, body: [sampleAgent] });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.list();
    expect(mockCalls[0]?.url).toBe('http://registry:8080/');
    expect(mockCalls[0]?.options?.method).toBe('GET');
  });

  it('returns array of ResolvedAgent from response JSON', async () => {
    mockResponses.push({ status: 200, body: [sampleAgent] });
    const client = createRegistryClient({ url: 'http://registry:8080' });
    const result = await client.list();
    expect(result).toEqual([sampleAgent]);
  });

  it('includes Authorization header when auth is configured', async () => {
    mockResponses.push({ status: 200, body: [] });
    const client = createRegistryClient({
      url: 'http://registry:8080',
      auth: 'secret-token',
    });
    await client.list();
    const headers = mockCalls[0]?.options?.headers as Record<string, string>;
    expect(headers?.['Authorization']).toBe('Bearer secret-token');
  });
});

describe('dispose() (AC-28)', () => {
  it('resolves without error', async () => {
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await expect(client.dispose()).resolves.toBeUndefined();
  });

  it('prevents subsequent heartbeat() calls from making HTTP requests', async () => {
    const client = createRegistryClient({ url: 'http://registry:8080' });
    await client.dispose();
    await client.heartbeat('parser');
    await client.heartbeat('parser');
    expect(mockCalls).toHaveLength(0);
  });
});

// ============================================================
// ERROR CASES
// ============================================================

describe('error cases', () => {
  describe('register() errors (EC-10, EC-11, AC-30)', () => {
    it('throws with "agent already registered" on HTTP 409 (EC-10, AC-30)', async () => {
      mockResponses.push({ status: 409, body: null });
      const client = createRegistryClient({ url: 'http://registry:8080' });
      await expect(client.register(samplePayload)).rejects.toThrow(
        'agent already registered'
      );
    });

    it('throws with "registry connection failed" on network error (EC-11)', async () => {
      vi.stubGlobal('fetch', () =>
        Promise.reject(new TypeError('Failed to fetch'))
      );
      const client = createRegistryClient({ url: 'http://registry:8080' });
      await expect(client.register(samplePayload)).rejects.toThrow(
        'registry connection failed'
      );
    });
  });

  describe('heartbeat() errors (EC-13, AC-25)', () => {
    it('resolves without throwing on HTTP 500 and calls console.warn', async () => {
      mockResponses.push({ status: 500, body: null });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = createRegistryClient({ url: 'http://registry:8080' });
      await expect(client.heartbeat('parser')).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('resolves without throwing on network error and calls console.warn', async () => {
      vi.stubGlobal('fetch', () =>
        Promise.reject(new TypeError('Failed to fetch'))
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = createRegistryClient({ url: 'http://registry:8080' });
      await expect(client.heartbeat('parser')).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('resolve() errors (EC-14, AC-29)', () => {
    it('throws with agent name in message on HTTP 404 (EC-14, AC-29)', async () => {
      mockResponses.push({ status: 404, body: null });
      const client = createRegistryClient({ url: 'http://registry:8080' });
      await expect(client.resolve('missing-agent')).rejects.toThrow(
        'agent not found: missing-agent'
      );
    });

    it('throws with "registry connection failed" on network error', async () => {
      vi.stubGlobal('fetch', () =>
        Promise.reject(new TypeError('Failed to fetch'))
      );
      const client = createRegistryClient({ url: 'http://registry:8080' });
      await expect(client.resolve('missing-agent')).rejects.toThrow(
        'registry connection failed'
      );
    });
  });

  describe('list() errors (EC-15)', () => {
    it('throws with "registry connection failed" on network error', async () => {
      vi.stubGlobal('fetch', () =>
        Promise.reject(new TypeError('Failed to fetch'))
      );
      const client = createRegistryClient({ url: 'http://registry:8080' });
      await expect(client.list()).rejects.toThrow('registry connection failed');
    });
  });
});

// ============================================================
// BOUNDARY CONDITIONS
// ============================================================

describe('boundary conditions', () => {
  describe('AC-32: URL normalization', () => {
    it('strips trailing slash so register() does not produce double slash', async () => {
      mockResponses.push({ status: 200, body: null });
      const client = createRegistryClient({
        url: 'http://registry:8080/api/registry/',
      });
      await client.register(samplePayload);
      expect(mockCalls[0]?.url).toBe(
        'http://registry:8080/api/registry/register'
      );
    });
  });

  describe('heartbeat after dispose()', () => {
    it('resolves immediately without calling fetch (additional EC-13 path)', async () => {
      const client = createRegistryClient({ url: 'http://registry:8080' });
      await client.dispose();
      await expect(client.heartbeat('parser')).resolves.toBeUndefined();
      expect(mockCalls).toHaveLength(0);
    });
  });
});

describe('createRegistryClient', () => {
  describe('EC-9: config.url validation', () => {
    it('throws synchronously when url is absent (empty string)', () => {
      expect(() => createRegistryClient({ url: '' })).toThrow(
        'registry client requires a url'
      );
    });

    it('throws synchronously when url is whitespace only', () => {
      expect(() => createRegistryClient({ url: '   ' })).toThrow(
        'registry client requires a url'
      );
    });

    it('throws synchronously when url is not a valid URL', () => {
      expect(() => createRegistryClient({ url: 'not-a-url' })).toThrow(
        'registry client url is malformed'
      );
    });

    it('throws synchronously when url uses an unsupported protocol', () => {
      expect(() =>
        createRegistryClient({ url: 'ftp://registry:8080/api' })
      ).toThrow('registry client url must use http or https');
    });

    it('throws synchronously when url uses ws: protocol', () => {
      expect(() =>
        createRegistryClient({ url: 'ws://registry:8080/api' })
      ).toThrow('registry client url must use http or https');
    });
  });

  describe('IR-3: factory returns a RegistryClient', () => {
    it('returns an object when given a valid http url', () => {
      const client = createRegistryClient({
        url: 'http://registry:8080/api/registry',
      });
      expect(client).toBeTruthy();
    });

    it('returns an object when given a valid https url', () => {
      const client = createRegistryClient({
        url: 'https://registry.example.com/api',
      });
      expect(client).toBeTruthy();
    });

    it('returns a client with all required RegistryClient methods', () => {
      const client: RegistryClient = createRegistryClient({
        url: 'http://registry:8080/api/registry',
      });
      expect(typeof client.register).toBe('function');
      expect(typeof client.deregister).toBe('function');
      expect(typeof client.heartbeat).toBe('function');
      expect(typeof client.resolve).toBe('function');
      expect(typeof client.list).toBe('function');
      expect(typeof client.dispose).toBe('function');
    });

    it('accepts an optional auth token without throwing', () => {
      expect(() =>
        createRegistryClient({
          url: 'http://registry:8080/api/registry',
          auth: 'my-secret-token',
        })
      ).not.toThrow();
    });

    it('accepts url with trailing slash without throwing (AC-32)', () => {
      expect(() =>
        createRegistryClient({ url: 'http://registry:8080/api/registry/' })
      ).not.toThrow();
    });

    it('dispose resolves without error before any interval is set', async () => {
      const client = createRegistryClient({
        url: 'http://registry:8080/api/registry',
      });
      await expect(client.dispose()).resolves.toBeUndefined();
    });
  });
});
