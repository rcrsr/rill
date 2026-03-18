/**
 * Stream Anti-Pattern Rules Tests
 * Verify STREAM_PRE_ITERATION warning for stream invocation before iteration.
 *
 * Covers: IR-15 (lint warning for pre-iteration invocation)
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@rcrsr/rill';
import { validateScript } from '../../../src/check/validator.js';
import type { CheckConfig, Diagnostic } from '../../../src/check/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create a config with STREAM_PRE_ITERATION enabled, other anti-patterns off.
 */
function createConfig(rules: Record<string, 'on' | 'off'> = {}): CheckConfig {
  return {
    rules: {
      STREAM_PRE_ITERATION: 'on',
      AVOID_REASSIGNMENT: 'off',
      COMPLEX_CONDITION: 'off',
      LOOP_OUTER_CAPTURE: 'off',
      ...rules,
    },
    severity: {},
  };
}

/**
 * Validate source and return all diagnostics.
 */
function getAllDiagnostics(source: string, config?: CheckConfig): Diagnostic[] {
  const ast = parse(source);
  return validateScript(ast, source, config ?? createConfig());
}

/**
 * Validate source and extract diagnostic messages.
 */
function getDiagnostics(source: string, config?: CheckConfig): string[] {
  return getAllDiagnostics(source, config).map((d) => d.message);
}

/**
 * Validate source and get diagnostic codes.
 */
function getCodes(source: string, config?: CheckConfig): string[] {
  return getAllDiagnostics(source, config).map((d) => d.code);
}

/**
 * Check if source produces STREAM_PRE_ITERATION violations.
 */
function hasStreamWarning(source: string, config?: CheckConfig): boolean {
  return getCodes(source, config).includes('STREAM_PRE_ITERATION');
}

// ============================================================
// STREAM_PRE_ITERATION TESTS
// ============================================================

describe('STREAM_PRE_ITERATION', () => {
  const config = createConfig();

  it('warns when $s() appears before each on $s', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s()
      $s -> each { $ }
    `;

    expect(hasStreamWarning(source, config)).toBe(true);
    const codes = getCodes(source, config);
    expect(codes).toContain('STREAM_PRE_ITERATION');
  });

  it('does not warn when each on $s precedes $s()', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s -> each { $ }
      $s()
    `;

    expect(hasStreamWarning(source, config)).toBe(false);
  });

  it('does not warn when map on $s precedes $s()', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s -> map { $ * 2 }
      $s()
    `;

    expect(hasStreamWarning(source, config)).toBe(false);
  });

  it('does not warn when filter on $s precedes $s()', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s -> filter { ($ > 0) }
      $s()
    `;

    expect(hasStreamWarning(source, config)).toBe(false);
  });

  it('does not warn when fold on $s precedes $s()', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s -> fold(0) { $@ + $ }
      $s()
    `;

    expect(hasStreamWarning(source, config)).toBe(false);
  });

  it('warning message includes stream variable name', () => {
    const source = `
      |x| ($x -> yield) :stream() => $my_stream
      $my_stream()
      $my_stream -> each { $ }
    `;

    const messages = getDiagnostics(source, config);
    const streamMsg = messages.find((m) =>
      m.includes('Stream invoked before iteration')
    );
    expect(streamMsg).toBeDefined();
    expect(streamMsg).toContain('$my_stream');
  });

  it('warning message includes invocation site line number', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s()
      $s -> each { $ }
    `;

    const diagnostics = getAllDiagnostics(source, config);
    const streamDiag = diagnostics.find(
      (d) => d.code === 'STREAM_PRE_ITERATION'
    );
    expect(streamDiag).toBeDefined();
    expect(streamDiag!.message).toContain('line');
    expect(streamDiag!.location.line).toBeGreaterThan(0);
  });

  it('warning does not halt execution (other diagnostics still produced)', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s()
      $s -> each { $ }
    `;

    // Enable another rule alongside STREAM_PRE_ITERATION
    const multiConfig = createConfig({
      AVOID_REASSIGNMENT: 'on',
    });

    const diagnostics = getAllDiagnostics(source, multiConfig);
    // Stream warning should be present
    const streamDiags = diagnostics.filter(
      (d) => d.code === 'STREAM_PRE_ITERATION'
    );
    expect(streamDiags.length).toBe(1);
  });

  it('has warning severity', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s()
      $s -> each { $ }
    `;

    const diagnostics = getAllDiagnostics(source, config);
    const streamDiag = diagnostics.find(
      (d) => d.code === 'STREAM_PRE_ITERATION'
    );
    expect(streamDiag).toBeDefined();
    expect(streamDiag!.severity).toBe('warning');
  });

  it('does not warn when stream variable is only iterated', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s -> each { $ }
    `;

    expect(hasStreamWarning(source, config)).toBe(false);
  });

  it('does not warn for non-stream closures', () => {
    const source = `
      |x| ($x * 2) => $fn
      $fn(5)
    `;

    expect(hasStreamWarning(source, config)).toBe(false);
  });

  it('detects stream via :stream type annotation on capture', () => {
    const source = `
      host_fn() => $s:stream
      $s()
      $s -> each { $ }
    `;

    expect(hasStreamWarning(source, config)).toBe(true);
  });

  it('does not warn when rule is disabled', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s()
      $s -> each { $ }
    `;

    const offConfig = createConfig({ STREAM_PRE_ITERATION: 'off' });
    expect(hasStreamWarning(source, offConfig)).toBe(false);
  });

  it('uses correct diagnostic code', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s()
      $s -> each { $ }
    `;

    const codes = getCodes(source, config);
    expect(codes).toContain('STREAM_PRE_ITERATION');
  });

  it('detects stream closure with typed chunks :stream(string)', () => {
    const source = `
      |x| ($x -> yield) :stream(string) => $s
      $s()
      $s -> each { $ }
    `;

    expect(hasStreamWarning(source, config)).toBe(true);
  });

  it('message matches spec format', () => {
    const source = `
      |x| ($x -> yield) :stream() => $s
      $s()
      $s -> each { $ }
    `;

    const messages = getDiagnostics(source, config);
    const streamMsg = messages.find((m) =>
      m.includes('chunks consumed internally')
    );
    expect(streamMsg).toBeDefined();
  });
});
