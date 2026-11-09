/**
 * Rill Runtime Tests: pass block variable scope
 *
 * A `pass` body runs in a child scope: outer variables are readable inside
 * it, but captures made inside it do not leak out.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('Rill Runtime: pass block scope', () => {
  it('halts when a capture made inside a pass body is read after it', async () => {
    await expectHalt(() => run('pass { 1 => $f }\n$f'), {
      code: 'RILL_R005',
      hostErrorId: 'RILL-R005',
      messagePattern: 'Undefined variable: $f',
    });
  });

  it('reads an outer variable inside a pass body', async () => {
    const result = await run('5 => $x\npass { $x => $y }\n$x');
    expect(result).toBe(5);
  });
});
