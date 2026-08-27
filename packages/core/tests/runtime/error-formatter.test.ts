/**
 * Rill Runtime Tests: Error Formatter
 * Characterization coverage for formatRillError's primary-location snippet
 * rendering across the plain-`sources` branch and the cross-module
 * `sourceId`-bearing branch.
 */

import { formatRillError, RuntimeError } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

describe('Rill Runtime: formatRillError', () => {
  it('renders a source snippet for a plain-`sources` error', () => {
    const script = ['1 + 1', '"5" + 1', '3 + 3'].join('\n');
    const err = new RuntimeError(
      'RILL-R001',
      'type mismatch',
      { line: 2, column: 5 },
      undefined,
      { start: { line: 2, column: 5 }, end: { line: 2, column: 6 } }
    );

    const formatted = formatRillError(err, {
      filePath: 'script.rill',
      sources: { script },
    });

    expect(formatted).toBe(
      [
        'error[RILL-R001]: type mismatch',
        '  at script.rill:2:5',
        '  2 | "5" + 1',
        '    |     ^',
      ].join('\n')
    );
  });

  it('renders a source snippet for a cross-module sourceId error', () => {
    const moduleSource = ['fn() {', '  1 + "1"', '}'].join('\n');
    const err = new RuntimeError(
      'RILL-R001',
      'type mismatch',
      { line: 2, column: 3 },
      { sourceText: moduleSource },
      { start: { line: 2, column: 3 }, end: { line: 2, column: 4 } },
      'module:greetings'
    );

    const formatted = formatRillError(err);

    expect(formatted).toBe(
      [
        'error[RILL-R001]: type mismatch',
        '  at module:greetings:2:3',
        '  2 |   1 + "1"',
        '    |   ^',
      ].join('\n')
    );
  });
});
