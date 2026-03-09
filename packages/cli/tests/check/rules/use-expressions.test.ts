/**
 * UseExpr Validation Rules Tests
 * Verify USE_DYNAMIC_IDENTIFIER (AC-14) and USE_UNTYPED_HOST_REF (AC-15).
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@rcrsr/rill';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

function createConfig(
  checkerMode: 'strict' | 'permissive',
  rules: Record<string, 'on' | 'off' | 'warn'> = {}
): CheckConfig {
  return {
    rules: {
      USE_DYNAMIC_IDENTIFIER: 'on',
      USE_UNTYPED_HOST_REF: 'on',
      ...rules,
    },
    severity: {},
    checkerMode,
  };
}

function getDiagnostics(
  source: string,
  config: CheckConfig
): { code: string; severity: string; message: string }[] {
  const ast = parse(source);
  return validateScript(ast, source, config).map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
  }));
}

// ============================================================
// USE_DYNAMIC_IDENTIFIER TESTS (AC-14)
// ============================================================

describe('USE_DYNAMIC_IDENTIFIER (AC-14)', () => {
  describe('variable form use<$name>', () => {
    it('AC-14: produces error in strict mode', () => {
      const source = '"host:fn" => $id\nuse<$id>';
      const diagnostics = getDiagnostics(source, createConfig('strict'));
      const rule = diagnostics.find((d) => d.code === 'USE_DYNAMIC_IDENTIFIER');
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe('error');
    });

    it('AC-14: produces warning in permissive mode', () => {
      const source = '"host:fn" => $id\nuse<$id>';
      const diagnostics = getDiagnostics(source, createConfig('permissive'));
      const rule = diagnostics.find((d) => d.code === 'USE_DYNAMIC_IDENTIFIER');
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe('warning');
    });

    it('message includes the variable form label', () => {
      const source = '"host:fn" => $id\nuse<$id>';
      const diagnostics = getDiagnostics(source, createConfig('strict'));
      const rule = diagnostics.find((d) => d.code === 'USE_DYNAMIC_IDENTIFIER');
      expect(rule?.message).toContain('use<$id>');
    });
  });

  describe('computed form use<(expr)>', () => {
    it('AC-14: produces error in strict mode', () => {
      const source = 'use<("host:fn")>';
      const diagnostics = getDiagnostics(source, createConfig('strict'));
      const rule = diagnostics.find((d) => d.code === 'USE_DYNAMIC_IDENTIFIER');
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe('error');
    });

    it('AC-14: produces warning in permissive mode', () => {
      const source = 'use<("host:fn")>';
      const diagnostics = getDiagnostics(source, createConfig('permissive'));
      const rule = diagnostics.find((d) => d.code === 'USE_DYNAMIC_IDENTIFIER');
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe('warning');
    });

    it('message includes the computed form label', () => {
      const source = 'use<("host:fn")>';
      const diagnostics = getDiagnostics(source, createConfig('strict'));
      const rule = diagnostics.find((d) => d.code === 'USE_DYNAMIC_IDENTIFIER');
      expect(rule?.message).toContain('use<(expr)>');
    });
  });

  describe('static form — no diagnostic', () => {
    it('does not flag static use<scheme:resource>', () => {
      const source = 'use<host:fn>';
      // Only check USE_DYNAMIC_IDENTIFIER — USE_UNTYPED_HOST_REF may fire
      const ast = parse(source);
      const diagnostics = validateScript(
        ast,
        source,
        createConfig('strict', { USE_UNTYPED_HOST_REF: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_DYNAMIC_IDENTIFIER');
      expect(rule).toBeUndefined();
    });
  });

  describe('rule disabled — no diagnostic', () => {
    it('produces no diagnostic when rule is off', () => {
      const source = '"host:fn" => $id\nuse<$id>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_DYNAMIC_IDENTIFIER');
      expect(rule).toBeUndefined();
    });
  });
});

// ============================================================
// USE_UNTYPED_HOST_REF TESTS (AC-15)
// ============================================================

describe('USE_UNTYPED_HOST_REF (AC-15)', () => {
  describe('static use<host:fn> without :type', () => {
    it('AC-15: produces error in strict mode', () => {
      const source = 'use<host:app.fetch>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe('error');
    });

    it('AC-15: produces warning in permissive mode', () => {
      const source = 'use<host:app.fetch>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('permissive', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe('warning');
    });

    it('message includes the resource identifier', () => {
      const source = 'use<host:app.fetch>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule?.message).toContain('host:app.fetch');
    });
  });

  describe('static use<host:fn> with :type annotation — no diagnostic', () => {
    it('does not flag use<host:fn>:string', () => {
      // use<host:fn>:string — annotated, no warning
      const source = 'use<host:fn>:string';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule).toBeUndefined();
    });
  });

  describe('non-host schemes — no diagnostic', () => {
    it('does not flag use<module:x> without :type', () => {
      const source = 'use<module:utils>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule).toBeUndefined();
    });

    it('does not flag use<ext:y> without :type', () => {
      const source = 'use<ext:someLib>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule).toBeUndefined();
    });
  });

  describe('dynamic forms — no diagnostic from this rule', () => {
    it('does not fire USE_UNTYPED_HOST_REF for variable form', () => {
      const source = '"host:fn" => $id\nuse<$id>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule).toBeUndefined();
    });

    it('does not fire USE_UNTYPED_HOST_REF for computed form', () => {
      const source = 'use<("host:fn")>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', { USE_DYNAMIC_IDENTIFIER: 'off' })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule).toBeUndefined();
    });
  });

  describe('rule disabled — no diagnostic', () => {
    it('produces no diagnostic when rule is off', () => {
      const source = 'use<host:fn>';
      const diagnostics = getDiagnostics(
        source,
        createConfig('strict', {
          USE_DYNAMIC_IDENTIFIER: 'off',
          USE_UNTYPED_HOST_REF: 'off',
        })
      );
      const rule = diagnostics.find((d) => d.code === 'USE_UNTYPED_HOST_REF');
      expect(rule).toBeUndefined();
    });
  });
});
