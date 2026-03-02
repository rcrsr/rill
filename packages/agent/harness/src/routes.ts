/**
 * HTTP route definitions for rill-host.
 *
 * Route registration logic lives in ./http/routes.ts.
 * Input-validation helpers live in ./core/input.ts.
 * This module re-exports both for backward compatibility.
 */

// ============================================================
// INPUT VALIDATION (backward-compat re-exports)
// ============================================================
export type { InputValidationIssue } from './core/input.js';
export { validateInputParams, injectDefaults } from './core/input.js';

// ============================================================
// HTTP ROUTES
// ============================================================
export type {
  SseEvent,
  SseStore,
  InputValidationErrorBody,
  RouteHost,
} from './http/routes.js';
export { registerRoutes } from './http/routes.js';
