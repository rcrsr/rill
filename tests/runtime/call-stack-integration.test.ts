/**
 * Rill Runtime Tests: Call Stack Integration with Function Invocation
 * Tests for push/pop integration at function and closure call sites
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { RuntimeError, getCallStack } from '../../src/index.js';

describe('Rill Runtime: Call Stack Integration', () => {
  describe('pushCallFrame at function call sites (IR-2)', () => {
    it('pushes frame before host function invocation', async () => {
      const result = await run('testFn()', {
        functions: {
          testFn: {
            params: [],
            fn: (_args, ctx) => {
              expect(ctx.callStack).toHaveLength(1);
              expect(ctx.callStack[0]?.functionName).toBe('testFn');
              return 'ok';
            },
          },
        },
      });
      expect(result).toBe('ok');
    });

    it('pushes frame before closure invocation', async () => {
      let capturedStack: any[] = [];
      await run('|x|{ capture() }(42)', {
        functions: {
          capture: {
            params: [],
            fn: (_args, ctx) => {
              capturedStack = [...ctx.callStack];
              return null;
            },
          },
        },
      });

      expect(capturedStack).toHaveLength(2);
      expect(capturedStack[0]?.functionName).toBe('<closure>');
      expect(capturedStack[1]?.functionName).toBe('capture');
    });

    it('pushes frame with call site location (IC-9)', async () => {
      let capturedLocation: any = null;
      await run('testFn()', {
        functions: {
          testFn: {
            params: [],
            fn: (_args, ctx) => {
              capturedLocation = ctx.callStack[0]?.location;
              return null;
            },
          },
        },
      });

      expect(capturedLocation).toBeDefined();
      expect(capturedLocation.start).toBeDefined();
      expect(capturedLocation.end).toBeDefined();
    });

    it('includes function name in CallFrame (IC-9)', async () => {
      let capturedName: string | undefined;
      await run('myFunction()', {
        functions: {
          myFunction: {
            params: [],
            fn: (_args, ctx) => {
              capturedName = ctx.callStack[0]?.functionName;
              return null;
            },
          },
        },
      });

      expect(capturedName).toBe('myFunction');
    });
  });

  describe('popCallFrame after function completes (IR-3)', () => {
    it('pops frame after host function returns', async () => {
      let ctx: any;
      await run('testFn()', {
        functions: {
          testFn: {
            params: [],
            fn: (_args, c) => {
              ctx = c;
              return 'ok';
            },
          },
        },
      });

      expect(ctx.callStack).toHaveLength(0);
    });

    it('pops frame after closure returns', async () => {
      let ctx: any;
      await run('|x|{ capture() }(5)', {
        functions: {
          capture: {
            params: [],
            fn: (_args, c) => {
              ctx = c;
              return null;
            },
          },
        },
      });

      expect(ctx.callStack).toHaveLength(0);
    });

    it('pops frame after method call returns', async () => {
      let ctx: any;
      await run('"hello".upper() -> capture()', {
        functions: {
          capture: {
            params: [],
            fn: (_args, c) => {
              ctx = c;
              return null;
            },
          },
        },
      });

      expect(ctx.callStack).toHaveLength(0);
    });
  });

  describe('popCallFrame on error paths (IR-3)', () => {
    it('pops frame when host function throws error', async () => {
      let ctx: any;
      await expect(
        run('failFn() -> capture()', {
          functions: {
            failFn: {
              params: [],
              fn: () => {
                throw new RuntimeError('RILL-R001', 'Test error');
              },
            },
            capture: {
              params: [],
              fn: (_args, c) => {
                ctx = c;
                return null;
              },
            },
          },
        })
      ).rejects.toThrow();

      expect(ctx).toBeUndefined();
    });

    it('captures call stack in error before popping', async () => {
      try {
        await run('fail()', {
          functions: {
            fail: {
              params: [],
              fn: () => {
                throw new RuntimeError('RILL-R001', 'Test error', undefined, {
                  callStack: [
                    {
                      location: {
                        start: { line: 1, column: 1, offset: 0 },
                        end: { line: 1, column: 7, offset: 6 },
                      },
                      functionName: 'fail',
                    },
                  ],
                });
              },
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (e) {
        const stack = getCallStack(e as RuntimeError);
        expect(stack.length).toBeGreaterThan(0);
      }
    });
  });

  describe('nested function calls', () => {
    it('maintains correct stack depth across nested calls', async () => {
      let depth1 = 0;
      let depth2 = 0;
      let depth3 = 0;

      await run('level1() -> level2() -> level3()', {
        functions: {
          level3: {
            params: [],
            fn: (_args, ctx) => {
              depth3 = ctx.callStack.length;
              return 'done';
            },
          },
          level2: {
            params: [],
            fn: (_args, ctx) => {
              depth2 = ctx.callStack.length;
              return null;
            },
          },
          level1: {
            params: [],
            fn: (_args, ctx) => {
              depth1 = ctx.callStack.length;
              return null;
            },
          },
        },
      });

      // Each function call should have 1 frame at the time it's called
      expect(depth1).toBe(1);
      expect(depth2).toBe(1);
      expect(depth3).toBe(1);
    });

    it('maintains correct order in nested closure calls', async () => {
      let capturedStack: any[] = [];
      await run('||{ ||{ capture() }() }()', {
        functions: {
          capture: {
            params: [],
            fn: (_args, ctx) => {
              capturedStack = [...ctx.callStack];
              return null;
            },
          },
        },
      });

      expect(capturedStack).toHaveLength(3);
      expect(capturedStack[0]?.functionName).toBe('<closure>');
      expect(capturedStack[1]?.functionName).toBe('<closure>');
      expect(capturedStack[2]?.functionName).toBe('capture');
    });
  });

  describe('method calls', () => {
    it('pushes frame for dict-bound callable', async () => {
      let capturedStack: any[] = [];
      await run('[fn: |x|{ capture() }].fn(42)', {
        functions: {
          capture: {
            params: [],
            fn: (_args, ctx) => {
              capturedStack = [...ctx.callStack];
              return null;
            },
          },
        },
      });

      expect(capturedStack).toHaveLength(2);
      expect(capturedStack[0]?.functionName).toBe('fn');
    });
  });

  describe('call site location vs function body location (IC-9)', () => {
    it('captures call site location, not function body', async () => {
      let callSiteLocation: any = null;
      await run('testFn()', {
        functions: {
          testFn: {
            params: [],
            fn: (_args, ctx) => {
              callSiteLocation = ctx.callStack[0]?.location;
              return null;
            },
          },
        },
      });

      expect(callSiteLocation).toBeDefined();
      expect(callSiteLocation.start.offset).toBe(0);
    });
  });
});
