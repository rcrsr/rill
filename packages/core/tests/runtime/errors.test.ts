/**
 * Rill Runtime Tests: Error Taxonomy
 * Tests for error registry, template rendering, error classes, and helper functions
 */

import { describe, expect, it } from 'vitest';

import {
  createError,
  ERROR_REGISTRY,
  LexerError,
  ParseError,
  renderMessage,
  RillError,
  RuntimeError,
  type SourceLocation,
} from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Error Taxonomy', () => {
  describe('Registry Tests', () => {
    it('Registry lookup returns in O(1) [AC-3, AC-4]', () => {
      const definition = ERROR_REGISTRY.get('RILL-R001');
      expect(definition).toBeDefined();
      expect(definition?.errorId).toBe('RILL-R001');
      expect(definition?.category).toBe('runtime');
    });

    it('No duplicate errorIds [AC-1, AC-2]', () => {
      const seen = new Set<string>();
      for (const [errorId] of ERROR_REGISTRY.entries()) {
        expect(seen.has(errorId)).toBe(false);
        seen.add(errorId);
      }
    });

    it('Error ID format supports 3-digit numbers [AC-15]', () => {
      // Verify that all error IDs follow the RILL-{category}{3-digit} format
      for (const [errorId] of ERROR_REGISTRY.entries()) {
        expect(errorId).toMatch(/^RILL-[LPRC]\d{3}$/);
      }
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

    it('Null context value coerced to "null"', () => {
      const result = renderMessage('Value: {value}', { value: null });
      expect(result).toBe('Value: null');
    });

    it('Empty placeholder renders as empty string', () => {
      const result = renderMessage('Test {} value', {});
      expect(result).toBe('Test  value');
    });

    it('Placeholder name may contain whitespace', () => {
      const result = renderMessage('Test {name with spaces}', {
        'name with spaces': 'value',
      });
      expect(result).toBe('Test value');
    });

    it('Multiple unclosed braces return template unchanged', () => {
      const template = 'Error {code at {location';
      const result = renderMessage(template, {
        code: 'E001',
        location: 'line 5',
      });
      expect(result).toBe(template);
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
      expect(error.helpUrl).toContain('docs/ref-errors.md#rill-r001');
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

    it('createError returns a ParseError instance for a parse-category ID', () => {
      const error = createError('RILL-P001', {
        token: '}',
        expected: ')',
      });

      expect(error).toBeInstanceOf(ParseError);
      expect(error).toBeInstanceOf(RillError);
    });

    it('createError returns a RuntimeError instance for a runtime-category ID', () => {
      const error = createError('RILL-R005', { name: 'foo' });

      expect(error).toBeInstanceOf(RuntimeError);
      expect(error).toBeInstanceOf(RillError);
    });

    it('createError returns a ParseError instance for a legacy syntax-parse ID', () => {
      const error = createError('RILL-R078', {});

      expect(error).toBeInstanceOf(ParseError);
      expect(error).toBeInstanceOf(RillError);
    });

    it('createError omits location metadata for an unlocated parse-category ID', () => {
      const error = createError('RILL-P001', {
        token: '}',
        expected: ')',
      });

      expect(error).toBeInstanceOf(ParseError);
      expect(error.location).toBeUndefined();
      expect(error.message).not.toContain(' at ');
      expect(error.message).toBe('Unexpected token }, expected )');
    });

    it('createError includes location metadata for a located parse-category ID', () => {
      const location: SourceLocation = { line: 2, column: 4, offset: 10 };
      const error = createError(
        'RILL-P001',
        { token: '}', expected: ')' },
        location
      );

      expect(error).toBeInstanceOf(ParseError);
      expect(error.location).toEqual(location);
      expect(error.message).toContain('at 2:4');
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

    it('Registry size matches expected error count', () => {
      // We should have errors defined across all categories
      expect(ERROR_REGISTRY.size).toBeGreaterThan(0);

      // Count errors by category
      let lexerCount = 0;
      let parseCount = 0;
      let runtimeCount = 0;
      let checkCount = 0;

      for (const [, definition] of ERROR_REGISTRY.entries()) {
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

  describe('AC-36: Phase 3 parse error codes exist with required fields', () => {
    it('RILL-P007 exists in ERROR_REGISTRY with cause, resolution, and examples', () => {
      // AC-36: whitespace adjacency error must have all documentation fields
      const definition = ERROR_REGISTRY.get('RILL-P007');
      expect(definition).toBeDefined();
      expect(definition?.errorId).toBe('RILL-P007');
      expect(definition?.category).toBe('parse');
      expect(definition?.cause).toBeTruthy();
      expect(definition?.resolution).toBeTruthy();
      expect(definition?.examples).toBeDefined();
      expect(definition?.examples!.length).toBeGreaterThan(0);
    });

    it('RILL-P008 exists in ERROR_REGISTRY with cause, resolution, and examples', () => {
      // AC-36: bare bracket error must have all documentation fields
      const definition = ERROR_REGISTRY.get('RILL-P008');
      expect(definition).toBeDefined();
      expect(definition?.errorId).toBe('RILL-P008');
      expect(definition?.category).toBe('parse');
      expect(definition?.cause).toBeTruthy();
      expect(definition?.resolution).toBeTruthy();
      expect(definition?.examples).toBeDefined();
      expect(definition?.examples!.length).toBeGreaterThan(0);
    });

    it('RILL-P009 exists in ERROR_REGISTRY with cause, resolution, and examples', () => {
      // AC-36: removed sigil forms error must have all documentation fields
      const definition = ERROR_REGISTRY.get('RILL-P009');
      expect(definition).toBeDefined();
      expect(definition?.errorId).toBe('RILL-P009');
      expect(definition?.category).toBe('parse');
      expect(definition?.cause).toBeTruthy();
      expect(definition?.resolution).toBeTruthy();
      expect(definition?.examples).toBeDefined();
      expect(definition?.examples!.length).toBeGreaterThan(0);
    });

    it('RILL-P010 exists in ERROR_REGISTRY with cause, resolution, and examples', () => {
      // AC-36: AT chain replacement error must have all documentation fields
      const definition = ERROR_REGISTRY.get('RILL-P010');
      expect(definition).toBeDefined();
      expect(definition?.errorId).toBe('RILL-P010');
      expect(definition?.category).toBe('parse');
      expect(definition?.cause).toBeTruthy();
      expect(definition?.resolution).toBeTruthy();
      expect(definition?.examples).toBeDefined();
      expect(definition?.examples!.length).toBeGreaterThan(0);
    });
  });

  describe('AC-37: Phase 3 resolution fields reference keyword-prefixed replacements', () => {
    it('RILL-P009 resolution references keyword-prefixed replacement forms', () => {
      // AC-37: removed sigil forms (*[, *<, /<) resolution must guide users to keyword syntax
      const definition = ERROR_REGISTRY.get('RILL-P009');
      expect(definition).toBeDefined();

      const resolution = definition?.resolution ?? '';
      // Resolution must mention the keyword-prefixed syntax (tuple, destruct, or slice)
      const mentionsKeywordForm =
        resolution.includes('tuple') ||
        resolution.includes('destruct') ||
        resolution.includes('slice') ||
        resolution.includes('keyword');
      expect(
        mentionsKeywordForm,
        `RILL-P009 resolution must reference keyword-prefixed replacements, got: "${resolution}"`
      ).toBe(true);
    });

    it('RILL-P009 examples reference specific keyword-prefixed forms', () => {
      // AC-37: examples must show the keyword-prefixed alternatives
      const definition = ERROR_REGISTRY.get('RILL-P009');
      expect(definition).toBeDefined();

      const exampleCodes =
        definition?.examples?.map((ex) => ex.code).join('\n') ?? '';
      // Examples must contain at least one keyword-prefixed form
      const mentionsKeywordForm =
        exampleCodes.includes('tuple[') ||
        exampleCodes.includes('ordered[') ||
        exampleCodes.includes('destruct<') ||
        exampleCodes.includes('slice<');
      expect(
        mentionsKeywordForm,
        'RILL-P009 examples must show keyword-prefixed replacement forms'
      ).toBe(true);
    });

    it('RILL-P010 resolution references chain() as the replacement', () => {
      // AC-37: AT chain replacement (@[, @$fn) resolution must reference chain()
      const definition = ERROR_REGISTRY.get('RILL-P010');
      expect(definition).toBeDefined();

      const resolution = definition?.resolution ?? '';
      expect(
        resolution.includes('chain('),
        `RILL-P010 resolution must reference chain(), got: "${resolution}"`
      ).toBe(true);
    });

    it('RILL-P010 messageTemplate references chain() as the replacement', () => {
      // AC-37: the error message itself must guide users toward chain()
      const definition = ERROR_REGISTRY.get('RILL-P010');
      expect(definition).toBeDefined();

      const template = definition?.messageTemplate ?? '';
      expect(
        template.includes('chain('),
        `RILL-P010 messageTemplate must reference chain(), got: "${template}"`
      ).toBe(true);
    });
  });

  describe('Loop Syntax Migration Errors [AC-NOD-23]', () => {
    it('R079: (cond) @ { body } emits RILL-R079 with UXT row-1 message and @ span', async () => {
      // Arrange: legacy pre-loop form — @ is at column 14, line 1
      const source = '0 -> ($ < 3) @ { $ + 1 }';

      // Act
      const err = await run(source).catch((e: unknown) => e);

      // Assert
      expect(err).toBeInstanceOf(ParseError);
      const e = err as ParseError;
      expect(e.errorId).toBe('RILL-R079');
      expect(e.message).toContain(
        'Migration error: use `while (cond) do { body }`'
      );
      expect(e.location?.line).toBe(1);
      expect(e.location?.column).toBe(14);
    });

    it('R080: seed -> @ { body } ? (cond) emits RILL-R080 with UXT row-2 message and @ span', async () => {
      // Arrange: legacy seeded post-loop form — @ is at column 6, line 1
      const source = '0 -> @ { $ + 1 } ? ($ < 3)';

      // Act
      const err = await run(source).catch((e: unknown) => e);

      // Assert
      expect(err).toBeInstanceOf(ParseError);
      const e = err as ParseError;
      expect(e.errorId).toBe('RILL-R080');
      expect(e.message).toContain(
        'Migration error: use `do { body } while (cond)`'
      );
      expect(e.location?.line).toBe(1);
      expect(e.location?.column).toBe(6);
    });

    it('R081: bare ^(limit: N) as primary expression emits RILL-R081 with UXT row-3 message and ^ span', async () => {
      // Arrange: bare ^(limit:) without preceding @ — ^ is at column 8, line 1
      const source = 'true ? ^(limit: 5) { $ + 1 } ! 0';

      // Act
      const err = await run(source).catch((e: unknown) => e);

      // Assert
      expect(err).toBeInstanceOf(ParseError);
      const e = err as ParseError;
      expect(e.errorId).toBe('RILL-R081');
      expect(e.message).toContain(
        'Migration error: use `do<limit: N> { body }`'
      );
      expect(e.location?.line).toBe(1);
      expect(e.location?.column).toBe(8);
    });
  });

  describe('Error Registry Syntax Validation [AC-9]', () => {
    it('RILL-R010 infinite loop example uses correct while syntax', () => {
      const definition = ERROR_REGISTRY.get('RILL-R010');
      expect(definition).toBeDefined();

      const infiniteLoopExample = definition?.examples?.find(
        (ex) => ex.description === 'Infinite loop without termination'
      );
      expect(infiniteLoopExample).toBeDefined();
      expect(infiniteLoopExample?.code).toContain('while (true) do {');
      expect(infiniteLoopExample?.code).not.toContain('@ {');
    });

    it('RILL-R010 large collection example uses correct range syntax', () => {
      const definition = ERROR_REGISTRY.get('RILL-R010');
      expect(definition).toBeDefined();

      const largeCollectionExample = definition?.examples?.find(
        (ex) => ex.description === 'Large collection with default limit'
      );
      expect(largeCollectionExample).toBeDefined();
      expect(largeCollectionExample?.code).toContain('range(0, 1000000)');
      expect(largeCollectionExample?.code).not.toMatch(/range\(\d+\)(?!\s*,)/);
    });

    it('RILL-R016 conditional error example uses correct ternary syntax', () => {
      const definition = ERROR_REGISTRY.get('RILL-R016');
      expect(definition).toBeDefined();

      const conditionalExample = definition?.examples?.find(
        (ex) => ex.description === 'Conditional error'
      );
      expect(conditionalExample).toBeDefined();
      expect(conditionalExample?.code).toContain('($status == "failed") ?');
      expect(conditionalExample?.code).toContain('{ error');
      expect(conditionalExample?.code).toContain('!');
      expect(conditionalExample?.code).not.toContain('?($status');
      expect(conditionalExample?.code).not.toContain(': "ok"');
    });
  });
});
