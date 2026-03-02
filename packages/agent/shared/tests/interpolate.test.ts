import { describe, it, expect } from 'vitest';
import { interpolateEnv, interpolateConfigDeep } from '../src/interpolate.js';

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

describe('interpolateConfigDeep', () => {
  describe('string value substitution [IR-5]', () => {
    it('replaces ${VAR} in string values across all sections', () => {
      const config = { db: { host: '${DB_HOST}', port: '5432' } };
      const env = { DB_HOST: 'localhost' };
      const result = interpolateConfigDeep(config, env);
      expect(result).toEqual({ db: { host: 'localhost', port: '5432' } });
    });

    it('replaces ${VAR} in multiple sections', () => {
      const config = {
        db: { url: '${DB_URL}' },
        cache: { url: '${CACHE_URL}' },
      };
      const env = { DB_URL: 'postgres://db', CACHE_URL: 'redis://cache' };
      const result = interpolateConfigDeep(config, env);
      expect(result).toEqual({
        db: { url: 'postgres://db' },
        cache: { url: 'redis://cache' },
      });
    });
  });

  describe('unset variable retention [IR-5/AC-20]', () => {
    it('retains literal ${VAR} when variable is not in env', () => {
      const config = { app: { name: '${APP_NAME}' } };
      const result = interpolateConfigDeep(config, {});
      expect(result).toEqual({ app: { name: '${APP_NAME}' } });
    });

    it('retains literal ${VAR} when env value is undefined', () => {
      const config = { app: { name: '${APP_NAME}' } };
      const result = interpolateConfigDeep(config, { APP_NAME: undefined });
      expect(result).toEqual({ app: { name: '${APP_NAME}' } });
    });
  });

  describe('non-string value passthrough [IR-5]', () => {
    it('passes through number values unchanged', () => {
      const config = { server: { port: 8080 } } as Record<
        string,
        Record<string, unknown>
      >;
      const result = interpolateConfigDeep(config, {});
      expect(result).toEqual({ server: { port: 8080 } });
    });

    it('passes through boolean values unchanged', () => {
      const config = { feature: { enabled: true } } as Record<
        string,
        Record<string, unknown>
      >;
      const result = interpolateConfigDeep(config, {});
      expect(result).toEqual({ feature: { enabled: true } });
    });

    it('passes through null values unchanged', () => {
      const config = { section: { key: null } } as Record<
        string,
        Record<string, unknown>
      >;
      const result = interpolateConfigDeep(config, {});
      expect(result).toEqual({ section: { key: null } });
    });
  });

  describe('immutability', () => {
    it('returns a new object without mutating the original config', () => {
      const config = { app: { name: '${APP_NAME}' } };
      const env = { APP_NAME: 'myapp' };
      const result = interpolateConfigDeep(config, env);
      expect(result).not.toBe(config);
      expect(result.app).not.toBe(config.app);
      expect(config.app.name).toBe('${APP_NAME}');
    });
  });

  describe('empty config', () => {
    it('returns an empty object for an empty config', () => {
      const result = interpolateConfigDeep({}, {});
      expect(result).toEqual({});
    });
  });
});
