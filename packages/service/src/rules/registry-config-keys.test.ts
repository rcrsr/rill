import { describe, expect, it } from 'vitest';
import {
  createDefaultConfig,
  validateConfig,
  validateRuleCodes,
} from './config.js';
import { RULES } from './rules.js';
import type { CheckConfig } from './types.js';

describe('registry/config/validator key equality', () => {
  it('exposes exactly 40 rule codes with no duplicates in the registry', () => {
    const codes = RULES.map((rule) => rule.code);
    const uniqueCodes = new Set(codes);

    expect(codes.length).toBe(40);
    expect(uniqueCodes.size).toBe(40);
  });

  it('exposes exactly 40 rule codes with no duplicates in the default config', () => {
    const codes = Object.keys(createDefaultConfig().rules);
    const uniqueCodes = new Set(codes);

    expect(codes.length).toBe(40);
    expect(uniqueCodes.size).toBe(40);
  });

  it('validates the full registry code set as known with no unknowns', () => {
    const codes = RULES.map((rule) => rule.code);
    expect(validateRuleCodes(codes)).toBeNull();
  });

  it('flags a code absent from the registry as unknown', () => {
    const errors = validateRuleCodes(['NOT_A_RULE']);
    expect(errors).not.toBeNull();
    expect(errors).toContainEqual(
      expect.objectContaining({ ruleCode: 'NOT_A_RULE' })
    );
  });

  it('reports the same set of 40 codes across RULES, createDefaultConfig, and validateRuleCodes', () => {
    const registryCodes = new Set(RULES.map((rule) => rule.code));
    const configCodes = new Set(Object.keys(createDefaultConfig().rules));

    expect(registryCodes.size).toBe(40);
    expect(configCodes.size).toBe(40);
    expect(configCodes).toEqual(registryCodes);

    // The validator's known-set is derived from RULES; probe it by asserting
    // every registry code passes and every non-registry code fails.
    expect(validateRuleCodes([...registryCodes])).toBeNull();

    for (const code of registryCodes) {
      expect(validateRuleCodes([code])).toBeNull();
    }

    const bogusCode = 'DEFINITELY_NOT_A_REGISTERED_RULE_CODE';
    expect(registryCodes.has(bogusCode)).toBe(false);
    const bogusErrors = validateRuleCodes([bogusCode]);
    expect(bogusErrors).toContainEqual(
      expect.objectContaining({ ruleCode: bogusCode })
    );
  });
});

describe('validateConfig additional contract edges', () => {
  it('reports an invalid severity without throwing', () => {
    const config = {
      rules: {},
      severity: 'bogus',
    } as unknown as CheckConfig;
    const errors = validateConfig(config);

    expect(errors).not.toBeNull();
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_SEVERITY' })
    );
  });

  it('reports every problem when multiple issues coexist', () => {
    const config = {
      rules: { NOT_A_RULE: 'on', NAMING_SNAKE_CASE: 'bogus' },
      checkerMode: 'bogus',
      severity: 'bogus',
    } as unknown as CheckConfig;
    const errors = validateConfig(config);

    expect(errors).not.toBeNull();
    expect(errors?.length).toBeGreaterThanOrEqual(4);
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'UNKNOWN_RULE_CODE',
        ruleCode: 'NOT_A_RULE',
      })
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_RULE_STATE',
        ruleCode: 'NAMING_SNAKE_CASE',
      })
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_CHECKER_MODE' })
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_SEVERITY' })
    );
  });

  it('does not mutate the input config object', () => {
    const config: CheckConfig = {
      rules: { NAMING_SNAKE_CASE: 'on' },
      checkerMode: 'strict',
      severity: 'warning',
    };
    const snapshot = JSON.parse(JSON.stringify(config)) as CheckConfig;

    validateConfig(config);
    validateConfig(config);

    expect(config).toEqual(snapshot);
  });

  it('returns equal results across repeated calls with the same input', () => {
    const config = { rules: { NOT_A_RULE: 'on' } } as unknown as CheckConfig;

    const first = validateConfig(config);
    const second = validateConfig(config);

    expect(first).toEqual(second);
  });
});

describe('validateRuleCodes additional contract edges', () => {
  it('returns null for an empty codes array', () => {
    expect(validateRuleCodes([])).toBeNull();
  });

  it('does not mutate the input codes array', () => {
    const codes = Object.freeze(['NOT_A_RULE']);
    expect(() => validateRuleCodes(codes)).not.toThrow();
    expect(codes).toEqual(['NOT_A_RULE']);
  });

  it('returns equal results across repeated calls with the same input', () => {
    const codes = ['NOT_A_RULE', 'ALSO_NOT_A_RULE'];

    const first = validateRuleCodes(codes);
    const second = validateRuleCodes(codes);

    expect(first).toEqual(second);
  });
});
