/**
 * Fetch Extension Factory
 *
 * Creates host functions for HTTP requests based on endpoint configuration.
 * Scripts call endpoints with positional args or single dict argument.
 * All URLs are constructed from config - scripts cannot specify arbitrary URLs.
 */

import { RuntimeError } from '../../error-classes.js';
import type { ExtensionResult } from '../../runtime/ext/extensions.js';
import type { RillValue } from '../../runtime/core/values.js';
import {
  isDict,
  type HostFunctionDefinition,
} from '../../runtime/core/callable.js';
import {
  type FetchExtensionConfig,
  type InternalEndpointConfig,
  type EndpointArg,
  buildRequest,
  executeRequest,
  createSemaphore,
} from './request.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/** Parameter definition for endpoint */
export interface EndpointParam {
  readonly name: string;
  readonly type: 'string' | 'number' | 'bool' | 'dict';
  readonly required?: boolean | undefined;
  readonly location: 'path' | 'query' | 'body' | 'header';
  readonly defaultValue?: string | number | boolean | undefined;
}

/** Endpoint configuration with parameter declarations */
export interface EndpointConfig {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly params?: EndpointParam[] | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly body?: 'json' | 'form' | 'text' | undefined;
  readonly responseFormat?: 'json' | 'text' | undefined;
  readonly responseShape?: 'body' | 'full' | undefined;
  readonly description?: string | undefined;
}

/** Fetch extension configuration */
export interface FetchConfig {
  readonly baseUrl: string;
  readonly headers?:
    | Record<string, string>
    | (() => Record<string, string>)
    | undefined;
  readonly timeout?: number | undefined;
  readonly retries?: number | undefined;
  readonly retryDelay?: number | undefined;
  readonly maxConcurrent?: number | undefined;
  readonly responseFormat?: 'json' | 'text' | undefined;
  readonly responseShape?: 'body' | 'full' | undefined;
  readonly endpoints: Record<string, EndpointConfig>;
}

// ============================================================
// PARAMETER MAPPING
// ============================================================

/**
 * Convert EndpointParam to EndpointArg for request module.
 * Maps type-aware parameters to location-based arguments.
 *
 * @param param - Parameter definition with type information
 * @returns Argument definition for request builder
 */
function mapParamToArg(param: EndpointParam): EndpointArg {
  return {
    name: param.name,
    location: param.location,
    required: param.required ?? true, // Default to required per spec
  };
}

/**
 * Convert EndpointConfig to InternalEndpointConfig for request module.
 * Maps high-level endpoint config to request-compatible format.
 *
 * @param config - Public endpoint configuration
 * @returns Request-compatible endpoint configuration
 */
function mapEndpointConfig(config: EndpointConfig): InternalEndpointConfig {
  return {
    method: config.method,
    path: config.path,
    args: config.params?.map(mapParamToArg),
    headers: config.headers,
    responseShape: config.responseShape ?? 'body',
  };
}

// ============================================================
// ARGUMENT PROCESSING
// ============================================================

/**
 * Process arguments from positional or dict form.
 * Supports two calling conventions:
 * 1. Positional: endpoint(arg1, arg2, arg3)
 * 2. Dict: endpoint({name: value, ...})
 *
 * @param args - Raw arguments from call site
 * @param params - Parameter definitions
 * @param functionName - Function name for error messages
 * @returns Dict of argument name to value
 * @throws RuntimeError on missing required parameter (EC-8)
 */
function processArguments(
  args: RillValue[],
  params: readonly EndpointParam[],
  functionName: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Case 1: Single dict argument - extract named parameters
  const firstArg = args[0];
  if (args.length === 1 && firstArg !== undefined && isDict(firstArg)) {
    const argsDict = firstArg as Record<string, RillValue>;

    for (const param of params) {
      const value = argsDict[param.name];

      if (value === undefined) {
        // Check if parameter has default value
        if (param.defaultValue !== undefined) {
          result[param.name] = param.defaultValue;
        } else if (param.required !== false) {
          // EC-8: Missing required parameter
          throw new RuntimeError(
            'RILL-R001',
            `parameter "${param.name}" is required`,
            undefined,
            {
              functionName,
              paramName: param.name,
            }
          );
        }
      } else {
        result[param.name] = value;
      }
    }

    return result;
  }

  // Case 2: Positional arguments - map by position
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    if (param === undefined) continue;

    const value = args[i];

    if (value === undefined) {
      // Check if parameter has default value
      if (param.defaultValue !== undefined) {
        result[param.name] = param.defaultValue;
      } else if (param.required !== false) {
        // EC-8: Missing required parameter
        throw new RuntimeError(
          'RILL-R001',
          `parameter "${param.name}" is required`,
          undefined,
          {
            functionName,
            paramName: param.name,
          }
        );
      }
    } else {
      result[param.name] = value;
    }
  }

  return result;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create fetch extension with generated endpoint functions.
 *
 * Each endpoint in config becomes a host function.
 * Scripts call endpoints with positional args or single dict.
 * All URLs constructed from config - scripts cannot create arbitrary URLs.
 *
 * @param config - Fetch configuration with endpoints
 * @returns ExtensionResult with endpoint functions and introspection
 * @throws Error on invalid configuration
 *
 * @example
 * ```typescript
 * const api = createFetchExtension({
 *   baseUrl: 'https://api.example.com',
 *   endpoints: {
 *     getUser: {
 *       method: 'GET',
 *       path: '/users/:id',
 *       params: [
 *         { name: 'id', type: 'string', location: 'path' }
 *       ]
 *     }
 *   }
 * });
 * ```
 */
