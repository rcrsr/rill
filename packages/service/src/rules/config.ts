/**
 * Pure config helpers for the rules engine.
 * Builds the all-rules-on default configuration and validates configs and
 * rule-code lists against the known rule set. Every function here is pure
 * and return-based: invalid input produces a `ValidationError[]`, never a
 * thrown exception.
 */

import type {
  CheckConfig,
  DiagnosticSeverity,
  RuleState,
  ValidationError,
} from './types.js';
import { RULES } from './rules.js';

// ============================================================
// TYPE GUARDS
// ============================================================

const RULE_STATES: readonly RuleState[] = ['on', 'off', 'warn'];
const CHECKER_MODES = ['strict', 'permissive'] as const;
const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = [
  'error',
  'warning',
  'info',
];

function isRuleState(value: unknown): value is RuleState {
  return (
    typeof value === 'string' &&
    (RULE_STATES as readonly string[]).includes(value)
  );
}

function isCheckerMode(value: unknown): value is 'strict' | 'permissive' {
  return (
    typeof value === 'string' &&
    (CHECKER_MODES as readonly string[]).includes(value)
  );
}

function isDiagnosticSeverity(value: unknown): value is DiagnosticSeverity {
  return (
    typeof value === 'string' &&
    (DIAGNOSTIC_SEVERITIES as readonly string[]).includes(value)
  );
}

// ============================================================
// KNOWN RULE CODES
// ============================================================

function getKnownRuleCodes(): Set<string> {
  return new Set(RULES.map((rule) => rule.code));
}

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

/**
 * Create the default configuration: every known rule set to 'on',
 * `checkerMode` left undefined (treated as permissive by rules that read
 * it).
 */
export function createDefaultConfig(): CheckConfig {
  const rules: Record<string, RuleState> = {};
  for (const rule of RULES) {
    rules[rule.code] = 'on';
  }
  return { rules };
}

// ============================================================
// CONFIG VALIDATION
// ============================================================

/**
 * Validate a `CheckConfig`: every rules-map key must be a known rule code,
 * every rule state must be 'on'/'off'/'warn', `checkerMode` (if present)
 * must be 'strict'/'permissive', and `severity` (if present) must be
 * 'error'/'warning'/'info'. Returns every problem found, or `null` when
 * the config is clean. Never throws.
 */
export function validateConfig(config: CheckConfig): ValidationError[] | null {
  const errors: ValidationError[] = [];

  if (config === null || typeof config !== 'object') {
    return [{ code: 'INVALID_CONFIG', message: 'config must be an object' }];
  }

  const knownCodes = getKnownRuleCodes();
  const rulesMap: unknown = config.rules;

  if (typeof rulesMap === 'object' && rulesMap !== null) {
    for (const [code, state] of Object.entries(
      rulesMap as Record<string, unknown>
    )) {
      if (!knownCodes.has(code)) {
        errors.push({
          code: 'UNKNOWN_RULE_CODE',
          message: `unknown rule code: ${code}`,
          ruleCode: code,
        });
        continue;
      }
      if (!isRuleState(state)) {
        errors.push({
          code: 'INVALID_RULE_STATE',
          message: `rule ${code} has invalid state: ${String(state)}`,
          ruleCode: code,
        });
      }
    }
  } else {
    errors.push({
      code: 'INVALID_RULES_MAP',
      message: 'rules must be an object mapping rule codes to rule states',
    });
  }

  if (config.checkerMode !== undefined && !isCheckerMode(config.checkerMode)) {
    errors.push({
      code: 'INVALID_CHECKER_MODE',
      message: `invalid checker mode: ${String(config.checkerMode)}`,
    });
  }

  if (config.severity !== undefined && !isDiagnosticSeverity(config.severity)) {
    errors.push({
      code: 'INVALID_SEVERITY',
      message: `invalid severity: ${String(config.severity)}`,
    });
  }

  return errors.length > 0 ? errors : null;
}

// ============================================================
// RULE CODE VALIDATION
// ============================================================

/**
 * Validate a list of rule codes against the known rule set. Returns a
 * `ValidationError` naming each unknown code, or `null` when every code is
 * known. Never throws.
 */
export function validateRuleCodes(
  codes: readonly string[]
): ValidationError[] | null {
  const knownCodes = getKnownRuleCodes();
  const errors: ValidationError[] = [];

  for (const code of codes) {
    if (!knownCodes.has(code)) {
      errors.push({
        code: 'UNKNOWN_RULE_CODE',
        message: `unknown rule code: ${code}`,
        ruleCode: code,
      });
    }
  }

  return errors.length > 0 ? errors : null;
}
