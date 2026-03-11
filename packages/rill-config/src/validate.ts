import semver from 'semver';
import {
  BundleRestrictionError,
  ContextValidationError,
  RuntimeVersionError,
} from './errors.js';
import type { ContextBlock, RillConfigFile } from './types.js';

// ============================================================
// RUNTIME VERSION CHECK
// ============================================================

export function checkRuntimeVersion(
  constraint: string,
  installedVersion: string
): void {
  if (semver.validRange(constraint) === null) {
    throw new RuntimeVersionError(`Invalid runtime constraint: ${constraint}`);
  }
  if (!semver.satisfies(installedVersion, constraint)) {
    throw new RuntimeVersionError(
      `Runtime ${installedVersion} does not satisfy ${constraint}`
    );
  }
}

// ============================================================
// CONTEXT VALIDATION
// ============================================================

export function validateContext(
  context: ContextBlock
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(context.schema)) {
    if (!(key in context.values)) {
      throw new ContextValidationError(`Missing context value for key: ${key}`);
    }

    const value = context.values[key];
    const expectedType = context.schema[key]!.type;
    const actualType = getContextValueType(value);

    if (actualType !== expectedType) {
      throw new ContextValidationError(
        `Context ${key}: expected ${expectedType}, got ${actualType}`
      );
    }

    result[key] = value;
  }

  return result;
}

function getContextValueType(value: unknown): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  return typeof value;
}

// ============================================================
// BUNDLE RESTRICTIONS
// ============================================================

export function validateBundleRestrictions(config: RillConfigFile): void {
  if (config.extensions?.config !== undefined) {
    throw new BundleRestrictionError(
      'extensions.config must not be present at bundle time'
    );
  }
  if (config.context !== undefined) {
    throw new BundleRestrictionError(
      'context must not be present at bundle time'
    );
  }
}
