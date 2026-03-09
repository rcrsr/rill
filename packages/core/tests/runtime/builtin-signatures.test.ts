/**
 * Rill Runtime Tests: Built-in Function Signatures
 *
 * Specification Mapping (conduct/specifications/host-type-system-refactor.md):
 *
 * FR-HTR-2 (Built-in validation):
 * - AC-10: range("a", 10) → RUNTIME_TYPE_ERROR for start param (string != number)
 * - AC-11: enumerate(42) → RUNTIME_TYPE_ERROR naming expected type (number != list|dict|string)
 * - AC-12: range(1, 10) with no step → applies default step=1 without error
 * - AC-13: Built-in with declared returnType does not validate return value at call time
 *
 * FR-HTR-3 (Method dispatch and validation):
 * - AC-14: Method call on type not in receiverTypes → error naming unsupported receiver
 * - AC-15: Method call on supported receiver with wrong-typed arg → RUNTIME_TYPE_ERROR
 * - AC-16: Methods with same name on different receiver types dispatch correctly
 */

import { describe, expect, it } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Built-in Function Signatures', () => {
  describe('AC-10: range() validates param types — string start param rejected', () => {
    it('throws RuntimeError when start is a string', async () => {
      await expect(run('range("a", 10)')).rejects.toThrow(RuntimeError);
    });

    it('error is RILL-R001 (type mismatch)', async () => {
      try {
        await run('range("a", 10)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        expect(rErr.errorId).toBe('RILL-R001');
      }
    });

    it('error message names the parameter start', async () => {
      try {
        await run('range("a", 10)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const msg = (err as RuntimeError).message;
        expect(msg).toContain('start');
      }
    });
  });

  describe('AC-11: enumerate() validates param types — number arg rejected', () => {
    it('throws RuntimeError when arg is a number', async () => {
      await expect(run('enumerate(42)')).rejects.toThrow(RuntimeError);
    });

    it('error is RILL-R001 (type mismatch)', async () => {
      try {
        await run('enumerate(42)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        expect(rErr.errorId).toBe('RILL-R001');
      }
    });

    it('error message names the expected types', async () => {
      try {
        await run('enumerate(42)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const msg = (err as RuntimeError).message;
        // Error should name the expected types (list, dict, or string)
        expect(msg.toLowerCase()).toMatch(/list|dict|string/);
      }
    });

    it('error message names the items parameter', async () => {
      try {
        await run('enumerate(42)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const msg = (err as RuntimeError).message;
        expect(msg).toContain('items');
      }
    });
  });

  describe('AC-12: range() with no step param applies default value = 1', () => {
    it('range(1, 4) executes without error when step is omitted', async () => {
      await expect(run('range(1, 4) -> each { $ }')).resolves.not.toThrow();
    });

    it('range(1, 4) produces [1, 2, 3] using default step of 1', async () => {
      const result = await run('range(1, 4) -> each { $ }');
      expect(result).toEqual([1, 2, 3]);
    });

    it('range(0, 5) produces [0, 1, 2, 3, 4] using default step', async () => {
      const result = await run('range(0, 5) -> each { $ }');
      expect(result).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('AC-13: Built-in returnType is metadata only — no return value validation at call time', () => {
    it('json() with valid string input returns the JSON string', async () => {
      // json has declared returnType: string in its signature
      // The runtime does not validate the return value against returnType
      const result = await run('json("hello")');
      expect(result).toBe('"hello"');
    });

    it('identity() returns any value type without validation', async () => {
      // identity has declared returnType: any — returns input unchanged
      const result = await run('identity(42)');
      expect(result).toBe(42);
    });

    it('identity() passes through string without returnType validation error', async () => {
      // identity signature is |value: any|:any — return is not validated
      const result = await run('identity("hello")');
      expect(result).toBe('hello');
    });

    it('identity() passes through list without returnType validation error', async () => {
      const result = await run('identity(list[1, 2, 3])');
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('AC-14: Method call on type not in receiverTypes → error naming unsupported receiver', () => {
    it('calling .upper on a number throws RuntimeError', async () => {
      // .upper has receiverTypes: ["string"] — number is not in the list
      await expect(run('42 -> .upper')).rejects.toThrow(RuntimeError);
    });

    it('error for .upper on number is RILL-R003', async () => {
      try {
        await run('42 -> .upper');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        expect(rErr.errorId).toBe('RILL-R003');
      }
    });

    it('error message names the unsupported receiver type', async () => {
      try {
        await run('42 -> .upper');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const msg = (err as RuntimeError).message;
        // Error should mention "number" as the unsupported receiver type
        expect(msg).toContain('number');
      }
    });

    it('error message names the method', async () => {
      try {
        await run('42 -> .upper');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const msg = (err as RuntimeError).message;
        expect(msg).toContain('upper');
      }
    });

    it('calling .split on a number throws RuntimeError (RILL-R003)', async () => {
      // .split has receiverTypes: ["string"]
      try {
        await run('42 -> .split(",")');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R003');
      }
    });
  });

  describe('AC-15: Method call on supported receiver with wrong-typed arg → RUNTIME_TYPE_ERROR', () => {
    it('calling .split on string with number arg throws RuntimeError', async () => {
      // .split has param separator: string — number arg is rejected
      await expect(run('"hello" -> .split(42)')).rejects.toThrow(RuntimeError);
    });

    it('error for .split with number separator is RILL-R001', async () => {
      try {
        await run('"hello" -> .split(42)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        expect(rErr.errorId).toBe('RILL-R001');
      }
    });

    it('error message names the separator parameter', async () => {
      try {
        await run('"hello" -> .split(42)');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const msg = (err as RuntimeError).message;
        expect(msg).toContain('separator');
      }
    });

    it('calling .at on list with string arg throws RuntimeError', async () => {
      // .at has param index: number — string arg is rejected
      await expect(run('list[1, 2, 3] -> .at("x")')).rejects.toThrow(
        RuntimeError
      );
    });

    it('error for .at with string index is RILL-R001', async () => {
      try {
        await run('list[1, 2, 3] -> .at("x")');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        const rErr = err as RuntimeError;
        expect(rErr.errorId).toBe('RILL-R001');
      }
    });
  });

  describe('AC-16: Methods with same name on different receiver types dispatch correctly', () => {
    it('.len on string returns character count', async () => {
      const result = await run('"hello" -> .len');
      expect(result).toBe(5);
    });

    it('.len on list returns element count', async () => {
      const result = await run('list[1, 2, 3, 4] -> .len');
      expect(result).toBe(4);
    });

    it('.len on dict returns key count', async () => {
      const result = await run('[a: 1, b: 2, c: 3] -> .len');
      expect(result).toBe(3);
    });

    it('.len dispatches differently based on receiver type — string vs list produce different results', async () => {
      const strLen = (await run('"abc" -> .len')) as number;
      const listLen = (await run('list[1, 2, 3, 4, 5] -> .len')) as number;
      expect(strLen).toBe(3);
      expect(listLen).toBe(5);
    });

    it('.empty dispatches on string — empty string returns true', async () => {
      const result = await run('"" -> .empty');
      expect(result).toBe(true);
    });

    it('.empty dispatches on list — empty list returns true', async () => {
      const result = await run('list[] -> .empty');
      expect(result).toBe(true);
    });

    it('.empty dispatches on dict — non-empty dict returns false', async () => {
      const result = await run('[a: 1] -> .empty');
      expect(result).toBe(false);
    });
  });
});
