/**
 * Rill Runtime Tests: Call Stack Integration with Function Invocation
 * Tests for push/pop integration at function and closure call sites
 */

import { describe, expect, it } from 'vitest';
import { run, toRuntimeContext } from '../helpers/runtime.js';
import { expectRuntimeError } from '../helpers/halt.js';
import {
  anyTypeValue,
  type CallFrame,
  RuntimeError,
  createRuntimeContext,
  execute,
  parse,
  type RuntimeContext,
  type SourceSpan,
  getCallStack,
} from '@rcrsr/rill';

describe('Rill Runtime: Call Stack Integration', () => {
  describe('pushCallFrame at function call sites (IR-2)', () => {
    it('pushes frame before host function invocation', async () => {
      const result = await run('testFn()', {
        functions: {
          testFn: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              expect(toRuntimeContext(ctx).callStack).toHaveLength(1);
              expect(toRuntimeContext(ctx).callStack[0]?.functionName).toBe(
                'testFn'
              );
              return 'ok';
            },
          },
        },
      });
      expect(result).toBe('ok');
    });

    it('pushes frame before closure invocation', async () => {
      let capturedStack: CallFrame[] = [];
      await run('|x|{ capture() }(42)', {
        functions: {
          capture: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              capturedStack = [...toRuntimeContext(ctx).callStack];
              return '';
            },
          },
        },
      });

      expect(capturedStack).toHaveLength(2);
      expect(capturedStack[0]?.functionName).toBe('<closure>');
      expect(capturedStack[1]?.functionName).toBe('capture');
    });

    it('pushes frame with call site location (IC-9)', async () => {
      let capturedLocation: SourceSpan | null = null;
      await run('testFn()', {
        functions: {
          testFn: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              capturedLocation =
                toRuntimeContext(ctx).callStack[0]?.location ?? null;
              return '';
            },
          },
        },
      });

      expect(capturedLocation).toBeDefined();
      expect(capturedLocation!.start).toBeDefined();
      expect(capturedLocation!.end).toBeDefined();
    });

    it('includes function name in CallFrame (IC-9)', async () => {
      let capturedName: string | undefined;
      await run('myFunction()', {
        functions: {
          myFunction: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              capturedName = toRuntimeContext(ctx).callStack[0]?.functionName;
              return '';
            },
          },
        },
      });

      expect(capturedName).toBe('myFunction');
    });
  });

  describe('popCallFrame after function completes (IR-3)', () => {
    it('pops frame after host function returns', async () => {
      let ctx: RuntimeContext | undefined;
      await run('testFn()', {
        functions: {
          testFn: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, c) => {
              ctx = toRuntimeContext(c);
              return 'ok';
            },
          },
        },
      });

      expect(ctx!.callStack).toHaveLength(0);
    });

    it('pops frame after closure returns', async () => {
      let ctx: RuntimeContext | undefined;
      await run('|x|{ capture() }(5)', {
        functions: {
          capture: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, c) => {
              ctx = toRuntimeContext(c);
              return '';
            },
          },
        },
      });

      expect(ctx!.callStack).toHaveLength(0);
    });

    it('pops frame after method call returns', async () => {
      let ctx: RuntimeContext | undefined;
      await run('"hello".upper() -> capture()', {
        functions: {
          capture: {
            returnType: anyTypeValue,
            params: [
              {
                name: 'val',
                type: undefined,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, c) => {
              ctx = toRuntimeContext(c);
              return '';
            },
          },
        },
      });

      expect(ctx!.callStack).toHaveLength(0);
    });
  });

  describe('popCallFrame on error paths (IR-3)', () => {
    it('pops frame when host function throws error', async () => {
      const ctx = createRuntimeContext({
        functions: {
          failFn: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, c) => {
              depthInBody = toRuntimeContext(c).callStack.length;
              throw new RuntimeError('RILL-R001', 'Test error');
            },
          },
        },
      });
      let depthInBody = -1;

      await expectRuntimeError(() => execute(parse('failFn()'), ctx), {
        code: 'RILL-R001',
      });

      expect(depthInBody).toBe(1);
      expect(ctx.callStack).toHaveLength(0);
    });

    it('captures call stack in error before popping', async () => {
      const ctx = createRuntimeContext({
        functions: {
          fail: {
            returnType: anyTypeValue,
            params: [],
            fn: () => {
              throw new RuntimeError('RILL-R001', 'Test error');
            },
          },
        },
      });
      let caught: unknown;
      await execute(parse('fail()'), ctx).catch((e: unknown) => {
        caught = e;
      });

      expect(caught).toBeInstanceOf(RuntimeError);
      const stack = getCallStack(caught as RuntimeError);
      expect(stack).toHaveLength(1);
      expect(stack[0]?.functionName).toBe('fail');
      expect(ctx.callStack).toHaveLength(0);
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
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              depth3 = toRuntimeContext(ctx).callStack.length;
              return 'done';
            },
          },
          level2: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              depth2 = toRuntimeContext(ctx).callStack.length;
              return '';
            },
          },
          level1: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              depth1 = toRuntimeContext(ctx).callStack.length;
              return '';
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
      let capturedStack: CallFrame[] = [];
      await run('||{ ||{ capture() }() }()', {
        functions: {
          capture: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              capturedStack = [...toRuntimeContext(ctx).callStack];
              return '';
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
      let capturedStack: CallFrame[] = [];
      await run('dict[fn: |x|{ capture() }].fn(42)', {
        functions: {
          capture: {
            returnType: anyTypeValue,
            params: [
              {
                name: 'val',
                type: undefined,
                defaultValue: undefined,
                annotations: {},
              },
            ],
            fn: (_args, ctx) => {
              capturedStack = [...toRuntimeContext(ctx).callStack];
              return '';
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
      let callSiteLocation: SourceSpan | null = null;
      await run('testFn()', {
        functions: {
          testFn: {
            returnType: anyTypeValue,
            params: [],
            fn: (_args, ctx) => {
              callSiteLocation =
                toRuntimeContext(ctx).callStack[0]?.location ?? null;
              return '';
            },
          },
        },
      });

      expect(callSiteLocation).toBeDefined();
      expect(callSiteLocation!.start.offset).toBe(0);
    });
  });
});
