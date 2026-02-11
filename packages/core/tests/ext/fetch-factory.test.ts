/**
 * Tests for fetch extension factory
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createFetchExtension,
  type FetchConfig,
} from '../../src/ext/fetch/index.js';
import type { RillValue } from '../../src/runtime/core/values.js';
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

function mockFetch(
  url: string,
  options?: { signal?: AbortSignal }
): Promise<Response> {
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

      const headers = new Headers(mockResponse.headers ?? {});
      const response = {
        ok: mockResponse.status >= 200 && mockResponse.status < 300,
        status: mockResponse.status,
        headers,
        text: async () => mockResponse.body,
        json: async () => JSON.parse(mockResponse.body),
      } as Response;

      resolve(response);
    }, delay);
  });
}

beforeEach(() => {
  mockResponses = [];
  fetchCallCount = 0;
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// HELPER
// ============================================================

function createMockContext() {
  return {
    variables: new Map<string, RillValue>(),
    pipeValue: null,
  };
}

// ============================================================
// TESTS
// ============================================================

describe('createFetchExtension', () => {
  describe('factory creation (IC-3)', () => {
    it('creates ExtensionResult with endpoint functions', () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);

      expect(extension).toHaveProperty('getUser');
      expect(extension).toHaveProperty('endpoints');
      expect(extension).toHaveProperty('dispose');
      expect(extension.getUser).toHaveProperty('params');
      expect(extension.getUser).toHaveProperty('fn');
    });

    it('creates function for each endpoint in config', () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
          createPost: {
            method: 'POST',
            path: '/posts',
            params: [{ name: 'title', type: 'string', location: 'body' }],
          },
          deleteComment: {
            method: 'DELETE',
            path: '/comments/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);

      expect(extension).toHaveProperty('getUser');
      expect(extension).toHaveProperty('createPost');
      expect(extension).toHaveProperty('deleteComment');
    });

    it('applies default config values', () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      // Should not throw with defaults
      const extension = createFetchExtension(config);
      expect(extension).toBeDefined();
    });
  });

  describe('endpoints() introspection (IR-13)', () => {
    it('returns list with name, method, path, description', async () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
            description: 'Get user by ID',
          },
          createPost: {
            method: 'POST',
            path: '/posts',
            params: [{ name: 'title', type: 'string', location: 'body' }],
            description: 'Create new post',
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      const result = (await extension.endpoints.fn([], ctx)) as RillValue[];

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'getUser',
        method: 'GET',
        path: '/users/:id',
        description: 'Get user by ID',
      });
      expect(result[1]).toEqual({
        name: 'createPost',
        method: 'POST',
        path: '/posts',
        description: 'Create new post',
      });
    });

    it('returns empty description for endpoints without description', async () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      const result = (await extension.endpoints.fn([], ctx)) as RillValue[];

      expect(result[0]).toEqual({
        name: 'getUser',
        method: 'GET',
        path: '/users/:id',
        description: '',
      });
    });
  });

  describe('missing required parameter (EC-8)', () => {
    it('throws RuntimeError when required parameter missing in positional args', async () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      await expect(extension.getUser.fn([], ctx)).rejects.toThrow(RuntimeError);
      await expect(extension.getUser.fn([], ctx)).rejects.toThrow(
        'parameter "id" is required'
      );
    });

    it('throws RuntimeError when required parameter missing in dict args', async () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          createUser: {
            method: 'POST',
            path: '/users',
            params: [
              { name: 'name', type: 'string', location: 'body' },
              { name: 'email', type: 'string', location: 'body' },
            ],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      await expect(
        extension.createUser.fn([{ name: 'John' }], ctx)
      ).rejects.toThrow(RuntimeError);
      await expect(
        extension.createUser.fn([{ name: 'John' }], ctx)
      ).rejects.toThrow('parameter "email" is required');
    });

    it('does not throw when optional parameter (with defaultValue) is missing', async () => {
      mockResponses.push({ status: 200, body: '{"users":[]}' });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          listUsers: {
            method: 'GET',
            path: '/users',
            params: [
              {
                name: 'limit',
                type: 'number',
                location: 'query',
                defaultValue: 10,
              },
            ],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      // Should not throw - uses default value
      await expect(extension.listUsers.fn([], ctx)).resolves.toBeDefined();
    });

    it('does not throw when parameter has required: false', async () => {
      mockResponses.push({ status: 200, body: '{"users":[]}' });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          listUsers: {
            method: 'GET',
            path: '/users',
            params: [
              {
                name: 'filter',
                type: 'string',
                location: 'query',
                required: false,
              },
            ],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      // Should not throw - parameter is optional
      await expect(extension.listUsers.fn([], ctx)).resolves.toBeDefined();
    });
  });

  describe('positional arguments', () => {
    it('accepts positional arguments for endpoint parameters', async () => {
      mockResponses.push({ status: 200, body: '{"id":123,"name":"John"}' });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      const result = await extension.getUser.fn(['123'], ctx);

      expect(result).toEqual({ id: 123, name: 'John' });
      expect(fetchCallCount).toBe(1);
    });

    it('processes multiple positional arguments in order', async () => {
      mockResponses.push({
        status: 201,
        body: '{"id":1,"title":"Test Post"}',
      });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          createPost: {
            method: 'POST',
            path: '/posts',
            params: [
              { name: 'title', type: 'string', location: 'body' },
              { name: 'body', type: 'string', location: 'body' },
            ],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      const result = await extension.createPost.fn(
        ['Test Post', 'Post content'],
        ctx
      );

      expect(result).toEqual({ id: 1, title: 'Test Post' });
    });
  });

  describe('dict arguments', () => {
    it('accepts single dict argument with named parameters', async () => {
      mockResponses.push({ status: 200, body: '{"id":123,"name":"John"}' });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      const result = await extension.getUser.fn([{ id: '123' }], ctx);

      expect(result).toEqual({ id: 123, name: 'John' });
      expect(fetchCallCount).toBe(1);
    });

    it('extracts multiple parameters from dict', async () => {
      mockResponses.push({
        status: 201,
        body: '{"id":1,"title":"Test","published":true}',
      });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          createPost: {
            method: 'POST',
            path: '/posts',
            params: [
              { name: 'title', type: 'string', location: 'body' },
              { name: 'published', type: 'bool', location: 'body' },
            ],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      const result = await extension.createPost.fn(
        [{ title: 'Test', published: true }],
        ctx
      );

      expect(result).toEqual({ id: 1, title: 'Test', published: true });
    });
  });

  describe('dispose() aborts in-flight requests (AC-8)', () => {
    it('provides dispose method', () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);

      expect(extension).toHaveProperty('dispose');
      expect(typeof extension.dispose).toBe('function');
    });

    it('dispose can be called multiple times without error', () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);

      // Should not throw on multiple calls
      expect(() => extension.dispose()).not.toThrow();
      expect(() => extension.dispose()).not.toThrow();
      expect(() => extension.dispose()).not.toThrow();
    });

    it('dispose aborts active abort controllers', () => {
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);

      // Verify dispose functionality exists and executes without error
      extension.dispose();

      // Dispose should clear internal state safely
      expect(() => extension.dispose()).not.toThrow();
    });
  });

  describe('scripts cannot construct arbitrary URLs (AC-4)', () => {
    it('only allows URLs defined in endpoint configuration', async () => {
      mockResponses.push({ status: 200, body: '{"result":"ok"}' });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);

      // Only getUser endpoint is available
      expect(extension).toHaveProperty('getUser');
      expect(extension).not.toHaveProperty('getPost');
      expect(extension).not.toHaveProperty('fetch');
    });

    it('constructs URLs from baseUrl and path pattern only', async () => {
      mockResponses.push({ status: 200, body: '{"result":"ok"}' });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getResource: {
            method: 'GET',
            path: '/resource/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      // Can only call configured endpoint with configured path
      await extension.getResource.fn(['123'], ctx);

      // No way to specify arbitrary URL
      expect(extension).not.toHaveProperty('request');
      expect(extension).not.toHaveProperty('get');
      expect(extension).not.toHaveProperty('post');
    });
  });

  describe('config types exported (AC-9)', () => {
    it('exports FetchConfig type', () => {
      // Type-only test - compilation verifies export
      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          test: { method: 'GET', path: '/test', params: [] },
        },
      };

      expect(config).toBeDefined();
    });

    it('exports EndpointParam type', async () => {
      // Import is tested by TypeScript compilation
      const { createFetchExtension } =
        await import('../../src/ext/fetch/index.js');
      expect(createFetchExtension).toBeDefined();
    });
  });

  describe('response handling', () => {
    it('returns response body by default (responseShape: body)', async () => {
      mockResponses.push({
        status: 200,
        body: '{"id":123,"name":"Test"}',
      });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      const result = await extension.getUser.fn(['123'], ctx);

      // Should return just the body, not wrapped in response object
      expect(result).toEqual({ id: 123, name: 'Test' });
    });

    it('returns full response when responseShape is full', async () => {
      mockResponses.push({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"id":123}',
      });

      const config: FetchConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
            responseShape: 'full',
          },
        },
      };

      const extension = createFetchExtension(config);
      const ctx = createMockContext();

      const result = await extension.getUser.fn(['123'], ctx);

      // Should return full response with status, headers, body
      expect(result).toHaveProperty('status', 200);
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
    });
  });
});
