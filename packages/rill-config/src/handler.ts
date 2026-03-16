import type { ScriptCallable } from '@rcrsr/rill';
import { ConfigValidationError, HandlerArgError } from './errors.js';
import type { HandlerIntrospection, HandlerParam } from './types.js';

// ============================================================
// MAIN FIELD PARSING
// ============================================================

export function parseMainField(main: string): {
  filePath: string;
  handlerName?: string;
} {
  const colonIndex = main.indexOf(':');

  if (colonIndex === -1) {
    if (main.length === 0) {
      throw new ConfigValidationError('main field has empty file path');
    }
    return { filePath: main };
  }

  const filePath = main.slice(0, colonIndex);
  const handlerName = main.slice(colonIndex + 1);

  if (filePath.length === 0) {
    throw new ConfigValidationError('main field has empty file path');
  }
  if (handlerName.length === 0) {
    throw new ConfigValidationError('main field has empty handler name');
  }

  return { filePath, handlerName };
}

// ============================================================
// HANDLER INTROSPECTION
// ============================================================

/**
 * Extract handler metadata from a ScriptCallable.
 * Reads closure-level and parameter-level annotations for description fields.
 * A param is required when its defaultValue is undefined.
 */
export function introspectHandler(
  closure: ScriptCallable
): HandlerIntrospection {
  const closureDesc = closure.annotations['description'];
  const description = typeof closureDesc === 'string' ? closureDesc : undefined;

  const params: HandlerParam[] = closure.params.map((param) => {
    const paramDesc = param.annotations?.['description'];

    const entry: HandlerParam = {
      name: param.name,
      type: param.type !== undefined ? param.type.kind : 'any',
      required: param.defaultValue === undefined,
      ...(typeof paramDesc === 'string'
        ? { description: paramDesc }
        : undefined),
      ...(param.defaultValue !== undefined
        ? { defaultValue: param.defaultValue }
        : undefined),
    };

    return entry;
  });

  return description !== undefined ? { description, params } : { params };
}

// ============================================================
// CLI ARG MARSHALLING
// ============================================================

/**
 * Map CLI flag string values to typed handler parameters.
 * Coerces types per param.type; throws HandlerArgError on failures.
 */
export function marshalCliArgs(
  args: Record<string, string>,
  params: ReadonlyArray<HandlerParam>
): Record<string, unknown> {
  const paramsByName = new Map<string, HandlerParam>();
  for (const param of params) {
    paramsByName.set(param.name, param);
  }

  // Check for unknown flags
  for (const name of Object.keys(args)) {
    if (!paramsByName.has(name)) {
      throw new HandlerArgError(`Unknown parameter: ${name}`);
    }
  }

  const result: Record<string, unknown> = {};

  for (const param of params) {
    const raw = args[param.name];

    if (raw === undefined) {
      if (param.required) {
        throw new HandlerArgError(
          `Required parameter ${param.name} not provided`
        );
      }
      // Optional params with no value use their default (not included in result)
      continue;
    }

    const type = param.type;

    if (type === 'number') {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new HandlerArgError(
          `Parameter ${param.name}: cannot convert '${raw}' to number`
        );
      }
      result[param.name] = n;
    } else if (type === 'bool') {
      // Presence of flag = true; absence handled above
      result[param.name] = true;
    } else if (type === 'dict' || type === 'list') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new HandlerArgError(
          `Parameter ${param.name}: cannot convert '${raw}' to ${type}`
        );
      }
      result[param.name] = parsed;
    } else {
      // string or any
      result[param.name] = raw;
    }
  }

  return result;
}
