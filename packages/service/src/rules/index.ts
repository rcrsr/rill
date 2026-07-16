/**
 * Rules Module
 * Exports the rule registry, config helpers, and the rules engine
 * orchestrator. Importing this barrel triggers every rule module's
 * self-registration, so `RULES` is fully populated as soon as the barrel
 * is imported.
 */

// ============================================================
// RULE REGISTRY
// ============================================================
export { RULES } from './rules.js';

// ============================================================
// CONFIG HELPERS
// ============================================================
export {
  createDefaultConfig,
  validateConfig,
  validateRuleCodes,
} from './config.js';

// ============================================================
// RULES ENGINE
// ============================================================
export { runRules } from './run-rules.js';

// ============================================================
// AST FACTS
// ============================================================
export { capturesInSubtree } from './facts.js';
export type {
  AstFacts,
  CaptureEntry,
  ScriptFacts,
  SubtreeFacts,
} from './facts.js';

// ============================================================
// RULE TYPES
// ============================================================
export type {
  CheckConfig,
  Diagnostic,
  DiagnosticFix,
  DiagnosticSeverity,
  Rule,
  RuleCategory,
  RuleContext,
  RuleState,
  ValidationError,
} from './types.js';
