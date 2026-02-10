/**
 * Tests for no-duplicate-error-id ESLint rule
 */

const { RuleTester } = require('eslint');
const rule = require('./no-duplicate-error-id.cjs');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('no-duplicate-error-id', rule, {
  valid: [
    // AC-4: Valid RuntimeError without duplicate ID
    {
      code: "new RuntimeError('RILL-R001', 'Variable not defined')",
    },
    {
      code: "RuntimeError.fromNode('RILL-R002', 'Type mismatch', node)",
    },
    // EC-5: Non-RuntimeError throw (should be ignored)
    {
      code: "throw new Error('RILL-R001: Some error')",
    },
    {
      code: "throw new TypeError('RILL-R001: Type error')",
    },
    // EC-6: Dynamic error ID (variable)
    {
      code: "new RuntimeError(errorId, 'RILL-R001: Message')",
    },
    {
      code: "RuntimeError.fromNode(myErrorId, 'RILL-R002: Message', node)",
    },
    // EC-7: Template literal with expression
    {
      code: "new RuntimeError('RILL-R001', `${prefix}: Message`)",
    },
    // Valid template literal without duplicate
    {
      code: "new RuntimeError('RILL-R001', `Variable ${name} not found`)",
    },
  ],

  invalid: [
    // EC-3: Pattern-1 violation detected (string literal)
    {
      code: "new RuntimeError('RILL-R001', 'RILL-R001: Variable not defined')",
      errors: [
        {
          messageId: 'duplicateErrorId',
          data: { errorId: 'RILL-R001' },
        },
      ],
      output: "new RuntimeError('RILL-R001', 'Variable not defined')",
    },
    // EC-3: Pattern-1 violation detected (RuntimeError.fromNode)
    {
      code: "RuntimeError.fromNode('RILL-R002', 'RILL-R002: Type mismatch', node)",
      errors: [
        {
          messageId: 'duplicateErrorId',
          data: { errorId: 'RILL-R002' },
        },
      ],
      output: "RuntimeError.fromNode('RILL-R002', 'Type mismatch', node)",
    },
    // AC-4: Auto-fix strips error ID prefix (template literal)
    {
      code: "new RuntimeError('RILL-R003', `RILL-R003: Timeout after ${ms}ms`)",
      errors: [
        {
          messageId: 'duplicateErrorId',
          data: { errorId: 'RILL-R003' },
        },
      ],
      output: "new RuntimeError('RILL-R003', `Timeout after ${ms}ms`)",
    },
    // Multiple violations in same file
    {
      code: `
        new RuntimeError('RILL-R001', 'RILL-R001: Error 1');
        RuntimeError.fromNode('RILL-R002', 'RILL-R002: Error 2', node);
      `,
      errors: [
        {
          messageId: 'duplicateErrorId',
          data: { errorId: 'RILL-R001' },
        },
        {
          messageId: 'duplicateErrorId',
          data: { errorId: 'RILL-R002' },
        },
      ],
      output: `
        new RuntimeError('RILL-R001', 'Error 1');
        RuntimeError.fromNode('RILL-R002', 'Error 2', node);
      `,
    },
  ],
});

console.log('All tests passed!');
