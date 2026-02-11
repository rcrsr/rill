/**
 * Fetch Request Module
 * Handles URL building, retry logic, response parsing, and error handling
 */

import { RuntimeError } from '../../error-classes.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/** Response shape configuration */
export type ResponseShape = 'body' | 'full';

/** Location of argument in request */
export type ArgLocation = 'path' | 'query' | 'header' | 'body';

/** Argument definition for endpoint */
export interface EndpointArg {
  readonly name: string;
  readonly location: ArgLocation;
  readonly required?: boolean | undefined;
}

/** Internal endpoint configuration for request building */
export interface InternalEndpointConfig {
  readonly path: string;
  readonly method: string;
  readonly args?: EndpointArg[] | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly responseShape?: ResponseShape | undefined;
}

/** Extension configuration */
export interface FetchExtensionConfig {
  readonly baseUrl: string;
  readonly endpoints: Record<string, InternalEndpointConfig>;
  readonly headers?:
    | Record<string, string>
    | (() => Record<string, string>)
    | undefined;
  readonly timeout?: number | undefined;
  readonly retryLimit?: number | undefined;
  readonly retryDelay?: number | undefined;
  readonly maxConcurrent?: number | undefined;
}

/** Full response shape */
export interface FullResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Fetch request options (compatible with fetch API) */
export interface FetchOptions {
  readonly method: string;
  readonly headers: Record<string, string>;
  body?: string | undefined;
  signal?: AbortSignal | undefined;
}

// ============================================================
// CONCURRENCY SEMAPHORE
// ============================================================

/**
 * Simple semaphore for limiting concurrent requests.
 * Queues requests when limit is reached.
 */
class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

// ============================================================
// URL BUILDING
// ============================================================

/**
 * Interpolate path parameters in URL pattern.
 * Replaces `:param` placeholders with values from pathArgs.
 *
 * @param pattern - URL pattern with :param placeholders
 * @param pathArgs - Map of parameter names to values
 * @returns Interpolated URL path
 *
 * @example
 * interpolatePathParams('/users/:id/posts/:postId', { id: '123', postId: '456' })
 * // Returns: '/users/123/posts/456'
 */
function interpolatePathParams(
  pattern: string,
  pathArgs: Map<string, string>
): string {
  return pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, paramName) => {
    const value = pathArgs.get(paramName);
    if (value === undefined) {
      throw new TypeError(`Missing path parameter: ${paramName}`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * Build query string from query arguments.
 *
 * @param queryArgs - Map of query parameter names to values
 * @returns Query string (without leading ?)
 */
function buildQueryString(queryArgs: Map<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of queryArgs) {
    params.append(key, value);
  }
  return params.toString();
}

/**
 * Build full URL from base, path pattern, and arguments.
 *
 * @param baseUrl - Base URL
 * @param pathPattern - URL path pattern with :param placeholders
 * @param pathArgs - Path parameter values
 * @param queryArgs - Query parameter values
 * @returns Complete URL
 */
function buildUrl(
  baseUrl: string,
  pathPattern: string,
  pathArgs: Map<string, string>,
  queryArgs: Map<string, string>
): string {
  const path = interpolatePathParams(pathPattern, pathArgs);
  const url = new URL(path, baseUrl);
  const queryString = buildQueryString(queryArgs);
  if (queryString) {
    url.search = queryString;
  }
  return url.toString();
}

// ============================================================
// HEADER HANDLING
// ============================================================

/**
 * Flatten multi-value headers to string-to-string dict.
 * Multiple values joined with `, `.
 *
 * @param headers - Headers object from fetch Response
 * @returns Flattened headers dict
 */
function flattenHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Resolve dynamic headers (call function if provided).
 *
 * @param headers - Static headers or function returning headers
 * @returns Resolved headers dict
 */
function resolveHeaders(
  headers: Record<string, string> | (() => Record<string, string>) | undefined
): Record<string, string> {
  if (!headers) return {};
  if (typeof headers === 'function') return headers();
  return headers;
}

/**
 * Merge headers with endpoint headers taking precedence.
 *
 * @param globalHeaders - Global extension headers
 * @param endpointHeaders - Endpoint-specific headers
 * @returns Merged headers dict
 */
function mergeHeaders(
  globalHeaders: Record<string, string>,
  endpointHeaders: Record<string, string> | undefined
): Record<string, string> {
  return { ...globalHeaders, ...(endpointHeaders || {}) };
}

// ============================================================
// RESPONSE PARSING
// ============================================================

/**
 * Parse response body as JSON.
 * Throws RuntimeError on invalid JSON.
 *
 * @param response - Fetch Response object
 * @param namespace - Extension namespace for error messages
 * @returns Parsed JSON body
 */
async function parseJsonResponse(
  response: Response,
  namespace: string
): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new RuntimeError('RILL-R026', `${namespace}: invalid JSON response`);
  }
}

