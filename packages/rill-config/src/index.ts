// ============================================================
// DATA MODEL TYPES
// ============================================================
export type {
  ExtensionManifest,
  RillConfigFile,
  ExtensionsBlock,
  ContextBlock,
  ContextFieldSchema,
  HostBlock,
  ResolvedMount,
  LoadedProject,
  ResolverConfig,
  ProjectResult,
  HandlerIntrospection,
  HandlerParam,
} from './types.js';

// ============================================================
// CONFIG RESOLUTION AND PARSING
// ============================================================
export { resolveConfigPath } from './resolve.js';
export { parseConfig } from './parse.js';

// ============================================================
// VALIDATION
// ============================================================
export {
  checkRuntimeVersion,
  validateContext,
  validateBundleRestrictions,
} from './validate.js';

// ============================================================
// MOUNT RESOLUTION AND COLLISION DETECTION
// ============================================================
export { resolveMounts, detectNamespaceCollisions } from './mounts.js';

// ============================================================
// EXTENSION LOADER
// ============================================================
export { loadExtensions } from './loader.js';

// ============================================================
// BINDINGS
// ============================================================
export { buildExtensionBindings, buildContextBindings } from './bindings.js';

// ============================================================
// RESOLVERS
// ============================================================
export { buildResolvers } from './resolvers.js';

// ============================================================
// PROJECT LOADER
// ============================================================
export { loadProject } from './project.js';

// ============================================================
// HANDLER
// ============================================================
export {
  parseMainField,
  introspectHandler,
  marshalCliArgs,
} from './handler.js';

// ============================================================
// ERROR CLASSES
// ============================================================
export {
  ConfigError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigEnvError,
  ConfigValidationError,
  RuntimeVersionError,
  MountValidationError,
  ExtensionLoadError,
  ExtensionVersionError,
  ExtensionBindingError,
  NamespaceCollisionError,
  ContextValidationError,
  BundleRestrictionError,
  HandlerArgError,
} from './errors.js';
