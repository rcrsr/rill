/**
 * Rill Runtime Tests: Host Type Validation
 *
 * RillParam validation:
 * - list(string) accepts list(string), rejects list(number)
 * - type: undefined accepts any type without error
 * - dict param with named fields validates argument structure
 * - Missing required param → RUNTIME_TYPE_ERROR
 * - Optional param with defaultValue applies default when omitted
 * - Default value type mismatch → Error at registration time
 * - list(string) rejects list(number) — mismatch location in error message
 * - Script closure and host function with identical param type use same validation
 *
 * Error contracts:
 * - defaultValue: 42 on type: string → Error at registration
 * - typed param with zero args → RuntimeError RILL-R044 naming missing param
 * - 1-param function called with 3 args → RuntimeError with expected vs actual
 *
 * Not covered: union-typed param validation.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  ERROR_REGISTRY,
  RuntimeError,
} from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';
import { expectHalt, expectRuntimeError } from '../helpers/halt.js';

describe('Rill Runtime: Host Type Validation', () => {
  describe('list(string) param accepts matching type, rejects mismatched element type', () => {
    it('accepts list(string) argument for list(string) param', async () => {
      const result = await run('greet(["alice", "bob"])', {
        functions: {
          greet: {
            params: [
              {
                name: 'names',
                type: { kind: 'list', element: { kind: 'string' } },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => (args['names'] as string[]).join(', '),
          },
        },
      });
      expect(result).toBe('alice, bob');
    });

    it('rejects list(number) argument for list(string) param with RILL-R001', async () => {
      await expectRuntimeError(
        () =>
          run('process([1, 2, 3])', {
            functions: {
              process: {
                params: [
                  {
                    name: 'items',
                    type: { kind: 'list', element: { kind: 'string' } },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args['items'],
              },
            },
          }),
        { code: 'RILL-R001' }
      );
    });

    it('error message names expected type list(string) and actual type list', async () => {
      // error message mentions mismatch location
      try {
        await run('process([1, 2, 3])', {
          functions: {
            process: {
              params: [
                {
                  name: 'items',
                  type: { kind: 'list', element: { kind: 'string' } },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['items'],
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const msg = (err as RuntimeError).message;
        expect(msg).toContain('items');
        expect(msg).toContain('list');
      }
    });
  });

  describe('type: undefined accepts any value without validation', () => {
    it('accepts string when type: undefined', async () => {
      const result = await run('anything("hello")', {
        functions: {
          anything: {
            params: [
              {
                name: 'value',
                type: undefined,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['value'],
          },
        },
      });
      expect(result).toBe('hello');
    });

    it('accepts number when type: undefined', async () => {
      const result = await run('anything(42)', {
        functions: {
          anything: {
            params: [
              {
                name: 'value',
                type: undefined,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['value'],
          },
        },
      });
      expect(result).toBe(42);
    });

    it('accepts list when type: undefined', async () => {
      const result = await run('anything([1, 2, 3])', {
        functions: {
          anything: {
            params: [
              {
                name: 'value',
                type: undefined,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['value'],
          },
        },
      });
      expect(result).toEqual([1, 2, 3]);
    });

    it('accepts dict when type: undefined', async () => {
      const result = await run('anything([a: 1])', {
        functions: {
          anything: {
            params: [
              {
                name: 'value',
                type: undefined,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['value'],
          },
        },
      });
      expect(result).toEqual({ a: 1 });
    });
  });

  describe('dict param with named fields validates argument structure', () => {
    it('accepts dict argument matching named fields', async () => {
      const result = await run('process([name: "alice", age: 30])', {
        functions: {
          process: {
            params: [
              {
                name: 'person',
                type: {
                  kind: 'dict',
                  fields: {
                    name: { type: { kind: 'string' } },
                    age: { type: { kind: 'number' } },
                  },
                },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => {
              const person = args['person'] as { name: string; age: number };
              return `${person.name} is ${person.age}`;
            },
          },
        },
      });
      expect(result).toBe('alice is 30');
    });

    it('rejects non-dict argument for dict param', async () => {
      await expectRuntimeError(
        () =>
          run('process("not-a-dict")', {
            functions: {
              process: {
                params: [
                  {
                    name: 'person',
                    type: { kind: 'dict' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args) => args['person'],
              },
            },
          }),
        { code: 'RILL-R001' }
      );
    });

    it('accepts any dict for dict param without fields constraint', async () => {
      // dict param with no fields matches any dict
      const result = await run('process([x: 1, y: 2, z: 3])', {
        functions: {
          process: {
            params: [
              {
                name: 'data',
                type: { kind: 'dict' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['data'],
          },
        },
      });
      expect(result).toEqual({ x: 1, y: 2, z: 3 });
    });
  });

  describe('Missing required param raises RuntimeError RILL-R044', () => {
    it('throws RILL-R044 when required param omitted', async () => {
      // typed param with zero args → RuntimeError naming missing param
      try {
        await run('process()', {
          functions: {
            process: {
              params: [
                {
                  name: 'input',
                  type: { kind: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['input'],
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        expect(rErr.errorId).toBe('RILL-R044');
        expect(rErr.message).toContain('input');
      }
    });

    it('error message names the missing parameter', async () => {
      try {
        await run('greet()', {
          functions: {
            greet: {
              params: [
                {
                  name: 'username',
                  type: { kind: 'string' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => `Hello ${args['username']}`,
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).message).toContain('username');
      }
    });
  });

  describe('Optional param with defaultValue applies default when omitted', () => {
    it('applies string default when param omitted', async () => {
      const result = await run('greet()', {
        functions: {
          greet: {
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: 'world',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
          },
        },
      });
      expect(result).toBe('Hello world');
    });

    it('applies number default when param omitted', async () => {
      const result = await run('scale()', {
        functions: {
          scale: {
            params: [
              {
                name: 'factor',
                type: { kind: 'number' },
                defaultValue: 2,
                annotations: {},
              },
            ],
            fn: (args) => (args['factor'] as number) * 10,
          },
        },
      });
      expect(result).toBe(20);
    });

    it('uses provided value instead of default when arg supplied', async () => {
      const result = await run('greet("alice")', {
        functions: {
          greet: {
            params: [
              {
                name: 'name',
                type: { kind: 'string' },
                defaultValue: 'world',
                annotations: {},
              },
            ],
            fn: (args) => `Hello ${args['name']}`,
          },
        },
      });
      expect(result).toBe('Hello alice');
    });
  });

  describe('Default value type mismatch throws Error at registration', () => {
    it('throws Error at registration when defaultValue: 42 on type: string param', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            broken: {
              params: [
                {
                  name: 'label',
                  type: { kind: 'string' },
                  defaultValue: 42,
                  annotations: {},
                },
              ],
              fn: (args) => args['x'],
            },
          },
        })
      ).toThrow(/defaultValue.*label|label.*defaultValue/i);
    });

    it('throws Error at registration when defaultValue is bool for number param', () => {
      expect(() =>
        createRuntimeContext({
          functions: {
            broken: {
              params: [
                {
                  name: 'count',
                  type: { kind: 'number' },
                  defaultValue: true,
                  annotations: {},
                },
              ],
              fn: (args) => args['x'],
            },
          },
        })
      ).toThrow(/defaultValue.*count|count.*expected/i);
    });
  });

  describe('Excess arguments raises RuntimeError with expected vs actual count', () => {
    it('throws RILL-R045 when 3 args passed to 1-param function', async () => {
      try {
        await run('fn(1, 2, 3)', {
          functions: {
            fn: {
              params: [
                {
                  name: 'x',
                  type: { kind: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['x'],
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        expect(rErr.errorId).toBe('RILL-R045');
        // Error message should mention expected count vs actual count
        expect(rErr.message).toMatch(/expects 1 arguments, got 3/);
      }
    });

    it('error context contains expectedCount and actualCount', async () => {
      try {
        await run('fn(1, 2, 3)', {
          functions: {
            fn: {
              params: [
                {
                  name: 'x',
                  type: { kind: 'number' },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => args['x'],
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        const ctx = rErr.context as Record<string, unknown>;
        expect(ctx['expectedCount']).toBe(1);
        expect(ctx['actualCount']).toBe(3);
      }
    });

    it('registry message template renders the thrown message from its context', async () => {
      const err = await run('fn(1, 2, 3)', {
        functions: {
          fn: {
            params: [
              {
                name: 'x',
                type: { kind: 'number' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['x'],
          },
        },
      }).then(
        () => expect.fail('Should have thrown'),
        (e: unknown) => e as RuntimeError
      );
      const template = ERROR_REGISTRY.get('RILL-R045')!.messageTemplate;
      const ctx = err.context as Record<string, unknown>;
      const rendered = template.replace(/\{(\w+)\}/g, (_, key: string) =>
        String(ctx[key])
      );
      expect(err.message.startsWith(rendered)).toBe(true);
    });
  });

  describe('Script closure uses same validation logic as host function', () => {
    it('calling an unbound closure variable halts RILL-R005', async () => {
      await expectHalt(
        () =>
          run('$fn(42)', {
            variables: {
              fn: null as never, // placeholder, defined via script
            },
            functions: {
              mkFn: {
                params: [],
                fn: () => null,
              },
            },
          }),
        { code: 'RILL_R005', hostErrorId: 'RILL-R005' }
      );
    });

    it('script closure type-checks same as host function for string param', async () => {
      // A script closure with |name: string| rejects non-string
      await expectRuntimeError(
        () =>
          run(`
          |name: string| { $name } => $greet
          $greet(42)
        `),
        { code: 'RILL-R001' }
      );
    });

    it('script closure with string param accepts string argument like host function', async () => {
      const result = await run(`
        |name: string| { $name } => $greet
        "alice" -> $greet
      `);
      expect(result).toBe('alice');
    });
  });

  describe('Boundary: Zero-param function invokes without error', () => {
    it('zero-param function registers and invokes without error', async () => {
      const result = await run('ping()', {
        functions: {
          ping: {
            params: [],
            fn: () => 'pong',
          },
        },
      });
      expect(result).toBe('pong');
    });
  });

  describe('Boundary: type: { type: "any" } and type: undefined both accept any value', () => {
    it('type: { type: "any" } accepts string', async () => {
      const result = await run('fn("hello")', {
        functions: {
          fn: {
            params: [
              {
                name: 'val',
                type: { kind: 'any' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['val'],
          },
        },
      });
      expect(result).toBe('hello');
    });

    it('type: { type: "any" } accepts number', async () => {
      const result = await run('fn(42)', {
        functions: {
          fn: {
            params: [
              {
                name: 'val',
                type: { kind: 'any' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['val'],
          },
        },
      });
      expect(result).toBe(42);
    });

    it('type: { type: "any" } accepts list', async () => {
      const result = await run('fn([1, 2])', {
        functions: {
          fn: {
            params: [
              {
                name: 'val',
                type: { kind: 'any' },
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (args) => args['val'],
          },
        },
      });
      expect(result).toEqual([1, 2]);
    });
  });
});
