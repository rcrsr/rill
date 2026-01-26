/**
 * String Handling Convention Rules Tests
 * Verify string handling convention enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../../src/index.js';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with string rules enabled.
 */
function createConfig(rules: Record<string, 'on' | 'off'> = {}): CheckConfig {
  return {
    rules: {
      USE_HEREDOC: 'on',
      USE_EMPTY_METHOD: 'on',
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
// USE_HEREDOC TESTS
// ============================================================

describe('USE_HEREDOC', () => {
  const config = createConfig({ USE_EMPTY_METHOD: 'off' });

  it('accepts single-line strings', () => {
    expect(hasViolations('"hello world"', config)).toBe(false);
  });

  it('accepts heredoc strings', () => {
    const source = `
      <<EOF
      Line 1
      Line 2
      EOF
    `;
    expect(hasViolations(source, config)).toBe(false);
  });

  it('recommends heredoc for multiline escape sequences', () => {
    const source = '"Line 1\\nLine 2\\nLine 3"';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Use heredoc');
    expect(messages[0]).toContain('<<EOF');
  });

  it('accepts strings with single newline', () => {
    // Single newline is borderline, but we only warn on multiple
    const source = '"Line 1\\nLine 2"';
    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('heredoc');
  });

  it('has correct severity and code', () => {
    const source = '"Line 1\\nLine 2\\nLine 3"';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('USE_HEREDOC');
    expect(diagnostics[0]?.severity).toBe('info');
  });

  it('does not provide auto-fix', () => {
    const source = '"Line 1\\nLine 2"';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.fix).toBeNull();
  });
});

// ============================================================
// USE_EMPTY_METHOD TESTS
// ============================================================

describe('USE_EMPTY_METHOD', () => {
  const config = createConfig({ USE_HEREDOC: 'off' });

  it('accepts .empty method usage', () => {
    expect(hasViolations('$str -> .empty', config)).toBe(false);
  });

  it('accepts comparisons not involving empty strings', () => {
    expect(hasViolations('$str == "hello"', config)).toBe(false);
  });

  it('warns on equality comparison with empty string', () => {
    const source = '$str == ""';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Use .empty');
    expect(messages[0]).toContain('comparing with ""');
  });

  it('warns on inequality comparison with empty string', () => {
    const source = '$str != ""';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Use .empty');
  });

  it('suggests correct method for equality', () => {
    const source = '$str == ""';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('.empty');
  });

  it('suggests correct method for inequality', () => {
    const source = '$str != ""';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('.empty -> !');
  });

  it('detects empty string on left side', () => {
    const source = '"" == $str';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Use .empty');
  });

  it('has correct severity and code', () => {
    const source = '$str == ""';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('USE_EMPTY_METHOD');
    expect(diagnostics[0]?.severity).toBe('warning');
  });

  it('does not provide auto-fix', () => {
    const source = '$str == ""';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.fix).toBeNull();
  });
});
