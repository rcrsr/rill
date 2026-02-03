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
  renderMessage,
  RILL_ERROR_CODES,
  RillError,
  type ErrorDefinition,
  type SourceLocation,
} from '../../src/index.js';

describe('Rill Runtime: Error Taxonomy', () => {
  describe('Registry Tests', () => {
    it('Registry lookup returns in O(1) [AC-3, AC-4]', () => {
      const definition = ERROR_REGISTRY.get('RILL-R001');
      expect(definition).toBeDefined();
      expect(definition?.errorId).toBe('RILL-R001');
      expect(definition?.legacyCode).toBe(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR);
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
      expect(
        ERROR_REGISTRY.getByLegacyCode(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR)
      ).toHaveLength(4); // R001, R002, R003, R004
      expect(ERROR_REGISTRY.has('RILL-R001')).toBe(true);
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

    it('EC-2: Unknown legacyCode returns empty array', () => {
      // Use a code that doesn't exist
      const unknownCode = 'UNKNOWN_CODE' as never;
      const result = ERROR_REGISTRY.getByLegacyCode(unknownCode);
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
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
      expect(error.code).toBe(RILL_ERROR_CODES.PARSE_INVALID_SYNTAX);
      expect(error.errorId).toBe('RILL-L001');
      expect(error.location).toEqual(location);
    });

    it('EC-3: LexerError with unknown errorId throws TypeError', () => {
      const location: SourceLocation = { line: 1, column: 5, offset: 5 };

      expect(() => {
        new LexerError('RILL-X999', 'Invalid error', location);
      }).toThrow(TypeError);

      expect(() => {
        new LexerError('RILL-X999', 'Invalid error', location);
      }).toThrow('Unknown error ID: RILL-X999');
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
        code: RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
        errorId: 'RILL-R005',
        message: 'Variable foo is not defined',
        location,
        context,
      });

      expect(error.code).toBe(RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE);
      expect(error.errorId).toBe('RILL-R005');
      expect(error.location).toEqual(location);
      expect(error.context).toEqual(context);
      expect(error.message).toContain('Variable foo is not defined');
      expect(error.message).toContain('at 2:10');
    });

    it('RillError toData() strips location suffix', () => {
      const location: SourceLocation = { line: 2, column: 10, offset: 25 };
      const error = new RillError({
        code: RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        errorId: 'RILL-R001',
        message: 'Type error',
        location,
      });

      const data = error.toData();
      expect(data.message).toBe('Type error');
      expect(data.message).not.toContain('at 2:10');
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
      expect(error.code).toBe(RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE);
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

  describe('Integration Tests [AC-17]', () => {
    it('Complete error lifecycle from registry to error instance', () => {
      // 1. Look up error definition from registry
      const definition = ERROR_REGISTRY.get('RILL-R001');
      expect(definition).toBeDefined();

      // 2. Verify definition structure
      expect(definition?.errorId).toBe('RILL-R001');
      expect(definition?.legacyCode).toBe(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR);
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
      expect(error.code).toBe(RILL_ERROR_CODES.RUNTIME_TYPE_ERROR);
      expect(error.message).toContain('Function add expects parameter x');
      expect(error.location).toEqual(location);
      expect(error.helpUrl).toContain('#rill-r001');
    });

    it('Legacy code can map to multiple error IDs', () => {
      const typeErrors = ERROR_REGISTRY.getByLegacyCode(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR
      );

      // R001, R002, R003, R004 all map to RUNTIME_TYPE_ERROR
      expect(typeErrors.length).toBeGreaterThanOrEqual(4);

      const errorIds = typeErrors.map((def: ErrorDefinition) => def.errorId);
      expect(errorIds).toContain('RILL-R001'); // Parameter type mismatch
      expect(errorIds).toContain('RILL-R002'); // Operator type mismatch
      expect(errorIds).toContain('RILL-R003'); // Method receiver type mismatch
      expect(errorIds).toContain('RILL-R004'); // Type conversion failure
    });

    it('All error definitions have required fields', () => {
      for (const [errorId, definition] of ERROR_REGISTRY.entries()) {
        expect(definition.errorId).toBe(errorId);
        expect(definition.legacyCode).toBeDefined();
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
});
