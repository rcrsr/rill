/**
 * Conversion halts name the full path to the failing part.
 */

import { describe, it } from 'vitest';
import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

describe('conversion failure path', () => {
  it('names the list element and the dict field that failed', async () => {
    await expectHalt(
      () => run('list[dict[a: 1], dict[a: "x"]] -> list(dict(a: number))'),
      { code: 'RILL_R038', messagePattern: /element 1, field 'a'/ }
    );
  });

  it('names the dict field and the tuple position that failed', async () => {
    await expectHalt(
      () => run('dict[t: tuple[1, "x"]] -> dict(t: tuple(number, number))'),
      { code: 'RILL_R038', messagePattern: /field 't', position 1/ }
    );
  });
});
