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

import noBannedSyntax from './no-banned-syntax.cjs';
import noDictBracketAssign from './no-dict-bracket-assign.cjs';
import noDuplicateErrorId from './no-duplicate-error-id.cjs';
import noNewRuntimeError from './no-new-runtime-error.cjs';
import noSpecIdReference from './no-spec-id-reference.cjs';
import rethrowControlSignal from './rethrow-control-signal.cjs';
import useHaltHelpers from './use-halt-helpers.cjs';

export default {
  meta: {
    name: 'rill',
  },
  rules: {
    'no-banned-syntax': noBannedSyntax,
    'no-dict-bracket-assign': noDictBracketAssign,
    'no-duplicate-error-id': noDuplicateErrorId,
    'no-new-runtime-error': noNewRuntimeError,
    'no-spec-id-reference': noSpecIdReference,
    'rethrow-control-signal': rethrowControlSignal,
    'use-halt-helpers': useHaltHelpers,
  },
};
