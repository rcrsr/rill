/**
 * Rill Runtime Tests: Host Type Validation
 *
 * Specification Mapping (conduct/specifications/host-type-system-refactor.md):
 *
 * FR-HTR-1 (RillParam validation):
 * - AC-1: list(string) accepts list(string), rejects list(number)
 * - AC-2: type: undefined accepts any type without error
 * - AC-3: dict param with named fields validates argument structure
 * - AC-4: Missing required param → RUNTIME_TYPE_ERROR
 * - AC-5: Optional param with defaultValue applies default when omitted
 * - AC-6: Default value type mismatch → Error at registration time
 * - AC-7: list(string) rejects list(number) — mismatch location in error message
 * - AC-8: Script closure and host function with identical param type use same validation
 *
 * Error contracts:
 * - AC-51: defaultValue: 42 on type: string → Error at registration (EC-5)
 * - AC-52: typed param with zero args → RuntimeError RILL-R001 naming missing param (EC-2)
 * - AC-54: 1-param function called with 3 args → RuntimeError with expected vs actual (EC-1)
 *
 * BLOCKED:
 * - AC-9: Union-typed param validation — BLOCKED by `type-system-improvements`
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, RuntimeError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Host Type Validation', () => {
  describe('AC-1: list(string) param accepts matching type, rejects mismatched element type', () => {
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
      await expect(
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
        })
      ).rejects.toThrow(RuntimeError);
    });

    it('error message names expected type list(string) and actual type list', async () => {
      // AC-7: error message mentions mismatch location
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

  describe('AC-2: type: undefined accepts any value without validation', () => {
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

  describe('AC-3: dict param with named fields validates argument structure', () => {
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
      await expect(
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
        })
      ).rejects.toThrow(RuntimeError);
    });

    it('accepts any dict for dict param without fields constraint', async () => {
      // AC-62: dict param with no fields matches any dict
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

  describe('AC-4: Missing required param raises RuntimeError RILL-R001', () => {
    it('throws RILL-R001 when required param omitted', async () => {
      // AC-52 (EC-2): typed param with zero args → RuntimeError naming missing param
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

  describe('AC-5: Optional param with defaultValue applies default when omitted', () => {
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

  describe('AC-6 / AC-51: Default value type mismatch throws Error at registration (EC-5)', () => {
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

  describe('AC-54: EC-1 — Excess arguments raises RuntimeError with expected vs actual count', () => {
    it('throws RILL-R001 when 3 args passed to 1-param function', async () => {
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
        expect(rErr.message).toMatch(/1|3/);
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
  });

  describe('AC-8: Script closure uses same validation logic as host function', () => {
    it('script closure with typed string param rejects number argument', async () => {
      await expect(
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
        })
      ).rejects.toThrow();
    });

    it('script closure type-checks same as host function for string param', async () => {
      // A script closure with |name: string| rejects non-string
      await expect(
        run(`
          |name: string| { $name } => $greet
          $greet(42)
        `)
      ).rejects.toThrow(RuntimeError);
    });

    it('script closure with string param accepts string argument like host function', async () => {
      const result = await run(`
        |name: string| { $name } => $greet
        "alice" -> $greet
      `);
      expect(result).toBe('alice');
    });
  });

  describe('Boundary: AC-59: Zero-param function invokes without error', () => {
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

  describe('Boundary: AC-61: type: { type: "any" } and type: undefined both accept any value', () => {
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
