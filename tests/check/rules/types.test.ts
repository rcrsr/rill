/**
 * Type Safety Convention Rules Tests
 * Verify type safety convention enforcement.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../../src/index.js';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig, Fix } from '../../../src/check/types.js';

/**
 * Apply a single fix to source code.
 */
function applyFix(source: string, fix: Fix): string {
  const before = source.slice(0, fix.range.start.offset);
  const after = source.slice(fix.range.end.offset);
  return before + fix.replacement + after;
}

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with type rules enabled.
 */
function createConfig(rules: Record<string, 'on' | 'off'> = {}): CheckConfig {
  return {
    rules: {
      UNNECESSARY_ASSERTION: 'on',
      VALIDATE_EXTERNAL: 'on',
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
// UNNECESSARY_ASSERTION TESTS
// ============================================================

describe('UNNECESSARY_ASSERTION', () => {
  const config = createConfig({ VALIDATE_EXTERNAL: 'off' });

  it('accepts assertions on variables', () => {
    expect(hasViolations('$val:number', config)).toBe(false);
  });

  it('accepts assertions on function results', () => {
    expect(hasViolations('getData():dict', config)).toBe(false);
  });

  it('accepts bare type assertions', () => {
    expect(hasViolations('$ -> :string', config)).toBe(false);
  });

  it('detects unnecessary number assertion', () => {
    const source = '5:number :> $n';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('unnecessary');
    expect(messages[0]).toContain('number literal');
  });

  it('detects unnecessary string assertion', () => {
    const source = '"hello":string :> $s';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('unnecessary');
    expect(messages[0]).toContain('string literal');
  });

  it('detects unnecessary bool assertion', () => {
    const source = 'true:bool :> $b';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('unnecessary');
    expect(messages[0]).toContain('bool literal');
  });

  it('has correct severity and code', () => {
    const source = '42:number';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('UNNECESSARY_ASSERTION');
    expect(diagnostics[0]?.severity).toBe('info');
  });

  it('provides fix to remove assertion', () => {
    const source = '5:number :> $n';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    const diagnostic = diagnostics[0];
    expect(diagnostic?.fix).toBeDefined();
    expect(diagnostic?.fix?.applicable).toBe(true);
    expect(diagnostic?.fix?.description).toContain('Remove unnecessary');
  });

  it('fix removes assertion correctly', () => {
    const source = '5:number :> $n';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    const diagnostic = diagnostics[0];
    if (diagnostic?.fix) {
      const fixed = applyFix(source, diagnostic.fix);
      expect(fixed).toBe('5 :> $n');
    }
  });

  it('fix handles string assertions', () => {
    const source = '"test":string :> $s';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    const diagnostic = diagnostics[0];
    if (diagnostic?.fix) {
      const fixed = applyFix(source, diagnostic.fix);
      expect(fixed).toBe('"test" :> $s');
    }
  });
});

// ============================================================
// VALIDATE_EXTERNAL TESTS
// ============================================================

describe('VALIDATE_EXTERNAL', () => {
  const config = createConfig({ UNNECESSARY_ASSERTION: 'off' });

  it('recommends validation for parse functions', () => {
    const source = 'parse_json($input)';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Consider validating external input');
    expect(messages[0]).toContain('parse_json');
  });

  it('recommends validation for fetch functions', () => {
    const source = 'fetch_data($url)';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('external input');
  });

  it('recommends validation for read functions', () => {
    const source = 'read_file($path)';

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('external input');
  });

  it('does not warn on non-external functions', () => {
    expect(hasViolations('compute($x)', config)).toBe(false);
  });

  it('has correct severity and code', () => {
    const source = 'parse_json($input)';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('VALIDATE_EXTERNAL');
    expect(diagnostics[0]?.severity).toBe('info');
  });

  it('does not provide auto-fix', () => {
    const source = 'parse_json($input)';
    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.fix).toBeNull();
  });

  it('does not warn when already type-asserted (simple case)', () => {
    const source = 'parse_json($input):dict';

    const violations = hasViolations(source, config);
    expect(violations).toBe(false);
  });

  it('does not warn when already type-asserted (with property access)', () => {
    const source = 'ccr::read_frontmatter($path, [status: ""]):dict.status';

    const violations = hasViolations(source, config);
    expect(violations).toBe(false);
  });

  it('does not warn when already type-asserted (namespaced function)', () => {
    const source = 'io::read_file($path):string';

    const violations = hasViolations(source, config);
    expect(violations).toBe(false);
  });

  it('warns when not type-asserted (namespaced function)', () => {
    const source = 'ccr::read_frontmatter($path)';

    const violations = hasViolations(source, config);
    expect(violations).toBe(true);
  });

  it('does not warn when parse_ function is type-asserted', () => {
    const source = 'parse_auto($text):dict';

    const violations = hasViolations(source, config);
    expect(violations).toBe(false);
  });

  it('warns when parse_ function is not type-asserted', () => {
    const source = 'parse_auto($text)';

    const violations = hasViolations(source, config);
    expect(violations).toBe(true);
  });
});
