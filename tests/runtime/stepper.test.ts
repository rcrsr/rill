/**
 * Rill Runtime Tests: Step Execution
 * Tests for createStepper and step-by-step execution
 */

import { createRuntimeContext, createStepper, parse } from '../../src/index.js';
import { describe, expect, it } from 'vitest';

describe('Rill Runtime: Step Execution', () => {
  describe('createStepper', () => {
    it('creates stepper from script', () => {
      const ast = parse('"hello"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      expect(stepper).toBeDefined();
      expect(stepper.done).toBe(false);
      expect(stepper.index).toBe(0);
      expect(stepper.total).toBe(1);
    });

    it('reports done=true for empty script', () => {
      const ast = parse('');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      expect(stepper.done).toBe(true);
      expect(stepper.total).toBe(0);
    });

    it('reports correct total for multi-statement script', () => {
      const ast = parse('"a" :> $x\n"b" :> $y\n"c"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      expect(stepper.total).toBe(3);
      expect(stepper.done).toBe(false);
    });

    it('provides access to context', () => {
      const ast = parse('"hello"');
      const ctx = createRuntimeContext({ variables: { preset: 'value' } });
      const stepper = createStepper(ast, ctx);

      expect(stepper.context).toBe(ctx);
      expect(stepper.context.variables.get('preset')).toBe('value');
    });
  });

  describe('step()', () => {
    it('executes single statement', async () => {
      const ast = parse('"hello"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      const result = await stepper.step();

      expect(result.value).toBe('hello');
      expect(result.done).toBe(true);
      expect(result.index).toBe(0);
      expect(result.total).toBe(1);
    });

    it('executes statements one at a time', async () => {
      const ast = parse('"a"\n"b"\n"c"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      const r1 = await stepper.step();
      expect(r1.value).toBe('a');
      expect(r1.done).toBe(false);
      expect(r1.index).toBe(0);

      const r2 = await stepper.step();
      expect(r2.value).toBe('b');
      expect(r2.done).toBe(false);
      expect(r2.index).toBe(1);

      const r3 = await stepper.step();
      expect(r3.value).toBe('c');
      expect(r3.done).toBe(true);
      expect(r3.index).toBe(2);
    });

    it('returns last value when stepping past done', async () => {
      const ast = parse('"only"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      await stepper.step(); // First step
      const result = await stepper.step(); // Already done

      expect(result.done).toBe(true);
      expect(result.value).toBe('only');
    });

    it('updates stepper.done after each step', async () => {
      const ast = parse('"a"\n"b"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      expect(stepper.done).toBe(false);

      await stepper.step();
      expect(stepper.done).toBe(false);

      await stepper.step();
      expect(stepper.done).toBe(true);
    });

    it('updates stepper.index after each step', async () => {
      const ast = parse('"a"\n"b"\n"c"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      expect(stepper.index).toBe(0);

      await stepper.step();
      expect(stepper.index).toBe(1);

      await stepper.step();
      expect(stepper.index).toBe(2);

      await stepper.step();
      expect(stepper.index).toBe(3);
    });
  });

  describe('StepResult.captured', () => {
    it('includes captured variable info', async () => {
      const ast = parse('"value" :> $myVar');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      const result = await stepper.step();

      expect(result.captured).toBeDefined();
      expect(result.captured?.name).toBe('myVar');
      expect(result.captured?.value).toBe('value');
    });

    it('is undefined when no capture', async () => {
      const ast = parse('"no capture"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      const result = await stepper.step();

      expect(result.captured).toBeUndefined();
    });

    it('captures different values per step', async () => {
      const ast = parse('"first" :> $a\n"second" :> $b');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      const r1 = await stepper.step();
      expect(r1.captured?.name).toBe('a');
      expect(r1.captured?.value).toBe('first');

      const r2 = await stepper.step();
      expect(r2.captured?.name).toBe('b');
      expect(r2.captured?.value).toBe('second');
    });
  });

  describe('getResult()', () => {
    it('returns final value after completion', async () => {
      const ast = parse('"a"\n"b"\n"final"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      while (!stepper.done) {
        await stepper.step();
      }

      const result = stepper.getResult();
      expect(result.value).toBe('final');
    });

    it('includes all captured variables', async () => {
      const ast = parse('"x" :> $first\n"y" :> $second\n[$first, $second]');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      while (!stepper.done) {
        await stepper.step();
      }

      const result = stepper.getResult();
      expect(result.variables['first']).toBe('x');
      expect(result.variables['second']).toBe('y');
    });

    it('can be called before completion', async () => {
      const ast = parse('"a" :> $x\n"b" :> $y');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      await stepper.step(); // Only first step

      const result = stepper.getResult();
      expect(result.variables['x']).toBe('a');
      expect(result.variables['y']).toBeUndefined();
    });
  });

  describe('Context Inspection', () => {
    it('pipeValue stays constant with scope isolation', async () => {
      // With scope isolation, statements are sibling scopes that don't share $
      // ctx.pipeValue remains the initial value throughout execution
      const ast = parse('"first"\n"second"');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      expect(ctx.pipeValue).toBe(null);

      await stepper.step();
      expect(ctx.pipeValue).toBe(null); // Was 'first' before scope isolation

      await stepper.step();
      expect(ctx.pipeValue).toBe(null); // Was 'second' before scope isolation
    });

    it('variables map updates after captures', async () => {
      const ast = parse('"val" :> $myVar');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      expect(ctx.variables.get('myVar')).toBeUndefined();

      await stepper.step();
      expect(ctx.variables.get('myVar')).toBe('val');
    });
  });

  describe('Error Handling', () => {
    it('throws on unknown function', async () => {
      const ast = parse('unknownFn()');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      await expect(stepper.step()).rejects.toThrow('Unknown function');
    });

    it('throws on unknown method', async () => {
      const ast = parse('"test" -> .unknownMethod');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      await expect(stepper.step()).rejects.toThrow('Unknown method');
    });

    it('stepper state unchanged after error', async () => {
      const ast = parse('unknownFn()');
      const ctx = createRuntimeContext();
      const stepper = createStepper(ast, ctx);

      try {
        await stepper.step();
      } catch {
        // Expected
      }

      expect(stepper.done).toBe(false);
      expect(stepper.index).toBe(0);
    });
  });
});