/**
 * Build full response object with status, headers, and body.
 *
 * @param response - Fetch Response object
 * @param namespace - Extension namespace for error messages
 * @returns Full response object
 */
async function buildFullResponse(
  response: Response,
  namespace: string
): Promise<FullResponse> {
  const body = await parseJsonResponse(response, namespace);
  return {
    status: response.status,
    headers: flattenHeaders(response.headers),
    body,
  };
}

// ============================================================
// RETRY LOGIC
// ============================================================

/**
 * Check if status code should be retried.
 * Retry on: 429, 502, 503, 504
 *
 * @param status - HTTP status code
 * @returns true if status should be retried
 */
function shouldRetryStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Extract Retry-After header value in seconds.
 * Supports both delay-seconds and HTTP-date formats.
 *
 * @param response - Fetch Response object
 * @returns Retry delay in milliseconds, or null if not present
 */
function getRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;

  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

/**
 * Calculate exponential backoff delay.
 *
 * @param baseDelay - Base delay in milliseconds
 * @param attempt - Attempt number (0-indexed)
 * @returns Delay in milliseconds
 */
function calculateBackoff(baseDelay: number, attempt: number): number {
  return baseDelay * Math.pow(2, attempt);
}

/**
 * Sleep for specified duration.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// REQUEST EXECUTION
// ============================================================

/**
 * Execute HTTP request with retry logic.
 * Handles timeouts, network errors, and retries.
 *
 * @param url - Request URL
 * @param options - Fetch options
 * @param config - Extension configuration
 * @param namespace - Extension namespace for error messages
 * @param semaphore - Concurrency semaphore (optional)
 * @returns Response body or full response
 */
