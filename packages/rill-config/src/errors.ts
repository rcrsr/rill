// ============================================================
// BASE ERROR CLASS
// ============================================================

export abstract class ConfigError extends Error {
  abstract readonly code: string;
}

// ============================================================
// CONFIG FILE ERRORS
// ============================================================

export class ConfigNotFoundError extends ConfigError {
  readonly code = 'CONFIG_NOT_FOUND' as const;
}

export class ConfigParseError extends ConfigError {
  readonly code = 'CONFIG_PARSE' as const;
}

export class ConfigEnvError extends ConfigError {
  readonly code = 'CONFIG_ENV' as const;
}

export class ConfigValidationError extends ConfigError {
  readonly code = 'CONFIG_VALIDATION' as const;
}

// ============================================================
// RUNTIME ERRORS
// ============================================================

export class RuntimeVersionError extends ConfigError {
  readonly code = 'RUNTIME_VERSION' as const;
}

// ============================================================
// EXTENSION ERRORS
// ============================================================

export class MountValidationError extends ConfigError {
  readonly code = 'MOUNT_VALIDATION' as const;
}

export class ExtensionLoadError extends ConfigError {
  readonly code = 'EXTENSION_LOAD' as const;
}

export class ExtensionVersionError extends ConfigError {
  readonly code = 'EXTENSION_VERSION' as const;
}

export class NamespaceMismatchError extends ConfigError {
  readonly code = 'NAMESPACE_MISMATCH' as const;
}

export class NamespaceCollisionError extends ConfigError {
  readonly code = 'NAMESPACE_COLLISION' as const;
}

// ============================================================
// CONTEXT AND BUNDLE ERRORS
// ============================================================

export class ContextValidationError extends ConfigError {
  readonly code = 'CONTEXT_VALIDATION' as const;
}

export class BundleRestrictionError extends ConfigError {
  readonly code = 'BUNDLE_RESTRICTION' as const;
}

// ============================================================
// HANDLER ERRORS
// ============================================================

export class HandlerArgError extends ConfigError {
  readonly code = 'HANDLER_ARG' as const;
}
