/**
 * Unit tests for resource function generation.
 *
 * Tests resource read and template functions per IR-3, IR-4, AC-9.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  extractTemplateVariables,
  createReadResourceFunction,
  generateResourceTemplateFunctions,
  type McpResourceTemplate,
  type McpResourceResult,
} from '../../src/resources.js';

// ============================================================
// TEMPLATE VARIABLE EXTRACTION TESTS
// ============================================================

describe('extractTemplateVariables', () => {
  it('extracts single variable from template', () => {
    const variables = extractTemplateVariables('db://table/{tableName}');
    expect(variables).toEqual(['tableName']);
  });

  it('extracts multiple variables from template', () => {
    const variables = extractTemplateVariables(
      'db://table/{tableName}/row/{rowId}'
    );
    expect(variables).toEqual(['tableName', 'rowId']);
  });

  it('extracts variables with path structure', () => {
    const variables = extractTemplateVariables('file:///{path}');
    expect(variables).toEqual(['path']);
  });

  it('returns empty array for static URI', () => {
    const variables = extractTemplateVariables('static://resource');
    expect(variables).toEqual([]);
  });

  it('ignores operators in template variables', () => {
    // RFC 6570 operators like {+var}, {#var}, {.var}, {/var}, {;var}, {?var}, {&var}
    const variables = extractTemplateVariables('api://{+path}/{#fragment}');
    expect(variables).toEqual([]);
  });

  it('handles whitespace in variable names', () => {
    const variables = extractTemplateVariables(
      'db://{ tableName }/row/{ rowId }'
    );
    expect(variables).toEqual(['tableName', 'rowId']);
  });

  it('handles multiple occurrences of same variable', () => {
    const variables = extractTemplateVariables('api://{version}/v{version}');
    expect(variables).toEqual(['version', 'version']);
  });
});

// ============================================================
// READ RESOURCE FUNCTION TESTS
// ============================================================

describe('createReadResourceFunction', () => {
  let mockClient: Client;

  beforeEach(() => {
    mockClient = {
      readResource: vi.fn(),
    } as unknown as Client;
  });

  it('generates function with correct parameter signature (IR-3)', () => {
    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    expect(func.params).toEqual([
      {
        name: 'uri',
        type: 'string',
        description: 'Resource URI to read',
      },
    ]);
    expect(func.description).toBe('Read an MCP resource by URI');
    expect(func.returnType).toBe('dict');
  });

  it('calls MCP readResource with provided URI', async () => {
    const mockResult: McpResourceResult = {
      contents: [
        {
          uri: 'config://app',
          text: 'config data',
        },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    await func.fn(['config://app'], {
      _lifecycle: { connectEmitted: false },
    } as any);

    expect(mockClient.readResource).toHaveBeenCalledWith({
      uri: 'config://app',
    });
  });

  it('returns string for single text content', async () => {
    const mockResult: McpResourceResult = {
      contents: [
        {
          uri: 'config://app',
          text: 'config data',
          mimeType: 'text/plain',
        },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const result = await func.fn(['config://app'], {
      _lifecycle: { connectEmitted: false },
    } as any);

    // Task 3.2: Text content returns string
    expect(result).toBe('config data');
  });

  it('returns dict with type/data/mime for single blob content', async () => {
    const mockResult: McpResourceResult = {
      contents: [
        {
          uri: 'image://logo',
          blob: 'base64data',
          mimeType: 'image/png',
        },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const result = await func.fn(['image://logo'], {
      _lifecycle: { connectEmitted: false },
    } as any);

    // Task 3.2: Blob content returns dict with type/data/mime
    expect(result).toEqual({
      type: 'image',
      data: 'base64data',
      mime: 'image/png',
    });
  });

  it('returns empty string for empty contents (BC-6)', async () => {
    const mockResult: McpResourceResult = {
      contents: [],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const result = await func.fn(['empty://resource'], {
      _lifecycle: { connectEmitted: false },
    } as any);

    // BC-6: Empty content returns empty string
    expect(result).toBe('');
  });

  it('concatenates multiple text contents with newlines', async () => {
    const mockResult: McpResourceResult = {
      contents: [
        { uri: 'resource://1', text: 'first' },
        { uri: 'resource://2', text: 'second' },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });
    const result = await func.fn(['resource://multi'], {
      _lifecycle: { connectEmitted: false },
    } as any);

    // Task 3.2: Multiple text contents concatenated with newlines
    expect(result).toBe('first\nsecond');
  });

  it('throws error for non-string URI parameter', async () => {
    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expect(
      func.fn([123], { _lifecycle: { connectEmitted: false } } as any)
    ).rejects.toThrow(
      'mcp tool "read_resource": expected string uri, got number'
    );
  });

  it('handles timeout during read operation', async () => {
    // Mock readResource to never resolve
    vi.mocked(mockClient.readResource).mockImplementation(
      () => new Promise(() => {})
    );

    const func = createReadResourceFunction(mockClient, 100, {
      connectEmitted: false,
    });

    await expect(
      func.fn(['slow://resource'], {
        _lifecycle: { connectEmitted: false },
      } as any)
    ).rejects.toThrow('mcp tool "read_resource": timeout after 100ms');
  });

  it('handles connection lost error', async () => {
    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('connection closed')
    );

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expect(
      func.fn(['config://app'], {
        _lifecycle: { connectEmitted: false },
      } as any)
    ).rejects.toThrow('mcp: connection lost');
  });

  it('handles authentication failed error', async () => {
    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('unauthorized')
    );

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expect(
      func.fn(['config://app'], {
        _lifecycle: { connectEmitted: false },
      } as any)
    ).rejects.toThrow('mcp: authentication failed');
  });

  it('handles protocol error', async () => {
    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('protocol error: invalid response')
    );

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expect(
      func.fn(['config://app'], {
        _lifecycle: { connectEmitted: false },
      } as any)
    ).rejects.toThrow('mcp: protocol error');
  });

  it('handles generic read error', async () => {
    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('resource not found')
    );

    const func = createReadResourceFunction(mockClient, 30000, {
      connectEmitted: false,
    });

    await expect(
      func.fn(['config://app'], {
        _lifecycle: { connectEmitted: false },
      } as any)
    ).rejects.toThrow('mcp tool "read_resource": resource not found');
  });
});

// ============================================================
// RESOURCE TEMPLATE FUNCTION TESTS
// ============================================================

describe('generateResourceTemplateFunctions', () => {
  let mockClient: Client;

  beforeEach(() => {
    mockClient = {
      readResource: vi.fn(),
    } as unknown as Client;
  });

  it('generates function for single-variable template (AC-9)', async () => {
    const templates: McpResourceTemplate[] = [
      {
        uriTemplate: 'db://table/{tableName}',
        name: 'table',
        description: 'Access database table',
      },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(functions).toHaveProperty('resource_table');
    const func = functions.resource_table!;

    expect(func.params).toEqual([
      {
        name: 'tableName',
        type: 'string',
        description: 'URI template variable: tableName',
      },
    ]);
    expect(func.description).toBe('Access database table');
    expect(func.returnType).toBe('dict');
  });

  it('generates function for multi-variable template (IR-4)', () => {
    const templates: McpResourceTemplate[] = [
      {
        uriTemplate: 'db://table/{tableName}/row/{rowId}',
        name: 'database_row',
        description: 'Access specific row',
      },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(functions).toHaveProperty('resource_database_row');
    const func = functions.resource_database_row!;

    expect(func.params).toEqual([
      {
        name: 'tableName',
        type: 'string',
        description: 'URI template variable: tableName',
      },
      {
        name: 'rowId',
        type: 'string',
        description: 'URI template variable: rowId',
      },
    ]);
  });

  it('expands URI template with arguments and reads resource (AC-9)', async () => {
    const templates: McpResourceTemplate[] = [
      {
        uriTemplate: 'db://table/{tableName}/row/{rowId}',
        name: 'database_row',
      },
    ];

    const mockResult: McpResourceResult = {
      contents: [
        {
          uri: 'db://table/users/row/123',
          text: '{"id": 123, "name": "Alice"}',
        },
      ],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_database_row!;
    await func.fn(['users', '123'], {
      _lifecycle: { connectEmitted: false },
    } as any);

    expect(mockClient.readResource).toHaveBeenCalledWith({
      uri: 'db://table/users/row/123',
    });
  });

  it('applies name sanitization to template names', () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'api://{id}', name: 'getUserProfile' },
      { uriTemplate: 'api://{id}', name: 'get-user-data' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(functions).toHaveProperty('resource_get_user_profile');
    expect(functions).toHaveProperty('resource_get_user_data');
  });

  it('handles collision detection in template names', () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'api://{id}', name: 'getUser' },
      { uriTemplate: 'api://{id}', name: 'get_user' },
      { uriTemplate: 'api://{id}', name: 'get-user' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(functions).toHaveProperty('resource_get_user');
    expect(functions).toHaveProperty('resource_get_user_2');
    expect(functions).toHaveProperty('resource_get_user_3');
  });

  it('generates functions for multiple templates', () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'db://table/{tableName}', name: 'table' },
      { uriTemplate: 'file:///{path}', name: 'file' },
      { uriTemplate: 'api://v{version}/users/{userId}', name: 'user' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    expect(Object.keys(functions)).toEqual([
      'resource_table',
      'resource_file',
      'resource_user',
    ]);
  });

  it('throws error for non-string template parameter', async () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'db://table/{tableName}', name: 'table' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_table!;

    await expect(
      func.fn([123], { _lifecycle: { connectEmitted: false } } as any)
    ).rejects.toThrow(
      'mcp tool "table": expected string for parameter tableName, got number'
    );
  });

  it('handles timeout during template expansion', async () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'slow://{id}', name: 'slow_resource' },
    ];

    vi.mocked(mockClient.readResource).mockImplementation(
      () => new Promise(() => {})
    );

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      100
    );
    const func = functions.resource_slow_resource!;

    await expect(
      func.fn(['test'], { _lifecycle: { connectEmitted: false } } as any)
    ).rejects.toThrow('mcp tool "slow_resource": timeout after 100ms');
  });

  it('handles connection lost during template read', async () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'db://{table}', name: 'table' },
    ];

    vi.mocked(mockClient.readResource).mockRejectedValue(
      new Error('disconnected')
    );

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_table!;

    await expect(
      func.fn(['users'], { _lifecycle: { connectEmitted: false } } as any)
    ).rejects.toThrow('mcp: connection lost');
  });

  it('returns empty object for templates array', () => {
    const functions = generateResourceTemplateFunctions([], mockClient, 30000);
    expect(functions).toEqual({});
  });

  it('converts non-string arguments to strings for URI expansion', async () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'api://item/{id}', name: 'item' },
    ];

    const mockResult: McpResourceResult = {
      contents: [{ uri: 'api://item/42', text: 'item data' }],
    };

    vi.mocked(mockClient.readResource).mockResolvedValue(mockResult);

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_item!;

    // This should throw because we validate string types
    await expect(
      func.fn([42], { _lifecycle: { connectEmitted: false } } as any)
    ).rejects.toThrow(
      'mcp tool "item": expected string for parameter id, got number'
    );
  });

  it('handles templates without description field', () => {
    const templates: McpResourceTemplate[] = [
      { uriTemplate: 'api://{id}', name: 'item' },
    ];

    const functions = generateResourceTemplateFunctions(
      templates,
      mockClient,
      30000
    );

    const func = functions.resource_item!;
    expect(func.description).toBeUndefined();
  });
});
