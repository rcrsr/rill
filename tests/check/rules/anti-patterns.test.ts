/**
 * Anti-Pattern Rules Tests
 * Verify anti-pattern detection enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../../src/index.js';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with anti-pattern rules enabled.
 */
function createConfig(rules: Record<string, 'on' | 'off'> = {}): CheckConfig {
  return {
    rules: {
      AVOID_REASSIGNMENT: 'on',
      COMPLEX_CONDITION: 'on',
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
// AVOID_REASSIGNMENT TESTS
// ============================================================

describe('AVOID_REASSIGNMENT', () => {
  const config = createConfig({
    COMPLEX_CONDITION: 'off',
  });

  it('accepts first variable assignment', () => {
    expect(hasViolations('"initial" :> $x', config)).toBe(false);
  });

  it('accepts multiple different variables', () => {
    const source = `
      "first" :> $x
      "second" :> $y
      "third" :> $z
    `;
    expect(hasViolations(source, config)).toBe(false);
  });

  it('warns on variable reassignment', () => {
    const source = `
      "initial" :> $x
      "updated" :> $x
    `;

    expect(hasViolations(source, config)).toBe(true);
    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('reassignment');
  });

  it('includes line number of first definition', () => {
    const source = `
      "initial" :> $x
      "updated" :> $x
    `;

    const messages = getDiagnostics(source, config);
    expect(messages[0]).toContain('line');
  });

  it('suggests alternatives in message', () => {
    const source = `
      "first" :> $x
      "second" :> $x
    `;

    const messages = getDiagnostics(source, config);
    expect(messages[0]).toMatch(/new variable|functional/i);
  });

  it('has correct severity and code', () => {
    const source = `
      "a" :> $x
      "b" :> $x
    `;

    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('AVOID_REASSIGNMENT');
    expect(diagnostics[0]?.severity).toBe('warning');
  });

  it('detects multiple reassignments', () => {
    const source = `
      "first" :> $x
      "second" :> $x
      "third" :> $x
    `;

    const diagnostics = getDiagnostics(source, config);
    expect(diagnostics.length).toBe(2); // Two reassignments (second and third)
  });
});

// ============================================================
// COMPLEX_CONDITION TESTS
// ============================================================

describe('COMPLEX_CONDITION', () => {
  const config = createConfig({
    AVOID_REASSIGNMENT: 'off',
  });

  it('accepts simple conditions', () => {
    expect(hasViolations('($x > 5) ? "big"', config)).toBe(false);
  });

  it('accepts conditions with one operator', () => {
    expect(hasViolations('(($x > 5) && ($y < 10)) ? "valid"', config)).toBe(
      false
    );
  });

  it('accepts conditions with two operators', () => {
    expect(
      hasViolations('(($x > 5) && ($y < 10) && ($z == 0)) ? "ok"', config)
    ).toBe(false);
  });

  it('warns on conditions with 3+ boolean operators', () => {
    const source =
      '(($x > 5) && (($y < 10) || ($z == 0)) && ($a != 1)) ? "complex"';

    expect(hasViolations(source, config)).toBe(true);
    const messages = getDiagnostics(source, config);
    expect(messages[0]).toContain('Complex condition');
  });

  it('warns on deeply nested conditions', () => {
    const source =
      '((($x > 5) && ($y < 10)) || (($z == 0) && ($a != 1))) ? "nested"';

    expect(hasViolations(source, config)).toBe(true);
  });

  it('suggests extracting to named checks', () => {
    const source =
      '(($x > 5) && ($y < 10) && ($z == 0) && ($a != 1)) ? "extract"';

    const messages = getDiagnostics(source, config);
    expect(messages[0]).toMatch(/extract|named/i);
  });

  it('has correct severity and code', () => {
    const source = '(($x > 5) && ($y < 10) && ($z == 0) && ($a != 1)) ? "test"';

    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('COMPLEX_CONDITION');
    expect(diagnostics[0]?.severity).toBe('info');
  });

  it('checks nesting depth independent of operator count', () => {
    // High nesting but few operators
    const source = '(((($x > 5))) || ((($y < 10)))) ? "deep"';

    expect(hasViolations(source, config)).toBe(true);
  });

  it('does not flag non-boolean operators', () => {
    const source = '((($x + 5) * ($y - 10)) > 0) ? "arithmetic"';

    expect(hasViolations(source, config)).toBe(false);
  });
});
