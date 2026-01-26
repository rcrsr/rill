/**
 * Configuration Loader for rill-check
 * Loads and validates .rill-check.json configuration files.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckConfig, RuleState, Severity } from './types.js';
import { VALIDATION_RULES } from './rules/index.js';

// ============================================================
// CONSTANTS
// ============================================================

/** Configuration file name */
const CONFIG_FILE_NAME = '.rill-check.json';

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

/**
 * Create default configuration with all rules enabled.
 * Returns configuration where all known rules are set to 'on'.
 */
export function createDefaultConfig(): CheckConfig {
  const rules: Record<string, RuleState> = {};
  const severity: Record<string, Severity> = {};

  for (const rule of VALIDATION_RULES) {
    rules[rule.code] = 'on';
    severity[rule.code] = rule.severity;
  }

  return { rules, severity };
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate that a value is a valid RuleState.
 */
function isRuleState(value: unknown): value is RuleState {
  return value === 'on' || value === 'off' || value === 'warn';
}

/**
 * Validate that a value is a valid Severity.
 */
function isSeverity(value: unknown): value is Severity {
  return value === 'error' || value === 'warning' || value === 'info';
}

/**
 * Validate configuration structure and values.
 * Throws Error if configuration is invalid.
 */
function validateConfig(data: unknown): asserts data is {
  rules?: Record<string, unknown>;
  severity?: Record<string, unknown>;
} {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid configuration: must be an object');
  }

  const config = data as Record<string, unknown>;

  // Validate rules field if present
  if ('rules' in config) {
    if (
      typeof config['rules'] !== 'object' ||
      config['rules'] === null ||
      Array.isArray(config['rules'])
    ) {
      throw new Error('Invalid configuration: rules must be an object');
    }

    const rules = config['rules'] as Record<string, unknown>;
    for (const [code, state] of Object.entries(rules)) {
      if (!isRuleState(state)) {
        throw new Error(
          `Invalid configuration: rule ${code} has invalid state "${state}" (must be 'on', 'off', or 'warn')`
        );
      }
    }
  }

  // Validate severity field if present
  if ('severity' in config) {
    if (
      typeof config['severity'] !== 'object' ||
      config['severity'] === null ||
      Array.isArray(config['severity'])
    ) {
      throw new Error('Invalid configuration: severity must be an object');
    }

    const severity = config['severity'] as Record<string, unknown>;
    for (const [code, sev] of Object.entries(severity)) {
      if (!isSeverity(sev)) {
        throw new Error(
          `Invalid configuration: rule ${code} has invalid severity "${sev}" (must be 'error', 'warning', or 'info')`
        );
      }
    }
  }
}

/**
 * Validate that all rule codes in config are known rules.
 * Throws Error if unknown rule code found.
 */
function validateRuleCodes(config: CheckConfig): void {
  const knownRules = new Set(VALIDATION_RULES.map((r) => r.code));

  // Check rules field
  for (const code of Object.keys(config.rules)) {
    if (!knownRules.has(code)) {
      throw new Error(`Invalid configuration: unknown rule ${code}`);
    }
  }

  // Check severity field
  for (const code of Object.keys(config.severity)) {
    if (!knownRules.has(code)) {
      throw new Error(`Invalid configuration: unknown rule ${code}`);
    }
  }
}

// ============================================================
// CONFIGURATION LOADING
// ============================================================

/**
 * Load configuration from .rill-check.json in the specified directory.
 *
 * @param cwd - Directory to search for configuration file
 * @returns CheckConfig object, or null if file not found
 * @throws Error with "Invalid configuration: {reason}" if JSON is invalid [EC-3]
 * @throws Error with "Invalid configuration: unknown rule {code}" if unknown rule [EC-4]
 */
export function loadConfig(cwd: string): CheckConfig | null {
  const configPath = join(cwd, CONFIG_FILE_NAME);

  // Return null if file not found (not an error)
  if (!existsSync(configPath)) {
    return null;
  }

  let fileContent: string;
  try {
    fileContent = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Invalid configuration: failed to read file (${err instanceof Error ? err.message : String(err)})`
    );
  }

  // Parse JSON
  let parsedData: unknown;
  try {
    parsedData = JSON.parse(fileContent);
  } catch (err) {
    throw new Error(
      `Invalid configuration: invalid JSON (${err instanceof Error ? err.message : String(err)})`
    );
  }

  // Validate structure
  validateConfig(parsedData);

  // Get defaults
  const defaults = createDefaultConfig();

  // Merge with defaults (parsedData is validated, so we can safely cast)
  const rules = {
    ...defaults.rules,
    ...(parsedData.rules as Record<string, RuleState> | undefined),
  };
  const severity = {
    ...defaults.severity,
    ...(parsedData.severity as Record<string, Severity> | undefined),
  };

  const config: CheckConfig = { rules, severity };

  // Validate rule codes
  validateRuleCodes(config);

  return config;
}
