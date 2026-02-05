/**
 * Rill Runtime Tests: RillError Constructor Validation
 * Tests for IR-4, IR-5, IR-6, EC-3, EC-4 (Task 1.2)
 */

import { describe, expect, it } from 'vitest';

import {
  AbortError,
  AutoExceptionError,
  ERROR_REGISTRY,
  ParseError,
  RillError,
  RuntimeError,
  TimeoutError,
  type SourceLocation,
  type SourceSpan,
} from '../../src/index.js';

describe('RillError Constructor Validation', () => {
  describe('IR-4: RillError constructor', () => {
    it('accepts data with required errorId', () => {
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
      });

      expect(error).toBeInstanceOf(RillError);
      expect(error.errorId).toBe('RILL-R001');
      expect(error.message).toBe('Test error');
    });

    it('includes location suffix when location provided', () => {
      const location: SourceLocation = { line: 5, column: 10, offset: 42 };
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
        location,
      });

      expect(error.message).toBe('Test error at 5:10');
      expect(error.location).toEqual(location);
    });

    it('stores helpUrl when provided', () => {
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
        helpUrl: 'https://example.com/help',
      });

      expect(error.helpUrl).toBe('https://example.com/help');
    });

    it('stores context when provided', () => {
      const context = { foo: 'bar', count: 42 };
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
        context,
      });

      expect(error.context).toEqual(context);
    });
  });

  describe('IR-5: toData() returns RillErrorData without code field', () => {
    it('returns data object with errorId', () => {
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
      });

      const data = error.toData();
      expect(data.errorId).toBe('RILL-R001');
      expect(data.message).toBe('Test error');
      expect('code' in data).toBe(false);
    });

    it('strips location suffix from message', () => {
      const location: SourceLocation = { line: 5, column: 10, offset: 42 };
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
        location,
      });

      const data = error.toData();
      expect(data.message).toBe('Test error');
      expect(data.message).not.toContain('at 5:10');
    });

    it('includes all optional fields when present', () => {
      const location: SourceLocation = { line: 5, column: 10, offset: 42 };
      const context = { foo: 'bar' };
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
        location,
        context,
        helpUrl: 'https://example.com/help',
      });

      const data = error.toData();
      expect(data.errorId).toBe('RILL-R001');
      expect(data.location).toEqual(location);
      expect(data.context).toEqual(context);
      expect(data.helpUrl).toBe('https://example.com/help');
    });
  });

  describe('IR-6: format() works with errorId-only data', () => {
    it('returns message when no formatter provided', () => {
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
      });

      expect(error.format()).toBe('Test error');
    });

    it('uses custom formatter when provided', () => {
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
      });

      const customFormat = (data: { errorId: string; message: string }) =>
        `[${data.errorId}] ${data.message}`;
      expect(error.format(customFormat)).toBe('[RILL-R001] Test error');
    });

    it('passes errorId to custom formatter', () => {
      const location: SourceLocation = { line: 5, column: 10, offset: 42 };
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Test error',
        location,
      });

      let capturedData: { errorId?: string; message?: string } = {};
      const captureFormatter = (data: { errorId: string; message: string }) => {
        capturedData = data;
        return data.message;
      };

      error.format(captureFormatter);
      expect(capturedData.errorId).toBe('RILL-R001');
      expect(capturedData.message).toBe('Test error');
    });
  });

  describe('EC-3: Missing errorId throws TypeError', () => {
    it('throws TypeError when errorId is missing', () => {
      expect(() => {
        new RillError({
          errorId: '',
          message: 'Test error',
        });
      }).toThrow(TypeError);

      expect(() => {
        new RillError({
          errorId: '',
          message: 'Test error',
        });
      }).toThrow('errorId is required');
    });

    it('throws TypeError when errorId is undefined', () => {
      expect(() => {
        new RillError({
          errorId: undefined as never,
          message: 'Test error',
        });
      }).toThrow(TypeError);

      expect(() => {
        new RillError({
          errorId: undefined as never,
          message: 'Test error',
        });
      }).toThrow('errorId is required');
    });
  });

  describe('EC-4: Unknown errorId throws TypeError', () => {
    it('throws TypeError for invalid errorId', () => {
      expect(() => {
        new RillError({
          errorId: 'INVALID-ID',
          message: 'Test error',
        });
      }).toThrow(TypeError);

      expect(() => {
        new RillError({
          errorId: 'INVALID-ID',
          message: 'Test error',
        });
      }).toThrow('Unknown error ID: INVALID-ID');
    });

    it('throws TypeError for non-existent errorId', () => {
      expect(() => {
        new RillError({
          errorId: 'RILL-X999',
          message: 'Test error',
        });
      }).toThrow(TypeError);

      expect(() => {
        new RillError({
          errorId: 'RILL-X999',
          message: 'Test error',
        });
      }).toThrow('Unknown error ID: RILL-X999');
    });

    it('validates errorId exists in ERROR_REGISTRY', () => {
      // Get a valid error ID from registry
      const validId = Array.from(ERROR_REGISTRY.entries())[0]![0];

      // Should not throw for valid ID
      expect(() => {
        new RillError({
          errorId: validId,
          message: 'Test error',
        });
      }).not.toThrow();

      // Should throw for invalid ID
      expect(() => {
        new RillError({
          errorId: 'RILL-Z999',
          message: 'Test error',
        });
      }).toThrow(TypeError);
    });
  });
});

