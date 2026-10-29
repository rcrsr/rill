/**
 * Keeps ATOM_UNREGISTERED aligned with the runtime atom registry.
 *
 * Core-to-rule: every atom the runtime pre-registers must pass the rule.
 * Rule-to-core: every registry error id the runtime does not register must
 * still fire.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ATOMS,
  ERROR_REGISTRY,
  parseWithRecovery,
  resolveAtom,
} from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import { atomUnregistered } from './atom-unregistered.js';

function runAtomRule(name: string): ReturnType<typeof runRules> {
  const source = `#${name}\n`;
  return runRules(parseWithRecovery(source), source, { rules: {} }, [
    atomUnregistered,
  ]);
}

const REGISTRY_ATOM_NAMES: string[] = Array.from(ERROR_REGISTRY.entries())
  .map(([id]) => id.replace('-', '_'))
  .filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name));

const REGISTERED_REGISTRY_NAMES = REGISTRY_ATOM_NAMES.filter(
  (name) => resolveAtom(name).name === name
);
const UNREGISTERED_REGISTRY_NAMES = REGISTRY_ATOM_NAMES.filter(
  (name) => resolveAtom(name).name !== name
);

describe('ATOM_UNREGISTERED stays aligned with the runtime registry', () => {
  it('has non-empty atom lists to iterate', () => {
    expect(BUILTIN_ATOMS.length).toBeGreaterThan(0);
    expect(REGISTERED_REGISTRY_NAMES.length).toBeGreaterThan(0);
    expect(UNREGISTERED_REGISTRY_NAMES.length).toBeGreaterThan(0);
  });

  it.each([...BUILTIN_ATOMS])('does not fire for builtin atom #%s', (name) => {
    expect(runAtomRule(name)).toEqual([]);
  });

  it.each(REGISTERED_REGISTRY_NAMES)(
    'does not fire for registered registry atom #%s',
    (name) => {
      expect(runAtomRule(name)).toEqual([]);
    }
  );

  it.each(UNREGISTERED_REGISTRY_NAMES)(
    'fires for unregistered registry atom #%s',
    (name) => {
      const result = runAtomRule(name);
      expect(result).toHaveLength(1);
      expect(result[0]?.code).toBe('ATOM_UNREGISTERED');
    }
  );

  it.each(['R004', 'CUSTOM_CODE'])('fires for #%s', (name) => {
    expect(runAtomRule(name)).toHaveLength(1);
  });
});
