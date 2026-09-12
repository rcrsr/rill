/**
 * Public policy surface, re-exported from `src/index.ts`.
 *
 * Only what a host or a downstream package consumes belongs here. The
 * internal wiring — identity branding, transform execution and the
 * per-context resolver registry — is imported directly from its module
 * by the one or two call sites that need it, so it stays off the public
 * surface and out of the barrel.
 */

export type {
  ExtensionIdentity,
  ExtensionMethodPolicy,
  Filter,
  FilterResolver,
  MethodPolicyRule,
  PolicyConfig,
  ResolvedPolicy,
} from './types.js';
export { createConfigFilterResolver } from './resolve.js';
export { resolvePolicy } from './config-resolver.js';
export { getExtensionIdentity } from './identity.js';