describe('ParseError Constructor Validation (Task 1.3)', () => {
  describe('IR-8: ParseError constructor signature', () => {
    it('accepts errorId as first parameter', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };
      const error = new ParseError('RILL-P001', 'Test parse error', location);

      expect(error).toBeInstanceOf(ParseError);
      expect(error.errorId).toBe('RILL-P001');
      expect(error.message).toBe('Test parse error at 1:5');
      expect(error.location).toEqual(location);
    });

    it('accepts optional context parameter', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };
      const context = { token: 'IDENTIFIER', expected: 'STRING' };
      const error = new ParseError(
        'RILL-P001',
        'Unexpected token',
        location,
        context
      );

      expect(error.context).toEqual(context);
    });

    it('requires location parameter', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };
      const error = new ParseError('RILL-P001', 'Test error', location);

      expect(error.location).toEqual(location);
    });
  });

  describe('EC-7: Unknown errorId throws TypeError', () => {
    it('throws TypeError for unknown errorId', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new ParseError('RILL-X999', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new ParseError('RILL-X999', 'Test error', location);
      }).toThrow('Unknown error ID: RILL-X999');
    });

    it('throws TypeError for invalid errorId format', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new ParseError('INVALID', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new ParseError('INVALID', 'Test error', location);
      }).toThrow('Unknown error ID: INVALID');
    });
  });

  describe('EC-8: Wrong category throws TypeError', () => {
    it('throws TypeError for runtime error ID', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new ParseError('RILL-R001', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new ParseError('RILL-R001', 'Test error', location);
      }).toThrow('Expected parse error ID, got: RILL-R001');
    });

    it('throws TypeError for lexer error ID', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new ParseError('RILL-L001', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new ParseError('RILL-L001', 'Test error', location);
      }).toThrow('Expected parse error ID, got: RILL-L001');
    });

    it('throws TypeError for check error ID', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new ParseError('RILL-C001', 'Test error', location);
      }).toThrow(TypeError);

      expect(() => {
        new ParseError('RILL-C001', 'Test error', location);
      }).toThrow('Expected parse error ID, got: RILL-C001');
    });

    it('accepts valid parse error IDs', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      // Get all parse error IDs from registry
      const parseErrorIds = Array.from(ERROR_REGISTRY.entries())
        .filter(([, def]) => def.category === 'parse')
        .map(([id]) => id);

      // Test each valid parse error ID
      for (const errorId of parseErrorIds) {
        expect(() => {
          new ParseError(errorId, 'Test error', location);
        }).not.toThrow();
      }
    });
  });
});

