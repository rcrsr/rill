/**
 * fn Parameter Conversion
 *
 * Maps between the declared parameters of a callable (`RillParam`) and the
 * field definitions of an fn type (`RillFieldDef`). Unnamed parameters bind
 * `$` and `$@`, so a callable names them '$' and '@' while the type leaves
 * the name undefined.
 *
 * @internal
 */

import type { RillParam } from '../callable.js';
import type { RillFieldDef } from './structures.js';

/** Binding name of the first unnamed param (`$`). */
const PIPE_PARAM_NAME = '$';
/** Binding name of the second unnamed param (`$@`). */
const ACCUMULATOR_PARAM_NAME = '@';

/** Binding name of the unnamed param at `index`. */
function unnamedParamName(index: number): string {
  return index === 0 ? PIPE_PARAM_NAME : ACCUMULATOR_PARAM_NAME;
}

/** Convert callable params to fn type field definitions. */
export function paramsToFieldDefs(
  params: readonly RillParam[]
): RillFieldDef[] {
  return params.map((param): RillFieldDef => {
    const unnamed =
      param.name === PIPE_PARAM_NAME || param.name === ACCUMULATOR_PARAM_NAME;
    const field: RillFieldDef = {
      name: unnamed ? undefined : param.name,
      type: param.type ?? { kind: 'any' },
    };
    if (param.defaultValue !== undefined) {
      field.defaultValue = param.defaultValue;
    }
    if (Object.keys(param.annotations).length > 0) {
      field.annotations = param.annotations;
    }
    return field;
  });
}

/** Convert fn type field definitions to callable params. */
export function fieldDefsToParams(
  fields: readonly RillFieldDef[]
): RillParam[] {
  return fields.map((field, index): RillParam => ({
    name: field.name ?? unnamedParamName(index),
    type: field.type.kind === 'any' ? undefined : field.type,
    defaultValue: field.defaultValue,
    annotations: field.annotations ?? {},
  }));
}
