/**
 * Check Module - Static Analysis for rill
 * Public API for rill-check tool.
 */

// ============================================================
// PUBLIC TYPES
// ============================================================
export type {
  ValidationRule,
  RuleCategory,
  Severity,
  RuleState,
  Diagnostic,
  Fix,
  CheckConfig,
  ValidationContext,
  FixContext,
} from './types.js';

// ============================================================
// RULE REGISTRY
// ============================================================
export { VALIDATION_RULES } from './rules/index.js';

// ============================================================
// CONFIGURATION
// ============================================================
export { loadConfig, createDefaultConfig } from './config.js';

// ============================================================
// VALIDATION
// ============================================================
export { validateScript } from './validator.js';

// ============================================================
// FIX APPLICATION
// ============================================================
export { applyFixes, type ApplyResult } from './fixer.js';
