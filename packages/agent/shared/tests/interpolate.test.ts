import { describe, it, expect } from 'vitest';
import { interpolateEnv } from '../src/interpolate.js';

describe('interpolateEnv', () => {
  describe('resolved variables', () => {
    it('replaces a single variable with its value', () => {
      const result = interpolateEnv('key=${VAR}', { VAR: 'val' });
      expect(result).toEqual({ value: 'key=val', unresolved: [] });
    });

    it('replaces multiple resolved variables', () => {
      const result = interpolateEnv('${A}-${B}', { A: 'foo', B: 'bar' });
      expect(result).toEqual({ value: 'foo-bar', unresolved: [] });
    });

    it('resolves empty string as a valid value [AC-27]', () => {
      const result = interpolateEnv('${VAR}', { VAR: '' });
      expect(result).toEqual({ value: '', unresolved: [] });
    });
  });

  describe('unresolved variables', () => {
    it('preserves unresolved variable in output and adds name to unresolved [AC-22]', () => {
      const result = interpolateEnv('${MISSING}', {});
      expect(result).toEqual({ value: '${MISSING}', unresolved: ['MISSING'] });
    });

    it('resolves known vars and preserves unknown vars in the same string', () => {
      const result = interpolateEnv('${KNOWN}-${UNKNOWN}', { KNOWN: 'yes' });
      expect(result).toEqual({
        value: 'yes-${UNKNOWN}',
        unresolved: ['UNKNOWN'],
      });
    });
  });

  describe('no variables', () => {
    it('returns the original string unchanged when no placeholders exist', () => {
      const result = interpolateEnv('hello', {});
      expect(result).toEqual({ value: 'hello', unresolved: [] });
    });
  });

  describe('IDENTIFIER pattern enforcement', () => {
    it('does not replace lowercase identifiers', () => {
      const result = interpolateEnv('${lowercase}', { lowercase: 'nope' });
      expect(result).toEqual({ value: '${lowercase}', unresolved: [] });
    });

    it('does not replace mixed-case identifiers', () => {
      const result = interpolateEnv('${MixedCase}', { MixedCase: 'nope' });
      expect(result).toEqual({ value: '${MixedCase}', unresolved: [] });
    });

    it('replaces identifiers starting with underscore', () => {
      const result = interpolateEnv('${_VAR}', { _VAR: 'ok' });
      expect(result).toEqual({ value: 'ok', unresolved: [] });
    });
  });

  describe('nested interpolation', () => {
    it('treats nested ${${VAR}} as a literal without replacement', () => {
      const result = interpolateEnv('${${VAR}}', { VAR: 'INNER' });
      expect(result).toEqual({ value: '${${VAR}}', unresolved: [] });
    });
  });
});
