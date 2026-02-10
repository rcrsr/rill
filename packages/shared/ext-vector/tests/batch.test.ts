/**
 * Test suite for batch execution utilities.
 * Validates all batch execution contracts (EC-11 through EC-14, AC-3, AC-14, AC-17, AC-18).
 */

import { describe, it, expect } from 'vitest';
import { executeBatch } from '../src/batch.js';
import { RuntimeError } from '@rcrsr/rill';

describe('executeBatch', () => {
  // Helper to create mock items
  const createItems = (count: number): Array<{ id: number }> => {
    return Array.from({ length: count }, (_, i) => ({ id: i }));
  };

  // Mock validation function that passes
  const validatePass = (): string | null => null;

  // Mock validation function that fails at specific index
  const validateFailAt =
    (failIndex: number) =>
    (_item: unknown, index: number): string | null => {
      if (index === failIndex) {
        return `validation failed at index ${index}`;
      }
      return null;
    };

  // Mock execute function that succeeds
  const executePass = async (): Promise<void> => {
    // Success - no-op
  };

  // Mock execute function that throws at specific index
  const executeFailAt = (failIndex: number) => {
    let currentIndex = 0;
    return async (): Promise<void> => {
      if (currentIndex === failIndex) {
        currentIndex++;
        throw new Error(`execution failed at index ${failIndex}`);
      }
      currentIndex++;
    };
  };

  // Mock error mapper
  const mapError = (error: unknown): RuntimeError => {
    const message = error instanceof Error ? error.message : String(error);
    return new RuntimeError('RILL-R004', message);
  };

  describe('EC-13, AC-3: All items succeed', () => {
    it('returns {succeeded: 5} when all 5 items pass validation and execution', async () => {
      const items = createItems(5);
      const result = await executeBatch(
        items,
        validatePass,
        executePass,
        mapError
      );

      expect(result).toEqual({ succeeded: 5 });
      expect(result.failed).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('returns {succeeded: 1} when single item succeeds', async () => {
      const items = createItems(1);
      const result = await executeBatch(
        items,
        validatePass,
        executePass,
        mapError
      );

      expect(result).toEqual({ succeeded: 1 });
      expect(result.failed).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('returns {succeeded: 100} when many items succeed', async () => {
      const items = createItems(100);
      const result = await executeBatch(
        items,
        validatePass,
        executePass,
        mapError
      );

      expect(result).toEqual({ succeeded: 100 });
      expect(result.failed).toBeUndefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe('EC-11, AC-14: Validation failure at index N', () => {
    it('returns {succeeded: 2, failed, error} when validation fails at index 2', async () => {
      const items = createItems(5);
      const result = await executeBatch(
        items,
        validateFailAt(2),
        executePass,
        mapError
      );

      expect(result).toEqual({
        succeeded: 2,
        failed: 'index 2',
        error: 'validation failed at index 2',
      });
    });

    it('returns {succeeded: 0, failed, error} when validation fails at index 0', async () => {
      const items = createItems(5);
      const result = await executeBatch(
        items,
        validateFailAt(0),
        executePass,
        mapError
      );

      expect(result).toEqual({
        succeeded: 0,
        failed: 'index 0',
        error: 'validation failed at index 0',
      });
    });

    it('returns {succeeded: 4, failed, error} when validation fails at last index', async () => {
      const items = createItems(5);
      const result = await executeBatch(
        items,
        validateFailAt(4),
        executePass,
        mapError
      );

      expect(result).toEqual({
        succeeded: 4,
        failed: 'index 4',
        error: 'validation failed at index 4',
      });
    });
  });

  describe('EC-12: Execution failure at index N', () => {
    it('returns {succeeded: 2, failed, error} when execution fails at index 2', async () => {
      const items = createItems(5);
      const result = await executeBatch(
        items,
        validatePass,
        executeFailAt(2),
        mapError
      );

      expect(result).toEqual({
        succeeded: 2,
        failed: 'index 2',
        error: 'execution failed at index 2',
      });
    });

    it('returns {succeeded: 0, failed, error} when execution fails at index 0', async () => {
      const items = createItems(5);
      const result = await executeBatch(
        items,
        validatePass,
        executeFailAt(0),
        mapError
      );

      expect(result).toEqual({
        succeeded: 0,
        failed: 'index 0',
        error: 'execution failed at index 0',
      });
    });

    it('returns {succeeded: 4, failed, error} when execution fails at last index', async () => {
      const items = createItems(5);
      const result = await executeBatch(
        items,
        validatePass,
        executeFailAt(4),
        mapError
      );

      expect(result).toEqual({
        succeeded: 4,
        failed: 'index 4',
        error: 'execution failed at index 4',
      });
    });

    it('maps error through mapError function', async () => {
      const items = createItems(3);
      const customError = new Error('custom error message');
      const execute = async (): Promise<void> => {
        throw customError;
      };

      const result = await executeBatch(items, validatePass, execute, mapError);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe('index 0');
      expect(result.error).toBe('custom error message');
    });
  });

  describe('EC-14, AC-17: Empty items array', () => {
    it('returns {succeeded: 0} when items array is empty', async () => {
      const items: Array<{ id: number }> = [];
      const result = await executeBatch(
        items,
        validatePass,
        executePass,
        mapError
      );

      expect(result).toEqual({ succeeded: 0 });
      expect(result.failed).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('does not call validate or execute when items array is empty', async () => {
      let validateCalled = false;
      let executeCalled = false;

      const validate = (): string | null => {
        validateCalled = true;
        return null;
      };

      const execute = async (): Promise<void> => {
        executeCalled = true;
      };

      const items: Array<{ id: number }> = [];
      await executeBatch(items, validate, execute, mapError);

      expect(validateCalled).toBe(false);
      expect(executeCalled).toBe(false);
    });
  });

  describe('AC-18: Single failing item', () => {
    it('returns {succeeded: 0, failed, error} when validation fails for single item', async () => {
      const items = createItems(1);
      const result = await executeBatch(
        items,
        validateFailAt(0),
        executePass,
        mapError
      );

      expect(result).toEqual({
        succeeded: 0,
        failed: 'index 0',
        error: 'validation failed at index 0',
      });
    });

    it('returns {succeeded: 0, failed, error} when execution fails for single item', async () => {
      const items = createItems(1);
      const result = await executeBatch(
        items,
        validatePass,
        executeFailAt(0),
        mapError
      );

      expect(result).toEqual({
        succeeded: 0,
        failed: 'index 0',
        error: 'execution failed at index 0',
      });
    });
  });

  describe('Sequential processing', () => {
    it('processes items in order from index 0 to N-1', async () => {
      const items = createItems(5);
      const processedIndexes: number[] = [];

      const validate = (_item: unknown, index: number): string | null => {
        processedIndexes.push(index);
        return null;
      };

      await executeBatch(items, validate, executePass, mapError);

      expect(processedIndexes).toEqual([0, 1, 2, 3, 4]);
    });

    it('halts immediately on first validation failure', async () => {
      const items = createItems(5);
      const processedIndexes: number[] = [];

      const validate = (_item: unknown, index: number): string | null => {
        processedIndexes.push(index);
        if (index === 2) return 'fail';
        return null;
      };

      await executeBatch(items, validate, executePass, mapError);

      expect(processedIndexes).toEqual([0, 1, 2]);
    });

    it('halts immediately on first execution failure', async () => {
      const items = createItems(5);
      const executedIndexes: number[] = [];

      const execute = async (item: { id: number }): Promise<void> => {
        executedIndexes.push(item.id);
        if (item.id === 2) {
          throw new Error('fail');
        }
      };

      await executeBatch(items, validatePass, execute, mapError);

      expect(executedIndexes).toEqual([0, 1, 2]);
    });

    it('calls validate before execute for each item', async () => {
      const items = createItems(3);
      const callOrder: string[] = [];

      const validate = (_item: unknown, index: number): string | null => {
        callOrder.push(`validate-${index}`);
        return null;
      };

      const execute = async (item: { id: number }): Promise<void> => {
        callOrder.push(`execute-${item.id}`);
      };

      await executeBatch(items, validate, execute, mapError);

      expect(callOrder).toEqual([
        'validate-0',
        'execute-0',
        'validate-1',
        'execute-1',
        'validate-2',
        'execute-2',
      ]);
    });
  });

  describe('Error propagation', () => {
    it('does not catch errors thrown by validate function', async () => {
      const items = createItems(3);
      const validate = (): string | null => {
        throw new Error('validate threw error');
      };

      await expect(
        executeBatch(items, validate, executePass, mapError)
      ).rejects.toThrow('validate threw error');
    });

    it('catches and maps errors thrown by execute function', async () => {
      const items = createItems(3);
      const execute = async (): Promise<void> => {
        throw new Error('execute threw error');
      };

      const result = await executeBatch(items, validatePass, execute, mapError);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe('index 0');
      expect(result.error).toBe('execute threw error');
    });
  });
});
