import type { RillFunction } from '../../../core/callable.js';
import type { RuntimeContext } from '../../../core/types/runtime.js';
import type { RillValue } from '../../../core/types/structures.js';
import { RuntimeError } from '../../../../types.js';
import { parseSignatureRegistration } from '../../../../signature-parser.js';
import { anyTypeValue, structureToTypeValue } from '../../../core/values.js';
import { ERROR_IDS } from '../../../../error-registry.js';
import { type RillMethod } from '../shared.js';

/** Receiver param prepended to every method's param list */
const RECEIVER_PARAM = {
  name: 'receiver',
  type: { kind: 'any' } as const,
  defaultValue: undefined,
  annotations: {},
} as const;

/**
 * Build a RillFunction entry from a method body and its signature string.
 * Wraps `method(receiver, args, ctx, location)` as `fn(args, ctx, location)`
 * where receiver is the first param by declaration order (named 'receiver').
 * Parses the signature to extract params and returnType so that task 1.4
 * can use them directly without re-parsing.
 *
 * Receiver missing from record raises RILL-R044.
 */
export function buildMethodEntry(
  name: string,
  signature: string,
  method: RillMethod,
  skipReceiverValidation?: boolean
): RillFunction {
  const parsed = parseSignatureRegistration(signature, name);
  const methodParams = parsed.params;
  return {
    params: [RECEIVER_PARAM, ...methodParams],
    fn: (args, ctx, location) => {
      if (!('receiver' in args)) {
        throw new RuntimeError(
          ERROR_IDS.RILL_R044,
          "Missing required parameter 'receiver'",
          location
        );
      }
      const receiver = args['receiver'] ?? null;
      // Reconstruct positional args array for RillMethod from named params in order.
      // UNVALIDATED_METHOD_PARAMS methods pass __positionalArgs to preserve actual
      // arg count so method body arity checks (args.length !== 1) fire correctly.
      const positionalArgs: RillValue[] =
        '__positionalArgs' in args
          ? (args['__positionalArgs'] as unknown as RillValue[])
          : methodParams.map((p) => args[p.name] ?? null);
      return method(receiver, positionalArgs, ctx as RuntimeContext, location);
    },
    annotations:
      parsed.description !== undefined
        ? { description: parsed.description }
        : {},
    returnType:
      parsed.returnType !== undefined
        ? structureToTypeValue(parsed.returnType)
        : anyTypeValue,
    ...(skipReceiverValidation ? { skipReceiverValidation: true } : {}),
  };
}

// Shared signatures for cross-type methods
export const SIG_LEN = '||:number';
export const SIG_EMPTY = '||:bool';
export const SIG_HEAD = '||:any';
export const SIG_TAIL = '||:any';
export const SIG_FIRST = '||:iterator';
export const SIG_AT = '|index: number|:any';
export const SIG_EQ = '|other: any|:bool';
export const SIG_NE = '|other: any|:bool';
export const SIG_CMP = '|other: any|:bool';
