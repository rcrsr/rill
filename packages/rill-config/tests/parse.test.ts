/**
 * Tests for parseConfig and parseMainField
 * Covers: HP-4, HP-5, HP-6, HP-10, EC-2, EC-3, EC-4, EC-15, BC-3, BC-6
 * (AC-4, AC-5, AC-6, AC-10, AC-12, AC-25, AC-28)
 */

import {
  ConfigEnvError,
  ConfigParseError,
  ConfigValidationError,
  parseConfig,
  parseMainField,
} from '@rcrsr/rill-config';
import { describe, expect, it } from 'vitest';

// ============================================================
// parseConfig
// ============================================================

describe('parseConfig', () => {
  describe('HP-4: preserves all metadata fields', () => {
    it('returns all populated metadata fields unchanged', () => {
      const raw = JSON.stringify({
        name: 'my-app',
        version: '1.2.3',
        description: 'A test app',
        runtime: '>=0.10.0',
        main: 'index.rill',
      });

      const result = parseConfig(raw, {});

      expect(result.name).toBe('my-app');
      expect(result.version).toBe('1.2.3');
      expect(result.description).toBe('A test app');
      expect(result.runtime).toBe('>=0.10.0');
      expect(result.main).toBe('index.rill');
    });

    it('returns extensions, context, host, and modules blocks', () => {
      const raw = JSON.stringify({
        extensions: { mounts: { 'ext/http': 'rill-http@1.0.0' } },
        context: {
          schema: { token: { type: 'string' } },
          values: { token: 'abc' },
        },
        host: { timeout: 5000 },
        modules: { math: './math.rill' },
      });

      const result = parseConfig(raw, {});

      expect(result.extensions).toEqual({
        mounts: { 'ext/http': 'rill-http@1.0.0' },
      });
      expect(result.context).toEqual({
        schema: { token: { type: 'string' } },
        values: { token: 'abc' },
      });
      expect(result.host).toEqual({ timeout: 5000 });
      expect(result.modules).toEqual({ math: './math.rill' });
    });
  });

  describe('BC-3: bare minimum config', () => {
    it('returns a config with all optional fields undefined when given empty object JSON', () => {
      const result = parseConfig('{}', {});

      expect(result.name).toBeUndefined();
      expect(result.version).toBeUndefined();
      expect(result.description).toBeUndefined();
      expect(result.runtime).toBeUndefined();
      expect(result.main).toBeUndefined();
      expect(result.extensions).toBeUndefined();
      expect(result.context).toBeUndefined();
      expect(result.host).toBeUndefined();
      expect(result.modules).toBeUndefined();
    });
  });

  describe('HP-10: env var interpolation', () => {
    it('interpolates ${API_KEY} from the provided env record', () => {
      const raw = JSON.stringify({ description: 'key is ${API_KEY}' });

      const result = parseConfig(raw, { API_KEY: 'secret-123' });

      expect(result.description).toBe('key is secret-123');
    });

    it('interpolates multiple distinct vars in a single string', () => {
      const raw = JSON.stringify({ name: '${ORG}-${APP}' });

      const result = parseConfig(raw, { ORG: 'acme', APP: 'runner' });

      expect(result.name).toBe('acme-runner');
    });

    it('interpolates env vars nested inside object values', () => {
      const raw = JSON.stringify({
        modules: { path: '${BASE_PATH}/script.rill' },
      });

      const result = parseConfig(raw, { BASE_PATH: '/opt/rill' });

      expect(result.modules).toEqual({ path: '/opt/rill/script.rill' });
    });
  });

  describe('BC-6: non-string values not interpolated', () => {
    it('does not interpolate ${VAR} syntax in numeric fields', () => {
      const raw = JSON.stringify({ host: { timeout: 3000 } });

      const result = parseConfig(raw, { timeout: 'should-not-appear' });

      expect(result.host?.timeout).toBe(3000);
    });

    it('does not attempt interpolation on boolean values', () => {
      const raw = JSON.stringify({
        context: {
          schema: {},
          values: { flag: true },
        },
      });

      const result = parseConfig(raw, {});

      const values = result.context?.values as Record<string, unknown>;
      expect(values?.['flag']).toBe(true);
    });
  });

  describe('EC-2: invalid JSON', () => {
    it('throws ConfigParseError for malformed JSON', () => {
      expect(() => parseConfig('not json', {})).toThrow(ConfigParseError);
    });

    it('throws ConfigParseError with message starting with "Failed to parse config:"', () => {
      expect(() => parseConfig('{broken', {})).toThrow(
        /^Failed to parse config:/
      );
    });

    it('throws ConfigParseError when JSON is a top-level array', () => {
      expect(() => parseConfig('[]', {})).toThrow(ConfigParseError);
    });

    it('throws ConfigParseError when JSON is a top-level string', () => {
      expect(() => parseConfig('"hello"', {})).toThrow(ConfigParseError);
    });
  });

  describe('EC-3: missing env vars', () => {
    it('throws ConfigEnvError when a referenced env var is absent', () => {
      const raw = JSON.stringify({ name: '${MISSING_VAR}' });

      expect(() => parseConfig(raw, {})).toThrow(ConfigEnvError);
    });

    it('collects all missing var names into a single ConfigEnvError', () => {
      const raw = JSON.stringify({
        name: '${FIRST_MISSING}',
        description: '${SECOND_MISSING}',
      });

      expect(() => parseConfig(raw, {})).toThrow(
        'Missing environment variables: FIRST_MISSING, SECOND_MISSING'
      );
    });

    it('throws ConfigEnvError listing names in sorted order', () => {
      const raw = JSON.stringify({ name: '${ZZZ} ${AAA}' });

      expect(() => parseConfig(raw, {})).toThrow(
        'Missing environment variables: AAA, ZZZ'
      );
    });
  });

  describe('EC-4: invalid field type', () => {
    it('throws ConfigValidationError when a string field receives a number', () => {
      const raw = JSON.stringify({ name: 42 });

      expect(() => parseConfig(raw, {})).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError with message showing field name and types', () => {
      const raw = JSON.stringify({ version: false });

      expect(() => parseConfig(raw, {})).toThrow(
        'Field version: expected string, got boolean'
      );
    });

    it('throws ConfigValidationError when extensions field receives an array', () => {
      const raw = JSON.stringify({ extensions: [] });

      expect(() => parseConfig(raw, {})).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError when host field receives a string', () => {
      const raw = JSON.stringify({ host: 'invalid' });

      expect(() => parseConfig(raw, {})).toThrow(
        'Field host: expected object, got string'
      );
    });
  });
});

