/**
 * Fixer Tests
 * Tests for fix application with collision detection.
 */

import { describe, it, expect } from 'vitest';
import { applyFixes, type ApplyResult } from '../../src/check/fixer.js';
import type {
  Diagnostic,
  Fix,
  ValidationContext,
} from '../../src/check/types.js';
import { parse } from '../../src/parser/index.js';
import { createDefaultConfig } from '../../src/check/config.js';

/**
 * Helper to create a diagnostic with a fix.
 */
function createDiagnostic(
  code: string,
  line: number,
  column: number,
  startOffset: number,
  endOffset: number,
  replacement: string,
  applicable = true
): Diagnostic {
  return {
    location: { line, column, offset: startOffset },
    severity: 'error',
    code,
    message: `Test diagnostic for ${code}`,
    context: 'test context',
    fix: {
      description: `Fix ${code}`,
      applicable,
      range: {
        start: { line, column, offset: startOffset },
        end: {
          line,
          column: column + (endOffset - startOffset),
          offset: endOffset,
        },
      },
      replacement,
    },
  };
}

/**
 * Helper to create a minimal validation context.
 */
function createContext(source: string): ValidationContext {
  const ast = parse(source);
  return {
    source,
    ast,
    config: createDefaultConfig(),
    diagnostics: [],
    variables: new Map(),
  };
}

