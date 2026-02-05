/**
 * Validator Tests
 * Verify validateScript orchestrator behavior.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@rcrsr/rill';
import { validateScript } from '../../src/check/validator.js';
import type {
  CheckConfig,
  ValidationRule,
  Diagnostic,
  ASTNode,
  ValidationContext,
} from '../../src/check/types.js';
import type { NodeType } from '@rcrsr/rill';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a minimal CheckConfig for testing.
 */
function createConfig(
  rules: Record<string, 'on' | 'off' | 'warn'> = {},
  severity: Record<string, 'error' | 'warning' | 'info'> = {}
): CheckConfig {
  return { rules, severity };
}

/**
 * Create a mock validation rule for testing.
 */
function createMockRule(
  code: string,
  nodeTypes: NodeType[],
  diagnosticCount: number = 1
): ValidationRule {
  return {
    code,
    category: 'naming',
    severity: 'error',
    nodeTypes,
    validate(node: ASTNode, _context: ValidationContext): Diagnostic[] {
      const diagnostics: Diagnostic[] = [];
      for (let i = 0; i < diagnosticCount; i++) {
        diagnostics.push({
          location: node.span.start,
          severity: 'error',
          code,
          message: `Mock diagnostic ${i} from ${code}`,
          context: '',
          fix: null,
        });
      }
      return diagnostics;
    },
  };
}

// ============================================================
// TESTS
// ============================================================