// ============================================================
// parseMainField
// ============================================================

describe('parseMainField', () => {
  describe('HP-5: module mode (no colon)', () => {
    it('returns filePath and undefined handlerName for a plain file path', () => {
      const result = parseMainField('script.rill');

      expect(result.filePath).toBe('script.rill');
      expect(result.handlerName).toBeUndefined();
    });

    it('returns filePath for a nested path with no colon', () => {
      const result = parseMainField('handlers/main.rill');

      expect(result.filePath).toBe('handlers/main.rill');
      expect(result.handlerName).toBeUndefined();
    });
  });

  describe('HP-6: handler mode (with colon)', () => {
    it('splits on the first colon to extract filePath and handlerName', () => {
      const result = parseMainField('handler.rill:run');

      expect(result.filePath).toBe('handler.rill');
      expect(result.handlerName).toBe('run');
    });

    it('uses only the text before the first colon as filePath', () => {
      const result = parseMainField('path/to/file.rill:execute');

      expect(result.filePath).toBe('path/to/file.rill');
      expect(result.handlerName).toBe('execute');
    });
  });

  describe('EC-15: empty file path or handler name', () => {
    it('throws ConfigValidationError for an empty string', () => {
      expect(() => parseMainField('')).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError with "empty file path" message for empty string', () => {
      expect(() => parseMainField('')).toThrow(
        'main field has empty file path'
      );
    });

    it('throws ConfigValidationError when colon is the first character (empty file path)', () => {
      expect(() => parseMainField(':run')).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError with "empty file path" message when colon is first', () => {
      expect(() => parseMainField(':run')).toThrow(
        'main field has empty file path'
      );
    });

    it('throws ConfigValidationError when nothing follows the colon (empty handler name)', () => {
      expect(() => parseMainField('handler.rill:')).toThrow(
        ConfigValidationError
      );
    });

    it('throws ConfigValidationError with "empty handler name" message when handler is empty', () => {
      expect(() => parseMainField('handler.rill:')).toThrow(
        'main field has empty handler name'
      );
    });
  });
});
