import { describe, expect, it } from 'vitest';
import {
  createDefaultConfig,
  validateConfig,
  validateRuleCodes,
} from './config.js';
import { RULES } from './rules.js';
import type { CheckConfig } from './types.js';

describe('createDefaultConfig', () => {
  it('returns all 40 rules set to on', () => {
    const config = createDefaultConfig();
    const codes = Object.keys(config.rules);

    expect(codes.length).toBe(40);
    for (const rule of RULES) {
      expect(config.rules[rule.code]).toBe('on');
    }
  });

  it('leaves checkerMode undefined', () => {
    const config = createDefaultConfig();
    expect(config.checkerMode).toBeUndefined();
  });

  it('is pure: repeated calls return equivalent but independent objects', () => {
    const first = createDefaultConfig();
    const second = createDefaultConfig();

    expect(first).toEqual(second);
    expect(first.rules).not.toBe(second.rules);
  });
});

describe('validateConfig', () => {
  it('returns null for a clean default config', () => {
    expect(validateConfig(createDefaultConfig())).toBeNull();
  });

  it('returns null for a config with a valid checkerMode and severity', () => {
    const config: CheckConfig = {
      rules: { NAMING_SNAKE_CASE: 'off' },
      checkerMode: 'strict',
      severity: 'warning',
    };
    expect(validateConfig(config)).toBeNull();
  });

  it('reports an unknown rule code without throwing', () => {
    const config: CheckConfig = { rules: { NOT_A_RULE: 'on' } };
    const errors = validateConfig(config);

    expect(errors).not.toBeNull();
    expect(errors).toContainEqual(
      expect.objectContaining({ ruleCode: 'NOT_A_RULE' })
    );
  });

  it('reports a malformed rule state without throwing', () => {
    const config = {
      rules: { NAMING_SNAKE_CASE: 'bogus' },
    } as unknown as CheckConfig;
    const errors = validateConfig(config);

    expect(errors).not.toBeNull();
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_RULE_STATE',
        ruleCode: 'NAMING_SNAKE_CASE',
      })
    );
  });

  it('reports an invalid checkerMode without throwing', () => {
    const config = {
      rules: {},
      checkerMode: 'bogus',
    } as unknown as CheckConfig;
    const errors = validateConfig(config);

    expect(errors).not.toBeNull();
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_CHECKER_MODE' })
    );
  });

  it('never throws for a malformed config shape', () => {
    const config = { rules: null } as unknown as CheckConfig;
    expect(() => validateConfig(config)).not.toThrow();
    expect(validateConfig(config)).not.toBeNull();
  });

  it('performs no side effects', () => {
    const config = createDefaultConfig();
    const before = JSON.stringify(config);
    validateConfig(config);
    expect(JSON.stringify(config)).toBe(before);
  });
});

describe('validateRuleCodes', () => {
  it('returns null when every code is known', () => {
    const codes = RULES.slice(0, 3).map((rule) => rule.code);
    expect(validateRuleCodes(codes)).toBeNull();
  });

  it('names the unknown code without throwing', () => {
    const errors = validateRuleCodes(['NOT_A_RULE']);

    expect(errors).not.toBeNull();
    expect(errors).toContainEqual(
      expect.objectContaining({ ruleCode: 'NOT_A_RULE' })
    );
  });

  it('performs no side effects', () => {
    const codes: readonly string[] = ['NAMING_SNAKE_CASE'];
    const before = [...codes];
    validateRuleCodes(codes);
    expect(codes).toEqual(before);
  });
});
