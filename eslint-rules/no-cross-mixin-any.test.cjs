/**
 * Tests for no-cross-mixin-any ESLint rule
 */

const { RuleTester } = require('eslint');
const rule = require('./no-cross-mixin-any.cjs');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: require('@typescript-eslint/parser'),
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

ruleTester.run('no-cross-mixin-any', rule, {
  valid: [
    // AC-13: Non-`this`, non-`evaluator` expression — must not trigger
    {
      code: 'const x = value as any',
    },
    {
      code: 'const x = other as any',
    },
    // Correct cast target — not `any`
    {
      code: 'const x = this as EvaluatorInterface',
    },
    {
      code: 'const x = evaluator as EvaluatorInterface',
    },
    // Variable annotation using `any` — not a TSAsExpression
    {
      code: 'let x: any = 42',
    },
  ],

  invalid: [
    // EC-1: (this as any) with member call
    {
      code: 'const x = (this as any).foo()',
      errors: [{ messageId: 'crossMixinAny' }],
    },
    // EC-1: (this as any) with property access (no call)
    {
      code: 'const x = (this as any).foo',
      errors: [{ messageId: 'crossMixinAny' }],
    },
    // EC-1: (evaluator as any) with member call
    {
      code: 'const x = (evaluator as any).bar()',
      errors: [{ messageId: 'crossMixinAny' }],
    },
    // EC-1: Nested — await (this as any).method(args)
    {
      code: 'async function f() { await (this as any).method(args) }',
      errors: [{ messageId: 'crossMixinAny' }],
    },
  ],
});

console.log('All tests passed!');