export function createFetchExtension(config: FetchConfig): ExtensionResult {
  // Apply defaults
  const timeout = config.timeout ?? 30000;
  const retries = config.retries ?? 0;
  const retryDelay = config.retryDelay ?? 1000;
  const defaultResponseShape = config.responseShape ?? 'body';

  // Create semaphore for concurrency control
  const semaphore = createSemaphore(config.maxConcurrent);

  // Track active requests for dispose()
  const activeControllers = new Set<AbortController>();

  // Convert config to request-compatible format
  const requestConfig: FetchExtensionConfig = {
    baseUrl: config.baseUrl,
    headers: config.headers,
    timeout,
    retryLimit: retries,
    retryDelay,
    maxConcurrent: config.maxConcurrent,
    endpoints: Object.fromEntries(
      Object.entries(config.endpoints).map(([name, endpointConfig]) => [
        name,
        mapEndpointConfig(endpointConfig),
      ])
    ),
  };

  // ============================================================
  // ENDPOINT FUNCTIONS
  // ============================================================

  const functions: Record<string, HostFunctionDefinition> = {};

  for (const [endpointName, endpointConfig] of Object.entries(
    config.endpoints
  )) {
    const params = endpointConfig.params ?? [];

    // Generate function for this endpoint
    const endpointFn = async (args: RillValue[]): Promise<RillValue> => {
      // Process arguments (positional or dict)
      const processedArgs = processArguments(args, params, endpointName);

      // Build request
      const { url, options, responseShape } = buildRequest(
        requestConfig,
        endpointName,
        processedArgs
      );

      // Create abort controller for this request
      const controller = new AbortController();
      activeControllers.add(controller);

      try {
        // Execute request
        const result = await executeRequest(
          url,
          { ...options, signal: controller.signal },
          requestConfig,
          endpointName,
          responseShape,
          semaphore
        );

        return result as RillValue;
      } finally {
        activeControllers.delete(controller);
      }
    };

    // Build parameter definitions for HostFunctionDefinition
    const hostParams = params.map((param) => {
      // Map EndpointParam type to HostFunctionParam type
      const type: 'string' | 'number' | 'bool' | 'dict' =
        param.type === 'bool' ? 'bool' : param.type;

      const hostParam: {
        name: string;
        type: 'string' | 'number' | 'bool' | 'dict';
        defaultValue?: string | number | boolean;
      } = {
        name: param.name,
        type,
      };

      if (param.defaultValue !== undefined) {
        hostParam.defaultValue = param.defaultValue;
      }

      return hostParam;
    });

    const returnType =
      (endpointConfig.responseShape ?? defaultResponseShape) === 'full'
        ? ('dict' as const)
        : ('any' as const);

    const hostFunctionDef: HostFunctionDefinition = {
      params: hostParams,
      fn: endpointFn,
      ...(endpointConfig.description !== undefined
        ? { description: endpointConfig.description }
        : {}),
      returnType,
    };

    functions[endpointName] = hostFunctionDef;
  }

  // ============================================================
  // INTROSPECTION FUNCTION
  // ============================================================

  /**
   * List all configured endpoints.
   * IR-13: Returns list with name, method, path, description.
   */
  const endpoints = async (): Promise<RillValue[]> => {
    const result: RillValue[] = [];

    for (const [name, endpointConfig] of Object.entries(config.endpoints)) {
      result.push({
        name,
        method: endpointConfig.method,
        path: endpointConfig.path,
        description: endpointConfig.description ?? '',
      });
    }

    return result;
  };

  functions['endpoints'] = {
    params: [],
    fn: endpoints,
    description: 'List configured endpoints',
    returnType: 'list',
  };

  // ============================================================
  // DISPOSAL
  // ============================================================

  /**
   * Abort all in-flight requests.
   * AC-8: dispose() aborts in-flight requests.
   */
  const dispose = (): void => {
    for (const controller of activeControllers) {
      controller.abort();
    }
    activeControllers.clear();
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const result: ExtensionResult = functions;
  result.dispose = dispose;
  return result;
}
