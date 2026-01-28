/**
 * Check Types
 * Type definitions for the rill-check static analysis tool.
 */

import type {
  SourceLocation,
  SourceSpan,
  ScriptNode,
  NodeType,
  ASTNode,
} from '../types.js';

// ============================================================
// SEVERITY AND RULE STATE
// ============================================================

/** Diagnostic severity levels */
export type Severity = 'error' | 'warning' | 'info';

/** Rule state configuration */
export type RuleState = 'on' | 'off' | 'warn';

// ============================================================
// DIAGNOSTIC DATA
// ============================================================

/**
 * Fix suggestion for a diagnostic.
 * Provides automated fix information that can be applied to source code.
 */
export interface Fix {
  /** Human-readable description of what the fix does */
  readonly description: string;
  /** Whether the fix can be safely applied automatically */
  readonly applicable: boolean;
  /** Source range to replace */
  readonly range: SourceSpan;
  /** Replacement text */
  readonly replacement: string;
}

/**
 * A single diagnostic issue found during validation.
 * Represents errors, warnings, or informational messages from static analysis.
 */
export interface Diagnostic {
  /** Location of the issue in source */
  readonly location: SourceLocation;
  /** Severity level */
  readonly severity: Severity;
  /** Rule code (e.g., NAMING_SNAKE_CASE) */
  readonly code: string;
  /** Human-readable description */
  readonly message: string;
  /** Source line containing the issue */
  readonly context: string;
  /** Optional automatic fix */
  readonly fix: Fix | null;
}

// ============================================================
// CHECK CONFIGURATION
// ============================================================

/**
 * Configuration for check rules and severity overrides.
 * Controls which rules are active and at what severity level.
 */
export interface CheckConfig {
  /** Per-rule enable/disable/warn state */
  readonly rules: Record<string, RuleState>;
  /** Severity overrides by rule code */
  readonly severity: Record<string, Severity>;
}

// ============================================================
// VALIDATION CONTEXT
// ============================================================

/**
 * Context for validation passes.
 * Tracks source, AST, configuration, and accumulated diagnostics.
 */
export interface ValidationContext {
  /** Original source text */
  readonly source: string;
  /** Parsed AST */
  readonly ast: ScriptNode;
  /** Active configuration */
  readonly config: CheckConfig;
  /** Accumulated diagnostics */
  readonly diagnostics: Diagnostic[];
  /** Variable definitions for collision detection */
  readonly variables: Map<string, SourceLocation>;
  /** HostCall nodes that are wrapped in type assertions */
  readonly assertedHostCalls: Set<ASTNode>;
}

/**
 * Context for fix generation.
 * Provides access to source and AST for computing fix replacements.
 */
export interface FixContext {
  /** Original source text */
  readonly source: string;
  /** Parsed AST */
  readonly ast: ScriptNode;
}

// ============================================================
// VALIDATION RULES
// ============================================================

/** Rule category for grouping and organization */
export type RuleCategory =
  | 'naming'
  | 'flow'
  | 'collections'
  | 'loops'
  | 'conditionals'
  | 'closures'
  | 'types'
  | 'strings'
  | 'errors'
  | 'formatting'
  | 'anti-patterns';

/**
 * Validation rule interface.
 * Rules are stateless - all context passed via ValidationContext.
 * Rules return diagnostics, never throw.
 * fix() must preserve semantics (no behavior changes).
 */
export interface ValidationRule {
  /** Unique rule code (e.g., NAMING_SNAKE_CASE) */
  readonly code: string;

  /** Rule category for grouping */
  readonly category: RuleCategory;

  /** Default severity level */
  readonly severity: Severity;

  /** Node types this rule applies to */
  readonly nodeTypes: NodeType[];

  /**
   * Validate a node, returning diagnostics for violations.
   * Called for each node matching nodeTypes.
   */
  validate(node: ASTNode, context: ValidationContext): Diagnostic[];

  /**
   * Optionally generate a fix for a diagnostic.
   * Returns null if fix not applicable.
   */
  fix?(node: ASTNode, context: FixContext): Fix | null;
}
