/**
 * Collection Operator Rules Tests
 * Verify conventions for each, map, fold, and filter operators.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../../src/index.js';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with specific rule enabled.
 */
function createConfig(ruleCode: string): CheckConfig {
  return {
    rules: { [ruleCode]: 'on' },
    severity: {},
  };
}

/**
 * Validate source and extract diagnostic messages.
 */
function getDiagnostics(source: string, ruleCode: string): string[] {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, createConfig(ruleCode));
  return diagnostics.map((d) => d.message);
}

/**
 * Validate source and check for violations.
 */
function hasViolations(source: string, ruleCode: string): boolean {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, createConfig(ruleCode));
  return diagnostics.length > 0;
}

/**
 * Validate source and get severity levels.
 */
function getSeverities(source: string, ruleCode: string): string[] {
  const ast = parse(source);
  const diagnostics = validateScript(ast, source, createConfig(ruleCode));
  return diagnostics.map((d) => d.severity);
}

// ============================================================
// BREAK_IN_PARALLEL TESTS
// ============================================================

describe('BREAK_IN_PARALLEL', () => {
  const rule = 'BREAK_IN_PARALLEL';

  it('detects break in map', () => {
    const source = `
      [1, 2, 3] -> map {
        ($ == 2) ? break
        $ * 2
      }
    `;
    expect(hasViolations(source, rule)).toBe(true);

    const messages = getDiagnostics(source, rule);
    expect(messages[0]).toContain("Break not allowed in 'map'");
    expect(messages[0]).toContain('parallel operator');
  });

  it('detects break in filter', () => {
    const source = `
      [1, 2, 3] -> filter {
        ($ > 2) ? break
        $ > 1
      }
    `;
    expect(hasViolations(source, rule)).toBe(true);

    const messages = getDiagnostics(source, rule);
    expect(messages[0]).toContain("Break not allowed in 'filter'");
  });

  it('detects break in nested conditional within map', () => {
    const source = `
      [1, 2, 3] -> map {
        ($ == 2) ? {
          break
        } ! {
          $ * 2
        }
      }
    `;
    expect(hasViolations(source, rule)).toBe(true);
  });

  it('detects break in pipe chain terminator within map', () => {
    const source = `
      [1, 2, 3] -> map {
        $ -> break
      }
    `;
    expect(hasViolations(source, rule)).toBe(true);
  });

  it('allows map without break', () => {
    const source = `
      [1, 2, 3] -> map { $ * 2 }
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('allows filter without break', () => {
    const source = `
      [1, 2, 3] -> filter { $ > 1 }
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('returns error severity', () => {
    const source = `
      [1, 2, 3] -> map {
        ($ == 2) ? break
        $ * 2
      }
    `;
    const severities = getSeverities(source, rule);
    expect(severities[0]).toBe('error');
  });
});

// ============================================================
// PREFER_MAP TESTS
// ============================================================

describe('PREFER_MAP', () => {
  const rule = 'PREFER_MAP';

  it('suggests map for each without accumulator', () => {
    const source = `
      [1, 2, 3] -> each { $ * 2 }
    `;
    expect(hasViolations(source, rule)).toBe(true);

    const messages = getDiagnostics(source, rule);
    expect(messages[0]).toContain("Consider using 'map'");
    expect(messages[0]).toContain('pure transformations');
  });

  it('allows each with accumulator initialization', () => {
    const source = `
      [1, 2, 3] -> each(0) { $@ + $ }
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('allows each with closure having accumulator parameter', () => {
    const source = `
      [1, 2, 3] -> each |x, acc = 0| ($acc + $x)
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('returns info severity', () => {
    const source = `
      [1, 2, 3] -> each { $ * 2 }
    `;
    const severities = getSeverities(source, rule);
    expect(severities[0]).toBe('info');
  });
});

// ============================================================
// FOLD_INTERMEDIATES TESTS
// ============================================================

describe('FOLD_INTERMEDIATES', () => {
  const rule = 'FOLD_INTERMEDIATES';

  it('is a placeholder rule (no violations yet)', () => {
    const source = `
      [1, 2, 3] -> fold(0) { $@ + $ }
    `;
    // Placeholder - no implementation yet
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('does not flag each with accumulator', () => {
    const source = `
      [1, 2, 3] -> each(0) { $@ + $ }
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });
});

// ============================================================
// FILTER_NEGATION TESTS
// ============================================================

describe('FILTER_NEGATION', () => {
  const rule = 'FILTER_NEGATION';

  it('warns about filter with .empty method (likely unintended)', () => {
    const source = `
      ["", "a", "b"] -> filter .empty
    `;
    expect(hasViolations(source, rule)).toBe(true);

    const messages = getDiagnostics(source, rule);
    expect(messages[0]).toContain("Filter with '.empty' likely unintended");
    expect(messages[0]).toContain('filter (!.empty)');
  });

  it('allows filter with other methods', () => {
    const source = `
      ["a", "b", "c"] -> filter .upper
    `;
    // Only .empty triggers warning for now
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('allows filter with grouped negation', () => {
    const source = `
      ["", "a", "b"] -> filter (!.empty)
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('allows filter with block containing complex logic', () => {
    const source = `
      ["", "a", "b"] -> filter { !$.empty }
    `;
    // Block form doesn't trigger shorthand warning
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('returns warning severity', () => {
    const source = `
      ["", "a", "b"] -> filter .empty
    `;
    const severities = getSeverities(source, rule);
    expect(severities[0]).toBe('warning');
  });
});

// ============================================================
// METHOD_SHORTHAND TESTS
// ============================================================

describe('METHOD_SHORTHAND', () => {
  const rule = 'METHOD_SHORTHAND';

  it('suggests shorthand for map with block wrapping method', () => {
    const source = `
      ["hello", "world"] -> map { $.upper() }
    `;
    expect(hasViolations(source, rule)).toBe(true);

    const messages = getDiagnostics(source, rule);
    expect(messages[0]).toContain("Prefer method shorthand '.upper'");
    expect(messages[0]).toContain('{ $.upper() }');
  });

  it('suggests shorthand for each with block wrapping method', () => {
    const source = `
      [1, 2, 3] -> each { $.str() }
    `;
    expect(hasViolations(source, rule)).toBe(true);

    const messages = getDiagnostics(source, rule);
    expect(messages[0]).toContain("Prefer method shorthand '.str'");
  });

  it('suggests shorthand for filter with block wrapping method', () => {
    const source = `
      ["", "a", "b"] -> filter { $.empty() }
    `;
    expect(hasViolations(source, rule)).toBe(true);
  });

  it('suggests shorthand for fold with block wrapping method', () => {
    const source = `
      ["a", "b"] -> fold("") { $.upper() }
    `;
    // Note: This detects the pattern even though fold typically needs
    // accumulator logic. This is a valid detection - if user writes
    // { $.upper() }, the suggestion to use .upper shorthand is correct.
    expect(hasViolations(source, rule)).toBe(true);
  });

  it('allows direct method shorthand', () => {
    const source = `
      ["hello", "world"] -> map .upper
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('allows blocks with complex logic', () => {
    const source = `
      [1, 2, 3] -> map {
        ($ > 2) ? "big" ! "small"
      }
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('allows blocks with multiple statements', () => {
    const source = `
      [1, 2, 3] -> map {
        $ * 2 :> $doubled
        $doubled + 1
      }
    `;
    expect(hasViolations(source, rule)).toBe(false);
  });

  it('returns info severity', () => {
    const source = `
      ["hello"] -> map { $.upper() }
    `;
    const severities = getSeverities(source, rule);
    expect(severities[0]).toBe('info');
  });
});

// ============================================================
// INTEGRATION TESTS
// ============================================================

describe('Collection Rules Integration', () => {
  it('detects multiple violations in same script', () => {
    const source = `
      [1, 2, 3] -> each { $ * 2 }
      [1, 2, 3] -> map {
        ($ == 2) ? break
        $ * 2
      }
    `;

    const ast = parse(source);
    const config: CheckConfig = {
      rules: {
        PREFER_MAP: 'on',
        BREAK_IN_PARALLEL: 'on',
      },
      severity: {},
    };

    const diagnostics = validateScript(ast, source, config);
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);

    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain('PREFER_MAP');
    expect(codes).toContain('BREAK_IN_PARALLEL');
  });

  it('respects rule configuration', () => {
    const source = `
      [1, 2, 3] -> each { $ * 2 }
    `;

    // Rule off
    const configOff: CheckConfig = {
      rules: { PREFER_MAP: 'off' },
      severity: {},
    };
    const diagnosticsOff = validateScript(parse(source), source, configOff);
    expect(diagnosticsOff.length).toBe(0);

    // Rule on
    const configOn: CheckConfig = {
      rules: { PREFER_MAP: 'on' },
      severity: {},
    };
    const diagnosticsOn = validateScript(parse(source), source, configOn);
    expect(diagnosticsOn.length).toBeGreaterThan(0);
  });
});