export async function executeRequest(
  url: string,
  options: FetchOptions,
  config: FetchExtensionConfig,
  namespace: string,
  responseShape: ResponseShape,
  semaphore?: Semaphore | undefined
): Promise<unknown> {
  const retryLimit = config.retryLimit ?? 3;
  const retryDelay = config.retryDelay ?? 100;
  const timeoutMs = config.timeout ?? 30000;

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= retryLimit) {
    try {
      // Acquire semaphore permit if concurrency control enabled
      if (semaphore) {
        await semaphore.acquire();
      }

      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          // Execute fetch request
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          } as any);

          clearTimeout(timeoutId);

          // Handle HTTP errors
          if (!response.ok) {
            const status = response.status;

            // 4xx errors (except 429) - no retry
            if (status >= 400 && status < 500 && status !== 429) {
              const body = await response.text();
              throw new RuntimeError(
                'RILL-R022',
                `${namespace}: HTTP ${status} — ${body}`
              );
            }

            // 5xx errors or 429 - retry
            if (shouldRetryStatus(status)) {
              if (attempt < retryLimit) {
                // Calculate retry delay
                let delay = calculateBackoff(retryDelay, attempt);

                // Respect Retry-After header for 429
                if (status === 429) {
                  const retryAfterMs = getRetryAfterMs(response);
                  if (retryAfterMs !== null) {
                    delay = retryAfterMs;
                  }
                }

                await sleep(delay);
                attempt++;
                continue;
              } else {
                // Max retries reached
                throw new RuntimeError(
                  'RILL-R023',
                  `${namespace}: HTTP ${status} after ${retryLimit} retries`
                );
              }
            }
          }

          // Success - parse response
          if (responseShape === 'full') {
            return await buildFullResponse(response, namespace);
          } else {
            return await parseJsonResponse(response, namespace);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } finally {
        // Release semaphore permit
        if (semaphore) {
          semaphore.release();
        }
      }
    } catch (error) {
      // Timeout - no retry
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RuntimeError(
          'RILL-R024',
          `${namespace}: request timeout (${timeoutMs}ms)`
        );
      }

      // Already formatted error - rethrow immediately
      if (error instanceof RuntimeError) {
        throw error;
      }

      // Network error - retry logic
      if (error instanceof TypeError) {
        if (attempt < retryLimit) {
          const delay = calculateBackoff(retryDelay, attempt);
          await sleep(delay);
          attempt++;
          lastError = error;
          continue;
        } else {
          throw new RuntimeError(
            'RILL-R025',
            `${namespace}: network error — ${error.message}`
          );
        }
      }

      // Unknown error
      lastError = error as Error;
      break;
    }
  }

  // Max retries reached for network errors
  throw new RuntimeError(
    'RILL-R025',
    `${namespace}: network error — ${lastError?.message ?? 'unknown error'}`
  );
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Create semaphore for concurrency control.
 *
 * @param maxConcurrent - Maximum concurrent requests
 * @returns Semaphore instance or undefined if no limit
 */
export function createSemaphore(
  maxConcurrent: number | undefined
): Semaphore | undefined {
  if (maxConcurrent && maxConcurrent > 0) {
    return new Semaphore(maxConcurrent);
  }
  return undefined;
}

/**
 * Build request from endpoint config and arguments.
 *
 * @param config - Extension configuration
 * @param endpointName - Endpoint name
 * @param args - Request arguments
 * @returns Request URL and options
 */
export function buildRequest(
  config: FetchExtensionConfig,
  endpointName: string,
  args: Record<string, unknown>
): { url: string; options: FetchOptions; responseShape: ResponseShape } {
  const endpoint = config.endpoints[endpointName];
  if (!endpoint) {
    throw new TypeError(`Unknown endpoint: ${endpointName}`);
  }

  // Categorize arguments by location
  const pathArgs = new Map<string, string>();
  const queryArgs = new Map<string, string>();
  const headerArgs: Record<string, string> = {};
  let bodyValue: unknown = null;

  for (const [argName, argValue] of Object.entries(args)) {
    const argDef = endpoint.args?.find((a) => a.name === argName);
    if (!argDef) continue;

    const stringValue =
      typeof argValue === 'string' ? argValue : String(argValue);

    switch (argDef.location) {
      case 'path':
        pathArgs.set(argName, stringValue);
        break;
      case 'query':
        queryArgs.set(argName, stringValue);
        break;
      case 'header':
        headerArgs[argName] = stringValue;
        break;
      case 'body':
        bodyValue = argValue;
        break;
    }
  }

  // Build URL
  const url = buildUrl(config.baseUrl, endpoint.path, pathArgs, queryArgs);

  // Resolve and merge headers
  const globalHeaders = resolveHeaders(config.headers);
  const allHeaders = mergeHeaders(globalHeaders, endpoint.headers);
  const finalHeaders = { ...allHeaders, ...headerArgs };

  // Build fetch options
  const options: FetchOptions = {
    method: endpoint.method,
    headers: finalHeaders,
  };

  if (bodyValue !== null) {
    options.body = JSON.stringify(bodyValue);
    finalHeaders['Content-Type'] = 'application/json';
  }

  return {
    url,
    options,
    responseShape: endpoint.responseShape ?? 'body',
  };
}
