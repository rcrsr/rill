/**
 * TypeScript interfaces for MCP extension configuration.
 *
 * Defines the configuration schema for MCP extension initialization,
 * including transport configuration and optional filters.
 */

import type { HeadersInit } from 'undici-types';

// ============================================================
// TRANSPORT CONFIGURATION
// ============================================================

/**
 * stdio transport configuration for process-based MCP servers.
 */
export interface McpStdioTransportConfig {
  readonly type: 'stdio';
  readonly command: string;
  readonly args?: string[] | undefined;
  readonly env?: Record<string, string> | undefined;
}

/**
 * HTTP transport configuration for HTTP-based MCP servers.
 *
 * Headers can be static or dynamically resolved via function/promise.
 */
export interface McpHttpTransportConfig {
  readonly type: 'http';
  readonly url: string;
  readonly headers?:
    | HeadersInit
    | (() => HeadersInit | Promise<HeadersInit>)
    | undefined;
}

/**
 * Union of supported MCP transport configurations.
 */
export type McpTransportConfig =
  | McpStdioTransportConfig
  | McpHttpTransportConfig;

// ============================================================
// EXTENSION CONFIGURATION
// ============================================================

/**
 * Configuration for MCP extension initialization.
 *
 * Defines transport, timeout, and optional filters for tools,
 * resources, and prompts.
 */
export interface McpExtensionConfig {
  readonly transport: McpTransportConfig;
  readonly timeout?: number | undefined; // per-call timeout in ms, default: 30000
  readonly toolFilter?: string[] | undefined; // include only these tool names (empty = all)
  readonly resourceFilter?: string[] | undefined; // include only these resource URIs (empty = all)
  readonly promptFilter?: string[] | undefined; // include only these prompt names (empty = all)
}