describe('RuntimeError Constructor Validation (Task 1.4)', () => {
  describe('IR-9: RuntimeError constructor signature', () => {
    it('accepts errorId as first parameter', () => {
      const error = new RuntimeError('RILL-R001', 'Test runtime error');

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R001');
      expect(error.message).toBe('Test runtime error');
    });

    it('accepts optional location parameter', () => {
      const location: SourceLocation = { line: 5, column: 10, offset: 42 };
      const error = new RuntimeError('RILL-R001', 'Test error', location);

      expect(error.location).toEqual(location);
      expect(error.message).toBe('Test error at 5:10');
    });

    it('accepts optional context parameter', () => {
      const context = { expected: 'string', actual: 'number' };
      const error = new RuntimeError(
        'RILL-R001',
        'Type error',
        undefined,
        context
      );

      expect(error.context).toEqual(context);
    });

    it('accepts all optional parameters', () => {
      const location: SourceLocation = { line: 5, column: 10, offset: 42 };
      const context = { foo: 'bar' };
      const error = new RuntimeError(
        'RILL-R001',
        'Test error',
        location,
        context
      );

      expect(error.errorId).toBe('RILL-R001');
      expect(error.location).toEqual(location);
      expect(error.context).toEqual(context);
    });
  });

  describe('IR-10: RuntimeError.fromNode static factory', () => {
    it('creates RuntimeError from AST node', () => {
      const span: SourceSpan = {
        start: { line: 5, column: 10, offset: 42 },
        end: { line: 5, column: 15, offset: 47 },
      };
      const node = { span };
      const error = RuntimeError.fromNode('RILL-R001', 'Test error', node);

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R001');
      expect(error.location).toEqual(span.start);
    });

    it('accepts optional context parameter', () => {
      const span: SourceSpan = {
        start: { line: 5, column: 10, offset: 42 },
        end: { line: 5, column: 15, offset: 47 },
      };
      const node = { span };
      const context = { variable: '$foo' };
      const error = RuntimeError.fromNode(
        'RILL-R001',
        'Undefined variable',
        node,
        context
      );

      expect(error.context).toEqual(context);
    });

    it('handles undefined node parameter', () => {
      const error = RuntimeError.fromNode('RILL-R001', 'Test error');

      expect(error.location).toBeUndefined();
    });
  });

  describe('EC-9: Unknown errorId throws TypeError', () => {
    it('throws TypeError for unknown errorId', () => {
      expect(() => {
        new RuntimeError('RILL-X999', 'Test error');
      }).toThrow(TypeError);

      expect(() => {
        new RuntimeError('RILL-X999', 'Test error');
      }).toThrow('Unknown error ID: RILL-X999');
    });

    it('throws TypeError for invalid errorId format', () => {
      expect(() => {
        new RuntimeError('INVALID', 'Test error');
      }).toThrow(TypeError);

      expect(() => {
        new RuntimeError('INVALID', 'Test error');
      }).toThrow('Unknown error ID: INVALID');
    });
  });

  describe('EC-10: Wrong category throws TypeError', () => {
    it('throws TypeError for parse error ID', () => {
      expect(() => {
        new RuntimeError('RILL-P001', 'Test error');
      }).toThrow(TypeError);

      expect(() => {
        new RuntimeError('RILL-P001', 'Test error');
      }).toThrow('Expected runtime error ID, got: RILL-P001');
    });

    it('throws TypeError for lexer error ID', () => {
      expect(() => {
        new RuntimeError('RILL-L001', 'Test error');
      }).toThrow(TypeError);

      expect(() => {
        new RuntimeError('RILL-L001', 'Test error');
      }).toThrow('Expected runtime error ID, got: RILL-L001');
    });

    it('throws TypeError for check error ID', () => {
      expect(() => {
        new RuntimeError('RILL-C001', 'Test error');
      }).toThrow(TypeError);

      expect(() => {
        new RuntimeError('RILL-C001', 'Test error');
      }).toThrow('Expected runtime error ID, got: RILL-C001');
    });

    it('accepts valid runtime error IDs', () => {
      // Get all runtime error IDs from registry
      const runtimeErrorIds = Array.from(ERROR_REGISTRY.entries())
        .filter(([, def]) => def.category === 'runtime')
        .map(([id]) => id);

      // Test each valid runtime error ID
      for (const errorId of runtimeErrorIds) {
        expect(() => {
          new RuntimeError(errorId, 'Test error');
        }).not.toThrow();
      }
    });
  });
});

