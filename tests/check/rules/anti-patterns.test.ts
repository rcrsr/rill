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
      LOOP_OUTER_CAPTURE: 'on',
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
    expect(hasViolations('"initial" => $x', config)).toBe(false);
  });

  it('accepts multiple different variables', () => {
    const source = `
      "first" => $x
      "second" => $y
      "third" => $z
    `;
    expect(hasViolations(source, config)).toBe(false);
  });

  it('warns on variable reassignment', () => {
    const source = `
      "initial" => $x
      "updated" => $x
    `;

    expect(hasViolations(source, config)).toBe(true);
    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('reassignment');
  });

  it('includes line number of first definition', () => {
    const source = `
      "initial" => $x
      "updated" => $x
    `;

    const messages = getDiagnostics(source, config);
    expect(messages[0]).toContain('line');
  });

  it('suggests alternatives in message', () => {
    const source = `
      "first" => $x
      "second" => $x
    `;

    const messages = getDiagnostics(source, config);
    expect(messages[0]).toMatch(/new variable|functional/i);
  });

  it('has correct severity and code', () => {
    const source = `
      "a" => $x
      "b" => $x
    `;

    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe('AVOID_REASSIGNMENT');
    expect(diagnostics[0]?.severity).toBe('warning');
  });

  it('detects multiple reassignments', () => {
    const source = `
      "first" => $x
      "second" => $x
      "third" => $x
    `;

    const diagnostics = getDiagnostics(source, config);
    expect(diagnostics.length).toBe(2); // Two reassignments (second and third)
  });

  it('does not warn for variables in sibling closures', () => {
    // Variables captured in different sibling closures are independent
    // and should not be considered reassignments
    const source = `
      |skill_name| {
        "output" => $result
        $result
      } => $run_skill

      |doc_path| {
        "output" => $result
        $result
      } => $review_loop
    `;

    expect(hasViolations(source, config)).toBe(false);
  });

  it('does warn for variables in same closure', () => {
    // Variables reassigned within the same closure should trigger warning
    const source = `
      |param| {
        "first" => $result
        "second" => $result
        $result
      } => $fn
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('AVOID_REASSIGNMENT');
  });

  it('does warn for variables in parent scope', () => {
    // Variables defined in outer scope and reassigned in nested closure
    // should trigger warning
    const source = `
      "outer" => $result

      |param| {
        "inner" => $result
        $result
      } => $fn
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('AVOID_REASSIGNMENT');
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

// ============================================================
// LOOP_OUTER_CAPTURE TESTS
// ============================================================

describe('LOOP_OUTER_CAPTURE', () => {
  const config = createConfig({
    AVOID_REASSIGNMENT: 'off',
    COMPLEX_CONDITION: 'off',
  });

  it('accepts captures of new variables in loop body', () => {
    // This is fine - $temp is new, not modifying outer scope
    const source = `
      [1, 2, 3] -> each {
        $ * 2 => $temp
        $temp
      }
    `;
    expect(hasViolations(source, config)).toBe(false);
  });

  it('accepts loops without captures', () => {
    const source = '[1, 2, 3] -> each { $ * 2 }';
    expect(hasViolations(source, config)).toBe(false);
  });

  it('accepts fold with accumulator pattern', () => {
    const source = '[1, 2, 3] -> fold(0) { $@ + $ }';
    expect(hasViolations(source, config)).toBe(false);
  });

  it('warns when each body captures outer variable', () => {
    const source = `
      0 => $count
      [1, 2, 3] -> each { $count + 1 => $count }
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('LOOP_OUTER_CAPTURE');
  });

  it('warns when map body captures outer variable', () => {
    const source = `
      "" => $result
      [1, 2, 3] -> map { $result + $ => $result }
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('LOOP_OUTER_CAPTURE');
  });

  it('warns when while loop body captures outer variable', () => {
    const source = `
      0 => $i
      0 -> ($ < 3) @ {
        $i + 1 => $i
        $ + 1
      }
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('LOOP_OUTER_CAPTURE');
  });

  it('warns when filter body captures outer variable', () => {
    const source = `
      0 => $count
      [1, 2, 3] -> filter {
        $count + 1 => $count
        ($ > 1)
      }
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('LOOP_OUTER_CAPTURE');
  });

  it('provides helpful message with line reference', () => {
    const source = `
      0 => $sum
      [1, 2, 3] -> each { $sum + $ => $sum }
    `;

    const messages = getDiagnostics(source, config);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('Cannot modify outer variable');
    expect(messages[0]).toContain('$sum');
    expect(messages[0]).toContain('fold');
    expect(messages[0]).toContain('line');
  });

  it('has warning severity', () => {
    const source = `
      0 => $x
      [1, 2, 3] -> each { $x + 1 => $x }
    `;

    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);
    const loopCapture = diagnostics.find(
      (d) => d.code === 'LOOP_OUTER_CAPTURE'
    );

    expect(loopCapture).toBeDefined();
    expect(loopCapture?.severity).toBe('warning');
  });

  it('detects multiple outer captures in same loop', () => {
    const source = `
      0 => $a
      0 => $b
      [1, 2, 3] -> each {
        $a + 1 => $a
        $b + 1 => $b
      }
    `;

    const ast = parse(source);
    const diagnostics = validateScript(ast, source, config);
    const loopCaptures = diagnostics.filter(
      (d) => d.code === 'LOOP_OUTER_CAPTURE'
    );

    expect(loopCaptures.length).toBe(2);
  });

  it('warns when do-while loop body captures outer variable', () => {
    const source = `
      0 => $count
      0 -> @ {
        $count + 1 => $count
        $ + 1
      } ? ($ < 3)
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('LOOP_OUTER_CAPTURE');
  });

  it('accepts closures that capture outer variables (different scope)', () => {
    // Closures have their own scope, so captures inside them shouldn't trigger
    const source = `
      10 => $multiplier
      [1, 2, 3] -> map {
        |x| ($x * $multiplier) => $fn
        $fn($)
      }
    `;

    expect(hasViolations(source, config)).toBe(false);
  });

  it('warns when fold body captures outer variable (distinct from accumulator)', () => {
    const source = `
      0 => $extraSum
      [1, 2, 3] -> fold(0) {
        $extraSum + 1 => $extraSum
        $@ + $ + $extraSum
      }
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('LOOP_OUTER_CAPTURE');
  });

  it('does not warn for variables in sibling closures', () => {
    // Variables captured in different sibling closures should not be
    // considered "outer" to each other
    const source = `
      |skill_name| {
        "output" => $result
        $result
      } => $run_skill

      |doc_path| {
        ^(limit: 5) 0 -> ($ < 3) @ {
          "output" => $result
          $ + 1
        }
      } => $review_loop
    `;

    expect(hasViolations(source, config)).toBe(false);
  });

  it('does warn for variables in parent closure captured in nested loop', () => {
    // Variable in parent closure should trigger warning when captured in nested loop
    const source = `
      |outer_param| {
        0 => $count
        [1, 2, 3] -> each {
          $count + 1 => $count
        }
      } => $fn
    `;

    expect(hasViolations(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('LOOP_OUTER_CAPTURE');
  });
});
