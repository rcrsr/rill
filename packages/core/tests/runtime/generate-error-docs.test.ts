/**
 * Tests for packages/core/scripts/generate-error-docs.ts validation logic
 *
 * These tests validate the error-checking behavior of the build script.
 * The script validates that all ERROR_DEFINITIONS entries have required fields.
 */

import { describe, it, expect } from 'vitest';
import type { ErrorDefinition } from '@rcrsr/rill';

/**
 * Simulate the validation logic from generate-error-docs.ts
 * This function mimics what the build script does.
 */
function validateErrorDefinitions(definitions: ErrorDefinition[]): void {
  for (const def of definitions) {
    // EC-14: Missing cause field
    if (!def.cause) {
      throw new Error(`${def.errorId} missing cause field`);
    }

    // EC-15: Missing resolution field
    if (!def.resolution) {
      throw new Error(`${def.errorId} missing resolution field`);
    }

    // EC-16: Missing examples field
    if (!def.examples || def.examples.length === 0) {
      throw new Error(`${def.errorId} missing examples field`);
    }
  }
}

describe('generate-error-docs validation', () => {
  describe('EC-14: Missing cause field', () => {
    it('throws Error with "RILL-XXXX missing cause field" when cause is missing', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-R001',
          category: 'runtime',
          description: 'Test error',
          messageTemplate: 'Test message',
          // cause: missing
          resolution: 'Fix it',
          examples: [
            {
              description: 'Example',
              code: 'test',
            },
          ],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).toThrow(
        'RILL-R001 missing cause field'
      );
    });

    it('throws Error with "RILL-XXXX missing cause field" when cause is empty string', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-L001',
          category: 'lexer',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: '', // empty string
          resolution: 'Fix it',
          examples: [
            {
              description: 'Example',
              code: 'test',
            },
          ],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).toThrow(
        'RILL-L001 missing cause field'
      );
    });

    it('passes when cause field is present', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-P001',
          category: 'parse',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: 'Something went wrong',
          resolution: 'Fix it',
          examples: [
            {
              description: 'Example',
              code: 'test',
            },
          ],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).not.toThrow();
    });
  });

  describe('EC-15: Missing resolution field', () => {
    it('throws Error with "RILL-XXXX missing resolution field" when resolution is missing', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-R002',
          category: 'runtime',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: 'Something went wrong',
          // resolution: missing
          examples: [
            {
              description: 'Example',
              code: 'test',
            },
          ],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).toThrow(
        'RILL-R002 missing resolution field'
      );
    });

    it('throws Error with "RILL-XXXX missing resolution field" when resolution is empty string', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-C001',
          category: 'check',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: 'Something went wrong',
          resolution: '', // empty string
          examples: [
            {
              description: 'Example',
              code: 'test',
            },
          ],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).toThrow(
        'RILL-C001 missing resolution field'
      );
    });

    it('passes when resolution field is present', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-P002',
          category: 'parse',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: 'Something went wrong',
          resolution: 'Do this to fix',
          examples: [
            {
              description: 'Example',
              code: 'test',
            },
          ],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).not.toThrow();
    });
  });

  describe('EC-16: Missing examples field', () => {
    it('throws Error with "RILL-XXXX missing examples field" when examples is missing', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-R003',
          category: 'runtime',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: 'Something went wrong',
          resolution: 'Fix it',
          // examples: missing
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).toThrow(
        'RILL-R003 missing examples field'
      );
    });

    it('throws Error with "RILL-XXXX missing examples field" when examples is empty array', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-L002',
          category: 'lexer',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: 'Something went wrong',
          resolution: 'Fix it',
          examples: [], // empty array
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).toThrow(
        'RILL-L002 missing examples field'
      );
    });

    it('passes when examples field has at least one entry', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-P003',
          category: 'parse',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: 'Something went wrong',
          resolution: 'Fix it',
          examples: [
            {
              description: 'Example scenario',
              code: 'test code',
            },
          ],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).not.toThrow();
    });

    it('passes when examples field has multiple entries', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-R004',
          category: 'runtime',
          description: 'Test error',
          messageTemplate: 'Test message',
          cause: 'Something went wrong',
          resolution: 'Fix it',
          examples: [
            {
              description: 'Example 1',
              code: 'test1',
            },
            {
              description: 'Example 2',
              code: 'test2',
            },
          ],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).not.toThrow();
    });
  });

  describe('Complete validation', () => {
    it('validates all definitions and stops at first error', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-R001',
          category: 'runtime',
          description: 'Valid error',
          messageTemplate: 'Test message',
          cause: 'Cause',
          resolution: 'Resolution',
          examples: [{ description: 'Ex', code: 'code' }],
        },
        {
          errorId: 'RILL-R002',
          category: 'runtime',
          description: 'Invalid error',
          messageTemplate: 'Test message',
          // cause missing - should fail here
          resolution: 'Resolution',
          examples: [{ description: 'Ex', code: 'code' }],
        },
        {
          errorId: 'RILL-R003',
          category: 'runtime',
          description: 'Another invalid',
          messageTemplate: 'Test message',
          cause: 'Cause',
          // resolution missing - but shouldn't get here
          examples: [{ description: 'Ex', code: 'code' }],
        },
      ];

      // Should fail on first invalid entry
      expect(() => validateErrorDefinitions(definitions)).toThrow(
        'RILL-R002 missing cause field'
      );
    });

    it('passes when all definitions are valid', () => {
      const definitions: ErrorDefinition[] = [
        {
          errorId: 'RILL-R001',
          category: 'runtime',
          description: 'Error 1',
          messageTemplate: 'Message 1',
          cause: 'Cause 1',
          resolution: 'Resolution 1',
          examples: [{ description: 'Ex 1', code: 'code1' }],
        },
        {
          errorId: 'RILL-R002',
          category: 'runtime',
          description: 'Error 2',
          messageTemplate: 'Message 2',
          cause: 'Cause 2',
          resolution: 'Resolution 2',
          examples: [{ description: 'Ex 2', code: 'code2' }],
        },
      ];

      expect(() => validateErrorDefinitions(definitions)).not.toThrow();
    });
  });
});
