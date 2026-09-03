/**
 * Rill Runtime Tests: number ordering reflexivity and string->number strictness
 *
 * Part A: compareNumber uses relational logic, not subtraction, so equal
 * values (including equal infinities) compare equal. Infinity - Infinity is
 * NaN, which previously made every ordering operator return false and broke
 * reflexivity of <= / >=.
 *
 * Part B: string -> number accepts only clean decimal/float strings. Hex/
 * octal/binary prefixes and surrounding whitespace, which bare Number()
 * would accept, now halt with the standard conversion error.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('number ordering reflexivity (Part A)', () => {
  it('Infinity <= Infinity is true', async () => {
    const result = await run('"Infinity" -> number => $i\n($i <= $i)');
    expect(result).toBe(true);
  });

  it('Infinity >= Infinity is true', async () => {
    const result = await run('"Infinity" -> number => $i\n($i >= $i)');
    expect(result).toBe(true);
  });

  it('Infinity == Infinity is true', async () => {
    const result = await run('"Infinity" -> number => $i\n($i == $i)');
    expect(result).toBe(true);
  });

  it('-Infinity <= -Infinity is true', async () => {
    const result = await run('"-Infinity" -> number => $i\n($i <= $i)');
    expect(result).toBe(true);
  });

  it('Infinity < Infinity is false', async () => {
    const result = await run('"Infinity" -> number => $i\n($i < $i)');
    expect(result).toBe(false);
  });

  it('reflexivity holds for a finite number', async () => {
    const result = await run('5 => $n\n($n <= $n)');
    expect(result).toBe(true);
  });

  it('ordinary ordering still works: -Infinity < Infinity', async () => {
    const result = await run(
      '"-Infinity" -> number => $lo\n"Infinity" -> number => $hi\n($lo < $hi)'
    );
    expect(result).toBe(true);
  });
});

describe('string -> number strict parsing (Part B)', () => {
  // Rejections added by the fix
  it('rejects hex string "0x10"', async () => {
    await expect(run('"0x10" -> number')).rejects.toThrow(
      /cannot convert string "0x10" to number/
    );
  });

  it('rejects octal string "0o17"', async () => {
    await expect(run('"0o17" -> number')).rejects.toThrow(
      /cannot convert string "0o17" to number/
    );
  });

  it('rejects binary string "0b101"', async () => {
    await expect(run('"0b101" -> number')).rejects.toThrow(
      /cannot convert string "0b101" to number/
    );
  });

  it('rejects whitespace-padded string " 12 "', async () => {
    await expect(run('" 12 " -> number')).rejects.toThrow(
      /cannot convert string " 12 " to number/
    );
  });

  it('rejects leading-whitespace string " 12"', async () => {
    await expect(run('" 12" -> number')).rejects.toThrow(
      /cannot convert string " 12" to number/
    );
  });

  it('rejects the word "NaN"', async () => {
    await expect(run('"NaN" -> number')).rejects.toThrow(
      /cannot convert string "NaN" to number/
    );
  });

  it('rejects padded " Infinity "', async () => {
    await expect(run('" Infinity " -> number')).rejects.toThrow(
      /cannot convert string " Infinity " to number/
    );
  });

  // Preserved: "Infinity"/"-Infinity" (unpadded) still convert (Part A relies
  // on this), matching prior bare Number() behavior.
  it('converts "Infinity" to a value equal to itself under <=', async () => {
    const result = await run('"Infinity" -> number => $i\n($i <= $i)');
    expect(result).toBe(true);
  });

  // Preserved valid conversions
  it('converts "12" to 12', async () => {
    expect(await run('"12" -> number')).toBe(12);
  });

  it('converts "-3.5" to -3.5', async () => {
    expect(await run('"-3.5" -> number')).toBe(-3.5);
  });

  it('converts "1e3" to 1000', async () => {
    expect(await run('"1e3" -> number')).toBe(1000);
  });

  it('converts ".5" to 0.5', async () => {
    expect(await run('".5" -> number')).toBe(0.5);
  });

  it('converts "5" to 5', async () => {
    expect(await run('"5" -> number')).toBe(5);
  });
});
