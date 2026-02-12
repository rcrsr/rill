/**
 * Tests for fetch request module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeRequest,
  buildRequest,
  createSemaphore,
  type FetchExtensionConfig,
  type FetchOptions,
} from '../../src/ext/fetch/request.js';
import { RuntimeError } from '../../src/error-classes.js';

// ============================================================
// MOCK FETCH
// ============================================================

type MockResponse = {
  status: number;
  headers?: Record<string, string>;
  body: string;
  delay?: number;
};

let mockResponses: MockResponse[] = [];
let fetchCallCount = 0;

function mockFetch(_url: string, options?: FetchOptions): Promise<Response> {
  fetchCallCount++;

  const mockResponse = mockResponses.shift();
  if (!mockResponse) {
    throw new TypeError('Network error: no mock response');
  }

  const delay = mockResponse.delay ?? 0;
  const signal = options?.signal;

  return new Promise((resolve, reject) => {
    // Check if already aborted
    if (signal?.aborted) {
      const abortError = new Error('AbortError: The operation was aborted');
      abortError.name = 'AbortError';
      reject(abortError);
      return;
    }

    // Set up abort listener
    const abortHandler = () => {
      const abortError = new Error('AbortError: The operation was aborted');
      abortError.name = 'AbortError';
      reject(abortError);
    };
    signal?.addEventListener('abort', abortHandler);

    setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);

      // Check again in case aborted during delay
      if (signal?.aborted) {
        const abortError = new Error('AbortError: The operation was aborted');
        abortError.name = 'AbortError';
        reject(abortError);
        return;
      }

      const headers = new Headers(mockResponse.headers ?? {});
      resolve({
        ok: mockResponse.status >= 200 && mockResponse.status < 300,
        status: mockResponse.status,
        headers,
        text: async () => mockResponse.body,
        json: async () => JSON.parse(mockResponse.body),
      } as Response);
    }, delay);
  });
}

beforeEach(() => {
  mockResponses = [];
  fetchCallCount = 0;
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// TEST CONFIGURATION
// ============================================================

const testConfig: FetchExtensionConfig = {
  baseUrl: 'https://api.example.com',
  endpoints: {
    getUser: {
      path: '/users/:id',
      method: 'GET',
      args: [
        { name: 'id', location: 'path' },
        { name: 'include', location: 'query' },
      ],
    },
    createUser: {
      path: '/users',
      method: 'POST',
      args: [{ name: 'data', location: 'body' }],
      headers: { 'X-Custom': 'value' },
      responseShape: 'full',
    },
    updateUser: {
      path: '/users/:id',
      method: 'PUT',
      args: [
        { name: 'id', location: 'path' },
        { name: 'data', location: 'body' },
        { name: 'auth', location: 'header' },
      ],
    },
  },
  timeout: 1000,
  retryLimit: 2,
  retryDelay: 50,
};

// ============================================================
// URL BUILDING TESTS
// ============================================================

describe('buildRequest', () => {
  it('builds URL with path parameters', () => {
    const { url } = buildRequest(testConfig, 'getUser', { id: '123' });
    expect(url).toBe('https://api.example.com/users/123');
  });

  it('builds URL with query parameters', () => {
    const { url } = buildRequest(testConfig, 'getUser', {
      id: '123',
      include: 'profile',
    });
    expect(url).toBe('https://api.example.com/users/123?include=profile');
  });

  it('includes method in options', () => {
    const { options } = buildRequest(testConfig, 'getUser', { id: '123' });
    expect(options.method).toBe('GET');
  });

  it('includes body for POST request', () => {
    const { options } = buildRequest(testConfig, 'createUser', {
      data: { name: 'John' },
    });
    expect(options.body).toBe('{"name":"John"}');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('merges endpoint headers', () => {
    const { options } = buildRequest(testConfig, 'createUser', {
      data: { name: 'John' },
    });
    expect(options.headers['X-Custom']).toBe('value');
  });

  it('includes header arguments', () => {
    const { options } = buildRequest(testConfig, 'updateUser', {
      id: '123',
      data: { name: 'John' },
      auth: 'Bearer token',
    });
    expect(options.headers.auth).toBe('Bearer token');
  });

  it('returns response shape from endpoint config', () => {
    const { responseShape } = buildRequest(testConfig, 'createUser', {
      data: {},
    });
    expect(responseShape).toBe('full');
  });

  it('defaults response shape to body', () => {
    const { responseShape } = buildRequest(testConfig, 'getUser', {
      id: '123',
    });
    expect(responseShape).toBe('body');
  });

  it('preserves base URL path when endpoint path starts with /', () => {
    const config: FetchExtensionConfig = {
      baseUrl: 'https://newsapi.org/v2',
      endpoints: {
        top_headlines: {
          path: '/top-headlines',
          method: 'GET',
          args: [{ name: 'country', location: 'query' }],
        },
      },
    };
    const { url } = buildRequest(config, 'top_headlines', { country: 'us' });
    expect(url).toBe('https://newsapi.org/v2/top-headlines?country=us');
  });

  it('handles base URL with trailing slash', () => {
    const config: FetchExtensionConfig = {
      baseUrl: 'https://newsapi.org/v2/',
      endpoints: {
        top_headlines: {
          path: '/top-headlines',
          method: 'GET',
          args: [],
        },
      },
    };
    const { url } = buildRequest(config, 'top_headlines', {});
    expect(url).toBe('https://newsapi.org/v2/top-headlines');
  });
});

// ============================================================
// RESPONSE PARSING TESTS
// ============================================================

describe('executeRequest - response parsing', () => {
  it('parses JSON response body', async () => {
    mockResponses = [
      {
        status: 200,
        body: '{"id": 123, "name": "John"}',
      },
    ];

    const result = await executeRequest(
      'https://api.example.com/users/123',
      { method: 'GET', headers: {} },
      testConfig,
      'api',
      'body'
    );

    expect(result).toEqual({ id: 123, name: 'John' });
  });

  it('returns full response with status and headers', async () => {
    mockResponses = [
      {
        status: 201,
        headers: { 'X-Request-Id': 'abc123' },
        body: '{"id": 123}',
      },
    ];

    const result = await executeRequest(
      'https://api.example.com/users',
      { method: 'POST', headers: {} },
      testConfig,
      'api',
      'full'
    );

    expect(result).toMatchObject({
      status: 201,
      headers: { 'x-request-id': 'abc123' },
      body: { id: 123 },
    });
  });

  it('throws RuntimeError for invalid JSON (EC-13)', async () => {
    mockResponses = [
      {
        status: 200,
        body: 'not json',
      },
      {
        status: 200,
        body: 'not json',
      },
    ];

    await expect(
      executeRequest(
        'https://api.example.com/users/123',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body'
      )
    ).rejects.toThrow(RuntimeError);

    try {
      await executeRequest(
        'https://api.example.com/users/123',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      if (error instanceof RuntimeError) {
        expect(error.errorId).toBe('RILL-R026');
        expect(error.message).toContain('invalid JSON response');
      }
    }
  });
});

// ============================================================
// ERROR HANDLING TESTS
// ============================================================

describe('executeRequest - HTTP errors', () => {
  it('throws RuntimeError for HTTP 4xx (EC-9)', async () => {
    mockResponses = [
      {
        status: 404,
        body: 'Not Found',
      },
      {
        status: 404,
        body: 'Not Found',
      },
    ];

    await expect(
      executeRequest(
        'https://api.example.com/users/999',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body'
      )
    ).rejects.toThrow(RuntimeError);

    try {
      await executeRequest(
        'https://api.example.com/users/999',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      if (error instanceof RuntimeError) {
        expect(error.errorId).toBe('RILL-R022');
        expect(error.message).toContain('HTTP 404');
        expect(error.message).toContain('Not Found');
      }
    }
  });

  it('throws RuntimeError for HTTP 5xx after retries (EC-10)', async () => {
    mockResponses = [
      { status: 503, body: 'Service Unavailable' },
      { status: 503, body: 'Service Unavailable' },
      { status: 503, body: 'Service Unavailable' },
      { status: 503, body: 'Service Unavailable' },
      { status: 503, body: 'Service Unavailable' },
      { status: 503, body: 'Service Unavailable' },
    ];

    await expect(
      executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body'
      )
    ).rejects.toThrow(RuntimeError);

    try {
      await executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      if (error instanceof RuntimeError) {
        expect(error.errorId).toBe('RILL-R023');
        expect(error.message).toContain('HTTP 503');
        expect(error.message).toContain('after 2 retries');
      }
    }

    expect(fetchCallCount).toBe(6); // (Initial + 2 retries) × 2 calls
  });

  it('throws RuntimeError for network error (EC-12)', async () => {
    // No mock responses, will trigger TypeError
    await expect(
      executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body'
      )
    ).rejects.toThrow(RuntimeError);

    try {
      await executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      if (error instanceof RuntimeError) {
        expect(error.errorId).toBe('RILL-R025');
        expect(error.message).toContain('network error');
      }
    }

    expect(fetchCallCount).toBe(6); // (Initial + 2 retries) × 2 calls
  });
});

// ============================================================
// RETRY LOGIC TESTS
// ============================================================

describe('executeRequest - retry logic', () => {
  it('retries on HTTP 503', async () => {
    mockResponses = [
      { status: 503, body: 'Service Unavailable' },
      { status: 200, body: '{"success": true}' },
    ];

    const result = await executeRequest(
      'https://api.example.com/users',
      { method: 'GET', headers: {} },
      testConfig,
      'api',
      'body'
    );

    expect(result).toEqual({ success: true });
    expect(fetchCallCount).toBe(2);
  });

  it('retries on HTTP 429 with Retry-After header', async () => {
    mockResponses = [
      {
        status: 429,
        headers: { 'Retry-After': '1' },
        body: 'Too Many Requests',
      },
      { status: 200, body: '{"success": true}' },
    ];

    const start = Date.now();
    const result = await executeRequest(
      'https://api.example.com/users',
      { method: 'GET', headers: {} },
      testConfig,
      'api',
      'body'
    );
    const elapsed = Date.now() - start;

    expect(result).toEqual({ success: true });
    expect(fetchCallCount).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(998); // Respects Retry-After (with 2ms tolerance)
  });

  it('uses exponential backoff for network errors', async () => {
    let callCount = 0;
    const callTimes: number[] = [];

    global.fetch = (async () => {
      callTimes.push(Date.now());
      callCount++;
      if (callCount < 3) {
        throw new TypeError('Network error');
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => '{"success": true}',
        json: async () => ({ success: true }),
      } as Response;
    }) as unknown as typeof fetch;

    await executeRequest(
      'https://api.example.com/users',
      { method: 'GET', headers: {} },
      testConfig,
      'api',
      'body'
    );

    expect(callCount).toBe(3);
    // Check exponential backoff: 50ms, 100ms (with 2ms tolerance for timer jitter)
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(48);
    expect(callTimes[2]! - callTimes[1]!).toBeGreaterThanOrEqual(98);
  });

  it('does not retry HTTP 4xx errors (except 429)', async () => {
    mockResponses = [{ status: 400, body: 'Bad Request' }];

    await expect(
      executeRequest(
        'https://api.example.com/users',
        { method: 'POST', headers: {} },
        testConfig,
        'api',
        'body'
      )
    ).rejects.toThrow(RuntimeError);

    expect(fetchCallCount).toBe(1); // No retries
  });
});

// ============================================================
// TIMEOUT TESTS
// ============================================================

describe('executeRequest - timeout', () => {
  it('throws RuntimeError on timeout (EC-11)', async () => {
    mockResponses = [
      { status: 200, body: '{"success": true}', delay: 2000 },
      { status: 200, body: '{"success": true}', delay: 2000 },
    ];

    const shortTimeoutConfig = { ...testConfig, timeout: 100 };

    await expect(
      executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        shortTimeoutConfig,
        'api',
        'body'
      )
    ).rejects.toThrow(RuntimeError);

    try {
      await executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        shortTimeoutConfig,
        'api',
        'body'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      if (error instanceof RuntimeError) {
        expect(error.errorId).toBe('RILL-R024');
        expect(error.message).toContain('request timeout');
        expect(error.message).toContain('100ms');
      }
    }
  });
});

// ============================================================
// CONCURRENCY TESTS
// ============================================================

describe('createSemaphore', () => {
  it('creates semaphore with max concurrent limit', () => {
    const semaphore = createSemaphore(5);
    expect(semaphore).toBeDefined();
  });

  it('returns undefined when maxConcurrent not set', () => {
    const semaphore = createSemaphore(undefined);
    expect(semaphore).toBeUndefined();
  });

  it('returns undefined when maxConcurrent is 0', () => {
    const semaphore = createSemaphore(0);
    expect(semaphore).toBeUndefined();
  });
});

describe('executeRequest - concurrency control', () => {
  it('limits concurrent requests with semaphore', async () => {
    const semaphore = createSemaphore(2);
    let activeCalls = 0;
    let maxActiveCalls = 0;

    global.fetch = (async () => {
      activeCalls++;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 50));
      activeCalls--;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => '{"success": true}',
        json: async () => ({ success: true }),
      } as Response;
    }) as unknown as typeof fetch;

    // Launch 5 concurrent requests
    await Promise.all([
      executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body',
        semaphore
      ),
      executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body',
        semaphore
      ),
      executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body',
        semaphore
      ),
      executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body',
        semaphore
      ),
      executeRequest(
        'https://api.example.com/users',
        { method: 'GET', headers: {} },
        testConfig,
        'api',
        'body',
        semaphore
      ),
    ]);

    expect(maxActiveCalls).toBeLessThanOrEqual(2);
  });
});
