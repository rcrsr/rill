/**
 * Error mapping utilities for MCP Server Mapper Extension.
 * Maps MCP protocol errors to rill error types per spec.
 */

import { RuntimeError } from '@rcrsr/rill';

// ============================================================
// FACTORY ERRORS (SYNC)
// ============================================================

/**
 * Creates a factory error for synchronous validation failures.
 * Plain Error with descriptive message.
 *
 * @param message - Error message describing validation failure
 * @returns Error instance
 */
export function createFactoryError(message: string): Error {
  return new Error(message);
}

// ============================================================
// CONNECTION ERRORS (ASYNC)
// ============================================================

/**
 * Creates a connection error for MCP server failures.
 * Plain Error with 'mcp: failed to connect' prefix.
 *
 * EC-3: Server process exit
 * EC-4: Connection refused
 * EC-5: Auth required
 *
 * @param reason - Connection failure reason
 * @returns Error instance
 */
export function createConnectionError(reason: string): Error {
  return new Error(`mcp: failed to connect -- ${reason}`);
}

/**
 * Creates connection error for server process exit.
 * EC-3: Server process exited with code N.
 *
 * @param exitCode - Process exit code
 * @returns Error instance
 */
export function createProcessExitError(exitCode: number): Error {
  return createConnectionError(`server process exited with code ${exitCode}`);
}

/**
 * Creates connection error for connection refused.
 * EC-4: Connection refused at URL.
 *
 * @param url - Server URL
 * @returns Error instance
 */
export function createConnectionRefusedError(url: string): Error {
  return createConnectionError(`connection refused at ${url}`);
}

/**
 * Creates connection error for authentication required.
 * EC-5: Server requires authentication.
 *
 * @returns Error instance
 */
export function createAuthRequiredError(): Error {
  return new Error(
    'mcp: server requires authentication -- complete OAuth flow before connecting'
  );
}

// ============================================================
// RUNTIME ERRORS
// ============================================================

/**
 * Creates runtime error for MCP tool failures.
 * RuntimeError RILL-R004 for tool call failures.
 *
 * EC-6: Tool error
 * EC-7: Protocol error
 * EC-8: Timeout
 * EC-9: Connection lost
 * EC-10: Auth failed
 *
 * @param message - Error message
 * @param context - Context data for error
 * @returns RuntimeError instance
 */
export function createRuntimeError(
  message: string,
  context?: Record<string, unknown>
): RuntimeError {
  return new RuntimeError('RILL-R004', message, undefined, context);
}

/**
 * Creates runtime error for tool execution failure.
 * EC-6: MCP tool "name": error text.
 *
 * @param toolName - Name of the tool that failed
 * @param errorText - Error message from tool
 * @returns RuntimeError instance
 */
export function createToolError(
  toolName: string,
  errorText: string
): RuntimeError {
  return createRuntimeError(`mcp tool "${toolName}": ${errorText}`, {
    toolName,
    errorText,
  });
}

/**
 * Creates runtime error for protocol errors.
 * EC-7: MCP protocol error.
 *
 * @param message - Protocol error message
 * @returns RuntimeError instance
 */
export function createProtocolError(message: string): RuntimeError {
  return createRuntimeError(`mcp: protocol error -- ${message}`, {
    protocolError: message,
  });
}

/**
 * Creates runtime error for operation timeout.
 * EC-8: MCP tool timeout.
 *
 * @param toolName - Name of the tool that timed out
 * @param timeoutMs - Timeout duration in milliseconds
 * @returns RuntimeError instance
 */
export function createTimeoutError(
  toolName: string,
  timeoutMs: number
): RuntimeError {
  return createRuntimeError(
    `mcp tool "${toolName}": timeout after ${timeoutMs}ms`,
    { toolName, timeoutMs }
  );
}

/**
 * Creates runtime error for connection lost.
 * EC-9: MCP connection lost during operation.
 *
 * @returns RuntimeError instance
 */
export function createConnectionLostError(): RuntimeError {
  return createRuntimeError('mcp: connection lost', {
    connectionLost: true,
  });
}

/**
 * Creates runtime error for authentication failure.
 * EC-10: MCP authentication failed.
 *
 * @returns RuntimeError instance
 */
export function createAuthFailedError(): RuntimeError {
  return createRuntimeError(
    'mcp: authentication failed -- token may be expired',
    { authFailed: true }
  );
}
