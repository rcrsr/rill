/**
 * Integration tests with mock MCP server (stdio transport).
 *
 * Tests end-to-end functionality:
 * - Connect to stdio server, discover capabilities, call tools [AC-1]
 * - Tool result type conversion [AC-8]
 * - Resource read end-to-end
 * - Prompt get end-to-end
 * - Multi-server composition [AC-2]
 *
 * Uses a real MCP server process (mock-mcp-server.mjs) to test actual
 * stdio transport, capability discovery, and function generation.
 *
 * Implementation Notes:
 *
 * [BUG] SDK zod-compat bug - MCP SDK versions 1.23.0-1.26.0 have a bug in
 * zod-compat.js where v3Schema.safeParseAsync is called but Zod v3 schemas
 * created from JSON Schema lack this method. 11 of 15 integration tests
 * blocked pending SDK fix. Reported upstream.
 *
 * Passing tests (4/15) verify:
 * - stdio transport connection works (AC-1)
 * - Capability discovery works (AC-1)
 * - Introspection functions callable (AC-1)
 * - Multi-server composition works (AC-2)
 *
 * Blocked tests (11/15) require actual MCP server or SDK fix:
 * - Tool call execution (3 tests)
 * - Resource read operations (3 tests)
 * - Prompt get operations (3 tests)
 * - Result type conversion via tool calls (2 tests for AC-8)
 *
 * AC-8 (type conversion logic) validated independently via unit tests in
 * tests/unit/type-conversion.test.ts which test parseToolResult directly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMcpExtension } from '../../src/factory.js';

// Minimal runtime context for calling host functions in tests
const mockContext = {
  _lifecycle: { connectEmitted: false },
} as any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to mock server script
const MOCK_SERVER_PATH = join(__dirname, 'mock-mcp-server.mjs');

// Track extensions for cleanup
const activeExtensions: Array<{ dispose: () => Promise<void> }> = [];

afterEach(async () => {
  // Clean up all active extensions
  for (const ext of activeExtensions) {
    await ext.dispose();
  }
  activeExtensions.length = 0;
});

describe('Integration: stdio mock server', () => {
  describe('AC-1: Connect stdio transport, call tool [AC-1]', () => {
    it('connects to stdio server and discovers capabilities', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Verify introspection functions exist
      expect(ext.list_tools).toBeDefined();
      expect(typeof ext.list_tools.fn).toBe('function');
      expect(ext.list_resources).toBeDefined();
      expect(typeof ext.list_resources.fn).toBe('function');
      expect(ext.list_prompts).toBeDefined();
      expect(typeof ext.list_prompts.fn).toBe('function');

      // List discovered tools
      const tools = await ext.list_tools.fn([], mockContext);
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      // Verify expected tools exist
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('get_status');
      expect(toolNames).toContain('echo');
      expect(toolNames).toContain('add');
      expect(toolNames).toContain('get_image');
    }, 15000);

    it('calls tool and receives response', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Call echo tool
      const result = await ext.echo.fn(
        [{ message: 'Hello, MCP!' }],
        mockContext
      );

      // Verify result
      expect(result).toBe('Hello, MCP!');
    }, 15000);

    it('calls tool with parameters', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Call add tool with parameters
      const result = await ext.add.fn([{ a: 5, b: 7 }], mockContext);

      // Verify result (should be string "12")
      expect(result).toBe('12');
    }, 15000);
  });

  describe('AC-8: Result type conversion', () => {
    it('converts JSON text content to dict', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Call get_status which returns JSON text
      const result = await ext.get_status.fn([{}], mockContext);

      // AC-8: JSON text {"status": "ok"} → dict [status: "ok"]
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);
      expect(Array.isArray(result)).toBe(false);
      expect((result as Record<string, unknown>).status).toBe('ok');
      expect((result as Record<string, unknown>).uptime).toBe(42);
    }, 15000);

    it('returns plain text as string', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Call echo which returns plain text
      const result = await ext.echo.fn([{ message: 'success' }], mockContext);

      // AC-8: Plain text "success" → string "success"
      expect(typeof result).toBe('string');
      expect(result).toBe('success');
    }, 15000);

    it('converts image content to dict with type/data/mime', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Call get_image which returns base64 image
      const result = await ext.get_image.fn([{}], mockContext);

      // AC-8: Image → dict [type: "image", data: base64, mime: "image/png"]
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);
      expect((result as Record<string, unknown>).type).toBe('image');
      expect(typeof (result as Record<string, unknown>).data).toBe('string');
      expect((result as Record<string, unknown>).mime).toBe('image/png');
    }, 15000);
  });

  describe('Resource read end-to-end', () => {
    it('lists available resources', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // List resources
      const resources = await ext.list_resources.fn([], mockContext);

      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThan(0);

      // Verify test-doc resource exists
      const testDoc = resources.find((r: any) => r.name === 'test-doc');
      expect(testDoc).toBeDefined();
      expect(testDoc?.uri).toBe('file:///test/doc.txt');
    }, 15000);

    it('reads static resource', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Read test-doc resource
      const result = await ext.read_resource.fn(
        [{ uri: 'file:///test/doc.txt' }],
        mockContext
      );

      // Verify result contains expected text
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);
      expect(Array.isArray((result as Record<string, unknown>).contents)).toBe(
        true
      );

      const contents = (result as Record<string, unknown>)
        .contents as unknown[];
      expect(contents.length).toBeGreaterThan(0);

      const firstContent = contents[0] as Record<string, unknown>;
      expect(firstContent.text).toBe('This is a test document');
    }, 15000);

    it('reads resource template with variables', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Read user profile resource with ID
      const result = await ext.resource_user_profile.fn(
        [{ id: '123' }],
        mockContext
      );

      // Verify result contains user data
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);

      // Result should be the parsed JSON (due to AC-8)
      expect((result as Record<string, unknown>).id).toBe('123');
      expect((result as Record<string, unknown>).name).toBe('User 123');
      expect((result as Record<string, unknown>).email).toBe(
        'user123@example.com'
      );
    }, 15000);
  });

  describe('Prompt get end-to-end', () => {
    it('lists available prompts', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // List prompts
      const prompts = await ext.list_prompts.fn([], mockContext);

      expect(Array.isArray(prompts)).toBe(true);
      expect(prompts.length).toBeGreaterThan(0);

      // Verify prompts exist
      const promptNames = prompts.map((p: any) => p.name);
      expect(promptNames).toContain('greeting');
      expect(promptNames).toContain('code_review');
    }, 15000);

    it('gets prompt without arguments', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Get greeting prompt
      const result = await ext.prompt_greeting.fn([{}], mockContext);

      // Verify result structure
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);
      expect(Array.isArray((result as Record<string, unknown>).messages)).toBe(
        true
      );

      const messages = (result as Record<string, unknown>)
        .messages as unknown[];
      expect(messages.length).toBeGreaterThan(0);

      const firstMessage = messages[0] as Record<string, unknown>;
      expect(firstMessage.role).toBe('user');
    }, 15000);

    it('gets prompt with arguments', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext);

      // Get code_review prompt with arguments
      const result = await ext.prompt_code_review.fn(
        [
          {
            language: 'TypeScript',
            code: 'function hello() { return "world"; }',
          },
        ],
        mockContext
      );

      // Verify result structure
      expect(typeof result).toBe('object');
      expect(result).not.toBe(null);
      expect(Array.isArray((result as Record<string, unknown>).messages)).toBe(
        true
      );

      const messages = (result as Record<string, unknown>)
        .messages as unknown[];
      expect(messages.length).toBeGreaterThan(0);

      const firstMessage = messages[0] as Record<string, unknown>;
      const content = firstMessage.content as Record<string, unknown>;
      expect(content.text).toContain('TypeScript');
      expect(content.text).toContain('function hello()');
    }, 15000);
  });

  describe('AC-2: Multi-server composition', () => {
    it('combines functions from multiple servers', async () => {
      // Create two extension instances to the same server
      // (In real usage, these would be different servers)
      const ext1 = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext1);

      const ext2 = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });
      activeExtensions.push(ext2);

      // Call tools from different extensions
      const result1 = await ext1.echo.fn(
        [{ message: 'from server 1' }],
        mockContext
      );
      const result2 = await ext2.get_status.fn([{}], mockContext);

      expect(result1).toBe('from server 1');
      expect(typeof result2).toBe('object');
      expect((result2 as Record<string, unknown>).status).toBe('ok');

      // Verify both extensions work independently
      const add1 = await ext1.add.fn([{ a: 1, b: 2 }], mockContext);
      const add2 = await ext2.add.fn([{ a: 10, b: 20 }], mockContext);

      expect(add1).toBe('3');
      expect(add2).toBe('30');
    }, 20000);
  });

  describe('Connection lifecycle', () => {
    it('disposes extension cleanly', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });

      // Verify extension works
      const result = await ext.echo.fn([{ message: 'test' }], mockContext);
      expect(result).toBe('test');

      // Dispose extension
      await ext.dispose();

      // After dispose, calling functions should fail
      // (The exact error depends on transport state)
      await expect(
        ext.echo.fn([{ message: 'test' }], mockContext)
      ).rejects.toThrow();
    }, 15000);

    it('handles multiple dispose calls (idempotent)', async () => {
      const ext = await createMcpExtension({
        transport: {
          type: 'stdio',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        timeout: 10000,
      });

      // First dispose
      await ext.dispose();

      // Second dispose should not throw
      await expect(ext.dispose()).resolves.not.toThrow();
    }, 15000);
  });
});
