/**
 * Rill Runtime Tests: core built-ins (log)
 *
 * Covers the zero-argument guard on `log()` and confirms the excess-arg
 * tolerance `log` retains as an untyped built-in stays intact.
 */

import { describe, expect, it } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: log built-in', () => {
  it('halts with RILL-R044 when called with zero arguments', async () => {
    try {
      await run('log()');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId).toBe('RILL-R044');
    }
  });

  it('succeeds with a single message argument', async () => {
    const result = await run('log("x")');
    expect(result).toBe('x');
  });

  it('tolerates excess arguments without halting', async () => {
    const result = await run('log("x", 99)');
    expect(result).toBe('x');
  });
});

describe('Rill Runtime: chain built-in missing-argument message', () => {
  it('halts with a missing-parameter error for an absent transform argument', async () => {
    try {
      await run('chain(5)');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const runtimeErr = err as RuntimeError;
      expect(runtimeErr.errorId).toBe('RILL-R044');
      expect(runtimeErr.message).toContain("parameter 'transform'");
    }
  });

  it('still names the actual type when a non-closure value is supplied', async () => {
    try {
      await run('chain(5, 42)');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const runtimeErr = err as RuntimeError;
      expect(runtimeErr.errorId).toBe('RILL-R040');
      expect(runtimeErr.message).toContain(
        'chain: second argument must be a closure or list of closures, got number'
      );
    }
  });
});

describe('Rill Runtime: iterate built-in missing-argument message', () => {
  it('halts with a missing-parameter error for an absent closure argument', async () => {
    try {
      await run('iterate(0)');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const runtimeErr = err as RuntimeError;
      expect(runtimeErr.errorId).toBe('RILL-R044');
      expect(runtimeErr.message).toContain("parameter 'closure'");
    }
  });

  it('still names the actual type when a non-callable value is supplied', async () => {
    try {
      await run('iterate(0, 42)');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeError);
      const runtimeErr = err as RuntimeError;
      expect(runtimeErr.errorId).toBe('RILL-R006');
      expect(runtimeErr.message).toContain(
        'iterate: closure must be a callable, got number'
      );
    }
  });
});
