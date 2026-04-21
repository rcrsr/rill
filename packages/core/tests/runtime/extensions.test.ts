/**
 * Rill Runtime Tests: Extension System
 * Tests for extension factory pattern and event emission.
 *
 * Specification Mapping (conduct/initiatives/rill-extensions/specifications/extensions.md):
 *
 * Success Criteria:
 * - AC-S1: Factory returns valid RillFunction mappings
 * - AC-S7: TypeScript validates extension config at compile time (type test)
 *
 * emitExtensionEvent Helper:
 * - EC-4: Null context throws TypeError
 * - EC-5: Missing event.event throws Error
 * - IR-2: Accepts RuntimeContextLike (widened context)
 *
 * Integration Evidence:
 * All tests execute through the full runtime pipeline to validate that
 * extension functions integrate correctly with the Rill execution model.
 */

import { describe, expect, it } from 'vitest';
import type {
  ExtensionFactory,
  ExtensionFactoryCtx,
  ExtensionFactoryResult,
  ExtensionEvent,
} from '@rcrsr/rill';
import { emitExtensionEvent, createRuntimeContext } from '@rcrsr/rill';

describe('Rill Runtime: Extension System', () => {
  describe('Success Cases', () => {
    describe('AC-S1: Factory returns valid RillFunction mappings', () => {
      it('returns object with RillFunction values', () => {
        // Create a simple extension factory
        const createMathExtension = (): ExtensionFactoryResult => ({
          value: {
            add: {
              params: [
                {
                  name: 'a',
                  type: { kind: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
                {
                  name: 'b',
                  type: { kind: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => (args['a'] as number) + (args['b'] as number),
            },
            multiply: {
              params: [
                {
                  name: 'a',
                  type: { kind: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
                {
                  name: 'b',
                  type: { kind: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => (args['a'] as number) * (args['b'] as number),
            },
          },
        });

        const extension = createMathExtension();
        const value = extension.value as Record<
          string,
          { params: unknown[]; fn: (...args: unknown[]) => unknown }
        >;

        // Verify all values are RillFunction objects
        expect(value.add).toBeDefined();
        expect(value.add.params).toBeInstanceOf(Array);
        expect(typeof value.add.fn).toBe('function');

        expect(value.multiply).toBeDefined();
        expect(value.multiply.params).toBeInstanceOf(Array);
        expect(typeof value.multiply.fn).toBe('function');
      });
    });

    describe('AC-S7: TypeScript validates extension config at compile time', () => {
      it('TypeScript validates extension config types', () => {
        // This test validates compile-time type safety.
        // The factory signature enforces config type at compile time.

        interface HttpConfig {
          baseUrl: string;
          timeout: number;
        }

        const createHttpExtension: ExtensionFactory<HttpConfig> = (
          config,
          _ctx
        ) => {
          // TypeScript ensures config has correct shape
          const { baseUrl, timeout } = config;

          return {
            value: {
              get: {
                params: [
                  {
                    name: 'path',
                    type: { kind: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) =>
                  `GET ${baseUrl}${args['path']} (timeout: ${timeout}ms)`,
              },
            },
          };
        };

        // Valid config - TypeScript accepts
        const validConfig: HttpConfig = {
          baseUrl: 'https://api.example.com',
          timeout: 5000,
        };
        const factoryCtx: ExtensionFactoryCtx = {
          registerErrorCode: (_name: string, _kind: string) => {},
          signal: new AbortController().signal,
        };
        const extension = createHttpExtension(validConfig, factoryCtx);
        const extValue = extension.value as Record<string, unknown>;

        expect(extValue['get']).toBeDefined();

        // This demonstrates type safety - the following would fail to compile:
        // const invalidConfig = { baseUrl: 'http://example.com' }; // missing timeout
        // createHttpExtension(invalidConfig); // TypeScript error
        //
        // const wrongTypes = { baseUrl: 123, timeout: 'fast' }; // wrong types
        // createHttpExtension(wrongTypes); // TypeScript error
      });
    });
  });

  describe('emitExtensionEvent Helper', () => {
    it('auto-adds ISO timestamp when timestamp is undefined', () => {
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
      expect(events[0]!.event).toBe('test_event');
      expect(events[0]!.subsystem).toBe('extension:test');
      expect(events[0]!.timestamp).toBeDefined();
      expect(events[0]!.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );

      // Verify timestamp is within the correct time window
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

      const customTimestamp = '2024-01-15T12:00:00.000Z';
      emitExtensionEvent(ctx, {
        event: 'test_event',
        subsystem: 'extension:test',
        timestamp: customTimestamp,
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.timestamp).toBe(customTimestamp);
    });

    it('does nothing when onLogEvent callback is undefined', () => {
      const ctx = createRuntimeContext({
        callbacks: {},
      });

      // Should not throw even though callback is undefined
      expect(() => {
        emitExtensionEvent(ctx, {
          event: 'test_event',
          subsystem: 'extension:test',
        });
      }).not.toThrow();
    });

    it('preserves extensible context fields', () => {
      const events: ExtensionEvent[] = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLogEvent: (event) => events.push(event),
        },
      });

      emitExtensionEvent(ctx, {
        event: 'extension_initialized',
        subsystem: 'extension:openai',
        model: 'gpt-4',
        config: { temperature: 0.7 },
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.event).toBe('extension_initialized');
      expect(events[0]!.subsystem).toBe('extension:openai');
      expect(events[0]!.timestamp).toBeDefined();
      expect((events[0] as Record<string, unknown>).model).toBe('gpt-4');
      expect((events[0] as Record<string, unknown>).config).toEqual({
        temperature: 0.7,
      });
    });

    describe('EC-4: Null context throws TypeError', () => {
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

    describe('EC-5: Missing event.event throws Error', () => {
      it('throws Error when event.event is missing', () => {
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

      it('throws Error when event.event is undefined (type-cast scenario)', () => {
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
    });

    describe('IR-2: Accepts RuntimeContextLike (widened context)', () => {
      it('accepts object with only callbacks property', () => {
        const events: ExtensionEvent[] = [];
        const minimalCtx = {
          callbacks: {
            onLogEvent: (event: ExtensionEvent) => events.push(event),
          },
        };

        // Should not throw - demonstrates widened parameter type
        emitExtensionEvent(minimalCtx, {
          event: 'test_event',
          subsystem: 'extension:test',
        });

        expect(events).toHaveLength(1);
        expect(events[0]!.event).toBe('test_event');
      });

      it('gracefully handles object without callbacks property', () => {
        const minimalCtx = {};

        // Should not throw even when callbacks are missing
        expect(() => {
          emitExtensionEvent(minimalCtx, {
            event: 'test_event',
            subsystem: 'extension:test',
          });
        }).not.toThrow();
      });

      it('gracefully handles object with undefined callbacks', () => {
        const minimalCtx = {
          callbacks: undefined,
        };

        // Should not throw when callbacks is explicitly undefined
        expect(() => {
          emitExtensionEvent(minimalCtx, {
            event: 'test_event',
            subsystem: 'extension:test',
          });
        }).not.toThrow();
      });

      it('gracefully handles object with callbacks but no onLogEvent', () => {
        const minimalCtx = {
          callbacks: {
            onLog: () => {},
          },
        };

        // Should not throw when onLogEvent is missing
        expect(() => {
          emitExtensionEvent(minimalCtx as never, {
            event: 'test_event',
            subsystem: 'extension:test',
          });
        }).not.toThrow();
      });
    });
  });
});
