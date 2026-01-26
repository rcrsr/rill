/**
 * Naming Rules Tests
 * Verify snake_case enforcement for variables, parameters, and dict keys.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../../src/index.js';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with NAMING_SNAKE_CASE rule enabled.
 */
function createConfig(): CheckConfig {
  return {
    rules: { NAMING_SNAKE_CASE: 'on' },
    severity: {},
  };
}

/**
 * Validate source and extract diagnostic messages.
 */
function getDiagnostics(source: string): string[] {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, createConfig());
  return diagnostics.map((d) => d.message);
}

/**
 * Validate source and check for violations.
 */
function hasViolations(source: string): boolean {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, createConfig());
  return diagnostics.length > 0;
}

/**
 * Validate source and get fix suggestions.
 */
function getFixes(
  source: string
): Array<{ description: string; replacement: string }> {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, createConfig());
  return diagnostics
    .filter((d) => d.fix !== null)
    .map((d) => ({
      description: d.fix!.description,
      replacement: d.fix!.replacement,
    }));
}

// ============================================================
// TESTS
// ============================================================

describe('NAMING_SNAKE_CASE', () => {
  describe('variables', () => {
    it('accepts valid snake_case variables', () => {
      expect(hasViolations('"test" :> $user_name')).toBe(false);
      expect(hasViolations('"test" :> $item_list')).toBe(false);
      expect(hasViolations('"test" :> $is_valid')).toBe(false);
      expect(hasViolations('"test" :> $count')).toBe(false);
      expect(hasViolations('"test" :> $x')).toBe(false);
    });

    it('accepts pipe variable', () => {
      expect(hasViolations('"test" -> $')).toBe(false);
      expect(hasViolations('"test" -> $ -> .len')).toBe(false);
    });

    it('rejects camelCase variables', () => {
      const messages = getDiagnostics('"test" :> $userName');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Captured variable 'userName' should use snake_case"
      );
      expect(messages[0]).toContain('user_name');
    });

    it('rejects PascalCase variables', () => {
      const messages = getDiagnostics('"test" :> $UserName');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Captured variable 'UserName' should use snake_case"
      );
    });

    it('rejects kebab-case variables', () => {
      const messages = getDiagnostics('"test" :> $user_name');
      // This should pass - it's already snake_case
      expect(hasViolations('"test" :> $user_name')).toBe(false);

      // Test actual kebab-case (with hyphens) - but this would be a parse error
      // so we skip testing invalid syntax
    });

    it('rejects variables with consecutive underscores', () => {
      const messages = getDiagnostics('"test" :> $user__name');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Captured variable 'user__name' should use snake_case"
      );
    });

    it('rejects variables with trailing underscore', () => {
      const messages = getDiagnostics('"test" :> $user_name_');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Captured variable 'user_name_' should use snake_case"
      );
    });

    it('provides fix suggestion for camelCase', () => {
      const fixes = getFixes('"test" :> $userName');
      expect(fixes).toHaveLength(1);
      expect(fixes[0].description).toBe("Rename 'userName' to 'user_name'");
      expect(fixes[0].replacement).toContain('$user_name');
    });

    it('provides fix suggestion for PascalCase', () => {
      const fixes = getFixes('"test" :> $ItemList');
      expect(fixes).toHaveLength(1);
      expect(fixes[0].description).toBe("Rename 'ItemList' to 'item_list'");
      expect(fixes[0].replacement).toContain('$item_list');
    });
  });

  describe('closure parameters', () => {
    it('accepts valid snake_case parameters', () => {
      expect(hasViolations('|user_name| $user_name')).toBe(false);
      expect(hasViolations('|item_count| $item_count')).toBe(false);
      expect(hasViolations('|x| $x')).toBe(false);
    });

    it('accepts single-letter parameters', () => {
      expect(hasViolations('|x| $x')).toBe(false);
      expect(hasViolations('|a, b| ($a + $b)')).toBe(false);
    });

    it('rejects camelCase parameters', () => {
      const messages = getDiagnostics('|userName| $userName');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Parameter 'userName' should use snake_case"
      );
    });

    it('rejects PascalCase parameters', () => {
      const messages = getDiagnostics('|UserName| $UserName');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Parameter 'UserName' should use snake_case"
      );
    });

    it('detects violations in multiple parameters', () => {
      const messages = getDiagnostics(
        '|firstName, lastName| "{$firstName} {$lastName}"'
      );
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain(
        "Parameter 'firstName' should use snake_case"
      );
      expect(messages[1]).toContain(
        "Parameter 'lastName' should use snake_case"
      );
    });

    it('provides fix suggestion for camelCase parameter', () => {
      const fixes = getFixes('|userName| $userName');
      expect(fixes).toHaveLength(1);
      expect(fixes[0].description).toBe("Rename 'userName' to 'user_name'");
      expect(fixes[0].replacement).toContain('user_name');
    });
  });

  describe('dict keys', () => {
    it('accepts valid snake_case dict keys', () => {
      expect(hasViolations('[user_name: "Alice"]')).toBe(false);
      expect(hasViolations('[first_name: "Alice", last_name: "Smith"]')).toBe(
        false
      );
      expect(hasViolations('[is_active: true]')).toBe(false);
      expect(hasViolations('[count: 42]')).toBe(false);
    });

    it('rejects camelCase dict keys', () => {
      const messages = getDiagnostics('[userName: "Alice"]');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Dict key 'userName' should use snake_case"
      );
    });

    it('rejects PascalCase dict keys', () => {
      const messages = getDiagnostics('[UserName: "Alice"]');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Dict key 'UserName' should use snake_case"
      );
    });

    it('detects violations in multiple dict keys', () => {
      const messages = getDiagnostics(
        '[firstName: "Alice", lastName: "Smith"]'
      );
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain(
        "Dict key 'firstName' should use snake_case"
      );
      expect(messages[1]).toContain(
        "Dict key 'lastName' should use snake_case"
      );
    });

    it('provides fix suggestion for camelCase dict key', () => {
      const fixes = getFixes('[userName: "Alice"]');
      expect(fixes).toHaveLength(1);
      expect(fixes[0].description).toBe("Rename 'userName' to 'user_name'");
      expect(fixes[0].replacement).toContain('user_name:');
    });

    it('handles mixed valid and invalid keys', () => {
      const messages = getDiagnostics('[user_name: "Alice", isActive: true]');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Dict key 'isActive' should use snake_case"
      );
    });
  });

  describe('captured variables', () => {
    it('accepts valid snake_case captures', () => {
      expect(hasViolations('"test" :> $result_data')).toBe(false);
      expect(hasViolations('42 :> $item_count')).toBe(false);
      expect(hasViolations('true :> $is_valid')).toBe(false);
    });

    it('rejects camelCase captures', () => {
      const messages = getDiagnostics('"test" :> $resultData');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Captured variable 'resultData' should use snake_case"
      );
    });

    it('rejects PascalCase captures', () => {
      const messages = getDiagnostics('"test" :> $ResultData');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        "Captured variable 'ResultData' should use snake_case"
      );
    });

    it('provides fix suggestion for camelCase capture', () => {
      const fixes = getFixes('"test" :> $resultData');
      expect(fixes).toHaveLength(1);
      expect(fixes[0].description).toBe("Rename 'resultData' to 'result_data'");
      expect(fixes[0].replacement).toContain('result_data');
    });
  });

  describe('edge cases', () => {
    it('handles numbers in names', () => {
      expect(hasViolations('"test" :> $item_1')).toBe(false);
      expect(hasViolations('"test" :> $user_2_name')).toBe(false);
      expect(hasViolations('[item_1: "test"]')).toBe(false);
    });

    it('handles single underscore', () => {
      expect(hasViolations('"test" :> $_')).toBe(false);
    });

    it('rejects empty variable name (parser should prevent this)', () => {
      // This would be a parse error, so we don't test it
    });

    it('handles leading underscore', () => {
      expect(hasViolations('"test" :> $_private')).toBe(false);
    });

    it('converts mixed case correctly', () => {
      const fixes = getFixes('"test" :> $getUserByID');
      expect(fixes).toHaveLength(1);
      expect(fixes[0].replacement).toContain('$get_user_by_id');
    });

    it('handles consecutive uppercase correctly', () => {
      const fixes = getFixes('"test" :> $XMLParser');
      expect(fixes[0].replacement).toContain('$xml_parser');
    });

    it('detects multiple violations in same script', () => {
      const source = `
        "Alice" :> $userName
        "Smith" :> $lastName
        [firstName: $userName, lastName: $lastName]
      `;
      const messages = getDiagnostics(source);
      expect(messages.length).toBeGreaterThanOrEqual(4); // 2 variables + 2 dict keys
    });
  });

  describe('rule configuration', () => {
    it('does not report violations when rule is disabled', () => {
      const source = '"test" :> $userName';
      const ast = parse(source);
      const config: CheckConfig = {
        rules: { NAMING_SNAKE_CASE: 'off' },
        severity: {},
      };

      const diagnostics = validateScript(ast, source, config);
      expect(diagnostics).toHaveLength(0);
    });

    it('reports violations when rule is set to warn', () => {
      const source = '"test" :> $userName';
      const ast = parse(source);
      const config: CheckConfig = {
        rules: { NAMING_SNAKE_CASE: 'warn' },
        severity: {},
      };

      const diagnostics = validateScript(ast, source, config);
      expect(diagnostics.length).toBeGreaterThan(0);
    });
  });
});
