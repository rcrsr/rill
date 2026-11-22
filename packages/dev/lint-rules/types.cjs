/**
 * Shared JSDoc types for the rule files.
 *
 * oxlint exports its plugin types only through `RuleTester` in
 * `oxlint/plugins-dev`, so the names below are derived from its `run`
 * signature. Rule files import them with `import('./types.cjs').Name`.
 * The file holds no runtime code and exports nothing at runtime.
 *
 * @typedef {import('oxlint/plugins-dev').RuleTester} RuleTester
 * @typedef {Parameters<RuleTester['run']>[1]} AnyRule
 * @typedef {Extract<AnyRule, { create: unknown }>} Rule
 * @typedef {Parameters<Rule['create']>[0]} Context
 * @typedef {ReturnType<Rule['create']>} Visitor
 * @typedef {Parameters<RuleTester['run']>[2]} TestCases
 * @typedef {RuleTester.InvalidTestCase} InvalidTestCase
 * @typedef {RuleTester.ValidTestCase} ValidTestCase
 */

/**
 * The node type a visitor key receives, such as `NodeOf<'CallExpression'>`.
 *
 * @template {string} K
 * @typedef {Parameters<NonNullable<Visitor[K]>>[0]} NodeOf
 */

/** @typedef {NodeOf<'Program'>} Program */

/** @typedef {NodeOf<'BlockStatement'>['body'][number]} Statement */

// Empty: the typedefs above need a module body. knip.json lists this file
// as an entry, so the unused export is not reported.
module.exports = {};
