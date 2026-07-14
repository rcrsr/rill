/**
 * Rules data-model types for the rill language service.
 * These are plain-data shapes describing diagnostics, rule configuration,
 * and the validation-rule contract used by the checker.
 */

import type {
  ASTNode,
  NodeType,
  SourceLocation,
  SourceSpan,
} from '@rcrsr/rill';
import type { AstFacts } from './facts.js';

// ============================================================
// SEVERITY AND RULE STATE
// ============================================================

/** Diagnostic severity levels. */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** Rule state configuration. */
export type RuleState = 'on' | 'off' | 'warn';

// ============================================================
// DIAGNOSTIC DATA
// ============================================================

/**
 * Fix suggestion for a diagnostic.
 * Provides automated fix information that can be applied to source code.
 * Only NAMING_SNAKE_CASE and UNNECESSARY_ASSERTION ever emit a non-null fix.
 */
export interface DiagnosticFix {
  /** Human-readable description of what the fix does. */
  readonly description: string;
  /** Whether the fix can be safely applied automatically. */
  readonly applicable: boolean;
  /** Source range to replace. */
  readonly range: SourceSpan;
  /** Replacement text. */
  readonly replacement: string;
}

/**
 * A single diagnostic issue found during validation.
 * Represents errors, warnings, or informational messages from static analysis.
 */
export interface Diagnostic {
  /** Rule code (e.g., NAMING_SNAKE_CASE). */
  readonly code: string;
  /** Human-readable description. */
  readonly message: string;
  /** Severity level. */
  readonly severity: DiagnosticSeverity;
  /** Location of the issue in source; anchor is 1-based `span.start`. */
  readonly location: SourceLocation;
  /** Source line containing the issue. */
  readonly context: string;
  /** Optional automatic fix. */
  readonly fix: DiagnosticFix | null;
}

// ============================================================
// CHECK CONFIGURATION
// ============================================================

/**
 * Configuration for check rules and severity overrides.
 * Controls which rules are active and at what severity level.
 */
export interface CheckConfig {
  /** Per-rule enable/disable/warn state. */
  readonly rules: Record<string, RuleState>;
  /**
   * Type checker mode controlling UseExpr validation strictness.
   * - 'strict': variable/computed use<> and untyped host references are errors
   * - 'permissive': same conditions produce warnings (default when undefined)
   */
  readonly checkerMode?: 'strict' | 'permissive' | undefined;
  /** Global severity override applied across all rules. */
  readonly severity?: DiagnosticSeverity | undefined;
}

// ============================================================
// VALIDATION ERRORS
// ============================================================

/** A structured error returned by config/rule-code validation. */
export interface ValidationError {
  readonly code: string;
  readonly message: string;
  readonly ruleCode?: string | undefined;
}

// ============================================================
// RULE CONTEXT
// ============================================================

/**
 * Context threaded through rule validation during a single check pass.
 * Carries the raw source, the engine-owned capture tracker, and the
 * traversal-populated set of type-asserted host calls.
 */
export interface RuleContext {
  /** Original source text. */
  readonly source: string;
  /** Variable definitions for collision detection. */
  readonly variables: Map<string, SourceLocation>;
  /** Closure scope IDs for variables (maps variable name to closure AST node). */
  readonly variableScopes: Map<string, ASTNode | null>;
  /** Current closure scope stack during traversal. */
  readonly scopeStack: ASTNode[];
  /** HostCall nodes that are wrapped in type assertions. */
  readonly assertedHostCalls: Set<ASTNode>;
  /** Resolved type checker mode; undefined is treated as permissive. */
  readonly checkerMode?: 'strict' | 'permissive' | undefined;
  /** Precomputed single-pass AST facts (subtree booleans, capture log, stream maps). */
  readonly facts: AstFacts;
}

// ============================================================
// VALIDATION RULES
// ============================================================

/**
 * Validation rule contract.
 * Rules are stateless from the registry's perspective - all mutable
 * tracking state lives on RuleContext. Rules return diagnostics, never throw.
 */
export interface Rule {
  /** Unique rule code (e.g., NAMING_SNAKE_CASE). */
  readonly code: string;
  /** Node types this rule applies to. */
  readonly nodeTypes: readonly NodeType[];
  /** Default severity level. */
  readonly defaultSeverity: DiagnosticSeverity;
  /**
   * Validate a node, returning diagnostics for violations.
   * Called for each node matching nodeTypes.
   */
  validate(node: ASTNode, context: RuleContext): Diagnostic[];
}
