/**
 * Conditional Convention Rules Tests
 * Verify conditional convention enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@rcrsr/rill';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with conditional rules enabled.
 */
function createConfig(rules: Record<string, 'on' | 'off'> = {}): CheckConfig {
  return {
    rules: {
      USE_DEFAULT_OPERATOR: 'on',
      CONDITION_TYPE: 'on',
      ...rules,
    },
    severity: {},
  };
}

/**
 * Validate source and extract diagnostic messages.
 */
function getDiagnostics(source: string, config?: CheckConfig): string[] {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, config ?? createConfig());
  return diagnostics.map((d) => d.message);
}

/**
 * Validate source and check for violations.
 */
function hasViolations(source: string, config?: CheckConfig): boolean {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, config ?? createConfig());
  return diagnostics.length > 0;
}

/**
 * Validate source and get diagnostic codes.
 */
function getCodes(source: string, config?: CheckConfig): string[] {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, config ?? createConfig());
  return diagnostics.map((d) => d.code);
}

// ============================================================
// USE_DEFAULT_OPERATOR TESTS
// ============================================================

describe('USE_DEFAULT_OPERATOR', () => {
  const config = createConfig({ CONDITION_TYPE: 'off' });

  it('accepts ?? for default values', () => {
    expect(hasViolations('$dict.field ?? "default"', config)).toBe(false);
  });

  it('accepts simple conditionals without .? check', () => {
    expect(hasViolations('$x > 0 ? "positive" ! "negative"', config)).toBe(
      false
    );
  });

  it('detects verbose default pattern with .? check', () => {
    const source = '$data.?name ? $data.name ! "unknown"';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Use ?? for defaults');
    expect(messages[0]).toContain('$dict.field ?? "default"');
  });

  it('accepts conditional without else branch', () => {
    expect(hasViolations('$data.?field ? "exists"', config)).toBe(false);
  });

  it('accepts negated conditionals without existence check', () => {
    // Pattern: value -> ! { body } is a negated conditional, not a default pattern
    expect(
      hasViolations(
        'ccr::file_exists($path) -> ! { ccr::error("...") }',
        config
      )
    ).toBe(false);
    expect(hasViolations('true -> ! { "not true" }', config)).toBe(false);
    expect(hasViolations('$ready -> ! { "not ready" }', config)).toBe(false);
  });

  it('has correct severity and code', () => {
    const source = '$data.?field ? $data.field ! "default"';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('USE_DEFAULT_OPERATOR');
    expect(diagnostics[0]?.severity).toBe('info');
  });
});

// ============================================================
// CONDITION_TYPE TESTS
// ============================================================

describe('CONDITION_TYPE', () => {
  const config = createConfig({ USE_DEFAULT_OPERATOR: 'off' });

  it('is currently disabled - accepts all conditionals', () => {
    // Note: This rule is currently disabled because Rill allows truthy/falsy
    // semantics in conditionals, and runtime handles type checking.
    // These tests verify the rule doesn't produce false positives.

    expect(hasViolations('true ? "yes" ! "no"', config)).toBe(false);
    expect(hasViolations('false ? "yes" ! "no"', config)).toBe(false);
    expect(hasViolations('$x > 0 ? "positive" ! "negative"', config)).toBe(
      false
    );
    expect(hasViolations('$a == $b ? "equal" ! "different"', config)).toBe(
      false
    );
    expect(hasViolations('$a && $b ? "both" ! "not both"', config)).toBe(false);
    expect(hasViolations('!$ready ? "not ready" ! "ready"', config)).toBe(
      false
    );
    expect(
      hasViolations(
        '"hello" -> .contains("ell") ? "found" ! "not found"',
        config
      )
    ).toBe(false);
    expect(
      hasViolations('$val -> :?string ? "is string" ! "not string"', config)
    ).toBe(false);
    expect(hasViolations('$data.?field ? "exists" ! "missing"', config)).toBe(
      false
    );

    // Currently these don't trigger warnings (rule disabled)
    expect(hasViolations('"hello" ? "has value" ! "empty"', config)).toBe(
      false
    );
    expect(hasViolations('42 ? "yes" ! "no"', config)).toBe(false);
    expect(hasViolations('$name ? "has name" ! "no name"', config)).toBe(false);
  });
});

// ============================================================
// INTEGRATION TESTS
// ============================================================

describe('Conditional rules integration', () => {
  it('can detect multiple violations in same code', () => {
    const source = '$data.?field ? $data.field ! "default"';

    const codes = getCodes(source);
    // Should detect USE_DEFAULT_OPERATOR
    expect(codes).toContain('USE_DEFAULT_OPERATOR');
  });

  it('respects rule configuration', () => {
    const source = '$data.?field ? $data.field ! "default"';

    // With USE_DEFAULT_OPERATOR on
    const withRule = createConfig({ USE_DEFAULT_OPERATOR: 'on' });
    expect(hasViolations(source, withRule)).toBe(true);

    // With USE_DEFAULT_OPERATOR off
    const withoutRule = createConfig({ USE_DEFAULT_OPERATOR: 'off' });
    expect(hasViolations(source, withoutRule)).toBe(false);
  });

  it('accepts all conditional forms (CONDITION_TYPE disabled)', () => {
    const config = createConfig({ USE_DEFAULT_OPERATOR: 'off' });
    const source = '($x > 0 && $y < 10) || $z == 5 ? "yes" ! "no"';
    expect(hasViolations(source, config)).toBe(false);
  });
});
