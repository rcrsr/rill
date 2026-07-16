/**
 * rill oxlint plugin
 *
 * Bundles the project's custom lint rules for oxlint's JS plugin API
 * (ESLint-compatible). The rule bodies live in sibling `.cjs` files and use
 * the standard ESLint rule shape (`meta` + `create(context)` returning AST
 * visitors), which oxlint executes unchanged.
 *
 * Referenced from `.oxlintrc.json` via `jsPlugins`. The `meta.name` becomes the
 * rule namespace, so rules resolve as `rill/no-duplicate-error-id`.
 */

import noDuplicateErrorId from './no-duplicate-error-id.cjs';

export default {
  meta: {
    name: 'rill',
  },
  rules: {
    'no-duplicate-error-id': noDuplicateErrorId,
  },
};
