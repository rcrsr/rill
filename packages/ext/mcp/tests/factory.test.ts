/**
 * Tests for MCP extension factory.
 *
 * Coverage:
 * - IR-1: Factory function exists and is async
 * - EC-1: Missing stdio command throws sync error
 * - EC-2: Missing http url throws sync error
 * - IC-3: Valid config returns ExtensionResult
 */

import { describe, it, expect } from 'vitest';
import { createMcpExtension } from '../src/factory.js';
import type { McpExtensionConfig } from '../src/types.js';

describe('createMcpExtension', () => {
  describe('IR-1: Factory function exists and is async', () => {
    it('exports factory function', () => {
      expect(typeof createMcpExtension).toBe('function');
    });

    it('returns a Promise', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'test-command',
        },
      };

      const result = createMcpExtension(config);
      expect(result).toBeInstanceOf(Promise);
      // Clean up promise to prevent unhandled rejection
      await expect(result).rejects.toThrow();
    });
  });

  describe('EC-1: Missing stdio command throws sync error', () => {
    it('throws for missing stdio command', async () => {
      const config = {
        transport: {
          type: 'stdio',
          command: '',
        },
      } as McpExtensionConfig;

      await expect(createMcpExtension(config)).rejects.toThrow(
        'transport.command is required for stdio transport'
      );
    });

    it('throws for undefined stdio command', async () => {
      const config = {
        transport: {
          type: 'stdio',
        },
      } as unknown as McpExtensionConfig;

      await expect(createMcpExtension(config)).rejects.toThrow(
        'transport.command is required for stdio transport'
      );
    });

    it('throws for null stdio command', async () => {
      const config = {
        transport: {
          type: 'stdio',
          command: null,
        },
      } as unknown as McpExtensionConfig;

      await expect(createMcpExtension(config)).rejects.toThrow(
        'transport.command is required for stdio transport'
      );
    });
  });

  describe('EC-2: Missing http url throws sync error', () => {
    it('throws for missing http url', async () => {
      const config = {
        transport: {
          type: 'http',
          url: '',
        },
      } as McpExtensionConfig;

      await expect(createMcpExtension(config)).rejects.toThrow(
        'transport.url is required for http transport'
      );
    });

    it('throws for undefined http url', async () => {
      const config = {
        transport: {
          type: 'http',
        },
      } as unknown as McpExtensionConfig;

      await expect(createMcpExtension(config)).rejects.toThrow(
        'transport.url is required for http transport'
      );
    });

    it('throws for null http url', async () => {
      const config = {
        transport: {
          type: 'http',
          url: null,
        },
      } as unknown as McpExtensionConfig;

      await expect(createMcpExtension(config)).rejects.toThrow(
        'transport.url is required for http transport'
      );
    });
  });

  describe('IC-3: Valid config syntax', () => {
    // Note: These tests expect connection failures since no real servers exist
    // Phase 2 Task 1 implements actual transport connection

    it('validates stdio config structure', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'test-command',
          args: ['--config', 'test.json'],
        },
        timeout: 30000,
      };

      // Will fail to connect since test-command doesn't exist
      await expect(createMcpExtension(config)).rejects.toThrow(
        /mcp: failed to connect/
      );
    });

    it('validates http config structure', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'http',
          url: 'http://localhost:3000/mcp',
        },
        timeout: 1000, // Short timeout for test
      };

      // Will fail to connect since server doesn't exist
      await expect(createMcpExtension(config)).rejects.toThrow();
    }, 5000);

    it('validates stdio config with env variables', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'test-command',
          env: {
            API_KEY: 'test-key',
            DEBUG: 'true',
          },
        },
      };

      // Will fail to connect since test-command doesn't exist
      await expect(createMcpExtension(config)).rejects.toThrow(
        /mcp: failed to connect/
      );
    });

    it('validates http config with headers', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'http',
          url: 'http://localhost:3000/mcp',
          headers: {
            Authorization: 'Bearer token',
          },
        },
        timeout: 1000, // Short timeout for test
      };

      // Will fail to connect since server doesn't exist
      await expect(createMcpExtension(config)).rejects.toThrow();
    }, 5000);

    it('validates config with filters', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'test-command',
        },
        toolFilter: ['tool1', 'tool2'],
        resourceFilter: ['resource1'],
        promptFilter: ['prompt1', 'prompt2', 'prompt3'],
      };

      // Will fail to connect since test-command doesn't exist
      await expect(createMcpExtension(config)).rejects.toThrow(
        /mcp: failed to connect/
      );
    });
  });
});
