import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { spacingOptions } from './spacing-options.js';
import { makeConfig, toParseResult } from './test-support.js';

function run(source: string): ReturnType<typeof runRules> {
  return runRules(toParseResult(source), source, makeConfig(), [
    spacingOptions,
  ]);
}

describe('SPACING_OPTIONS', () => {
  it.each([
    ['guard', 'guard (on: #TIMEOUT) { 1 }\n'],
    ['retry', 'retry (attempts: 3) { 1 }\n'],
    ['timeout', 'timeout (total: duration("1s")) { 1 }\n'],
    ['pass', '"x" -> pass (async: true) { 1 }\n'],
    ['do', '0 -> do (limit: 5) { $ + 1 } while ($ < 3)\n'],
    ['do', '0 -> while ($ < 3) do (limit: 5) { $ + 1 }\n'],
  ])('fires on a space after %s', (keyword, source) => {
    const result = run(source);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'SPACING_OPTIONS',
      severity: 'info',
      message: `No space between '${keyword}' and '(': write '${keyword}(...)'`,
    });
  });

  it('offers a fix that removes the space', () => {
    const source = 'retry (attempts: 3) { 1 }\n';
    const fix = run(source)[0]?.fix;

    expect(fix).toMatchObject({ applicable: true, replacement: '' });
    expect(source.slice(fix?.range.start.offset, fix?.range.end.offset)).toBe(
      ' '
    );
  });

  it('is silent on the tight form', () => {
    expect(run('retry(attempts: 3) { 1 }\n')).toEqual([]);
    expect(run('guard { 1 }\n')).toEqual([]);
  });
});
