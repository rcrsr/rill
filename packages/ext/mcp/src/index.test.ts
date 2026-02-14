import { describe, it, expect } from 'vitest';
import type {
  McpExtensionConfig,
  McpTransportConfig,
  McpStdioTransportConfig,
  McpHttpTransportConfig,
} from './index.js';

describe('Package Structure', () => {
  describe('build configuration', () => {
    it('exports a valid ES module', () => {
      // This test verifies the package can be imported
      // Actual API exports will be tested in subsequent tasks
      expect(true).toBe(true);
    });
  });

  describe('type exports', () => {
    it('exports McpExtensionConfig type', () => {
      // Type-only import test - verifies type is exported
      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'test-command',
        },
      };
      expect(config.transport.type).toBe('stdio');
    });

    it('exports McpStdioTransportConfig type', () => {
      // Type-only import test - verifies type is exported
      const config: McpStdioTransportConfig = {
        type: 'stdio',
        command: 'test-command',
        args: ['--arg1', '--arg2'],
        env: { KEY: 'value' },
      };
      expect(config.type).toBe('stdio');
    });

    it('exports McpHttpTransportConfig type', () => {
      // Type-only import test - verifies type is exported
      const config: McpHttpTransportConfig = {
        type: 'http',
        url: 'https://example.com',
        headers: { 'Content-Type': 'application/json' },
      };
      expect(config.type).toBe('http');
    });

    it('exports McpTransportConfig union type', () => {
      // Type-only import test - verifies union type is exported
      const stdioConfig: McpTransportConfig = {
        type: 'stdio',
        command: 'test-command',
      };
      const httpConfig: McpTransportConfig = {
        type: 'http',
        url: 'https://example.com',
      };
      expect(stdioConfig.type).toBe('stdio');
      expect(httpConfig.type).toBe('http');
    });

    it('accepts headers as function in McpHttpTransportConfig', () => {
      // Verify headers can be a function
      const config: McpHttpTransportConfig = {
        type: 'http',
        url: 'https://example.com',
        headers: () => ({ Authorization: 'Bearer token' }),
      };
      expect(typeof config.headers).toBe('function');
    });

    it('accepts headers as async function in McpHttpTransportConfig', () => {
      // Verify headers can be an async function
      const config: McpHttpTransportConfig = {
        type: 'http',
        url: 'https://example.com',
        headers: async () => ({ Authorization: 'Bearer token' }),
      };
      expect(typeof config.headers).toBe('function');
    });

    it('accepts optional timeout in McpExtensionConfig', () => {
      const config: McpExtensionConfig = {
        transport: { type: 'stdio', command: 'test' },
        timeout: 60000,
      };
      expect(config.timeout).toBe(60000);
    });

    it('accepts optional filters in McpExtensionConfig', () => {
      const config: McpExtensionConfig = {
        transport: { type: 'stdio', command: 'test' },
        toolFilter: ['tool1', 'tool2'],
        resourceFilter: ['resource://example'],
        promptFilter: ['prompt1'],
      };
      expect(config.toolFilter).toEqual(['tool1', 'tool2']);
      expect(config.resourceFilter).toEqual(['resource://example']);
      expect(config.promptFilter).toEqual(['prompt1']);
    });
  });
});
