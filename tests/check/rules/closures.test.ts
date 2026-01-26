/**
 * Closure Convention Rules Tests
 * Verify closure convention enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../../src/index.js';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with closure rules enabled.
 */
function createConfig(rules: Record<string, 'on' | 'off'> = {}): CheckConfig {
  return {
    rules: {
      CLOSURE_BARE_DOLLAR: 'on',
      CLOSURE_BRACES: 'on',
      CLOSURE_LATE_BINDING: 'on',
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
// CLOSURE_BARE_DOLLAR TESTS
// ============================================================

describe('CLOSURE_BARE_DOLLAR', () => {
  const config = createConfig({
    CLOSURE_BRACES: 'off',
    CLOSURE_LATE_BINDING: 'off',
  });

  it('accepts closures with parameters', () => {
    expect(hasViolations('|x|($x * 2) :> $fn', config)).toBe(false);
  });

  it('accepts closures without $ reference', () => {
    expect(hasViolations('||{ 42 } :> $fn', config)).toBe(false);
  });

  it('accepts inline blocks with bare $', () => {
    // Inline blocks are not Closure nodes, they're immediate evaluation
    expect(hasViolations('5 -> { $ * 2 }', config)).toBe(false);
  });

  it('warns on bare $ in zero-param stored closure', () => {
    const source = '||{ $ * 2 } :> $fn';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Bare $ in stored closure');
    expect(messages[0]).toContain('ambiguous binding');
  });

  it('suggests explicit capture', () => {
    const source = '||{ $ + 5 } :> $fn';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('$ :> $item');
  });

  it('has correct severity and code', () => {
    const source = '||{ $ } :> $fn';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('CLOSURE_BARE_DOLLAR');
    expect(diagnostics[0]?.severity).toBe('warning');
  });
});

// ============================================================
// CLOSURE_BRACES TESTS
// ============================================================

describe('CLOSURE_BRACES', () => {
  const config = createConfig({
    CLOSURE_BARE_DOLLAR: 'off',
    CLOSURE_LATE_BINDING: 'off',
  });

  it('accepts simple closure with parentheses', () => {
    expect(hasViolations('|x|($x * 2) :> $fn', config)).toBe(false);
  });

  it('accepts complex closure with braces', () => {
    const source = `
      |n| {
        ($n < 1) ? 1 ! ($n * 2)
      } :> $fn
    `;
    expect(hasViolations(source, config)).toBe(false);
  });

  it('recommends braces for conditional in closure body', () => {
    const source = '|n|(($n < 1) ? 1 ! ($n * 2)) :> $fn';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('braces for complex closure bodies');
  });

  it('has correct severity and code', () => {
    const source = '|x|(($x > 0) ? "pos" ! "neg") :> $fn';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('CLOSURE_BRACES');
    expect(diagnostics[0]?.severity).toBe('info');
  });
});

// ============================================================
// CLOSURE_LATE_BINDING TESTS
// ============================================================

describe('CLOSURE_LATE_BINDING', () => {
  const config = createConfig({
    CLOSURE_BARE_DOLLAR: 'off',
    CLOSURE_BRACES: 'off',
  });

  it('accepts each loops without closure creation', () => {
    expect(hasViolations('[1, 2, 3] -> each { $ * 2 }', config)).toBe(false);
  });

  it('accepts closures with explicit capture', () => {
    const source = `
      [1, 2, 3] -> each {
        $ :> $item
        ||{ $item }
      }
    `;
    expect(hasViolations(source, config)).toBe(false);
  });

  it('warns on closure creation without explicit capture', () => {
    const source = '[1, 2, 3] -> each { ||{ $ } }';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Capture loop variable explicitly');
    expect(messages[0]).toContain('$ :> $item');
  });

  it('has correct severity and code', () => {
    const source = '[1, 2, 3] -> each { ||{ $ } }';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('CLOSURE_LATE_BINDING');
    expect(diagnostics[0]?.severity).toBe('warning');
  });
});
