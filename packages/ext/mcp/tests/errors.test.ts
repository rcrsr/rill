/**
 * Error mapping utilities test suite.
 * Tests all error categories and message formats per spec.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import {
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
} from '../src/errors.js';

describe('Error Mapping Utilities', () => {
  describe('Factory Errors (Sync)', () => {
    it('creates plain Error with descriptive message', () => {
      const error = createFactoryError('invalid configuration');

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('invalid configuration');
    });

    it('creates Error for multiple validation failures', () => {
      const error = createFactoryError(
        'namespace cannot be empty and must match pattern'
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('namespace');
      expect(error.message).toContain('pattern');
    });
  });

  describe('Connection Errors (Async)', () => {
    it('EC-3: creates error for process exit with code', () => {
      const error = createProcessExitError(1);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        'mcp: failed to connect -- server process exited with code 1'
      );
    });

    it('EC-3: creates error for process exit with code 127', () => {
      const error = createProcessExitError(127);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        'mcp: failed to connect -- server process exited with code 127'
      );
    });

    it('EC-4: creates error for connection refused at URL', () => {
      const error = createConnectionRefusedError('http://localhost:8080');

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        'mcp: failed to connect -- connection refused at http://localhost:8080'
      );
    });

    it('EC-5: creates error for auth required', () => {
      const error = createAuthRequiredError();

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        'mcp: server requires authentication -- complete OAuth flow before connecting'
      );
    });

    it('creates generic connection error with custom reason', () => {
      const error = createConnectionError('network timeout');

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('mcp: failed to connect -- network timeout');
    });
  });

  describe('Runtime Errors', () => {
    it('EC-6: creates RuntimeError for tool error', () => {
      const error = createToolError('read_file', 'file not found');

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe('mcp tool "read_file": file not found');
      expect(error.context).toEqual({
        toolName: 'read_file',
        errorText: 'file not found',
      });
    });

    it('EC-6: creates RuntimeError for tool error with complex message', () => {
      const error = createToolError(
        'execute_command',
        'command failed with exit code 1'
      );

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe(
        'mcp tool "execute_command": command failed with exit code 1'
      );
      expect(error.context).toEqual({
        toolName: 'execute_command',
        errorText: 'command failed with exit code 1',
      });
    });

    it('EC-7: creates RuntimeError for protocol error', () => {
      const error = createProtocolError('invalid message format');

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe(
        'mcp: protocol error -- invalid message format'
      );
      expect(error.context).toEqual({
        protocolError: 'invalid message format',
      });
    });

    it('EC-7: creates RuntimeError for protocol error with details', () => {
      const error = createProtocolError(
        'unexpected response: missing required field "result"'
      );

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toContain('protocol error');
      expect(error.message).toContain('missing required field');
    });

    it('EC-8: creates RuntimeError for timeout', () => {
      const error = createTimeoutError('read_file', 30000);

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe('mcp tool "read_file": timeout after 30000ms');
      expect(error.context).toEqual({
        toolName: 'read_file',
        timeoutMs: 30000,
      });
    });

    it('EC-8: creates RuntimeError for timeout with different duration', () => {
      const error = createTimeoutError('execute_command', 5000);

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe(
        'mcp tool "execute_command": timeout after 5000ms'
      );
      expect(error.context).toEqual({
        toolName: 'execute_command',
        timeoutMs: 5000,
      });
    });

    it('EC-9: creates RuntimeError for connection lost', () => {
      const error = createConnectionLostError();

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe('mcp: connection lost');
      expect(error.context).toEqual({
        connectionLost: true,
      });
    });

    it('EC-10: creates RuntimeError for auth failed', () => {
      const error = createAuthFailedError();

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe(
        'mcp: authentication failed -- token may be expired'
      );
      expect(error.context).toEqual({
        authFailed: true,
      });
    });

    it('creates generic RuntimeError with custom message', () => {
      const error = createRuntimeError('custom error message', {
        customField: 'value',
      });

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe('custom error message');
      expect(error.context).toEqual({
        customField: 'value',
      });
    });

    it('creates RuntimeError without context', () => {
      const error = createRuntimeError('error without context');

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R004');
      expect(error.message).toBe('error without context');
      expect(error.context).toBeUndefined();
    });
  });

  describe('Error Message Format Validation', () => {
    it('all connection errors include "mcp: failed to connect" prefix', () => {
      const errors = [
        createProcessExitError(1),
        createConnectionRefusedError('http://localhost:8080'),
        createConnectionError('custom reason'),
      ];

      errors.forEach((error) => {
        expect(error.message).toMatch(/^mcp: failed to connect -- /);
      });
    });

    it('auth required error has specific format', () => {
      const error = createAuthRequiredError();

      expect(error.message).toBe(
        'mcp: server requires authentication -- complete OAuth flow before connecting'
      );
    });

    it('tool errors include tool name in quotes', () => {
      const error = createToolError('test_tool', 'error message');

      expect(error.message).toMatch(/mcp tool "test_tool":/);
    });

    it('protocol errors include "mcp: protocol error" prefix', () => {
      const error = createProtocolError('test error');

      expect(error.message).toMatch(/^mcp: protocol error -- /);
    });

    it('timeout errors include duration', () => {
      const error = createTimeoutError('test_tool', 15000);

      expect(error.message).toContain('15000ms');
    });

    it('connection lost error has exact format', () => {
      const error = createConnectionLostError();

      expect(error.message).toBe('mcp: connection lost');
    });

    it('auth failed error has exact format', () => {
      const error = createAuthFailedError();

      expect(error.message).toBe(
        'mcp: authentication failed -- token may be expired'
      );
    });
  });

  describe('Error Instance Types', () => {
    it('factory errors are plain Error instances', () => {
      const error = createFactoryError('test');

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RuntimeError);
    });

    it('connection errors are plain Error instances', () => {
      const errors = [
        createProcessExitError(1),
        createConnectionRefusedError('url'),
        createAuthRequiredError(),
        createConnectionError('reason'),
      ];

      errors.forEach((error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(RuntimeError);
      });
    });

    it('runtime errors are RuntimeError instances', () => {
      const errors = [
        createToolError('tool', 'error'),
        createProtocolError('error'),
        createTimeoutError('tool', 1000),
        createConnectionLostError(),
        createAuthFailedError(),
        createRuntimeError('error'),
      ];

      errors.forEach((error) => {
        expect(error).toBeInstanceOf(RuntimeError);
        expect(error.errorId).toBe('RILL-R004');
      });
    });
  });

  describe('Error Context Data', () => {
    it('tool errors include toolName and errorText in context', () => {
      const error = createToolError('my_tool', 'something failed');

      expect(error.context).toHaveProperty('toolName', 'my_tool');
      expect(error.context).toHaveProperty('errorText', 'something failed');
    });

    it('protocol errors include protocolError in context', () => {
      const error = createProtocolError('invalid format');

      expect(error.context).toHaveProperty('protocolError', 'invalid format');
    });

    it('timeout errors include toolName and timeoutMs in context', () => {
      const error = createTimeoutError('slow_tool', 20000);

      expect(error.context).toHaveProperty('toolName', 'slow_tool');
      expect(error.context).toHaveProperty('timeoutMs', 20000);
    });

    it('connection lost errors include connectionLost flag in context', () => {
      const error = createConnectionLostError();

      expect(error.context).toHaveProperty('connectionLost', true);
    });

    it('auth failed errors include authFailed flag in context', () => {
      const error = createAuthFailedError();

      expect(error.context).toHaveProperty('authFailed', true);
    });
  });
});