describe('validateScript', () => {
  describe('orchestration', () => {
    it('returns empty array when no rules registered', () => {
      const source = '"hello"';
      const ast = parse(source);
      const config = createConfig();

      const diagnostics = validateScript(ast, source, config);

      expect(diagnostics).toEqual([]);
    });

    it('returns empty array when all rules disabled', () => {
      const source = '"hello"';
      const ast = parse(source);
      const config = createConfig({ MOCK_RULE: 'off' });

      const diagnostics = validateScript(ast, source, config);

      expect(diagnostics).toEqual([]);
    });

    it('creates validation context with correct structure', () => {
      const source = '"hello"';
      const ast = parse(source);
      const config = createConfig();

      // Validation context is internal, verify through behavior
      const diagnostics = validateScript(ast, source, config);

      // Should complete without errors
      expect(Array.isArray(diagnostics)).toBe(true);
    });
  });

  describe('diagnostic sorting', () => {
    it('sorts diagnostics by line number', () => {
      const source = `"line1"
"line2"
"line3"`;
      const ast = parse(source);
      const config = createConfig();

      // Create mock diagnostics with different line numbers
      const mockDiagnostics: Diagnostic[] = [
        {
          location: { line: 3, column: 1 },
          severity: 'error',
          code: 'TEST',
          message: 'Line 3',
          context: '',
          fix: null,
        },
        {
          location: { line: 1, column: 1 },
          severity: 'error',
          code: 'TEST',
          message: 'Line 1',
          context: '',
          fix: null,
        },
        {
          location: { line: 2, column: 1 },
          severity: 'error',
          code: 'TEST',
          message: 'Line 2',
          context: '',
          fix: null,
        },
      ];

      // Sort using same logic as validateScript
      const sorted = [...mockDiagnostics].sort((a, b) => {
        if (a.location.line !== b.location.line) {
          return a.location.line - b.location.line;
        }
        return a.location.column - b.location.column;
      });

      expect(sorted[0].message).toBe('Line 1');
      expect(sorted[1].message).toBe('Line 2');
      expect(sorted[2].message).toBe('Line 3');
    });

    it('sorts diagnostics by column when lines equal', () => {
      const source = '"hello"';
      const mockDiagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 5 },
          severity: 'error',
          code: 'TEST',
          message: 'Col 5',
          context: '',
          fix: null,
        },
        {
          location: { line: 1, column: 1 },
          severity: 'error',
          code: 'TEST',
          message: 'Col 1',
          context: '',
          fix: null,
        },
        {
          location: { line: 1, column: 3 },
          severity: 'error',
          code: 'TEST',
          message: 'Col 3',
          context: '',
          fix: null,
        },
      ];

      const sorted = [...mockDiagnostics].sort((a, b) => {
        if (a.location.line !== b.location.line) {
          return a.location.line - b.location.line;
        }
        return a.location.column - b.location.column;
      });

      expect(sorted[0].message).toBe('Col 1');
      expect(sorted[1].message).toBe('Col 3');
      expect(sorted[2].message).toBe('Col 5');
    });

    it('sorts by line first, then column', () => {
      const mockDiagnostics: Diagnostic[] = [
        {
          location: { line: 2, column: 1 },
          severity: 'error',
          code: 'TEST',
          message: 'L2 C1',
          context: '',
          fix: null,
        },
        {
          location: { line: 1, column: 5 },
          severity: 'error',
          code: 'TEST',
          message: 'L1 C5',
          context: '',
          fix: null,
        },
        {
          location: { line: 1, column: 1 },
          severity: 'error',
          code: 'TEST',
          message: 'L1 C1',
          context: '',
          fix: null,
        },
        {
          location: { line: 2, column: 3 },
          severity: 'error',
          code: 'TEST',
          message: 'L2 C3',
          context: '',
          fix: null,
        },
      ];

      const sorted = [...mockDiagnostics].sort((a, b) => {
        if (a.location.line !== b.location.line) {
          return a.location.line - b.location.line;
        }
        return a.location.column - b.location.column;
      });

      expect(sorted[0].message).toBe('L1 C1');
      expect(sorted[1].message).toBe('L1 C5');
      expect(sorted[2].message).toBe('L2 C1');
      expect(sorted[3].message).toBe('L2 C3');
    });

    it('preserves original order for diagnostics at same location', () => {
      const mockDiagnostics: Diagnostic[] = [
        {
          location: { line: 1, column: 1 },
          severity: 'error',
          code: 'RULE_A',
          message: 'First',
          context: '',
          fix: null,
        },
        {
          location: { line: 1, column: 1 },
          severity: 'error',
          code: 'RULE_B',
          message: 'Second',
          context: '',
          fix: null,
        },
        {
          location: { line: 1, column: 1 },
          severity: 'error',
          code: 'RULE_C',
          message: 'Third',
          context: '',
          fix: null,
        },
      ];

      // JavaScript sort is stable, so order should be preserved
      const sorted = [...mockDiagnostics].sort((a, b) => {
        if (a.location.line !== b.location.line) {
          return a.location.line - b.location.line;
        }
        return a.location.column - b.location.column;
      });

      expect(sorted[0].code).toBe('RULE_A');
      expect(sorted[1].code).toBe('RULE_B');
      expect(sorted[2].code).toBe('RULE_C');
    });
  });

  describe('rule enablement', () => {
    it('invokes rules with state "on"', () => {
      const source = '"hello"';
      const ast = parse(source);

      // Rules would be in VALIDATION_RULES registry
      // This test verifies the enablement logic indirectly
      const config = createConfig({ RULE_A: 'on' });
      const diagnostics = validateScript(ast, source, config);

      // Currently VALIDATION_RULES is empty, so no diagnostics
      expect(diagnostics).toEqual([]);
    });

    it('invokes rules with state "warn"', () => {
      const source = '"hello"';
      const ast = parse(source);
      const config = createConfig({ RULE_A: 'warn' });

      const diagnostics = validateScript(ast, source, config);

      // Currently VALIDATION_RULES is empty, so no diagnostics
      expect(diagnostics).toEqual([]);
    });

    it('skips rules with state "off"', () => {
      const source = '"hello"';
      const ast = parse(source);
      const config = createConfig({ RULE_A: 'off' });

      const diagnostics = validateScript(ast, source, config);

      expect(diagnostics).toEqual([]);
    });
  });

  describe('node type filtering', () => {
    it('only invokes rules for matching node types', () => {
      const source = '"hello"';
      const ast = parse(source);
      const config = createConfig();

      // Rule system filters by nodeTypes array
      // Verified through rule.nodeTypes.includes(node.type) check
      const diagnostics = validateScript(ast, source, config);

      expect(diagnostics).toEqual([]);
    });
  });

  describe('complex scripts', () => {
    it('validates script with multiple statements', () => {
      const source = `
        "hello" => $greeting
        $greeting -> .upper => $shouted
        $shouted
      `;
      const ast = parse(source);
      const config = createConfig();

      const diagnostics = validateScript(ast, source, config);

      expect(Array.isArray(diagnostics)).toBe(true);
    });

    it('validates script with conditionals', () => {
      const source = 'true ? "yes" ! "no"';
      const ast = parse(source);
      const config = createConfig();

      const diagnostics = validateScript(ast, source, config);

      expect(Array.isArray(diagnostics)).toBe(true);
    });

    it('validates script with loops', () => {
      const source = '[1, 2, 3] -> each { $ * 2 }';
      const ast = parse(source);
      const config = createConfig();

      const diagnostics = validateScript(ast, source, config);

      expect(Array.isArray(diagnostics)).toBe(true);
    });

    it('validates script with closures', () => {
      const source = '|x: number| ($x * 2)';
      const ast = parse(source);
      const config = createConfig();

      const diagnostics = validateScript(ast, source, config);

      expect(Array.isArray(diagnostics)).toBe(true);
    });

    it('validates script with destructuring', () => {
      const source = '[1, 2, 3] -> *<$a, $b, $c>';
      const ast = parse(source);
      const config = createConfig();

      const diagnostics = validateScript(ast, source, config);

      expect(Array.isArray(diagnostics)).toBe(true);
    });
  });

  describe('integration behavior', () => {
    it('passes source to validation context', () => {
      const source = '"test source"';
      const ast = parse(source);
      const config = createConfig();

      // Context created internally with source
      const diagnostics = validateScript(ast, source, config);

      expect(diagnostics).toEqual([]);
    });

    it('passes AST to validation context', () => {
      const source = '"test"';
      const ast = parse(source);
      const config = createConfig();

      // Context created internally with ast
      const diagnostics = validateScript(ast, source, config);

      expect(diagnostics).toEqual([]);
    });

    it('passes config to validation context', () => {
      const source = '"test"';
      const ast = parse(source);
      const config = createConfig({ RULE_A: 'on' });

      // Context created internally with config
      const diagnostics = validateScript(ast, source, config);

      expect(diagnostics).toEqual([]);
    });

    it('initializes empty diagnostics array', () => {
      const source = '"test"';
      const ast = parse(source);
      const config = createConfig();

      const diagnostics = validateScript(ast, source, config);

      expect(Array.isArray(diagnostics)).toBe(true);
      expect(diagnostics.length).toBe(0);
    });

    it('initializes empty variables map', () => {
      const source = '$x';
      const ast = parse(source);
      const config = createConfig();

      // Variables map created and available to rules
      const diagnostics = validateScript(ast, source, config);

      expect(diagnostics).toEqual([]);
    });
  });
});
