/**
 * Tests for checkRuntimeVersion, validateContext, validateBundleRestrictions
 * Covers: HP-9, EC-5, EC-12, EC-14 (AC-9, AC-13, AC-14, AC-15, AC-17)
 */

import type { ContextBlock, RillConfigFile } from '@rcrsr/rill-config';
import {
  BundleRestrictionError,
  checkRuntimeVersion,
  ContextValidationError,
  RuntimeVersionError,
  validateBundleRestrictions,
  validateContext,
} from '@rcrsr/rill-config';
import { describe, expect, it } from 'vitest';

// ============================================================
// checkRuntimeVersion
// ============================================================

describe('checkRuntimeVersion', () => {
  describe('happy path', () => {
    it('does not throw when installed version satisfies the constraint', () => {
      // AC-15: no error when versions match
      expect(() => checkRuntimeVersion('^1.0.0', '1.2.3')).not.toThrow();
    });

    it('does not throw for exact version match', () => {
      expect(() => checkRuntimeVersion('1.0.0', '1.0.0')).not.toThrow();
    });
  });

  describe('error cases', () => {
    it('throws RuntimeVersionError when installed version does not satisfy constraint', () => {
      // AC-15: version mismatch produces RuntimeVersionError
      expect(() => checkRuntimeVersion('^2.0.0', '1.9.9')).toThrowError(
        RuntimeVersionError
      );
      expect(() => checkRuntimeVersion('^2.0.0', '1.9.9')).toThrowError(
        'Runtime 1.9.9 does not satisfy ^2.0.0'
      );
    });

    it('throws RuntimeVersionError for an invalid semver range constraint', () => {
      // EC-5: invalid range string throws RuntimeVersionError
      expect(() => checkRuntimeVersion('not-a-range', '1.0.0')).toThrowError(
        RuntimeVersionError
      );
      expect(() => checkRuntimeVersion('not-a-range', '1.0.0')).toThrowError(
        'Invalid runtime constraint: not-a-range'
      );
    });
  });
});

// ============================================================
// validateContext
// ============================================================

describe('validateContext', () => {
  describe('happy path', () => {
    it('returns validated values when schema and values match', () => {
      // AC-9: returns Record<string, unknown> with matched values
      const context: ContextBlock = {
        schema: {
          name: { type: 'string' },
          count: { type: 'number' },
          active: { type: 'bool' },
        },
        values: {
          name: 'alice',
          count: 42,
          active: true,
        },
      };

      const result = validateContext(context);

      expect(result['name']).toBe('alice');
      expect(result['count']).toBe(42);
      expect(result['active']).toBe(true);
    });

    it('returns empty record for empty schema', () => {
      const context: ContextBlock = {
        schema: {},
        values: {},
      };

      const result = validateContext(context);

      expect(result).toEqual({});
    });
  });

  describe('error cases', () => {
    it('throws ContextValidationError naming the missing key', () => {
      // AC-13 / EC-12: missing value in values block
      const context: ContextBlock = {
        schema: { username: { type: 'string' } },
        values: {},
      };

      expect(() => validateContext(context)).toThrowError(
        ContextValidationError
      );
      expect(() => validateContext(context)).toThrowError(
        'Missing context value for key: username'
      );
    });

    it('throws ContextValidationError naming expected and actual types on mismatch', () => {
      // AC-14 / EC-12: value present but wrong type
      const context: ContextBlock = {
        schema: { score: { type: 'number' } },
        values: { score: 'not-a-number' },
      };

      expect(() => validateContext(context)).toThrowError(
        ContextValidationError
      );
      expect(() => validateContext(context)).toThrowError(
        'Context score: expected number, got string'
      );
    });

    it('throws ContextValidationError for boolean value where string is expected', () => {
      const context: ContextBlock = {
        schema: { label: { type: 'string' } },
        values: { label: true },
      };

      expect(() => validateContext(context)).toThrowError(
        'Context label: expected string, got bool'
      );
    });
  });
});

// ============================================================
// validateBundleRestrictions
// ============================================================

describe('validateBundleRestrictions', () => {
  describe('happy path', () => {
    it('does not throw when neither extensions.config nor context is present', () => {
      // AC-17: clean config passes bundle restriction check
      const config: RillConfigFile = {
        name: 'my-bundle',
        extensions: { mounts: { 'ns.fs': '@scope/pkg' } },
      };

      expect(() => validateBundleRestrictions(config)).not.toThrow();
    });

    it('does not throw for a minimal empty config', () => {
      const config: RillConfigFile = {};

      expect(() => validateBundleRestrictions(config)).not.toThrow();
    });
  });

  describe('error cases', () => {
    it('throws BundleRestrictionError when extensions.config is present', () => {
      // AC-17 / EC-14: extensions.config prohibited at bundle time
      const config: RillConfigFile = {
        extensions: {
          mounts: {},
          config: { apiKey: 'secret' },
        },
      };

      expect(() => validateBundleRestrictions(config)).toThrowError(
        BundleRestrictionError
      );
      expect(() => validateBundleRestrictions(config)).toThrowError(
        'extensions.config must not be present at bundle time'
      );
    });

    it('throws BundleRestrictionError when context is present', () => {
      // AC-17 / EC-14: context prohibited at bundle time
      const config: RillConfigFile = {
        context: {
          schema: { token: { type: 'string' } },
          values: { token: 'abc' },
        },
      };

      expect(() => validateBundleRestrictions(config)).toThrowError(
        BundleRestrictionError
      );
      expect(() => validateBundleRestrictions(config)).toThrowError(
        'context must not be present at bundle time'
      );
    });
  });
});