describe('applyFixes', () => {
  describe('basic fix application', () => {
    it('returns original source when no diagnostics provided', () => {
      const source = '"hello"';
      const context = createContext(source);
      const result = applyFixes(source, [], context);

      expect(result.modified).toBe(source);
      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.skippedReasons).toEqual([]);
    });

    it('returns original source when no fixes available', () => {
      const source = '"hello"';
      const context = createContext(source);
      const diagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 1, offset: 0 },
          severity: 'error',
          code: 'TEST_NO_FIX',
          message: 'Test',
          context: 'test',
          fix: null,
        },
      ];
      const result = applyFixes(source, diagnostics, context);

      expect(result.modified).toBe(source);
      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('returns original source when all fixes are not applicable', () => {
      const source = '"hello"';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('TEST_1', 1, 1, 0, 7, '"world"', false),
      ];
      const result = applyFixes(source, diagnostics, context);

      expect(result.modified).toBe(source);
      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('applies a single fix successfully', () => {
      const source = '"hello"';
      const context = createContext(source);
      const diagnostics = [createDiagnostic('TEST_1', 1, 1, 0, 7, '"world"')];
      const result = applyFixes(source, diagnostics, context);

      expect(result.modified).toBe('"world"');
      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.skippedReasons).toEqual([]);
    });

    it('applies multiple non-overlapping fixes', () => {
      const source = '"a" -> "b" -> "c"';
      const context = createContext(source);
      const diagnostics = [
        // Replace "a" with "x"
        createDiagnostic('TEST_1', 1, 1, 0, 3, '"x"'),
        // Replace "b" with "y"
        createDiagnostic('TEST_2', 1, 8, 7, 10, '"y"'),
        // Replace "c" with "z"
        createDiagnostic('TEST_3', 1, 15, 14, 17, '"z"'),
      ];
      const result = applyFixes(source, diagnostics, context);

      expect(result.modified).toBe('"x" -> "y" -> "z"');
      expect(result.applied).toBe(3);
      expect(result.skipped).toBe(0);
    });
  });

  describe('fix ordering', () => {
    it('applies fixes in reverse position order to avoid offset shifts', () => {
      const source = '1 + 2 + 3';
      const context = createContext(source);
      const diagnostics = [
        // These fixes are provided in forward order
        createDiagnostic('TEST_1', 1, 1, 0, 1, '10'), // Replace "1"
        createDiagnostic('TEST_2', 1, 5, 4, 5, '20'), // Replace "2"
        createDiagnostic('TEST_3', 1, 9, 8, 9, '30'), // Replace "3"
      ];
      const result = applyFixes(source, diagnostics, context);

      // Should apply from end to start
      expect(result.modified).toBe('10 + 20 + 30');
      expect(result.applied).toBe(3);
    });

    it('handles fixes at different positions correctly', () => {
      const source = '[a: 1, b: 2]';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('TEST_1', 1, 2, 1, 2, 'x'), // "a" -> "x"
        createDiagnostic('TEST_2', 1, 8, 7, 8, 'y'), // "b" -> "y"
      ];
      const result = applyFixes(source, diagnostics, context);

      expect(result.modified).toBe('[x: 1, y: 2]');
      expect(result.applied).toBe(2);
    });
  });

  describe('collision detection [EC-5]', () => {
    it('skips overlapping fixes with reason', () => {
      const source = '"hello world"';
      const context = createContext(source);
      const diagnostics = [
        // First fix: replace entire string
        createDiagnostic('TEST_1', 1, 1, 0, 13, '"goodbye"'),
        // Second fix: replace part of string (overlaps with first)
        createDiagnostic('TEST_2', 1, 2, 1, 6, 'HELLO'),
      ];
      const result = applyFixes(source, diagnostics, context);

      // First fix applied (appears last in sorted order)
      expect(result.modified).toBe('"goodbye"');
      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.skippedReasons).toHaveLength(1);
      expect(result.skippedReasons[0]).toEqual({
        code: 'TEST_2',
        reason: 'Fix range overlaps with another fix',
      });
    });

    it('skips multiple overlapping fixes', () => {
      const source = '"hello"';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('TEST_1', 1, 1, 0, 7, '"a"'),
        createDiagnostic('TEST_2', 1, 1, 0, 7, '"b"'),
        createDiagnostic('TEST_3', 1, 1, 0, 7, '"c"'),
      ];
      const result = applyFixes(source, diagnostics, context);

      // Only one fix applied, others skipped
      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.skippedReasons).toHaveLength(2);
      expect(
        result.skippedReasons.every(
          (r) => r.reason === 'Fix range overlaps with another fix'
        )
      ).toBe(true);
    });

    it('applies non-overlapping fixes and skips overlapping ones', () => {
      const source = '"a" -> "b" -> "c"';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('TEST_1', 1, 1, 0, 3, '"x"'), // "a" -> "x" (ok)
        createDiagnostic('TEST_2', 1, 2, 1, 2, 'X'), // Overlaps with TEST_1
        createDiagnostic('TEST_3', 1, 8, 7, 10, '"y"'), // "b" -> "y" (ok)
      ];
      const result = applyFixes(source, diagnostics, context);

      expect(result.modified).toBe('"x" -> "y" -> "c"');
      expect(result.applied).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.skippedReasons[0]?.code).toBe('TEST_2');
    });

    it('detects adjacent but non-overlapping ranges correctly', () => {
      const source = '"ab"';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('TEST_1', 1, 2, 1, 2, 'X'), // "a" -> "X"
        createDiagnostic('TEST_2', 1, 3, 2, 3, 'Y'), // "b" -> "Y"
      ];
      const result = applyFixes(source, diagnostics, context);

      // Adjacent ranges should NOT overlap
      expect(result.modified).toBe('"XY"');
      expect(result.applied).toBe(2);
      expect(result.skipped).toBe(0);
    });
  });

  describe('parse verification [EC-6]', () => {
    it('throws when fix creates invalid syntax', () => {
      const source = '"hello"';
      const context = createContext(source);
      const diagnostics = [
        // This creates invalid syntax (operator without operands)
        createDiagnostic('TEST_BAD', 1, 1, 0, 7, '1 + +'),
      ];

      expect(() => applyFixes(source, diagnostics, context)).toThrow(
        'Fix would create invalid syntax'
      );
    });

    it('throws when multiple fixes together create invalid syntax', () => {
      const source = '1 + 2';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('TEST_1', 1, 1, 0, 1, '+'), // Replace "1" with "+"
        createDiagnostic('TEST_2', 1, 5, 4, 5, '+'), // Replace "2" with "+"
      ];

      // Results in "+ + +" which is invalid
      expect(() => applyFixes(source, diagnostics, context)).toThrow(
        'Fix would create invalid syntax'
      );
    });

    it('succeeds when all fixes create valid syntax', () => {
      const source = '"a" -> "b"';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('TEST_1', 1, 1, 0, 3, '"x"'),
        createDiagnostic('TEST_2', 1, 8, 7, 10, '"y"'),
      ];

      const result = applyFixes(source, diagnostics, context);
      expect(result.modified).toBe('"x" -> "y"');

      // Verify it actually parses
      expect(() => parse(result.modified)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('handles empty source', () => {
      const source = '';
      const context = createContext(source);
      const result = applyFixes(source, [], context);

      expect(result.modified).toBe('');
      expect(result.applied).toBe(0);
    });

    it('handles fix that replaces entire source', () => {
      const source = '"old"';
      const context = createContext(source);
      const diagnostics = [createDiagnostic('TEST_1', 1, 1, 0, 5, '"new"')];
      const result = applyFixes(source, diagnostics, context);

      expect(result.modified).toBe('"new"');
      expect(result.applied).toBe(1);
    });

    it('handles fix with empty replacement (deletion)', () => {
      const source = '1 + 2';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('TEST_1', 1, 1, 0, 1, ''), // Remove "1"
      ];

      // This would create invalid syntax ( + 2)
      expect(() => applyFixes(source, diagnostics, context)).toThrow(
        'Fix would create invalid syntax'
      );
    });

    it('handles fix with multi-line replacement', () => {
      const source = '1';
      const context = createContext(source);
      const diagnostics = [createDiagnostic('TEST_1', 1, 1, 0, 1, '{\n  2\n}')];
      const result = applyFixes(source, diagnostics, context);

      expect(result.modified).toBe('{\n  2\n}');
      expect(result.applied).toBe(1);
    });
  });

  describe('return value structure', () => {
    it('returns correct structure with all fields', () => {
      const source = '"hello"';
      const context = createContext(source);
      const diagnostics = [createDiagnostic('TEST_1', 1, 1, 0, 7, '"world"')];
      const result = applyFixes(source, diagnostics, context);

      expect(result).toHaveProperty('modified');
      expect(result).toHaveProperty('applied');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('skippedReasons');
      expect(typeof result.modified).toBe('string');
      expect(typeof result.applied).toBe('number');
      expect(typeof result.skipped).toBe('number');
      expect(Array.isArray(result.skippedReasons)).toBe(true);
    });

    it('includes all skipped reasons with correct structure', () => {
      const source = '"test"';
      const context = createContext(source);
      const diagnostics = [
        createDiagnostic('RULE_A', 1, 1, 0, 6, '"a"'),
        createDiagnostic('RULE_B', 1, 1, 0, 6, '"b"'),
        createDiagnostic('RULE_C', 1, 1, 0, 6, '"c"'),
      ];
      const result = applyFixes(source, diagnostics, context);

      expect(result.skipped).toBe(2);
      expect(result.skippedReasons).toHaveLength(2);
      result.skippedReasons.forEach((reason) => {
        expect(reason).toHaveProperty('code');
        expect(reason).toHaveProperty('reason');
        expect(typeof reason.code).toBe('string');
        expect(typeof reason.reason).toBe('string');
      });
    });
  });
});
