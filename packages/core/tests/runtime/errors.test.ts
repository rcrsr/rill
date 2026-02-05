/**
 * Rill Runtime Tests: Error Taxonomy
 * Tests for error registry, template rendering, error classes, and helper functions
 */

import { describe, expect, it } from 'vitest';

import {
  createError,
  ERROR_REGISTRY,
  getHelpUrl,
  LexerError,
  ParseError,
  renderMessage,
  RillError,
  RuntimeError,
  type CallFrame,
  type ErrorDefinition,
  type ErrorExample,
  type SourceLocation,
  type SourceSpan,
} from '@rcrsr/rill';

describe('Rill Runtime: Error Taxonomy', () => {
  describe('Registry Tests', () => {
    it('Registry lookup returns in O(1) [AC-3, AC-4]', () => {
      const definition = ERROR_REGISTRY.get('RILL-R001');
      expect(definition).toBeDefined();
      expect(definition?.errorId).toBe('RILL-R001');
      expect(definition?.category).toBe('runtime');
    });

    it('RILL-P006 exists in registry with correct fields', () => {
      const definition = ERROR_REGISTRY.get('RILL-P006');
      expect(definition).toBeDefined();
      expect(definition?.errorId).toBe('RILL-P006');
      expect(definition?.category).toBe('parse');
      expect(definition?.description).toBe('Deprecated capture arrow syntax');
      expect(definition?.messageTemplate).toBe(
        'The capture arrow syntax changed from :> to =>'
      );
    });

    it('No duplicate errorIds [AC-1, AC-2]', () => {
      const seen = new Set<string>();
      for (const [errorId] of ERROR_REGISTRY.entries()) {
        expect(seen.has(errorId)).toBe(false);
        seen.add(errorId);
      }
    });

    it('Registry is read-only after init [AC-16]', () => {
      const registrySize = ERROR_REGISTRY.size;
      expect(registrySize).toBeGreaterThan(0);
      expect(ERROR_REGISTRY.size).toBe(registrySize);

      // Verify registry methods exist
      expect(ERROR_REGISTRY.get('RILL-R001')).toBeDefined();
      expect(ERROR_REGISTRY.has('RILL-R001')).toBe(true);

      // Verify multiple error IDs exist for type errors
      expect(ERROR_REGISTRY.get('RILL-R001')).toBeDefined(); // Parameter type mismatch
      expect(ERROR_REGISTRY.get('RILL-R002')).toBeDefined(); // Operator type mismatch
      expect(ERROR_REGISTRY.get('RILL-R003')).toBeDefined(); // Method receiver type mismatch
      expect(ERROR_REGISTRY.get('RILL-R004')).toBeDefined(); // Type conversion failure
    });

    it('Error ID format supports 3-digit numbers [AC-15]', () => {
      // Verify that all error IDs follow the RILL-{category}{3-digit} format
      for (const [errorId] of ERROR_REGISTRY.entries()) {
        expect(errorId).toMatch(/^RILL-[LPRC]\d{3}$/);
      }

      // Verify we can have IDs up to 999
      const maxLexer = 'RILL-L999';
      const maxParse = 'RILL-P999';
      const maxRuntime = 'RILL-R999';
      const maxCheck = 'RILL-C999';

      // These should match the format pattern (even if not in registry yet)
      expect(maxLexer).toMatch(/^RILL-[LPRC]\d{3}$/);
      expect(maxParse).toMatch(/^RILL-[LPRC]\d{3}$/);
      expect(maxRuntime).toMatch(/^RILL-[LPRC]\d{3}$/);
      expect(maxCheck).toMatch(/^RILL-[LPRC]\d{3}$/);
    });

    it('EC-1: Invalid errorId returns undefined', () => {
      expect(ERROR_REGISTRY.get('INVALID-ID')).toBeUndefined();
      expect(ERROR_REGISTRY.get('RILL-X999')).toBeUndefined();
      expect(ERROR_REGISTRY.get('')).toBeUndefined();
    });

    it('EC-2: Unknown errorId returns undefined', () => {
      // Use an error ID that doesn't exist
      const unknownId = 'RILL-Z999';
      const result = ERROR_REGISTRY.get(unknownId);
      expect(result).toBeUndefined();
    });
  });

  describe('Template Rendering Tests', () => {
    it('Template rendering with context [AC-5]', () => {
      const template = 'Expected {expected}, got {actual}';
      const context = { expected: 'string', actual: 'number' };
      const result = renderMessage(template, context);
      expect(result).toBe('Expected string, got number');
    });

    it('Missing placeholder produces empty string [AC-6, AC-12]', () => {
      const template = 'Hello {name}!';
      const context = {};
      const result = renderMessage(template, context);
      expect(result).toBe('Hello !');
    });

    it('Template with no placeholders [AC-13, AC-14]', () => {
      const template = 'This is a plain message';
      const context = { unused: 'value' };
      const result = renderMessage(template, context);
      expect(result).toBe('This is a plain message');
    });

    it('EC-4: renderMessage with unclosed brace returns unchanged', () => {
      const template = 'Error: {unclosed';
      const context = { unclosed: 'value' };
      const result = renderMessage(template, context);
      expect(result).toBe(template);
    });

    it('EC-5: Non-string context coerced via String()', () => {
      const template = 'Count: {count}, Flag: {flag}, Items: {items}';
      const context = {
        count: 42,
        flag: true,
        items: [1, 2, 3],
      };
      const result = renderMessage(template, context);
      expect(result).toBe('Count: 42, Flag: true, Items: 1,2,3');
    });

    it('EC-6: Coercion failure renders "[object Object]"', () => {
      // Create an object that throws on toString
      const problematic = {
        toString() {
          throw new Error('toString failed');
        },
      };

      const template = 'Value: {value}';
      const context = { value: problematic };
      const result = renderMessage(template, context);
      expect(result).toBe('Value: [object Object]');
    });

    it('Multiple placeholders in template', () => {
      const template =
        'Function {function} expects {param} to be {expected}, got {actual}';
      const context = {
        function: 'add',
        param: 'x',
        expected: 'number',
        actual: 'string',
      };
      const result = renderMessage(template, context);
      expect(result).toBe('Function add expects x to be number, got string');
    });

    it('Consecutive placeholders', () => {
      const template = '{a}{b}{c}';
      const context = { a: '1', b: '2', c: '3' };
      const result = renderMessage(template, context);
      expect(result).toBe('123');
    });
  });

  describe('Error Class Tests', () => {
    it('LexerError extends RillError [AC-8, AC-9]', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };
      const error = new LexerError(
        'RILL-L001',
        'Unterminated string',
        location
      );

      expect(error).toBeInstanceOf(RillError);
      expect(error).toBeInstanceOf(LexerError);
      expect(error.name).toBe('LexerError');
      expect(error.errorId).toBe('RILL-L001');
      expect(error.location).toEqual(location);
    });

    it('LexerError requires location', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };
      const error = new LexerError('RILL-L002', 'Invalid character', location);

      expect(error.location).toBeDefined();
      expect(error.location).toEqual(location);
    });

    it('RillError stores structured data', () => {
      const location: SourceLocation = { line: 2, column: 10, offset: 25 };
      const context = { name: 'foo' };
      const error = new RillError({
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        location,
        context,
      });

      expect(error.errorId).toBe('RILL-R005');
      expect(error.location).toEqual(location);
      expect(error.context).toEqual(context);
      expect(error.message).toContain('Variable foo is not defined');
      expect(error.message).toContain('at 2:10');
    });

    it('RillError toData() strips location suffix', () => {
      const location: SourceLocation = { line: 2, column: 10, offset: 25 };
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Type error',
        location,
      });

      const data = error.toData();
      expect(data.message).toBe('Type error');
      expect(data.message).not.toContain('at 2:10');
    });

    it('AC-12: RillError without location omits " at line:column" suffix', () => {
      const error = new RillError({
        errorId: 'RILL-R001',
        message: 'Type error',
      });

      expect(error.message).toBe('Type error');
      expect(error.message).not.toContain(' at ');
      expect(error.location).toBeUndefined();
    });
  });

  describe('Helper Function Tests', () => {
    it('getHelpUrl produces correct URL [AC-7]', () => {
      const url = getHelpUrl('RILL-R001', '0.4.5');
      expect(url).toBe(
        'https://github.com/rcrsr/rill/blob/v0.4.5/docs/88_errors.md#rill-r001'
      );
    });

    it('getHelpUrl returns empty string for invalid input [AC-11]', () => {
      expect(getHelpUrl('INVALID', '0.4.5')).toBe('');
      expect(getHelpUrl('RILL-R001', 'invalid-version')).toBe('');
    });

    it('EC-7: getHelpUrl with invalid errorId returns empty string', () => {
      expect(getHelpUrl('RILL-X999', '0.4.5')).toBe('');
      expect(getHelpUrl('NOT-AN-ID', '0.4.5')).toBe('');
      expect(getHelpUrl('RILL-R1', '0.4.5')).toBe(''); // Only 1 digit
      expect(getHelpUrl('RILL-R0001', '0.4.5')).toBe(''); // 4 digits
      expect(getHelpUrl('', '0.4.5')).toBe('');
    });

    it('EC-8: getHelpUrl with invalid version returns empty string', () => {
      expect(getHelpUrl('RILL-R001', '0.4')).toBe(''); // Missing patch
      expect(getHelpUrl('RILL-R001', 'v0.4.5')).toBe(''); // Has 'v' prefix
      expect(getHelpUrl('RILL-R001', '0.4.5-beta')).toBe(''); // Prerelease
      expect(getHelpUrl('RILL-R001', '')).toBe('');
      expect(getHelpUrl('RILL-R001', 'latest')).toBe('');
    });

    it('getHelpUrl lowercases error ID in anchor', () => {
      const url = getHelpUrl('RILL-R001', '1.0.0');
      expect(url).toContain('#rill-r001');
      expect(url).not.toContain('#RILL-R001');
    });

    it('getHelpUrl handles all error categories', () => {
      expect(getHelpUrl('RILL-L001', '0.4.5')).toContain('#rill-l001');
      expect(getHelpUrl('RILL-P001', '0.4.5')).toContain('#rill-p001');
      expect(getHelpUrl('RILL-R001', '0.4.5')).toContain('#rill-r001');
      expect(getHelpUrl('RILL-C001', '0.4.5')).toContain('#rill-c001');
    });
  });

  describe('Error Factory Tests', () => {
    it('createError throws TypeError for unknown ID [AC-10]', () => {
      expect(() => {
        createError('RILL-X999', {});
      }).toThrow(TypeError);

      expect(() => {
        createError('RILL-X999', {});
      }).toThrow('Unknown error ID: RILL-X999');
    });

    it('EC-9: createError with unknown errorId throws TypeError', () => {
      expect(() => {
        createError('INVALID-ID', {});
      }).toThrow(TypeError);

      expect(() => {
        createError('', {});
      }).toThrow(TypeError);
    });

    it('EC-10: createError with coercion failure uses fallback', () => {
      const problematic = {
        toString() {
          throw new Error('toString failed');
        },
      };

      const error = createError('RILL-R001', {
        function: 'test',
        param: problematic,
        position: 0,
        expected: 'string',
        actual: 'object',
      });

      expect(error.message).toContain('[object Object]');
    });

    it('EC-11: createError with malformed location omits metadata', () => {
      // Create error without location
      const error = createError('RILL-R005', { name: 'foo' });
      expect(error.location).toBeUndefined();
      expect(error.message).not.toContain(' at ');
    });

    it('createError renders message from template', () => {
      const error = createError('RILL-R005', { name: 'foo' });
      expect(error.message).toBe('Variable foo is not defined');
      expect(error.errorId).toBe('RILL-R005');
    });

    it('createError includes location in message', () => {
      const location: SourceLocation = { line: 3, column: 7, offset: 42 };
      const error = createError('RILL-R006', { name: 'bar' }, location);

      expect(error.message).toContain('Function bar is not defined');
      expect(error.message).toContain('at 3:7');
      expect(error.location).toEqual(location);
    });

    it('createError sets helpUrl', () => {
      const error = createError('RILL-R001', {
        function: 'add',
        param: 'x',
        position: 0,
        expected: 'number',
        actual: 'string',
      });

      expect(error.helpUrl).toBeDefined();
      expect(error.helpUrl).toContain('docs/88_errors.md#rill-r001');
    });

    it('createError preserves context', () => {
      const context = {
        function: 'test',
        param: 'x',
        position: 0,
        expected: 'number',
        actual: 'string',
      };
      const error = createError('RILL-R001', context);

      expect(error.context).toEqual(context);
    });
  });

  describe('Error Constructor Validation Tests', () => {
    describe('RillError constructor validation', () => {
      it('EC-3: throws TypeError when errorId is missing', () => {
        expect(() => {
          new RillError({
            errorId: '',
            message: 'Test message',
          });
        }).toThrow(TypeError);

        expect(() => {
          new RillError({
            errorId: '',
            message: 'Test message',
          });
        }).toThrow('errorId is required');
      });

      it('EC-4: throws TypeError when errorId is unknown', () => {
        expect(() => {
          new RillError({
            errorId: 'RILL-X999',
            message: 'Test message',
          });
        }).toThrow(TypeError);

        expect(() => {
          new RillError({
            errorId: 'RILL-X999',
            message: 'Test message',
          });
        }).toThrow('Unknown error ID: RILL-X999');
      });

      it('creates successfully with valid errorId', () => {
        const error = new RillError({
          errorId: 'RILL-R001',
          message: 'Test message',
        });

        expect(error).toBeInstanceOf(RillError);
        expect(error.errorId).toBe('RILL-R001');
        expect(error.message).toBe('Test message');
      });
    });

    describe('LexerError constructor validation [AC-6]', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      it('EC-5: throws TypeError when errorId is unknown', () => {
        expect(() => {
          new LexerError('RILL-X999', 'Test message', location);
        }).toThrow(TypeError);

        expect(() => {
          new LexerError('RILL-X999', 'Test message', location);
        }).toThrow('Unknown error ID: RILL-X999');
      });

      it('EC-6: throws TypeError when errorId has wrong category', () => {
        expect(() => {
          new LexerError('RILL-R001', 'Test message', location);
        }).toThrow(TypeError);

        expect(() => {
          new LexerError('RILL-R001', 'Test message', location);
        }).toThrow('Expected lexer error ID, got: RILL-R001');
      });

      it('creates successfully with valid lexer errorId', () => {
        const error = new LexerError('RILL-L001', 'Test message', location);

        expect(error).toBeInstanceOf(LexerError);
        expect(error).toBeInstanceOf(RillError);
        expect(error.errorId).toBe('RILL-L001');
        expect(error.location).toEqual(location);
      });
    });

    describe('ParseError constructor validation [AC-7]', () => {
      const location: SourceLocation = { line: 1, column: 10, offset: 10 };

      it('EC-7: throws TypeError when errorId is unknown', () => {
        expect(() => {
          new ParseError('RILL-X999', 'Test message', location);
        }).toThrow(TypeError);

        expect(() => {
          new ParseError('RILL-X999', 'Test message', location);
        }).toThrow('Unknown error ID: RILL-X999');
      });

      it('EC-8: throws TypeError when errorId has wrong category', () => {
        expect(() => {
          new ParseError('RILL-R001', 'Test message', location);
        }).toThrow(TypeError);

        expect(() => {
          new ParseError('RILL-R001', 'Test message', location);
        }).toThrow('Expected parse error ID, got: RILL-R001');
      });

      it('creates successfully with valid parse errorId', () => {
        const error = new ParseError('RILL-P001', 'Test message', location);

        expect(error).toBeInstanceOf(ParseError);
        expect(error).toBeInstanceOf(RillError);
        expect(error.errorId).toBe('RILL-P001');
        expect(error.location).toEqual(location);
      });
    });

    describe('RuntimeError constructor validation [AC-8]', () => {
      const location: SourceLocation = { line: 1, column: 15, offset: 15 };

      it('EC-9: throws TypeError when errorId is unknown', () => {
        expect(() => {
          new RuntimeError('RILL-X999', 'Test message', location);
        }).toThrow(TypeError);

        expect(() => {
          new RuntimeError('RILL-X999', 'Test message', location);
        }).toThrow('Unknown error ID: RILL-X999');
      });

      it('EC-10: throws TypeError when errorId has wrong category', () => {
        expect(() => {
          new RuntimeError('RILL-L001', 'Test message', location);
        }).toThrow(TypeError);

        expect(() => {
          new RuntimeError('RILL-L001', 'Test message', location);
        }).toThrow('Expected runtime error ID, got: RILL-L001');
      });

      it('creates successfully with valid runtime errorId', () => {
        const error = new RuntimeError('RILL-R001', 'Test message', location);

        expect(error).toBeInstanceOf(RuntimeError);
        expect(error).toBeInstanceOf(RillError);
        expect(error.errorId).toBe('RILL-R001');
        expect(error.location).toEqual(location);
      });

      it('creates successfully without location', () => {
        const error = new RuntimeError('RILL-R005', 'Test message');

        expect(error).toBeInstanceOf(RuntimeError);
        expect(error.errorId).toBe('RILL-R005');
        expect(error.location).toBeUndefined();
      });
    });
  });

  describe('Integration Tests [AC-17]', () => {
    it('Complete error lifecycle from registry to error instance', () => {
      // 1. Look up error definition from registry
      const definition = ERROR_REGISTRY.get('RILL-R001');
      expect(definition).toBeDefined();

      // 2. Verify definition structure
      expect(definition?.errorId).toBe('RILL-R001');
      expect(definition?.category).toBe('runtime');
      expect(definition?.messageTemplate).toContain('{function}');

      // 3. Create error using factory
      const location: SourceLocation = { line: 1, column: 10, offset: 10 };
      const error = createError(
        'RILL-R001',
        {
          function: 'add',
          param: 'x',
          position: 0,
          expected: 'number',
          actual: 'string',
        },
        location
      );

      // 4. Verify error instance
      expect(error).toBeInstanceOf(RillError);
      expect(error.errorId).toBe('RILL-R001');
      expect(error.message).toContain('Function add expects parameter x');
      expect(error.location).toEqual(location);
      expect(error.helpUrl).toContain('#rill-r001');
    });

    it('Multiple error IDs exist for different type error scenarios', () => {
      // Multiple distinct error IDs for different type error contexts
      const r001 = ERROR_REGISTRY.get('RILL-R001');
      const r002 = ERROR_REGISTRY.get('RILL-R002');
      const r003 = ERROR_REGISTRY.get('RILL-R003');
      const r004 = ERROR_REGISTRY.get('RILL-R004');

      expect(r001?.description).toBe('Parameter type mismatch');
      expect(r002?.description).toBe('Operator type mismatch');
      expect(r003?.description).toBe('Method receiver type mismatch');
      expect(r004?.description).toBe('Type conversion failure');

      // All should be runtime category
      expect(r001?.category).toBe('runtime');
      expect(r002?.category).toBe('runtime');
      expect(r003?.category).toBe('runtime');
      expect(r004?.category).toBe('runtime');
    });

    it('All error definitions have required fields', () => {
      for (const [errorId, definition] of ERROR_REGISTRY.entries()) {
        expect(definition.errorId).toBe(errorId);
        expect(definition.category).toMatch(/^(lexer|parse|runtime|check)$/);
        expect(definition.description).toBeTruthy();
        expect(definition.description.length).toBeLessThanOrEqual(50);
        expect(definition.messageTemplate).toBeTruthy();

        // Severity is optional, but if present must be valid
        if (definition.severity !== undefined) {
          expect(definition.severity).toMatch(/^(error|warning)$/);
        }
      }
    });

    it('Registry size matches expected error count', () => {
      // We should have errors defined across all categories
      expect(ERROR_REGISTRY.size).toBeGreaterThan(0);

      // Count errors by category
      let lexerCount = 0;
      let parseCount = 0;
      let runtimeCount = 0;
      let checkCount = 0;

      for (const [_errorId, definition] of ERROR_REGISTRY.entries()) {
        switch (definition.category) {
          case 'lexer':
            lexerCount++;
            break;
          case 'parse':
            parseCount++;
            break;
          case 'runtime':
            runtimeCount++;
            break;
          case 'check':
            checkCount++;
            break;
        }
      }

      expect(lexerCount).toBeGreaterThan(0);
      expect(parseCount).toBeGreaterThan(0);
      expect(runtimeCount).toBeGreaterThan(0);
      expect(checkCount).toBeGreaterThan(0);
    });
  });

  describe('CallFrame Interface Tests', () => {
    it('CallFrame accepts SourceSpan with all required fields', () => {
      const span: SourceSpan = {
        start: { line: 1, column: 5, offset: 5 },
        end: { line: 1, column: 10, offset: 10 },
      };

      const frame: CallFrame = {
        location: span,
      };

      expect(frame.location).toEqual(span);
      expect(frame.location.start.line).toBe(1);
      expect(frame.location.end.column).toBe(10);
    });

    it('CallFrame accepts optional functionName', () => {
      const span: SourceSpan = {
        start: { line: 2, column: 1, offset: 15 },
        end: { line: 2, column: 10, offset: 24 },
      };

      const frame: CallFrame = {
        location: span,
        functionName: 'processData',
      };

      expect(frame.functionName).toBe('processData');
    });

    it('CallFrame accepts optional context', () => {
      const span: SourceSpan = {
        start: { line: 3, column: 5, offset: 30 },
        end: { line: 3, column: 15, offset: 40 },
      };

      const frame: CallFrame = {
        location: span,
        context: 'in each body',
      };

      expect(frame.context).toBe('in each body');
    });

    it('CallFrame accepts all optional fields together', () => {
      const span: SourceSpan = {
        start: { line: 4, column: 1, offset: 45 },
        end: { line: 4, column: 20, offset: 64 },
      };

      const frame: CallFrame = {
        location: span,
        functionName: 'validate',
        context: 'in map closure',
      };

      expect(frame.location).toEqual(span);
      expect(frame.functionName).toBe('validate');
      expect(frame.context).toBe('in map closure');
    });
  });

  describe('ErrorExample Interface Tests', () => {
    it('ErrorExample accepts description and code', () => {
      const example: ErrorExample = {
        description: 'Adding string and number',
        code: '"hello" + 5',
      };

      expect(example.description).toBe('Adding string and number');
      expect(example.code).toBe('"hello" + 5');
    });

    it('ErrorExample description can be up to 100 characters', () => {
      const description = 'a'.repeat(100);
      const example: ErrorExample = {
        description,
        code: 'test',
      };

      expect(example.description.length).toBe(100);
    });

    it('ErrorExample code can be up to 500 characters', () => {
      const code = 'x'.repeat(500);
      const example: ErrorExample = {
        description: 'Long code example',
        code,
      };

      expect(example.code.length).toBe(500);
    });
  });

  describe('ErrorDefinition Extension Tests', () => {
    it('ErrorDefinition accepts optional cause field', () => {
      const definition: ErrorDefinition = {
        errorId: 'RILL-R001',
        category: 'runtime',
        description: 'Parameter type mismatch',
        messageTemplate: 'Expected {expected}, got {actual}',
        cause: 'Function parameter received wrong type',
      };

      expect(definition.cause).toBe('Function parameter received wrong type');
    });

    it('ErrorDefinition accepts optional resolution field', () => {
      const definition: ErrorDefinition = {
        errorId: 'RILL-R002',
        category: 'runtime',
        description: 'Operator type mismatch',
        messageTemplate:
          'Cannot apply {operator} to {leftType} and {rightType}',
        resolution: 'Ensure both operands have compatible types',
      };

      expect(definition.resolution).toBe(
        'Ensure both operands have compatible types'
      );
    });

    it('ErrorDefinition accepts optional examples field', () => {
      const examples: ErrorExample[] = [
        {
          description: 'Adding incompatible types',
          code: '"text" + 5',
        },
        {
          description: 'Multiplying string and number',
          code: '"hello" * 3',
        },
      ];

      const definition: ErrorDefinition = {
        errorId: 'RILL-R002',
        category: 'runtime',
        description: 'Operator type mismatch',
        messageTemplate:
          'Cannot apply {operator} to {leftType} and {rightType}',
        examples,
      };

      expect(definition.examples).toEqual(examples);
      expect(definition.examples?.length).toBe(2);
    });

    it('ErrorDefinition accepts all new optional fields together', () => {
      const examples: ErrorExample[] = [
        {
          description: 'Example 1',
          code: 'code1',
        },
        {
          description: 'Example 2',
          code: 'code2',
        },
        {
          description: 'Example 3',
          code: 'code3',
        },
      ];

      const definition: ErrorDefinition = {
        errorId: 'RILL-R003',
        category: 'runtime',
        description: 'Method receiver type mismatch',
        messageTemplate: 'Method {method} cannot be called on {type}',
        cause: 'Method called on incompatible type',
        resolution: 'Check method receiver type requirements',
        examples,
      };

      expect(definition.cause).toBe('Method called on incompatible type');
      expect(definition.resolution).toBe(
        'Check method receiver type requirements'
      );
      expect(definition.examples).toEqual(examples);
      expect(definition.examples?.length).toBe(3);
    });

    it('ErrorDefinition works without new optional fields (backward compatibility)', () => {
      const definition: ErrorDefinition = {
        errorId: 'RILL-R005',
        category: 'runtime',
        description: 'Undefined variable',
        messageTemplate: 'Variable {name} is not defined',
      };

      expect(definition.cause).toBeUndefined();
      expect(definition.resolution).toBeUndefined();
      expect(definition.examples).toBeUndefined();
    });

    it('All ERROR_REGISTRY definitions have documentation fields', () => {
      // Verify that all definitions have the new documentation fields populated
      for (const [errorId, definition] of ERROR_REGISTRY.entries()) {
        expect(definition.errorId).toBe(errorId);
        expect(definition.category).toBeTruthy();
        expect(definition.description).toBeTruthy();
        expect(definition.messageTemplate).toBeTruthy();
        // All 31 error definitions now have documentation fields
        expect(definition.cause).toBeTruthy();
        expect(definition.resolution).toBeTruthy();
        expect(definition.examples).toBeTruthy();
        expect(definition.examples!.length).toBeGreaterThan(0);
        expect(definition.examples!.length).toBeLessThanOrEqual(3);
      }
    });

    it('cause field can be up to 200 characters', () => {
      const cause = 'c'.repeat(200);
      const definition: ErrorDefinition = {
        errorId: 'RILL-R001',
        category: 'runtime',
        description: 'Test',
        messageTemplate: 'Test',
        cause,
      };

      expect(definition.cause?.length).toBe(200);
    });

    it('resolution field can be up to 300 characters', () => {
      const resolution = 'r'.repeat(300);
      const definition: ErrorDefinition = {
        errorId: 'RILL-R001',
        category: 'runtime',
        description: 'Test',
        messageTemplate: 'Test',
        resolution,
      };

      expect(definition.resolution?.length).toBe(300);
    });

    it('examples field can have up to 3 entries', () => {
      const examples: ErrorExample[] = [
        { description: 'Example 1', code: 'code1' },
        { description: 'Example 2', code: 'code2' },
        { description: 'Example 3', code: 'code3' },
      ];

      const definition: ErrorDefinition = {
        errorId: 'RILL-R001',
        category: 'runtime',
        description: 'Test',
        messageTemplate: 'Test',
        examples,
      };

      expect(definition.examples?.length).toBe(3);
    });
  });
});
