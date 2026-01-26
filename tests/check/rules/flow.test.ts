/**
 * Flow and Capture Rules Tests
 * Verify flow and capture convention enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../../src/index.js';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with flow rules enabled.
 */
function createConfig(rules: Record<string, 'on' | 'off'> = {}): CheckConfig {
  return {
    rules: {
      CAPTURE_INLINE_CHAIN: 'on',
      CAPTURE_BEFORE_BRANCH: 'on',
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
// CAPTURE_INLINE_CHAIN TESTS
// ============================================================

describe('CAPTURE_INLINE_CHAIN', () => {
  const config = createConfig({ CAPTURE_BEFORE_BRANCH: 'off' });

  it('accepts inline capture with continuation', () => {
    expect(hasViolations('prompt("test") :> $raw -> log', config)).toBe(false);
    expect(
      hasViolations('prompt("test") :> $raw -> .contains("ERROR")', config)
    ).toBe(false);
  });

  it('accepts capture without immediate continuation', () => {
    expect(hasViolations('prompt("test") :> $raw', config)).toBe(false);
  });

  it('detects separate capture and usage on next line', () => {
    const source = `
prompt("Read file") :> $raw
$raw -> log
    `.trim();

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('inline capture');
    expect(messages[0]).toContain(':> $raw ->');
  });

  it('detects separate capture followed by method chain', () => {
    const source = `
checkStatus() :> $result
$result -> .contains("OK")
    `.trim();

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('inline capture');
  });

  it('accepts capture with different variable used next', () => {
    const source = `
prompt("test") :> $raw
$other -> log
    `.trim();

    expect(hasViolations(source, config)).toBe(false);
  });

  it('accepts capture when next statement is not a pipe chain', () => {
    const source = `
prompt("test") :> $raw
"constant"
    `.trim();

    expect(hasViolations(source, config)).toBe(false);
  });

  it('accepts capture at end of script', () => {
    const source = 'prompt("test") :> $raw';
    expect(hasViolations(source, config)).toBe(false);
  });

  it('has info severity', () => {
    const source = `
prompt("test") :> $raw
$raw -> log
    `.trim();

    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);
    expect(diagnostics[0]?.severity).toBe('info');
  });
});

// ============================================================
// CAPTURE_BEFORE_BRANCH TESTS
// ============================================================

describe('CAPTURE_BEFORE_BRANCH', () => {
  const config = createConfig({ CAPTURE_INLINE_CHAIN: 'off' });

  it('accepts simple variable in conditional input', () => {
    const source = `
checkStatus() :> $result
$result -> .contains("OK") ? { "Success" } ! { "Failed" }
    `.trim();

    expect(hasViolations(source, config)).toBe(false);
  });

  it('detects piped value used in both branches', () => {
    const source = `
checkStatus() -> .contains("OK") ? {
  $ -> log
} ! {
  $ -> log
}
    `.trim();

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('capturing value before conditional');
    expect(messages[0]).toContain('multiple branches');
  });

  it('accepts conditional with single branch', () => {
    const source = `
checkStatus() -> .contains("OK") ? { $ -> log }
    `.trim();

    expect(hasViolations(source, config)).toBe(false);
  });

  it('accepts conditional without input expression', () => {
    const source = `
true ? { "yes" } ! { "no" }
    `.trim();

    expect(hasViolations(source, config)).toBe(false);
  });

  it('accepts branches that do not reference piped value', () => {
    const source = `
checkStatus() -> .contains("OK") ? { "Success" } ! { "Failed" }
    `.trim();

    expect(hasViolations(source, config)).toBe(false);
  });

  it('detects value used in then branch only', () => {
    const source = `
checkStatus() -> .contains("OK") ? {
  $ -> log
} ! {
  "other"
}
    `.trim();

    // Should not trigger - only in one branch
    expect(hasViolations(source, config)).toBe(false);
  });

  it('has info severity', () => {
    const source = `
checkStatus() -> .contains("OK") ? {
  $ -> log
} ! {
  $ -> log
}
    `.trim();

    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);
    if (diagnostics.length > 0) {
      expect(diagnostics[0]?.severity).toBe('info');
    }
  });
});

// ============================================================
// COMBINED RULES TESTS
// ============================================================

describe('flow rules combined', () => {
  it('can detect both rules in same source', () => {
    const source = `
prompt("test") :> $raw
$raw -> .contains("OK") ? {
  $ -> log
} ! {
  $ -> log
}
    `.trim();

    const codes = getCodes(source);
    // May trigger CAPTURE_INLINE_CHAIN
    expect(codes.length).toBeGreaterThan(0);
  });

  it('respects rule configuration', () => {
    const source = `
prompt("test") :> $raw
$raw -> log
    `.trim();

    const disabledConfig = createConfig({
      CAPTURE_INLINE_CHAIN: 'off',
      CAPTURE_BEFORE_BRANCH: 'off',
    });

    expect(hasViolations(source, disabledConfig)).toBe(false);
  });
});
