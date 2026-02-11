/**
 * Rill Runtime Tests: hoistExtension Function
 * Tests for extension hoisting, namespacing, and event emission utilities
 *
 * Specification Mapping (extension-hoisting-dx/specifications/phase-1-implementation.md):
 *
 * Success Criteria (AC-1 to AC-13):
 * - AC-1: Valid extension hoisted returns separated functions and dispose
 * - AC-2: Extension without dispose returns functions, dispose undefined
 * - AC-5: Multiple extensions hoisted with correct namespace prefixes
 * - AC-9: dispose not leaked to functions record
 * - AC-10: Extension with 0 functions returns empty record
 * - AC-11: Namespace with max length (100+ chars) accepted
 * - AC-12: dispose returns Promise for async cleanup
 * - AC-3: emitExtensionEvent with callbacks invokes callback
 * - AC-4: emitExtensionEvent without callbacks gracefully no-ops
 *
 * Error Contracts (EC-1 to EC-7):
 * - EC-1: Invalid namespace format throws error with regex message
 * - EC-2: Empty namespace throws error
 * - EC-3: Null/undefined extension throws TypeError
 * - AC-13: Extension is primitive (string, number) throws TypeError
 * - EC-4: Null/undefined context throws TypeError
 * - EC-5: Empty event.event throws error
 * - EC-6: Invalid namespace in prefixFunctions throws error
 * - EC-7: Extension not object throws TypeError
 *
 * Total: 17 test scenarios covering all acceptance criteria and error contracts
 */

import { describe, expect, it } from 'vitest';
import type { ExtensionResult } from '../../../src/runtime/ext/extensions.js';
import {
  hoistExtension,
  emitExtensionEvent,
  prefixFunctions,
} from '../../../src/runtime/ext/extensions.js';
import { run } from '../../helpers/runtime.js';
import { createRuntimeContext } from '../../../src/runtime/core/context.js';
import type { ExtensionEvent } from '../../../src/runtime/core/types.js';

