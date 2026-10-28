/**
 * Keeps ATOM_UNREGISTERED aligned with the runtime atom registry.
 *
 * Core-to-rule: every atom the runtime pre-registers must pass the rule.
 * Rule-to-core: every registry error id the runtime does not register must
 * still fire. A source scan guards against a hand-copied atom list
 * creeping back into the rule file.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('reads the builtin set from core without a hand-copied atom list', () => {
    const text = readFileSync(
      join(import.meta.dirname, 'atom-unregistered.ts'),
      'utf8'
    );
    expect(text).toMatch(
      /import \{[^}]*\bBUILTIN_ATOMS\b[^}]*\} from '@rcrsr\/rill'/
    );
    expect(text).not.toMatch(/'(?:TIMEOUT|RILL_R\w*|R\d{3})'/);
  });
});
