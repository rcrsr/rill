/**
 * Tests for getHelpUrl function.
 * Covers AC-7, AC-11, EC-7, EC-8, and boundary cases.
 */

import { describe, it, expect } from 'vitest';
import { getHelpUrl } from '@rcrsr/rill';

describe('getHelpUrl', () => {
  describe('valid inputs (AC-7)', () => {
    it('generates correct URL for runtime error RILL-R001 with version 0.4.1', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toBe(
        'https://github.com/rcrsr/rill/blob/v0.4.1/docs/ref-errors.md#rill-r001'
      );
    });

    it('generates correct URL for parse error RILL-P001 with version 1.0.0', () => {
      const result = getHelpUrl('RILL-P001', '1.0.0');
      expect(result).toBe(
        'https://github.com/rcrsr/rill/blob/v1.0.0/docs/ref-errors.md#rill-p001'
      );
    });

    it('generates correct URL for lexer error RILL-L001 with version 0.5.0', () => {
      const result = getHelpUrl('RILL-L001', '0.5.0');
      expect(result).toBe(
        'https://github.com/rcrsr/rill/blob/v0.5.0/docs/ref-errors.md#rill-l001'
      );
    });

    it('generates correct URL for check error RILL-C001 with version 2.1.3', () => {
      const result = getHelpUrl('RILL-C001', '2.1.3');
      expect(result).toBe(
        'https://github.com/rcrsr/rill/blob/v2.1.3/docs/ref-errors.md#rill-c001'
      );
    });

    it('lowercases error ID in anchor', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('#rill-r001');
    });

    it('preserves version in URL path', () => {
      const result = getHelpUrl('RILL-P005', '1.2.3');
      expect(result).toContain('/v1.2.3/');
    });

    it('includes correct documentation file path', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('/docs/ref-errors.md#');
    });

    it('includes correct GitHub repository path', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('https://github.com/rcrsr/rill/blob/');
    });
  });

  describe('boundary cases - all error categories', () => {
    it('handles lexer category (RILL-L)', () => {
      const result = getHelpUrl('RILL-L005', '0.4.1');
      expect(result).toBe(
        'https://github.com/rcrsr/rill/blob/v0.4.1/docs/ref-errors.md#rill-l005'
      );
    });

    it('handles parse category (RILL-P)', () => {
      const result = getHelpUrl('RILL-P005', '0.4.1');
      expect(result).toBe(
        'https://github.com/rcrsr/rill/blob/v0.4.1/docs/ref-errors.md#rill-p005'
      );
    });

    it('handles runtime category (RILL-R)', () => {
      const result = getHelpUrl('RILL-R016', '0.4.1');
      expect(result).toBe(
        'https://github.com/rcrsr/rill/blob/v0.4.1/docs/ref-errors.md#rill-r016'
      );
    });

    it('handles check category (RILL-C)', () => {
      const result = getHelpUrl('RILL-C004', '0.4.1');
      expect(result).toBe(
        'https://github.com/rcrsr/rill/blob/v0.4.1/docs/ref-errors.md#rill-c004'
      );
    });
  });

  describe('boundary cases - 3-digit error numbers', () => {
    it('handles 001 error number', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('#rill-r001');
    });

    it('handles 100 error number', () => {
      const result = getHelpUrl('RILL-R100', '0.4.1');
      expect(result).toContain('#rill-r100');
    });

    it('handles 999 error number (maximum 3-digit)', () => {
      const result = getHelpUrl('RILL-R999', '0.4.1');
      expect(result).toContain('#rill-r999');
    });
  });

  describe('invalid inputs (AC-11)', () => {
    it('returns empty string for invalid error ID format', () => {
      const result = getHelpUrl('invalid', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for missing RILL- prefix', () => {
      const result = getHelpUrl('R001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for invalid category letter (not LPRC)', () => {
      const result = getHelpUrl('RILL-X001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for lowercase category letter', () => {
      const result = getHelpUrl('RILL-r001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for wrong number of digits', () => {
      const result = getHelpUrl('RILL-R01', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for 4-digit error number', () => {
      const result = getHelpUrl('RILL-R0001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for non-numeric error suffix', () => {
      const result = getHelpUrl('RILL-RABC', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for extra characters in error ID', () => {
      const result = getHelpUrl('RILL-R001X', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for error ID with leading spaces', () => {
      const result = getHelpUrl(' RILL-R001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for error ID with trailing spaces', () => {
      const result = getHelpUrl('RILL-R001 ', '0.4.1');
      expect(result).toBe('');
    });
  });

  describe('invalid version formats (EC-8)', () => {
    it('returns empty string when version is invalid format', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1.1');
      expect(result).toBe('');
    });

    it('returns empty string when version has 2 parts', () => {
      const result = getHelpUrl('RILL-R001', '0.4');
      expect(result).toBe('');
    });

    it('returns empty string when version is non-numeric', () => {
      const result = getHelpUrl('RILL-R001', 'v0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string when version has leading v', () => {
      const result = getHelpUrl('RILL-R001', 'v0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string when version has trailing spaces', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1 ');
      expect(result).toBe('');
    });

    it('returns empty string when version has leading spaces', () => {
      const result = getHelpUrl('RILL-R001', ' 0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string when version is empty string', () => {
      const result = getHelpUrl('RILL-R001', '');
      expect(result).toBe('');
    });

    it('returns empty string when version has non-numeric parts', () => {
      const result = getHelpUrl('RILL-R001', '0.4.a');
      expect(result).toBe('');
    });

    it('returns empty string when version is alpha suffix format', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1-alpha');
      expect(result).toBe('');
    });

    it('returns empty string when version has letters mixed in', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1rc1');
      expect(result).toBe('');
    });

    it('returns empty string when version is only major.minor', () => {
      const result = getHelpUrl('RILL-R001', '1.2');
      expect(result).toBe('');
    });
  });

  describe('error ID format validation (EC-7)', () => {
    it('returns empty string for lowercase error ID', () => {
      const result = getHelpUrl('rill-r001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for error ID with missing hyphen', () => {
      const result = getHelpUrl('RILLR001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for error ID with extra hyphen', () => {
      const result = getHelpUrl('RILL--R001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for space instead of hyphen', () => {
      const result = getHelpUrl('RILL R001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for partial error ID', () => {
      const result = getHelpUrl('RILL-R', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for number only', () => {
      const result = getHelpUrl('001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string when error ID is empty', () => {
      const result = getHelpUrl('', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for error ID with special characters', () => {
      const result = getHelpUrl('RILL@R001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for error ID with underscore', () => {
      const result = getHelpUrl('RILL_R001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for all lowercase prefix', () => {
      const result = getHelpUrl('rill-R001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for mixed case RILL prefix', () => {
      const result = getHelpUrl('Rill-R001', '0.4.1');
      expect(result).toBe('');
    });

    it('returns empty string for invalid category after hyphen', () => {
      const result = getHelpUrl('RILL-A001', '0.4.1');
      expect(result).toBe('');
    });
  });

  describe('combined invalid inputs', () => {
    it('returns empty string when both errorId and version are invalid', () => {
      const result = getHelpUrl('invalid', '0.4');
      expect(result).toBe('');
    });

    it('returns empty string when errorId is valid but version is invalid', () => {
      const result = getHelpUrl('RILL-R001', '0.4');
      expect(result).toBe('');
    });

    it('returns empty string when errorId is invalid but version is valid', () => {
      const result = getHelpUrl('INVALID-R001', '0.4.1');
      expect(result).toBe('');
    });
  });

  describe('version format variations', () => {
    it('accepts single digit version parts', () => {
      const result = getHelpUrl('RILL-R001', '1.0.0');
      expect(result).not.toBe('');
      expect(result).toContain('v1.0.0');
    });

    it('accepts multi-digit version parts', () => {
      const result = getHelpUrl('RILL-R001', '10.20.30');
      expect(result).not.toBe('');
      expect(result).toContain('v10.20.30');
    });

    it('accepts leading zero in patch version', () => {
      const result = getHelpUrl('RILL-R001', '0.0.0');
      expect(result).not.toBe('');
      expect(result).toContain('v0.0.0');
    });

    it('accepts large version numbers', () => {
      const result = getHelpUrl('RILL-R001', '100.200.300');
      expect(result).not.toBe('');
      expect(result).toContain('v100.200.300');
    });
  });

  describe('URL structure validation', () => {
    it('URL starts with https://', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toMatch(/^https:\/\//);
    });

    it('URL contains GitHub domain', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('github.com/rcrsr/rill');
    });

    it('URL contains correct blob path', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('/blob/v');
    });

    it('URL contains error documentation file', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('docs/ref-errors.md#');
    });

    it('anchor is lowercased and complete', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toMatch(/#rill-r001$/);
    });
  });

  describe('case sensitivity', () => {
    it('converts uppercase error ID to lowercase in anchor', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('#rill-r001');
    });

    it('maintains uppercase in input validation', () => {
      // lowercase input should fail validation
      const result = getHelpUrl('rill-r001', '0.4.1');
      expect(result).toBe('');
    });

    it('does not convert version to lowercase', () => {
      const result = getHelpUrl('RILL-R001', '0.4.1');
      expect(result).toContain('v0.4.1');
    });
  });
});