describe('hoistExtension: Success Cases', () => {
  describe('AC-1: Valid extension hoisted returns separated functions and dispose', () => {
    it('separates functions from dispose for createRuntimeContext', async () => {
      const extension: ExtensionResult = {
        greet: {
          params: [{ name: 'name', type: 'string' }],
          fn: (args) => `Hello, ${args[0]}!`,
        },
        farewell: {
          params: [{ name: 'name', type: 'string' }],
          fn: (args) => `Goodbye, ${args[0]}!`,
        },
        dispose: () => {
          // cleanup
        },
      };

      const hoisted = hoistExtension('app', extension);

      // Verify structure matches HoistedExtension interface
      expect(hoisted.functions).toBeDefined();
      expect(hoisted.dispose).toBeDefined();

      // Verify functions are prefixed correctly
      expect(hoisted.functions['app::greet']).toBeDefined();
      expect(hoisted.functions['app::farewell']).toBeDefined();
      expect(
        hoisted.functions['greet' as keyof typeof hoisted.functions]
      ).toBeUndefined();

      // Verify dispose is preserved as function
      expect(typeof hoisted.dispose).toBe('function');

      // Verify functions work with runtime
      const result = await run('app::greet("World")', {
        functions: hoisted.functions,
      });
      expect(result).toBe('Hello, World!');
    });

    it('hoisted functions integrate with createRuntimeContext', () => {
      const extension: ExtensionResult = {
        double: {
          params: [{ name: 'x', type: 'number' }],
          fn: (args) => (args[0] as number) * 2,
        },
      };

      const { functions } = hoistExtension('math', extension);

      // Should not throw when passed to createRuntimeContext
      const ctx = createRuntimeContext({ functions });
      expect(ctx).toBeDefined();
    });
  });

  describe('AC-2: Extension without dispose returns functions, dispose undefined', () => {
    it('handles extension without dispose method', () => {
      const extension: ExtensionResult = {
        add: {
          params: [
            { name: 'a', type: 'number' },
            { name: 'b', type: 'number' },
          ],
          fn: (args) => (args[0] as number) + (args[1] as number),
        },
      };

      const hoisted = hoistExtension('math', extension);

      // Verify functions exist
      expect(hoisted.functions['math::add']).toBeDefined();

      // Verify dispose is undefined when not provided (exactOptionalPropertyTypes)
      expect(hoisted.dispose).toBeUndefined();
    });

    it('functions work correctly without dispose', async () => {
      const extension: ExtensionResult = {
        triple: {
          params: [{ name: 'x', type: 'number' }],
          fn: (args) => (args[0] as number) * 3,
        },
      };

      const { functions } = hoistExtension('calc', extension);

      const result = await run('calc::triple(7)', { functions });
      expect(result).toBe(21);
    });
  });

  describe('AC-5: Multiple extensions hoisted with correct namespace prefixes', () => {
    it('hoists multiple extensions with different namespaces', async () => {
      const extension1: ExtensionResult = {
        read: {
          params: [{ name: 'path', type: 'string' }],
          fn: (args) => `reading ${args[0]}`,
        },
      };

      const extension2: ExtensionResult = {
        query: {
          params: [{ name: 'sql', type: 'string' }],
          fn: (args) => `querying ${args[0]}`,
        },
      };

      const hoisted1 = hoistExtension('fs', extension1);
      const hoisted2 = hoistExtension('db', extension2);

      // Verify each namespace prefix applied correctly
      expect(hoisted1.functions['fs::read']).toBeDefined();
      expect(hoisted2.functions['db::query']).toBeDefined();

      // Verify no cross-contamination
      expect(
        hoisted1.functions['fs::query' as keyof typeof hoisted1.functions]
      ).toBeUndefined();
      expect(
        hoisted2.functions['db::read' as keyof typeof hoisted2.functions]
      ).toBeUndefined();

      // Verify both work in runtime
      const result1 = await run('fs::read("test.txt")', {
        functions: hoisted1.functions,
      });
      expect(result1).toBe('reading test.txt');

      const result2 = await run('db::query("SELECT * FROM users")', {
        functions: hoisted2.functions,
      });
      expect(result2).toBe('querying SELECT * FROM users');
    });

    it('combines multiple hoisted extensions in single runtime context', async () => {
      const ext1: ExtensionResult = {
        upper: {
          params: [{ name: 's', type: 'string' }],
          fn: (args) => (args[0] as string).toUpperCase(),
        },
      };

      const ext2: ExtensionResult = {
        lower: {
          params: [{ name: 's', type: 'string' }],
          fn: (args) => (args[0] as string).toLowerCase(),
        },
      };

      const { functions: f1 } = hoistExtension('str1', ext1);
      const { functions: f2 } = hoistExtension('str2', ext2);

      // Combine functions from multiple extensions
      const combined = { ...f1, ...f2 };

      const result = await run('str1::upper("hello") -> str2::lower()', {
        functions: combined,
      });
      expect(result).toBe('hello'); // HELLO -> hello
    });
  });

  describe('AC-9: dispose not leaked to functions record', () => {
    it('functions record does not contain dispose property', () => {
      const extension: ExtensionResult = {
        test: {
          params: [],
          fn: () => 'test',
        },
        dispose: () => {
          // cleanup
        },
      };

      const hoisted = hoistExtension('ext', extension);

      // Verify dispose is not in functions record
      expect(
        hoisted.functions['dispose' as keyof typeof hoisted.functions]
      ).toBeUndefined();

      // Verify only test function is in functions
      const functionKeys = Object.keys(hoisted.functions);
      expect(functionKeys).toHaveLength(1);
      expect(functionKeys).toEqual(['ext::test']);

      // Verify dispose exists separately
      expect(hoisted.dispose).toBeDefined();
    });

    it('dispose remains callable after separation', () => {
      let disposed = false;

      const extension: ExtensionResult = {
        work: {
          params: [],
          fn: () => 'working',
        },
        dispose: () => {
          disposed = true;
        },
      };

      const hoisted = hoistExtension('worker', extension);

      // Call dispose and verify it works
      hoisted.dispose!();
      expect(disposed).toBe(true);
    });
  });

  describe('AC-10: Extension with 0 functions returns empty record', () => {
    it('handles extension with only dispose method', () => {
      let disposed = false;

      const extension: ExtensionResult = {
        dispose: () => {
          disposed = true;
        },
      };

      const hoisted = hoistExtension('empty', extension);

      // Verify functions is empty record
      expect(hoisted.functions).toEqual({});
      expect(Object.keys(hoisted.functions)).toHaveLength(0);

      // Verify dispose still works
      expect(hoisted.dispose).toBeDefined();
      hoisted.dispose!();
      expect(disposed).toBe(true);
    });

    it('handles truly empty extension (no functions, no dispose)', () => {
      const extension: ExtensionResult = {};

      const hoisted = hoistExtension('bare', extension);

      // Verify functions is empty
      expect(hoisted.functions).toEqual({});
      expect(Object.keys(hoisted.functions)).toHaveLength(0);

      // Verify dispose is undefined
      expect(hoisted.dispose).toBeUndefined();
    });
  });

  describe('AC-11: Namespace with max length (100+ chars) accepted', () => {
    it('accepts namespace with 100 characters', async () => {
      const longNamespace = 'a'.repeat(100);
      const extension: ExtensionResult = {
        test: {
          params: [],
          fn: () => 'success',
        },
      };

      const hoisted = hoistExtension(longNamespace, extension);
      const expectedKey = `${longNamespace}::test`;

      expect(hoisted.functions[expectedKey]).toBeDefined();

      // Verify works in runtime
      const result = await run(`${longNamespace}::test()`, {
        functions: hoisted.functions,
      });
      expect(result).toBe('success');
    });

    it('accepts namespace longer than 100 characters', () => {
      const veryLongNamespace = 'extension_' + 'x'.repeat(150);
      const extension: ExtensionResult = {
        func: {
          params: [],
          fn: () => 'works',
        },
      };

      const hoisted = hoistExtension(veryLongNamespace, extension);
      const expectedKey = `${veryLongNamespace}::func`;

      expect(hoisted.functions[expectedKey]).toBeDefined();
      expect(veryLongNamespace.length).toBeGreaterThan(100);
    });
  });

  describe('AC-12: dispose returns Promise for async cleanup', () => {
    it('preserves async dispose method', async () => {
      let disposed = false;

      const extension: ExtensionResult = {
        test: {
          params: [],
          fn: () => 'done',
        },
        dispose: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          disposed = true;
        },
      };

      const hoisted = hoistExtension('async_ext', extension);

      expect(hoisted.dispose).toBeDefined();

      // Call async dispose
      await hoisted.dispose!();
      expect(disposed).toBe(true);
    });

    it('async dispose can perform cleanup operations', async () => {
      const cleanupLog: string[] = [];

      const extension: ExtensionResult = {
        connect: {
          params: [],
          fn: () => 'connected',
        },
        dispose: async () => {
          cleanupLog.push('closing connections');
          await new Promise((resolve) => setTimeout(resolve, 5));
          cleanupLog.push('releasing resources');
          await new Promise((resolve) => setTimeout(resolve, 5));
          cleanupLog.push('cleanup complete');
        },
      };

      const hoisted = hoistExtension('db', extension);

      await hoisted.dispose!();

      expect(cleanupLog).toEqual([
        'closing connections',
        'releasing resources',
        'cleanup complete',
      ]);
    });
  });
});

