/**
 * Runtime tests: sort key-extractor vacancy check.
 *
 * sort's key extractor previously compared the extracted key against
 * `null` to detect a missing key, but rill has no null value, so that
 * comparison could never be true. These tests exercise the corrected
 * vacancy check (empty string, empty list, empty dict, and invalid
 * values) on both the dict-like/ordered path and the list path, plus a
 * not-vacant boundary (numeric `0`) to confirm the fix does not
 * over-halt on legitimate falsy-but-present keys.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('sort: key extractor vacancy check', () => {
  describe('list path', () => {
    it('halts with #INVALID_INPUT when the extractor returns an empty string', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> sort({ "" })'), {
        code: 'INVALID_INPUT',
      });
    });

    it('halts with #INVALID_INPUT when the extractor returns an empty list', async () => {
      await expectHalt(() => run('list[1, 2, 3] -> sort({ list[] })'), {
        code: 'INVALID_INPUT',
      });
    });

    it('halts with #INVALID_INPUT when the extractor returns an invalid (guard-caught) value', async () => {
      await expectHalt(
        () => run('list[1, 2, 3] -> sort({ guard { "x":number } })'),
        { code: 'INVALID_INPUT' }
      );
    });

    it('does not halt when the extractor returns numeric 0 (falsy but not vacant)', async () => {
      const script = `
        dict[score: 0, id: "only"] => $a
        list[$a] -> sort({ $.score })
      `;
      const result = (await run(script)) as Array<Record<string, unknown>>;
      expect(result).toHaveLength(1);
      expect(result[0]?.['id']).toBe('only');
    });
  });

  describe('dict/ordered path', () => {
    it('halts with #INVALID_INPUT when the extractor returns an empty string', async () => {
      await expectHalt(() => run('dict[a: 1, b: 2] -> sort({ "" })'), {
        code: 'INVALID_INPUT',
      });
    });

    it('halts with #INVALID_INPUT when the extractor returns an empty dict', async () => {
      await expectHalt(() => run('dict[a: 1, b: 2] -> sort({ dict[] })'), {
        code: 'INVALID_INPUT',
      });
    });

    it('halts with #INVALID_INPUT when the extractor returns an invalid (guard-caught) value', async () => {
      await expectHalt(
        () => run('dict[a: 1, b: 2] -> sort({ guard { "x":number } })'),
        { code: 'INVALID_INPUT' }
      );
    });

    it('does not halt when the extractor returns numeric 0 (falsy but not vacant)', async () => {
      const script = `
        dict[only: dict[score: 0]] => $d
        $d -> sort({ $.value.score })
      `;
      const result = await run(script);
      expect(result).toMatchObject({
        __rill_ordered: true,
        entries: [['only', { score: 0 }]],
      });
    });
  });
});
