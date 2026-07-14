import { describe, expect, it } from 'vitest';
import { parse, parseWithRecovery } from '@rcrsr/rill';
import type { ASTNode, ParseResult } from '@rcrsr/rill';
import { runRules, compareDiagnosticLocation } from './run-rules.js';
import type { CheckConfig, Diagnostic, Rule, RuleContext } from './types.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

function makeDiagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: 'FAKE_RULE',
    message: 'fake diagnostic',
    severity: 'error',
    location: { line: 1, column: 1, offset: 0 },
    context: '',
    fix: null,
    ...overrides,
  };
}

/** A test-only Rule that fires once per matching node with a fixed diagnostic. */
function makeFakeRule(
  code: string,
  nodeTypes: readonly ASTNode['type'][],
  diagnostic: Diagnostic
): Rule {
  return {
    code,
    nodeTypes,
    defaultSeverity: diagnostic.severity,
    validate(_node: ASTNode, _context: RuleContext): Diagnostic[] {
      return [diagnostic];
    },
  };
}

describe('runRules', () => {
  describe('with no registered rules (Phase 3 task 3.2 state)', () => {
    it('returns an empty diagnostics array', () => {
      const parsed = toParseResult('1 => $a\n2 => $b\n');

      const result = runRules(parsed, '1 => $a\n2 => $b\n', makeConfig());

      expect(result).toEqual([]);
    });
  });

  describe('dispatch mechanics', () => {
    it('invokes a rule whose nodeTypes matches the visited node', () => {
      const source = '1 => $a\n';
      const parsed = toParseResult(source);
      const diagnostic = makeDiagnostic({ code: 'FAKE_CAPTURE' });
      const rule = makeFakeRule('FAKE_CAPTURE', ['Capture'], diagnostic);

      const result = runRules(parsed, source, makeConfig(), [rule]);

      expect(result).toHaveLength(1);
      expect(result[0]?.code).toBe('FAKE_CAPTURE');
    });

    it('does not invoke a rule whose nodeTypes does not match any node', () => {
      const source = '1 => $a\n';
      const parsed = toParseResult(source);
      const diagnostic = makeDiagnostic({ code: 'FAKE_UNMATCHED' });
      const rule = makeFakeRule('FAKE_UNMATCHED', ['WhileLoop'], diagnostic);

      const result = runRules(parsed, source, makeConfig(), [rule]);

      expect(result).toEqual([]);
    });
  });

  describe('malformed AST regions do not abort traversal', () => {
    it('does not throw on a RecoveryErrorNode input and returns survivable findings', () => {
      const source = '1 => $a\n$ ->\n2 => $b\n';
      const parsed = parseWithRecovery(source);

      let result: Diagnostic[] = [];
      expect(() => {
        result = runRules(parsed, source, makeConfig());
      }).not.toThrow();

      expect(result).toEqual([]);
    });

    it('does not throw on a PartialExpressionNode input and returns survivable findings', () => {
      const source = 'error(1 + 2))\n"after"';
      const parsed = parseWithRecovery(source);

      let result: Diagnostic[] = [];
      expect(() => {
        result = runRules(parsed, source, makeConfig());
      }).not.toThrow();

      expect(result).toEqual([]);
    });
  });

  describe('rule isolation', () => {
    it('skips a throwing rule and still returns diagnostics from the other rules', () => {
      const source = '1 => $a\n2 => $b\n';
      const parsed = toParseResult(source);

      const throwingRule: Rule = {
        code: 'THROWING_RULE',
        nodeTypes: ['Capture'],
        defaultSeverity: 'error',
        validate(): Diagnostic[] {
          throw new Error('unexpected shape');
        },
      };
      const survivingDiagnostic = makeDiagnostic({ code: 'SURVIVING_RULE' });
      const survivingRule = makeFakeRule(
        'SURVIVING_RULE',
        ['Capture'],
        survivingDiagnostic
      );

      let result: Diagnostic[] = [];
      expect(() => {
        result = runRules(parsed, source, makeConfig(), [
          throwingRule,
          survivingRule,
        ]);
      }).not.toThrow();

      // Two Capture nodes ($a, $b) each produce one surviving diagnostic.
      expect(result).toHaveLength(2);
      expect(result.every((d) => d.code === 'SURVIVING_RULE')).toBe(true);
    });
  });

  describe('severity resolution', () => {
    it('keeps the emitted severity when the rule state is "on"', () => {
      const source = '1 => $a\n';
      const parsed = toParseResult(source);
      const diagnostic = makeDiagnostic({
        code: 'FAKE_ON',
        severity: 'error',
      });
      const rule = makeFakeRule('FAKE_ON', ['Capture'], diagnostic);
      const config = makeConfig({ rules: { FAKE_ON: 'on' } });

      const result = runRules(parsed, source, config, [rule]);

      expect(result[0]?.severity).toBe('error');
    });

    it('skips a rule whose state is "off"', () => {
      const source = '1 => $a\n';
      const parsed = toParseResult(source);
      const diagnostic = makeDiagnostic({ code: 'FAKE_OFF' });
      const rule = makeFakeRule('FAKE_OFF', ['Capture'], diagnostic);
      const config = makeConfig({ rules: { FAKE_OFF: 'off' } });

      const result = runRules(parsed, source, config, [rule]);

      expect(result).toEqual([]);
    });

    it('remaps the emitted severity to "warning" when the rule state is "warn"', () => {
      const source = '1 => $a\n';
      const parsed = toParseResult(source);
      const diagnostic = makeDiagnostic({
        code: 'FAKE_WARN',
        severity: 'error',
      });
      const rule = makeFakeRule('FAKE_WARN', ['Capture'], diagnostic);
      const config = makeConfig({ rules: { FAKE_WARN: 'warn' } });

      const result = runRules(parsed, source, config, [rule]);

      expect(result[0]?.severity).toBe('warning');
    });

    it('overrides severity on every diagnostic when config.severity is set', () => {
      const source = '1 => $a\n2 => $b\n';
      const parsed = toParseResult(source);
      const diagnosticA = makeDiagnostic({
        code: 'FAKE_OVERRIDE',
        severity: 'warning',
        location: { line: 1, column: 1, offset: 0 },
      });
      const rule = makeFakeRule('FAKE_OVERRIDE', ['Capture'], diagnosticA);
      const config = makeConfig({
        rules: { FAKE_OVERRIDE: 'warn' },
        severity: 'info',
      });

      const result = runRules(parsed, source, config, [rule]);

      expect(result.every((d) => d.severity === 'info')).toBe(true);
    });
  });

  describe('diagnostic emission order', () => {
    it('sorts diagnostics by line then column via the exported comparator', () => {
      const diagnostics = [
        makeDiagnostic({ location: { line: 2, column: 5, offset: 0 } }),
        makeDiagnostic({ location: { line: 1, column: 9, offset: 0 } }),
        makeDiagnostic({ location: { line: 1, column: 1, offset: 0 } }),
      ];

      const sorted = [...diagnostics].sort(compareDiagnosticLocation);

      expect(sorted.map((d) => d.location)).toEqual([
        { line: 1, column: 1, offset: 0 },
        { line: 1, column: 9, offset: 0 },
        { line: 2, column: 5, offset: 0 },
      ]);
    });

    it('returns diagnostics sorted by line then column end-to-end', () => {
      const source = '1 => $a\n';
      const parsed = toParseResult(source);
      const ruleB = makeFakeRule(
        'FAKE_LINE_TWO',
        ['Capture'],
        makeDiagnostic({
          code: 'FAKE_LINE_TWO',
          location: { line: 2, column: 6, offset: 0 },
        })
      );
      const ruleA = makeFakeRule(
        'FAKE_LINE_ONE',
        ['Capture'],
        makeDiagnostic({
          code: 'FAKE_LINE_ONE',
          location: { line: 1, column: 6, offset: 0 },
        })
      );

      const result = runRules(parsed, source, makeConfig(), [ruleB, ruleA]);

      expect(result.map((d) => d.code)).toEqual([
        'FAKE_LINE_ONE',
        'FAKE_LINE_TWO',
      ]);
    });
  });
});