describe('TimeoutError Constructor Validation (Task 1.4)', () => {
  describe('IR-11: TimeoutError uses RILL-R012', () => {
    it('creates TimeoutError with correct errorId', () => {
      const error = new TimeoutError('fetch', 5000);

      expect(error).toBeInstanceOf(TimeoutError);
      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R012');
    });

    it('stores functionName and timeoutMs', () => {
      const error = new TimeoutError('processData', 3000);

      expect(error.functionName).toBe('processData');
      expect(error.timeoutMs).toBe(3000);
    });

    it('includes function details in message', () => {
      const error = new TimeoutError('apiCall', 2000);

      expect(error.message).toContain('apiCall');
      expect(error.message).toContain('2000ms');
    });

    it('accepts optional location parameter', () => {
      const location: SourceLocation = { line: 10, column: 5, offset: 100 };
      const error = new TimeoutError('slowFunction', 1000, location);

      expect(error.location).toEqual(location);
      expect(error.message).toContain('at 10:5');
    });

    it('includes functionName and timeoutMs in context', () => {
      const error = new TimeoutError('myFunc', 4000);

      expect(error.context).toEqual({
        functionName: 'myFunc',
        timeoutMs: 4000,
      });
    });
  });
});

describe('AutoExceptionError Constructor Validation (Task 1.4)', () => {
  describe('IR-12: AutoExceptionError uses RILL-R014', () => {
    it('creates AutoExceptionError with correct errorId', () => {
      const error = new AutoExceptionError('error.*', 'error occurred');

      expect(error).toBeInstanceOf(AutoExceptionError);
      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R014');
    });

    it('stores pattern and matchedValue', () => {
      const error = new AutoExceptionError('fail.*', 'failed to connect');

      expect(error.pattern).toBe('fail.*');
      expect(error.matchedValue).toBe('failed to connect');
    });

    it('includes pattern in message', () => {
      const error = new AutoExceptionError('exception', 'exception thrown');

      expect(error.message).toContain('exception');
      expect(error.message).toContain('Auto-exception triggered');
    });

    it('accepts optional location parameter', () => {
      const location: SourceLocation = { line: 15, column: 3, offset: 150 };
      const error = new AutoExceptionError('error', 'error text', location);

      expect(error.location).toEqual(location);
      expect(error.message).toContain('at 15:3');
    });

    it('includes pattern and matchedValue in context', () => {
      const error = new AutoExceptionError('critical.*', 'critical failure');

      expect(error.context).toEqual({
        pattern: 'critical.*',
        matchedValue: 'critical failure',
      });
    });
  });
});

describe('AbortError Constructor Validation (Task 1.4)', () => {
  describe('IR-13: AbortError uses RILL-R013', () => {
    it('creates AbortError with correct errorId', () => {
      const error = new AbortError();

      expect(error).toBeInstanceOf(AbortError);
      expect(error).toBeInstanceOf(RuntimeError);
      expect(error.errorId).toBe('RILL-R013');
    });

    it('has predefined message', () => {
      const error = new AbortError();

      expect(error.message).toBe('Execution aborted');
    });

    it('accepts optional location parameter', () => {
      const location: SourceLocation = { line: 20, column: 8, offset: 200 };
      const error = new AbortError(location);

      expect(error.location).toEqual(location);
      expect(error.message).toContain('at 20:8');
    });

    it('has empty context object', () => {
      const error = new AbortError();

      expect(error.context).toEqual({});
    });
  });
});
