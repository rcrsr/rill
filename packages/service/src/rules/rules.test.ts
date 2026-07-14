import { describe, expect, it } from 'vitest';
import { RULES } from './rules.js';

describe('RULES', () => {
  it('registers exactly 40 rules', () => {
    expect(RULES.length).toBe(40);
  });

  it('has unique rule codes', () => {
    const codes = RULES.map((rule) => rule.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(RULES)).toBe(true);
    expect(() => {
      (RULES as Array<(typeof RULES)[number]>).push(RULES[0] as never);
    }).toThrow();
  });
});
