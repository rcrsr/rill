/**
 * Key misses carry structured context: destructure reports the missing key and
 * the available keys, dispatch reports the missing key.
 */

import { describe, expect, it } from 'vitest';
import { getStatus, isInvalid } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

async function rawOf(src: string): Promise<Record<string, unknown>> {
  const result = await run(src);
  expect(isInvalid(result)).toBe(true);
  return getStatus(result).raw;
}

describe('key miss context', () => {
  it('reports key and availableKeys for a destructure miss', async () => {
    const raw = await rawOf('guard { dict[a: 1, b: 2] -> destruct<z: $z> }');

    expect(raw['message']).toBe('Undefined dict key: z');
    expect(raw['key']).toBe('z');
    expect(raw['availableKeys']).toEqual(['a', 'b']);
  });

  it('reports the key for a dispatch miss', async () => {
    const raw = await rawOf('guard { "z" -> dict[a: 1] }');

    expect(raw['message']).toBe('Undefined dict key: z');
    expect(raw['key']).toBe('z');
  });

  it('keeps a literal multi-key table stable across repeated dispatch', async () => {
    const result = await run(
      'dict[list["a", "b"]: 1, c: 2] => $t\nlist["b", "c", "a"] -> seq({ $ -> $t })'
    );

    expect(result).toEqual([1, 2, 1]);
  });

  it.each([
    ['a bracket read', 'dict[a: 1] => $d\nguard { $d["z"] }'],
    ['a variable key', 'dict[a: 1] => $d\n"z" => $k\nguard { $d.$k }'],
    ['a spelled field', 'dict[a: 1] => $d\nguard { $d.z }'],
    ['pipe selection', 'dict[a: 1] => $d\nguard { "z" -> $d }'],
    [
      'a hierarchical step',
      'dict[a: dict[b: 1]] => $d\nguard { list["a", "z"] -> $d }',
    ],
    ['an ordered bracket read', 'ordered[a: 1] => $o\nguard { $o["z"] }'],
    ['an ordered pipe selection', 'ordered[a: 1] => $o\nguard { "z" -> $o }'],
  ])('reports the key for %s', async (_label, src) => {
    const raw = await rawOf(src);

    expect(raw['key']).toBe('z');
  });

  it('re-evaluates an interpolated multi-key list on every dispatch', async () => {
    const result = await run(
      'list["a", "b"] -> seq({ $ => $x\n$x -> dict[list["{$x}"]: 1, other: 2] })'
    );

    expect(result).toEqual([1, 1]);
  });
});
