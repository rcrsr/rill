/**
 * @rcrsr/rill-ext-mcp
 *
 * rill extension for Model Context Protocol (MCP) integration.
 *
 * This extension provides host functions for connecting to MCP servers,
 * calling tools, accessing resources, and managing MCP client sessions.
 */

// ============================================================
// PUBLIC TYPES
// ============================================================
export type {
  McpExtensionConfig,
  McpTransportConfig,
  McpStdioTransportConfig,
  McpHttpTransportConfig,
} from './types.js';

// ============================================================
// FACTORY FUNCTIONS
// ============================================================
export { createMcpExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

import type { ExtensionConfigSchema } from '@rcrsr/rill';

export const configSchema: ExtensionConfigSchema = {
  timeout: { type: 'number' },
};

// ============================================================
// ERROR UTILITIES
// ============================================================
export {
  createFactoryError,
  createConnectionError,
  createProcessExitError,
  createConnectionRefusedError,
  createAuthRequiredError,
  createRuntimeError,
  createToolError,
  createProtocolError,
  createTimeoutError,
  createConnectionLostError,
  createAuthFailedError,
} from './errors.js';