describe('hoistExtension: Error Contract Tests', () => {
  describe('EC-1, AC-6: Invalid namespace format throws error with regex message', () => {
    it('throws Error for namespace with spaces', () => {
      const extension: ExtensionResult = {
        test: { params: [], fn: () => 'test' },
      };

      expect(() => hoistExtension('my extension', extension)).toThrow(
        'Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/'
      );
    });

    it('throws Error for namespace with special characters', () => {
      const extension: ExtensionResult = {
        test: { params: [], fn: () => 'test' },
      };

      expect(() => hoistExtension('my@extension', extension)).toThrow(
        'Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/'
      );
      expect(() => hoistExtension('ext.name', extension)).toThrow(
        'Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/'
      );
      expect(() => hoistExtension('ext:name', extension)).toThrow(
        'Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/'
      );
    });

    it('throws Error with correct regex pattern in message', () => {
      const extension: ExtensionResult = {
        test: { params: [], fn: () => 'test' },
      };

      try {
        hoistExtension('invalid!namespace', extension);
        expect.fail('Expected error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error;
        expect(error.message).toContain('Invalid namespace format');
        expect(error.message).toContain('/^[a-zA-Z0-9_-]+$/');
      }
    });
  });

  describe('EC-2: Empty namespace throws error', () => {
    it('throws Error when namespace is empty string', () => {
      const extension: ExtensionResult = {
        test: { params: [], fn: () => 'test' },
      };

      expect(() => hoistExtension('', extension)).toThrow(
        'Namespace cannot be empty'
      );
    });

    it('error is plain Error, not TypeError', () => {
      const extension: ExtensionResult = {
        test: { params: [], fn: () => 'test' },
      };

      try {
        hoistExtension('', extension);
        expect.fail('Expected error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(TypeError);
      }
    });
  });

  describe('EC-3, AC-7: Null/undefined extension throws TypeError', () => {
    it('throws TypeError for null extension', () => {
      expect(() =>
        hoistExtension('test', null as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        hoistExtension('test', null as unknown as ExtensionResult)
      ).toThrow('Extension cannot be null or undefined');
    });

    it('throws TypeError for undefined extension', () => {
      expect(() =>
        hoistExtension('test', undefined as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        hoistExtension('test', undefined as unknown as ExtensionResult)
      ).toThrow('Extension cannot be null or undefined');
    });

    it('error message is specific to extension parameter', () => {
      try {
        hoistExtension('test', null as unknown as ExtensionResult);
        expect.fail('Expected error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TypeError);
        const error = err as TypeError;
        expect(error.message).toBe('Extension cannot be null or undefined');
      }
    });
  });

  describe('AC-13: Extension is primitive (string, number) throws TypeError', () => {
    it('throws TypeError when extension is a string', () => {
      expect(() =>
        hoistExtension('test', 'not-an-object' as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        hoistExtension('test', 'not-an-object' as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });

    it('throws TypeError when extension is a number', () => {
      expect(() =>
        hoistExtension('test', 42 as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        hoistExtension('test', 42 as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });

    it('throws TypeError when extension is a boolean', () => {
      expect(() =>
        hoistExtension('test', true as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        hoistExtension('test', true as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });

    it('throws TypeError when extension is an array', () => {
      expect(() =>
        hoistExtension('test', [] as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        hoistExtension('test', [] as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });
  });
});

describe('emitExtensionEvent: Success Cases', () => {
  describe('AC-3: emitExtensionEvent with callbacks invokes callback', () => {
    it('calls onLogEvent when callback is defined', () => {
      const events: ExtensionEvent[] = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLogEvent: (event) => events.push(event),
        },
      });

      emitExtensionEvent(ctx, {
        event: 'extension_loaded',
        subsystem: 'extension:test',
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.event).toBe('extension_loaded');
      expect(events[0]!.subsystem).toBe('extension:test');
      expect(events[0]!.timestamp).toBeDefined();
    });

    it('auto-adds ISO timestamp when not provided', () => {
      const events: ExtensionEvent[] = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLogEvent: (event) => events.push(event),
        },
      });

      const beforeTime = Date.now();
      emitExtensionEvent(ctx, {
        event: 'test_event',
        subsystem: 'extension:test',
      });
      const afterTime = Date.now();

      expect(events).toHaveLength(1);
      expect(events[0]!.timestamp).toBeDefined();
      expect(events[0]!.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );

      const eventTime = new Date(events[0]!.timestamp!).getTime();
      expect(eventTime).toBeGreaterThanOrEqual(beforeTime);
      expect(eventTime).toBeLessThanOrEqual(afterTime);
    });

    it('preserves custom timestamp when provided', () => {
      const events: ExtensionEvent[] = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLogEvent: (event) => events.push(event),
        },
      });

      const customTimestamp = '2024-12-25T10:30:00.000Z';
      emitExtensionEvent(ctx, {
        event: 'custom_time',
        subsystem: 'extension:test',
        timestamp: customTimestamp,
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.timestamp).toBe(customTimestamp);
    });
  });

  describe('AC-4: emitExtensionEvent without callbacks gracefully no-ops', () => {
    it('does not throw when onLogEvent callback is undefined', () => {
      const ctx = createRuntimeContext({
        callbacks: {},
      });

      expect(() => {
        emitExtensionEvent(ctx, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).not.toThrow();
    });

    it('does not throw when callbacks property is undefined', () => {
      const ctx = createRuntimeContext({});

      expect(() => {
        emitExtensionEvent(ctx, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).not.toThrow();
    });

    it('accepts context-like object without callbacks property', () => {
      const minimalCtx = {};

      expect(() => {
        emitExtensionEvent(minimalCtx, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).not.toThrow();
    });

    it('accepts context-like object with undefined callbacks', () => {
      const minimalCtx = {
        callbacks: undefined,
      };

      expect(() => {
        emitExtensionEvent(minimalCtx, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).not.toThrow();
    });
  });
});

describe('emitExtensionEvent: Error Contract Tests', () => {
  describe('EC-4: Null/undefined context throws TypeError', () => {
    it('throws TypeError when context is null', () => {
      expect(() => {
        emitExtensionEvent(null as never, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).toThrow(TypeError);
      expect(() => {
        emitExtensionEvent(null as never, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).toThrow('Context cannot be null or undefined');
    });

    it('throws TypeError when context is undefined', () => {
      expect(() => {
        emitExtensionEvent(undefined as never, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).toThrow(TypeError);
      expect(() => {
        emitExtensionEvent(undefined as never, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).toThrow('Context cannot be null or undefined');
    });
  });

  describe('EC-5, AC-8: Empty event.event throws error', () => {
    it('throws Error when event.event is empty string', () => {
      const ctx = createRuntimeContext({
        callbacks: {
          onLogEvent: () => {},
        },
      });

      expect(() => {
        emitExtensionEvent(ctx, {
          event: '',
          subsystem: 'extension:test',
        });
      }).toThrow('Event must include non-empty event field');
    });

    it('throws Error when event.event is only whitespace', () => {
      const ctx = createRuntimeContext({
        callbacks: {
          onLogEvent: () => {},
        },
      });

      expect(() => {
        emitExtensionEvent(ctx, {
          event: '   ',
          subsystem: 'extension:test',
        });
      }).toThrow('Event must include non-empty event field');
    });

    it('throws Error when event.event is undefined', () => {
      const ctx = createRuntimeContext({
        callbacks: {
          onLogEvent: () => {},
        },
      });

      expect(() => {
        emitExtensionEvent(ctx, {
          event: undefined as never,
          subsystem: 'extension:test',
        });
      }).toThrow('Event must include non-empty event field');
    });

    it('error is plain Error, not TypeError', () => {
      const ctx = createRuntimeContext({
        callbacks: {
          onLogEvent: () => {},
        },
      });

      try {
        emitExtensionEvent(ctx, {
          event: '',
          subsystem: 'extension:test',
        });
        expect.fail('Expected error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(TypeError);
      }
    });
  });
});

describe('prefixFunctions: Error Contract Tests', () => {
  describe('EC-6: Invalid namespace in prefixFunctions throws error', () => {
    it('throws Error for empty namespace', () => {
      const extension: ExtensionResult = {
        test: { params: [], fn: () => 'test' },
      };

      expect(() => prefixFunctions('', extension)).toThrow(
        'Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/'
      );
    });

    it('throws Error for namespace with spaces', () => {
      const extension: ExtensionResult = {
        test: { params: [], fn: () => 'test' },
      };

      expect(() => prefixFunctions('my extension', extension)).toThrow(
        'Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/'
      );
    });

    it('throws Error for namespace with special characters', () => {
      const extension: ExtensionResult = {
        test: { params: [], fn: () => 'test' },
      };

      expect(() => prefixFunctions('ext@name', extension)).toThrow(
        'Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/'
      );
      expect(() => prefixFunctions('ext.name', extension)).toThrow(
        'Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/'
      );
    });
  });

  describe('EC-7: Extension not object throws TypeError', () => {
    it('throws TypeError when extension is null', () => {
      expect(() =>
        prefixFunctions('test', null as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        prefixFunctions('test', null as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });

    it('throws TypeError when extension is undefined', () => {
      expect(() =>
        prefixFunctions('test', undefined as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        prefixFunctions('test', undefined as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });

    it('throws TypeError when extension is a number', () => {
      expect(() =>
        prefixFunctions('test', 42 as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        prefixFunctions('test', 42 as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });

    it('throws TypeError when extension is a string', () => {
      expect(() =>
        prefixFunctions('test', 'not-an-object' as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        prefixFunctions('test', 'not-an-object' as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });

    it('throws TypeError when extension is an array', () => {
      expect(() =>
        prefixFunctions('test', [] as unknown as ExtensionResult)
      ).toThrow(TypeError);
      expect(() =>
        prefixFunctions('test', [] as unknown as ExtensionResult)
      ).toThrow('Extension must be an object');
    });
  });
});
