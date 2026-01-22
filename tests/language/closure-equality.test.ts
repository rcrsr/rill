/**
 * Rill Runtime Tests: Closure Equality
 *
 * Tests structural equality for closures:
 * - Same params + body AST + captured values = equal
 * - Different params, body, or captures = not equal
 * - Location in source does not affect equality
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Closure Equality', () => {
  describe('identical closures', () => {
    it('closures with same body are equal', async () => {
      const code = `
        { .trim } :> $a
        { .trim } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('closures with method calls are equal', async () => {
      const code = `
        { .trim } :> $a
        { .trim } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });
  });

  describe('different closures', () => {
    it('closures with different body are not equal', async () => {
      const code = `
        { .trim } :> $a
        { .len } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });
  });

  describe('captured values', () => {
    it('closures with same captured values are equal', async () => {
      const code = `
        "hello" :> $x
        { $x } :> $a
        { $x } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('closures with different captured values are not equal', async () => {
      const code = `
        "hello" :> $x
        { $x } :> $a
        "world" :> $x
        { $x } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });

    it('closures with multiple captures must match all', async () => {
      const code = `
        "a" :> $a
        "b" :> $b
        { [$a, $b] } :> $f1
        { [$a, $b] } :> $f2
        ($f1 == $f2) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('closures with different captured variable subset are not equal', async () => {
      const code = `
        "a" :> $a
        "b" :> $b
        { $a } :> $f1
        { $b } :> $f2
        ($f1 == $f2) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });
  });

  describe('complex closures', () => {
    it('closures with different conditionals are not equal', async () => {
      const code = `
        { $ ? "yes" ! "no" } :> $a
        { $ ? "yes" ! "maybe" } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });

    it('closures with loops are equal', async () => {
      const code = `
        |x| (true @ { $x }) :> $a
        |x| (true @ { $x }) :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('nested closures are compared structurally', async () => {
      const code = `
        { { .trim } } :> $a
        { { .trim } } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('nested closures with differences are not equal', async () => {
      const code = `
        { { .trim } } :> $a
        { { .len } } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });
  });

  describe('inequality operator', () => {
    it('!= returns true for different closures', async () => {
      const code = `
        { .trim } :> $a
        { .len } :> $b
        ($a != $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('!= returns false for same closures', async () => {
      const code = `
        { .trim } :> $a
        { .trim } :> $b
        ($a != $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });
  });

  describe('closures in collections', () => {
    it('tuples containing different closures are not equal', async () => {
      const code = `
        [{ .trim }, { .len }] :> $a
        [{ .trim }, { .str }] :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });

    it('dicts containing different closures are not equal', async () => {
      const code = `
        [f: { .trim }] :> $a
        [f: { .len }] :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('closures returning literals are equal', async () => {
      const code = `
        { "hello" } :> $a
        { "hello" } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('closures returning different literals are not equal', async () => {
      const code = `
        { "hello" } :> $a
        { "world" } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });

    it('closures with pipe variable are equal', async () => {
      const code = `
        { $ } :> $a
        { $ } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('same closure reference equals itself', async () => {
      const code = `
        { .trim } :> $a
        ($a == $a) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('closures with tuples are equal', async () => {
      const code = `
        { [1, 2, 3] } :> $a
        { [1, 2, 3] } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(true);
    });

    it('closures with different tuples are not equal', async () => {
      const code = `
        { [1, 2, 3] } :> $a
        { [1, 2, 4] } :> $b
        ($a == $b) ? true ! false
      `;
      expect(await run(code)).toBe(false);
    });
  });
});
