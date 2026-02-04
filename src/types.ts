/**
 * Rill AST Types
 * Based on docs/grammar.ebnf
 */

import { VERSION } from './generated/version-data.js';

// ============================================================
// SOURCE LOCATION
// ============================================================

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface SourceSpan {
  readonly start: SourceLocation;
  readonly end: SourceLocation;
}

// ============================================================
// ERROR HIERARCHY
// ============================================================

/** Error codes for programmatic handling */
export const RILL_ERROR_CODES = {
  // Parse errors
  PARSE_UNEXPECTED_TOKEN: 'PARSE_UNEXPECTED_TOKEN',
  PARSE_INVALID_SYNTAX: 'PARSE_INVALID_SYNTAX',
  PARSE_INVALID_TYPE: 'PARSE_INVALID_TYPE',

  // Runtime errors
  RUNTIME_UNDEFINED_VARIABLE: 'RUNTIME_UNDEFINED_VARIABLE',
  RUNTIME_UNDEFINED_FUNCTION: 'RUNTIME_UNDEFINED_FUNCTION',
  RUNTIME_UNDEFINED_METHOD: 'RUNTIME_UNDEFINED_METHOD',
  RUNTIME_UNDEFINED_ANNOTATION: 'RUNTIME_UNDEFINED_ANNOTATION',
  RUNTIME_TYPE_ERROR: 'RUNTIME_TYPE_ERROR',
  RUNTIME_TIMEOUT: 'RUNTIME_TIMEOUT',
  RUNTIME_INVALID_PATTERN: 'RUNTIME_INVALID_PATTERN',
  RUNTIME_AUTO_EXCEPTION: 'RUNTIME_AUTO_EXCEPTION',
  RUNTIME_ABORTED: 'RUNTIME_ABORTED',
  RUNTIME_PROPERTY_NOT_FOUND: 'RUNTIME_PROPERTY_NOT_FOUND',
  RUNTIME_LIMIT_EXCEEDED: 'RUNTIME_LIMIT_EXCEEDED',
  RUNTIME_ASSERTION_FAILED: 'RUNTIME_ASSERTION_FAILED',
  RUNTIME_ERROR_RAISED: 'RUNTIME_ERROR_RAISED',

  // Check errors
  CHECK_FILE_NOT_FOUND: 'CHECK_FILE_NOT_FOUND',
  CHECK_FILE_UNREADABLE: 'CHECK_FILE_UNREADABLE',
  CHECK_INVALID_CONFIG: 'CHECK_INVALID_CONFIG',
  CHECK_FIX_COLLISION: 'CHECK_FIX_COLLISION',
} as const;

export type RillErrorCode =
  (typeof RILL_ERROR_CODES)[keyof typeof RILL_ERROR_CODES];

/** Error category determining error ID prefix */
export type ErrorCategory = 'lexer' | 'parse' | 'runtime' | 'check';

/** Error severity level */
export type ErrorSeverity = 'error' | 'warning';

/** Error registry entry containing all metadata for a single error condition */
export interface ErrorDefinition {
  /** Format: RILL-{category}{3-digit} (e.g., RILL-R001) */
  readonly errorId: string;
  /** Legacy error code from RILL_ERROR_CODES */
  readonly legacyCode: RillErrorCode;
  /** Error category (determines ID prefix) */
  readonly category: ErrorCategory;
  /** Severity level (defaults to 'error' when omitted) */
  readonly severity?: ErrorSeverity | undefined;
  /** Human-readable description (max 50 characters) */
  readonly description: string;
  /** Message template with {placeholder} syntax */
  readonly messageTemplate: string;
}

// ============================================================
// ERROR REGISTRY
// ============================================================

/**
 * Central registry for all error definitions with O(1) lookup.
 * Immutable after initialization.
 */
export interface ErrorRegistry {
  get(errorId: string): ErrorDefinition | undefined;
  getByLegacyCode(code: RillErrorCode): readonly ErrorDefinition[];
  has(errorId: string): boolean;
  readonly size: number;
  entries(): IterableIterator<[string, ErrorDefinition]>;
}

class ErrorRegistryImpl implements ErrorRegistry {
  private readonly byId: ReadonlyMap<string, ErrorDefinition>;
  private readonly byLegacyCode: ReadonlyMap<
    RillErrorCode,
    readonly ErrorDefinition[]
  >;

  constructor(definitions: ErrorDefinition[]) {
    const idMap = new Map<string, ErrorDefinition>();
    const codeMap = new Map<RillErrorCode, ErrorDefinition[]>();

    for (const def of definitions) {
      idMap.set(def.errorId, def);

      const existing = codeMap.get(def.legacyCode) ?? [];
      codeMap.set(def.legacyCode, [...existing, def]);
    }

    this.byId = idMap;
    this.byLegacyCode = codeMap;
  }

  get(errorId: string): ErrorDefinition | undefined {
    return this.byId.get(errorId);
  }

  getByLegacyCode(code: RillErrorCode): readonly ErrorDefinition[] {
    return this.byLegacyCode.get(code) ?? [];
  }

  has(errorId: string): boolean {
    return this.byId.has(errorId);
  }

  get size(): number {
    return this.byId.size;
  }

  entries(): IterableIterator<[string, ErrorDefinition]> {
    return this.byId.entries();
  }
}

/** All error definitions indexed by error ID */
const ERROR_DEFINITIONS: ErrorDefinition[] = [
  // Lexer Errors (RILL-L0xx)
  {
    errorId: 'RILL-L001',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
    category: 'lexer',
    description: 'Unterminated string literal',
    messageTemplate: 'Unterminated string literal at {location}',
  },
  {
    errorId: 'RILL-L002',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
    category: 'lexer',
    description: 'Invalid character',
    messageTemplate: 'Invalid character {char} at {location}',
  },
  {
    errorId: 'RILL-L003',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
    category: 'lexer',
    description: 'Invalid number format',
    messageTemplate: 'Invalid number format: {value}',
  },
  {
    errorId: 'RILL-L004',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
    category: 'lexer',
    description: 'Unterminated multiline string',
    messageTemplate: 'Unterminated multiline string starting at {location}',
  },
  {
    errorId: 'RILL-L005',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
    category: 'lexer',
    description: 'Invalid escape sequence',
    messageTemplate: 'Invalid escape sequence {sequence} at {location}',
  },

  // Parse Errors (RILL-P0xx)
  {
    errorId: 'RILL-P001',
    legacyCode: RILL_ERROR_CODES.PARSE_UNEXPECTED_TOKEN,
    category: 'parse',
    description: 'Unexpected token',
    messageTemplate: 'Unexpected token {token}, expected {expected}',
  },
  {
    errorId: 'RILL-P002',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
    category: 'parse',
    description: 'Unexpected end of input',
    messageTemplate: 'Unexpected end of input, expected {expected}',
  },
  {
    errorId: 'RILL-P003',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_TYPE,
    category: 'parse',
    description: 'Invalid type annotation',
    messageTemplate: 'Invalid type annotation: {type}',
  },
  {
    errorId: 'RILL-P004',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
    category: 'parse',
    description: 'Invalid expression',
    messageTemplate: 'Invalid expression: {details}',
  },
  {
    errorId: 'RILL-P005',
    legacyCode: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
    category: 'parse',
    description: 'Missing delimiter',
    messageTemplate: 'Missing {delimiter}, found {found}',
  },

  // Runtime Errors (RILL-R0xx)
  {
    errorId: 'RILL-R001',
    legacyCode: RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
    category: 'runtime',
    description: 'Parameter type mismatch',
    messageTemplate:
      'Function {function} expects parameter {param} (position {position}) to be {expected}, got {actual}',
  },
  {
    errorId: 'RILL-R002',
    legacyCode: RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
    category: 'runtime',
    description: 'Operator type mismatch',
    messageTemplate:
      'Operator {operator} cannot be applied to {leftType} and {rightType}',
  },
  {
    errorId: 'RILL-R003',
    legacyCode: RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
    category: 'runtime',
    description: 'Method receiver type mismatch',
    messageTemplate: 'Method {method} cannot be called on {type}',
  },
  {
    errorId: 'RILL-R004',
    legacyCode: RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
    category: 'runtime',
    description: 'Type conversion failure',
    messageTemplate: 'Cannot convert {value} to {targetType}',
  },
  {
    errorId: 'RILL-R005',
    legacyCode: RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
    category: 'runtime',
    description: 'Undefined variable',
    messageTemplate: 'Variable {name} is not defined',
  },
  {
    errorId: 'RILL-R006',
    legacyCode: RILL_ERROR_CODES.RUNTIME_UNDEFINED_FUNCTION,
    category: 'runtime',
    description: 'Undefined function',
    messageTemplate: 'Function {name} is not defined',
  },
  {
    errorId: 'RILL-R007',
    legacyCode: RILL_ERROR_CODES.RUNTIME_UNDEFINED_METHOD,
    category: 'runtime',
    description: 'Undefined method',
    messageTemplate: 'Method {method} is not defined on {type}',
  },
  {
    errorId: 'RILL-R008',
    legacyCode: RILL_ERROR_CODES.RUNTIME_UNDEFINED_ANNOTATION,
    category: 'runtime',
    description: 'Undefined annotation',
    messageTemplate: 'Annotation {key} is not defined',
  },
  {
    errorId: 'RILL-R009',
    legacyCode: RILL_ERROR_CODES.RUNTIME_PROPERTY_NOT_FOUND,
    category: 'runtime',
    description: 'Property not found',
    messageTemplate: 'Property {property} not found on {type}',
  },
  {
    errorId: 'RILL-R010',
    legacyCode: RILL_ERROR_CODES.RUNTIME_LIMIT_EXCEEDED,
    category: 'runtime',
    description: 'Iteration limit exceeded',
    messageTemplate: 'Iteration limit of {limit} exceeded',
  },
  {
    errorId: 'RILL-R011',
    legacyCode: RILL_ERROR_CODES.RUNTIME_INVALID_PATTERN,
    category: 'runtime',
    description: 'Invalid regex pattern',
    messageTemplate: 'Invalid regex pattern: {pattern}',
  },
  {
    errorId: 'RILL-R012',
    legacyCode: RILL_ERROR_CODES.RUNTIME_TIMEOUT,
    category: 'runtime',
    description: 'Operation timeout',
    messageTemplate: 'Operation timed out after {timeout}ms',
  },
  {
    errorId: 'RILL-R013',
    legacyCode: RILL_ERROR_CODES.RUNTIME_ABORTED,
    category: 'runtime',
    description: 'Execution aborted',
    messageTemplate: 'Execution aborted by signal',
  },
  {
    errorId: 'RILL-R014',
    legacyCode: RILL_ERROR_CODES.RUNTIME_AUTO_EXCEPTION,
    category: 'runtime',
    description: 'Auto-exception triggered',
    messageTemplate: 'Auto-exception triggered: pattern {pattern} matched',
  },
  {
    errorId: 'RILL-R015',
    legacyCode: RILL_ERROR_CODES.RUNTIME_ASSERTION_FAILED,
    category: 'runtime',
    description: 'Assertion failed',
    messageTemplate: 'Assertion failed: {condition}',
  },
  {
    errorId: 'RILL-R016',
    legacyCode: RILL_ERROR_CODES.RUNTIME_ERROR_RAISED,
    category: 'runtime',
    description: 'Error statement executed',
    messageTemplate: 'Error raised: {message}',
  },

  // Check Errors (RILL-C0xx)
  {
    errorId: 'RILL-C001',
    legacyCode: RILL_ERROR_CODES.CHECK_FILE_NOT_FOUND,
    category: 'check',
    description: 'File not found',
    messageTemplate: 'File not found: {path}',
  },
  {
    errorId: 'RILL-C002',
    legacyCode: RILL_ERROR_CODES.CHECK_FILE_UNREADABLE,
    category: 'check',
    description: 'File unreadable',
    messageTemplate: 'File unreadable: {path}',
  },
  {
    errorId: 'RILL-C003',
    legacyCode: RILL_ERROR_CODES.CHECK_INVALID_CONFIG,
    category: 'check',
    description: 'Invalid configuration',
    messageTemplate: 'Invalid configuration: {details}',
  },
  {
    errorId: 'RILL-C004',
    legacyCode: RILL_ERROR_CODES.CHECK_FIX_COLLISION,
    category: 'check',
    description: 'Fix collision detected',
    messageTemplate: 'Fix collision detected for {location}',
  },
];

/**
 * Global error registry instance.
 * Read-only singleton initialized at module load.
 */
export const ERROR_REGISTRY: ErrorRegistry = new ErrorRegistryImpl(
  ERROR_DEFINITIONS
);

// ============================================================
// TEMPLATE RENDERING
// ============================================================

/**
 * Renders a message template by replacing placeholders with context values.
 *
 * Placeholder format: {varName}
 * Missing context values render as empty string.
 * Non-string values are coerced via String().
 * Invalid templates (unclosed braces) return template unchanged.
 *
 * @param template - Template string with {placeholder} syntax
 * @param context - Key-value pairs for placeholder replacement
 * @returns Rendered message with placeholders replaced
 *
 * @example
 * renderMessage("Expected {expected}, got {actual}", {expected: "string", actual: "number"})
 * // Returns: "Expected string, got number"
 *
 * @example
 * renderMessage("Hello {name}", {})
 * // Returns: "Hello "
 */
export function renderMessage(
  template: string,
  context: Record<string, unknown>
): string {
  let result = '';
  let i = 0;

  while (i < template.length) {
    const char = template[i]!;

    if (char === '{') {
      // Check if this is the start of a placeholder
      const nextChar = template[i + 1];
      if (nextChar !== '{') {
        // Find the closing brace
        let j = i + 1;
        while (j < template.length && template[j] !== '}') {
          j++;
        }

        // Check if we found a closing brace
        if (j >= template.length) {
          // Unclosed brace - return template unchanged
          return template;
        }

        // Extract placeholder name and render value
        const placeholderName = template.slice(i + 1, j);
        const value = context[placeholderName];

        // Render value: missing = empty string, non-string coerced via String()
        if (value === undefined) {
          result += '';
        } else {
          try {
            result += String(value);
          } catch {
            // String() coercion failed - use default toString behavior
            result += Object.prototype.toString.call(value);
          }
        }

        // Move past closing brace. Each character is visited once (O(n) performance).
        i = j + 1;
        continue;
      }
    }

    // Regular character - append to result
    result += char;
    i++;
  }

  return result;
}

/**
 * Generates documentation URL for an error ID.
 *
 * Format: https://github.com/rcrsr/rill/blob/v{version}/docs/88_errors.md#{errorId}
 * Error ID is lowercased in anchor.
 *
 * @param errorId - Error identifier (format: RILL-{category}{3-digit}, e.g., RILL-R001)
 * @param version - Semver version (format: X.Y.Z)
 * @returns Documentation URL, or empty string if inputs are invalid
 *
 * @example
 * getHelpUrl("RILL-R001", "0.4.1")
 * // Returns: "https://github.com/rcrsr/rill/blob/v0.4.1/docs/88_errors.md#rill-r001"
 *
 * @example
 * getHelpUrl("invalid", "0.4.1")
 * // Returns: ""
 */
export function getHelpUrl(errorId: string, version: string): string {
  // Validate errorId format: RILL-{category}{3-digit}
  // Category is single letter (L=lexer, P=parse, R=runtime, C=check)
  const errorIdPattern = /^RILL-[LPRC]\d{3}$/;
  if (!errorIdPattern.test(errorId)) {
    return '';
  }

  // Validate version format: X.Y.Z (semver)
  const versionPattern = /^\d+\.\d+\.\d+$/;
  if (!versionPattern.test(version)) {
    return '';
  }

  // Build URL with lowercased errorId in anchor
  const anchor = errorId.toLowerCase();
  return `https://github.com/rcrsr/rill/blob/v${version}/docs/88_errors.md#${anchor}`;
}

// ============================================================
// ERROR FACTORY
// ============================================================

/**
 * Factory function for creating errors from registry.
 *
 * Looks up error definition from registry, renders message template with context,
 * and creates RillError with structured metadata.
 *
 * @param errorId - Error identifier (format: RILL-{category}{3-digit})
 * @param context - Key-value pairs for template placeholder replacement
 * @param location - Source location where error occurred (optional)
 * @returns RillError instance with rendered message
 * @throws TypeError if errorId is not found in registry
 *
 * @example
 * createError("RILL-R005", { name: "foo" }, location)
 * // Creates RuntimeError: "Variable foo is not defined at 1:5"
 *
 * @example
 * createError("RILL-X999", {})
 * // Throws: TypeError("Unknown error ID: RILL-X999")
 */
export function createError(
  errorId: string,
  context: Record<string, unknown>,
  location?: SourceLocation | undefined
): RillError {
  // Lookup error definition from registry (O(1))
  const definition = ERROR_REGISTRY.get(errorId);

  // EC-9: Unknown errorId -> Throws TypeError
  if (!definition) {
    throw new TypeError(`Unknown error ID: ${errorId}`);
  }

  // Render message from template + context (O(n) where n = template length)
  // EC-10: Context value fails String() coercion -> Uses fallback "[object Object]"
  // This is handled inside renderMessage via try-catch
  const message = renderMessage(definition.messageTemplate, context);

  // EC-11: Malformed location (missing line/column) -> Error created without location metadata
  // We accept the location as-is; if it's malformed, the error won't have proper location data
  // This is acceptable per spec - the error is still created, just without complete location info

  // Compute helpUrl from errorId using VERSION constant
  const helpUrl = getHelpUrl(errorId, VERSION);

  // Create RillError with errorId, helpUrl, legacy code, and rendered message
  return new RillError({
    code: definition.legacyCode,
    errorId,
    helpUrl: helpUrl || undefined, // Convert empty string to undefined
    message,
    location,
    context,
  });
}

/** Structured error data for host applications */
export interface RillErrorData {
  readonly code: RillErrorCode;
  readonly errorId?: string | undefined;
  readonly helpUrl?: string | undefined;
  readonly message: string;
  readonly location?: SourceLocation | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

/**
 * Base error class for all Rill errors.
 * Provides structured data for host applications to format as needed.
 */
export class RillError extends Error {
  readonly code: RillErrorCode;
  readonly errorId: string | undefined;
  readonly helpUrl: string | undefined;
  readonly location?: SourceLocation | undefined;
  readonly context?: Record<string, unknown> | undefined;

  constructor(data: RillErrorData) {
    const locationStr = data.location
      ? ` at ${data.location.line}:${data.location.column}`
      : '';
    super(`${data.message}${locationStr}`);
    this.name = 'RillError';
    this.code = data.code;
    this.errorId = data.errorId;
    this.helpUrl = data.helpUrl;
    this.location = data.location;
    this.context = data.context;
  }

  /** Get structured error data for custom formatting */
  toData(): RillErrorData {
    return {
      code: this.code,
      errorId: this.errorId,
      helpUrl: this.helpUrl,
      message: this.message.replace(/ at \d+:\d+$/, ''), // Strip location suffix
      location: this.location,
      context: this.context,
    };
  }

  /** Format error for display (can be overridden by host) */
  format(formatter?: (data: RillErrorData) => string): string {
    if (formatter) return formatter(this.toData());
    return this.message;
  }
}

/** Parse-time errors */
export class ParseError extends RillError {
  constructor(
    message: string,
    location: SourceLocation,
    context?: Record<string, unknown>,
    errorId?: string
  ) {
    // When errorId provided, look up definition and derive legacyCode
    if (errorId) {
      const definition = ERROR_REGISTRY.get(errorId);
      if (!definition) {
        throw new TypeError(`Unknown error ID: ${errorId}`);
      }
      super({
        code: definition.legacyCode,
        errorId,
        message,
        location,
        context,
      });
    } else {
      // Backward compatible: use default PARSE_INVALID_SYNTAX code
      super({
        code: RILL_ERROR_CODES.PARSE_INVALID_SYNTAX,
        message,
        location,
        context,
      });
    }
    this.name = 'ParseError';
  }
}

/** Runtime execution errors */
export class RuntimeError extends RillError {
  constructor(
    code: RillErrorCode,
    message: string,
    location?: SourceLocation,
    context?: Record<string, unknown>,
    errorId?: string
  ) {
    // When errorId provided, look up definition and derive legacyCode
    if (errorId) {
      const definition = ERROR_REGISTRY.get(errorId);
      if (!definition) {
        throw new TypeError(`Unknown error ID: ${errorId}`);
      }
      super({
        code: definition.legacyCode,
        errorId,
        message,
        location,
        context,
      });
    } else {
      // Backward compatible: use provided code directly
      super({ code, message, location, context });
    }
    this.name = 'RuntimeError';
  }

  /** Create from an AST node */
  static fromNode(
    code: RillErrorCode,
    message: string,
    node?: { span: SourceSpan },
    context?: Record<string, unknown>,
    errorId?: string
  ): RuntimeError {
    return new RuntimeError(code, message, node?.span.start, context, errorId);
  }
}

/** Timeout errors */
export class TimeoutError extends RuntimeError {
  readonly functionName: string;
  readonly timeoutMs: number;

  constructor(
    functionName: string,
    timeoutMs: number,
    location?: SourceLocation
  ) {
    super(
      RILL_ERROR_CODES.RUNTIME_TIMEOUT,
      `Function '${functionName}' timed out after ${timeoutMs}ms`,
      location,
      { functionName, timeoutMs }
    );
    this.name = 'TimeoutError';
    this.functionName = functionName;
    this.timeoutMs = timeoutMs;
  }
}

/** Auto-exception errors (when $_ matches a pattern) */
export class AutoExceptionError extends RuntimeError {
  readonly pattern: string;
  readonly matchedValue: string;

  constructor(
    pattern: string,
    matchedValue: string,
    location?: SourceLocation
  ) {
    super(
      RILL_ERROR_CODES.RUNTIME_AUTO_EXCEPTION,
      `Auto-exception triggered: pattern '${pattern}' matched`,
      location,
      { pattern, matchedValue }
    );
    this.name = 'AutoExceptionError';
    this.pattern = pattern;
    this.matchedValue = matchedValue;
  }
}

/** Abort errors (when execution is cancelled via AbortSignal) */
export class AbortError extends RuntimeError {
  constructor(location?: SourceLocation) {
    super(RILL_ERROR_CODES.RUNTIME_ABORTED, 'Execution aborted', location, {});
    this.name = 'AbortError';
  }
}

// ============================================================
// TOKEN TYPES
// ============================================================

export const TOKEN_TYPES = {
  // Literals
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  TRUE: 'TRUE',
  FALSE: 'FALSE',

  // Identifiers
  IDENTIFIER: 'IDENTIFIER',

  // Variables
  DOLLAR: 'DOLLAR', // $
  PIPE_VAR: 'PIPE_VAR', // $ (lone dollar sign)

  // Operators
  ARROW: 'ARROW', // ->
  CAPTURE_ARROW: 'CAPTURE_ARROW', // :>
  DOT: 'DOT', // .
  QUESTION: 'QUESTION', // ?
  AT: 'AT', // @
  CARET: 'CARET', // ^ (annotation prefix)
  COLON: 'COLON', // :
  DOUBLE_COLON: 'DOUBLE_COLON', // :: (namespace separator)
  COMMA: 'COMMA', // ,

  // Boolean operators
  BANG: 'BANG', // !
  AND: 'AND', // &&
  OR: 'OR', // ||

  // Null-coalescing and existence
  NULLISH_COALESCE: 'NULLISH_COALESCE', // ??
  DOT_QUESTION: 'DOT_QUESTION', // .?
  AMPERSAND: 'AMPERSAND', // &

  // Assignment
  ASSIGN: 'ASSIGN', // =

  // Comparison operators
  EQ: 'EQ', // ==
  NE: 'NE', // !=
  LT: 'LT', // <
  GT: 'GT', // >
  LE: 'LE', // <=
  GE: 'GE', // >=

  // Extraction operators
  STAR_LT: 'STAR_LT', // *< (destructure)
  SLASH_LT: 'SLASH_LT', // /< (slice)
  UNDERSCORE: 'UNDERSCORE', // _ (skip in destructure)

  // Spread operator
  ELLIPSIS: 'ELLIPSIS', // ... (list spread)

  // Arithmetic operators
  PIPE_BAR: 'PIPE_BAR', // |
  PLUS: 'PLUS', // +
  MINUS: 'MINUS', // -
  STAR: 'STAR', // *
  SLASH: 'SLASH', // /
  PERCENT: 'PERCENT', // %

  // Delimiters
  LPAREN: 'LPAREN', // (
  RPAREN: 'RPAREN', // )
  LBRACE: 'LBRACE', // {
  RBRACE: 'RBRACE', // }
  LBRACKET: 'LBRACKET', // [
  RBRACKET: 'RBRACKET', // ]

  // Keywords
  BREAK: 'BREAK',
  RETURN: 'RETURN',
  PASS: 'PASS',
  ASSERT: 'ASSERT',
  ERROR: 'ERROR',
  EACH: 'EACH',
  MAP: 'MAP',
  FOLD: 'FOLD',
  FILTER: 'FILTER',

  // Frontmatter
  FRONTMATTER_DELIM: 'FRONTMATTER_DELIM', // ---

  // Special
  NEWLINE: 'NEWLINE',
  COMMENT: 'COMMENT',
  EOF: 'EOF',
} as const;

export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly span: SourceSpan;
}

// ============================================================
// AST NODE TYPES
// ============================================================

export type NodeType =
  | 'Script'
  | 'Frontmatter'
  | 'Closure'
  | 'ClosureParam'
  | 'Statement'
  | 'PipeChain'
  | 'PostfixExpr'
  | 'MethodCall'
  | 'Invoke'
  | 'HostCall'
  | 'ClosureCall'
  | 'PipeInvoke'
  | 'Variable'
  | 'Capture'
  | 'Conditional'
  | 'WhileLoop'
  | 'DoWhileLoop'
  | 'Block'
  | 'StringLiteral'
  | 'Interpolation'
  | 'NumberLiteral'
  | 'BoolLiteral'
  | 'Tuple'
  | 'ListSpread'
  | 'Dict'
  | 'DictEntry'
  | 'Break'
  | 'Return'
  | 'Pass'
  | 'Assert'
  | 'BinaryExpr'
  | 'UnaryExpr'
  | 'InnerExpr'
  | 'GroupedExpr'
  | 'ClosureChain'
  | 'Destructure'
  | 'DestructPattern'
  | 'Slice'
  | 'Enumerate'
  | 'Spread'
  | 'TypeAssertion'
  | 'TypeCheck'
  | 'AnnotatedStatement'
  | 'NamedArg'
  | 'SpreadArg'
  | 'EachExpr'
  | 'MapExpr'
  | 'FoldExpr'
  | 'FilterExpr'
  | 'RecoveryError'
  | 'Error';

interface BaseNode {
  readonly span: SourceSpan;
}

// ============================================================
// SCRIPT STRUCTURE
// ============================================================

export interface ScriptNode extends BaseNode {
  readonly type: 'Script';
  readonly frontmatter: FrontmatterNode | null;
  /** Statements in the script. May include RecoveryErrorNode when parsed with recoveryMode. */
  readonly statements: (
    | StatementNode
    | AnnotatedStatementNode
    | RecoveryErrorNode
  )[];
}

export interface FrontmatterNode extends BaseNode {
  readonly type: 'Frontmatter';
  readonly content: string; // Raw YAML content
}

/**
 * Closure: |params| body
 * First-class closure with optional typed parameters and defaults.
 * Scope rules: captures outer (read-only), local mutable.
 *
 * Body can be:
 * - Simple: |x| $x (postfix-expr)
 * - Grouped: |x| ($x * 2) (compound expression)
 * - Block: |x| { $a ↵ $b } (multiple statements)
 */
export interface ClosureNode extends BaseNode {
  readonly type: 'Closure';
  readonly params: ClosureParamNode[];
  readonly body: BodyNode;
}

/**
 * Function parameter with optional type and default value.
 * - (x) { }           -- untyped
 * - (x: string) { }   -- typed
 * - (x: string = "hi") { }  -- typed with default
 * - ^(key: value) (x) { }  -- with parameter annotations
 */
export interface ClosureParamNode extends BaseNode {
  readonly type: 'ClosureParam';
  readonly name: string;
  readonly typeName: 'string' | 'number' | 'bool' | null; // null = untyped
  readonly defaultValue: LiteralNode | null;
  readonly annotations?: AnnotationArg[] | undefined; // Parameter-level annotations (default: empty array)
}

// ============================================================
// STATEMENTS
// ============================================================

/**
 * Statement: a pipe chain expression.
 * Termination (capture/break/return) is now part of PipeChainNode.
 */
export interface StatementNode extends BaseNode {
  readonly type: 'Statement';
  readonly expression: PipeChainNode;
}

/**
 * Recovery error node for parse error recovery mode.
 * Represents unparseable content that was skipped during error recovery.
 * Only appears in ASTs when parsing with `recoveryMode: true`.
 */
export interface RecoveryErrorNode extends BaseNode {
  readonly type: 'RecoveryError';
  /** The error message describing what went wrong */
  readonly message: string;
  /** The raw source text that could not be parsed */
  readonly text: string;
}

// ============================================================
// ANNOTATIONS
// ============================================================

/**
 * Annotated statement: ^(key: value, ...) statement
 * Annotations modify operational parameters for statements.
 * They prefix statements and bind to the immediately following construct.
 *
 * Examples:
 *   ^(limit: 100) $items @ process()
 *   ^(timeout: 30) fetch($url)
 *   ^(retry: 3, backoff: 1.5) api_call()
 */
export interface AnnotatedStatementNode extends BaseNode {
  readonly type: 'AnnotatedStatement';
  readonly annotations: AnnotationArg[];
  readonly statement: StatementNode;
}

/**
 * Annotation argument: named or spread
 * Reuses similar structure to dict entries but with spread support.
 */
export type AnnotationArg = NamedArgNode | SpreadArgNode;

/**
 * Named annotation argument: key: value
 * Example: limit: 100, timeout: 30
 */
export interface NamedArgNode extends BaseNode {
  readonly type: 'NamedArg';
  readonly name: string;
  readonly value: ExpressionNode;
}

/**
 * Spread annotation argument: *expr
 * Example: *$opts spreads tuple keys as annotations
 */
export interface SpreadArgNode extends BaseNode {
  readonly type: 'SpreadArg';
  readonly expression: ExpressionNode;
}

/** Rill type names for type annotations */
export type RillTypeName =
  | 'string'
  | 'number'
  | 'bool'
  | 'closure'
  | 'list'
  | 'dict'
  | 'tuple';

export interface CaptureNode extends BaseNode {
  readonly type: 'Capture';
  readonly name: string;
  /** Optional explicit type annotation: $name:string */
  readonly typeName: RillTypeName | null;
}

/**
 * Break: exit loop with current pipe value.
 * Used as chain terminator: $x -> break
 * Or bare: break (implicit $ -> break)
 */
export interface BreakNode extends BaseNode {
  readonly type: 'Break';
}

/**
 * Return: exit closure with current pipe value.
 * Used as chain terminator: $x -> return
 * Or bare: return (implicit $ -> return)
 */
export interface ReturnNode extends BaseNode {
  readonly type: 'Return';
}

/**
 * Pass: pass through pipe value unchanged.
 * Used as chain terminator: $x -> pass
 * Or bare: pass (implicit $ -> pass)
 */
export interface PassNode extends BaseNode {
  readonly type: 'Pass';
}

/**
 * Assert: halt execution if condition is false.
 * Syntax: assert condition
 * Or: assert condition "custom error message"
 */
export interface AssertNode extends BaseNode {
  readonly type: 'Assert';
  readonly condition: ExpressionNode;
  readonly message: StringLiteralNode | null;
}

/**
 * Error: explicitly raise an error with a message.
 * Syntax: error "message"
 * Or: error "interpolated {$var} message"
 */
export interface ErrorNode extends BaseNode {
  readonly type: 'Error';
  readonly message: StringLiteralNode | null;
}

// ============================================================
// EXPRESSIONS
// ============================================================

export type ExpressionNode = PipeChainNode;

/** Chain terminator: capture, break, or return */
export type ChainTerminator = CaptureNode | BreakNode | ReturnNode;

export interface PipeChainNode extends BaseNode {
  readonly type: 'PipeChain';
  readonly head: ArithHead;
  /**
   * Pipe targets and inline captures.
   * Inline captures act as implicit .set() — store value and return unchanged.
   * Semantically: "-> $a ->" ≡ "-> $a.set($) ->"
   */
  readonly pipes: (PipeTargetNode | CaptureNode)[];
  /**
   * Chain terminator: final capture, break, or return.
   * Examples:
   *   $x -> $y         terminator = Capture($y)
   *   $x -> break      terminator = Break
   *   $x -> return     terminator = Return
   *   $x -> .method    terminator = null
   */
  readonly terminator: ChainTerminator | null;
}

export interface PostfixExprNode extends BaseNode {
  readonly type: 'PostfixExpr';
  readonly primary: PrimaryNode;
  readonly methods: (MethodCallNode | InvokeNode)[];
  readonly defaultValue: BodyNode | null;
}

export type PrimaryNode =
  | LiteralNode
  | VariableNode
  | HostCallNode
  | ClosureCallNode
  | MethodCallNode
  | ConditionalNode
  | WhileLoopNode
  | DoWhileLoopNode
  | BlockNode
  | AssertNode
  | ErrorNode
  | PassNode
  | GroupedExprNode
  | SpreadNode
  | TypeAssertionNode
  | TypeCheckNode;

export type PipeTargetNode =
  | HostCallNode
  | ClosureCallNode
  | MethodCallNode
  | PipeInvokeNode
  | ConditionalNode
  | WhileLoopNode
  | DoWhileLoopNode
  | BlockNode
  | ClosureNode
  | StringLiteralNode
  | DictNode
  | TupleNode
  | GroupedExprNode
  | ClosureChainNode
  | DestructureNode
  | SliceNode
  | SpreadNode
  | TypeAssertionNode
  | TypeCheckNode
  | EachExprNode
  | MapExprNode
  | FoldExprNode
  | FilterExprNode
  | PostfixExprNode
  | VariableNode
  | AssertNode
  | ErrorNode;

/** Invoke pipe value as a closure: -> $() or -> $(arg1, arg2) */
export interface PipeInvokeNode extends BaseNode {
  readonly type: 'PipeInvoke';
  readonly args: ExpressionNode[];
}

// ============================================================
// LITERALS
// ============================================================

export type LiteralNode =
  | StringLiteralNode
  | NumberLiteralNode
  | BoolLiteralNode
  | TupleNode
  | DictNode
  | ClosureNode;

export interface StringLiteralNode extends BaseNode {
  readonly type: 'StringLiteral';
  readonly parts: (string | InterpolationNode)[];
  readonly isMultiline: boolean;
}

export interface InterpolationNode extends BaseNode {
  readonly type: 'Interpolation';
  readonly expression: ExpressionNode;
}

export interface NumberLiteralNode extends BaseNode {
  readonly type: 'NumberLiteral';
  readonly value: number;
}

export interface BoolLiteralNode extends BaseNode {
  readonly type: 'BoolLiteral';
  readonly value: boolean;
}

export interface TupleNode extends BaseNode {
  readonly type: 'Tuple';
  readonly elements: (ExpressionNode | ListSpreadNode)[];
  readonly defaultValue: BodyNode | null;
}

export interface ListSpreadNode extends BaseNode {
  readonly type: 'ListSpread';
  readonly expression: ExpressionNode;
}

export interface DictNode extends BaseNode {
  readonly type: 'Dict';
  readonly entries: DictEntryNode[];
  readonly defaultValue: BodyNode | null;
}

export interface DictKeyVariable {
  readonly kind: 'variable';
  readonly variableName: string;
}

export interface DictKeyComputed {
  readonly kind: 'computed';
  readonly expression: ExpressionNode;
}

export interface DictEntryNode extends BaseNode {
  readonly type: 'DictEntry';
  readonly key:
    | string
    | number
    | boolean
    | TupleNode
    | DictKeyVariable
    | DictKeyComputed;
  readonly value: ExpressionNode;
}

// ============================================================
// ARITHMETIC & GROUPED EXPRESSIONS
// ============================================================

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%' // arithmetic
  | '&&'
  | '||' // logical
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='; // comparison

/**
 * Expression head types for binary/unary expressions.
 * Includes arithmetic (+, -, *, /, %) and logical (&&, ||, !) operators.
 */
export type ArithHead = BinaryExprNode | UnaryExprNode | PostfixExprNode;

/**
 * Binary expression: left op right
 * Arithmetic: ($x + 5), ($a * $b), (2 + 3 * 4)
 * Logical: ($a && $b), ($x || $y)
 */
export interface BinaryExprNode extends BaseNode {
  readonly type: 'BinaryExpr';
  readonly op: BinaryOp;
  readonly left: ArithHead;
  readonly right: ArithHead;
}

/**
 * Unary expression: -operand or !operand
 * Examples: (-5), (-$x), (!$ready)
 */
export interface UnaryExprNode extends BaseNode {
  readonly type: 'UnaryExpr';
  readonly op: '-' | '!';
  readonly operand: UnaryExprNode | PostfixExprNode;
}

/**
 * Grouped expression: ( expression )
 * Single-expression block with () delimiters.
 * Provides scoping — captures inside are local and not visible outside.
 *
 * Scoping rules identical to blocks:
 *   ("hello" -> $local)  — $local is scoped to group, returns "hello"
 */
export interface GroupedExprNode extends BaseNode {
  readonly type: 'GroupedExpr';
  readonly expression: PipeChainNode;
}

/**
 * Simple body: expression that can follow closure params, conditionals, or loops.
 * No naked compound expressions — arithmetic/pipes/booleans must be grouped.
 *
 * Valid: block, grouped, or postfix-expr (variable, literal, method, function call)
 * Examples:
 *   |x| $x           — postfix-expr
 *   |x| ($x * 2)     — grouped (compound)
 *   |x| { $a ↵ $b }  — block (multiple statements)
 */
export type BodyNode =
  | BlockNode
  | GroupedExprNode
  | PostfixExprNode
  | PipeChainNode;

// ============================================================
// VARIABLES
// ============================================================

export interface VariableNode extends BaseNode {
  readonly type: 'Variable';
  readonly name: string | null; // null for $ (pipe variable)
  readonly isPipeVar: boolean;
  /** Ordered chain of property accesses: .name, [0], .$var, etc. */
  readonly accessChain: PropertyAccess[];
  /**
   * Default value for null-coalescing: $data.path ?? default
   * If property access returns null/missing, use this value instead.
   */
  readonly defaultValue: BodyNode | null;
  /**
   * Existence check on final path element: $data.?path
   * Returns boolean (true if path exists).
   * When set, implies safe traversal (no error on missing intermediate paths).
   */
  readonly existenceCheck: ExistenceCheck | null;
}

/**
 * Existence check configuration.
 * For .?path (just exists) or .?path&type (exists AND type matches).
 */
export interface ExistenceCheck {
  /** The final field/index being checked for existence */
  readonly finalAccess: FieldAccess;
  /** Optional type check: returns true only if exists AND matches type */
  readonly typeName: RillTypeName | null;
}

/**
 * Field access element in a property access chain (dot-based).
 *
 * Access forms:
 * - literal: .identifier (string key)
 * - variable: .$var (variable as key)
 * - computed: .(expr) (computed expression)
 * - block: .{block} (block returning key)
 * - alternatives: .(a || b) (try keys left-to-right)
 *
 * Note: Numeric indices use bracket syntax [0], [-1] instead of dot.
 */
export type FieldAccess =
  | FieldAccessLiteral
  | FieldAccessVariable
  | FieldAccessComputed
  | FieldAccessBlock
  | FieldAccessAlternatives
  | FieldAccessAnnotation;

/** Literal field access: .identifier */
export interface FieldAccessLiteral {
  readonly kind: 'literal';
  readonly field: string;
}

/** Variable as key: .$var or .$ (pipe variable) */
export interface FieldAccessVariable {
  readonly kind: 'variable';
  readonly variableName: string | null; // null for pipe variable ($)
}

/** Computed expression: .(expr) */
export interface FieldAccessComputed {
  readonly kind: 'computed';
  readonly expression: ExpressionNode;
}

/** Block returning key: .{block} */
export interface FieldAccessBlock {
  readonly kind: 'block';
  readonly block: BlockNode;
}

/** Alternatives (try keys left-to-right): .(a || b) */
export interface FieldAccessAlternatives {
  readonly kind: 'alternatives';
  readonly alternatives: string[];
}

/** Annotation reflection: .^key */
export interface FieldAccessAnnotation {
  readonly kind: 'annotation';
  readonly key: string;
}

/**
 * Bracket index access: [expr]
 * Used for numeric indexing into lists/strings.
 * Expression can be positive (from start) or negative (from end).
 */
export interface BracketAccess {
  /** Discriminator for the unified PropertyAccess type */
  readonly accessKind: 'bracket';
  /** The index expression (evaluates to number) */
  readonly expression: ExpressionNode;
  /** Source span from opening [ to closing ] (inclusive) */
  readonly span: SourceSpan;
}

/**
 * Unified property access type.
 * Used to maintain order of mixed dot and bracket accesses.
 * e.g., $data[0].name[1] has accesses: [bracket(0), field(name), bracket(1)]
 */
export type PropertyAccess = FieldAccess | BracketAccess;

// ============================================================
// FUNCTIONS & METHODS
// ============================================================

export interface HostCallNode extends BaseNode {
  readonly type: 'HostCall';
  readonly name: string;
  readonly args: ExpressionNode[];
}

export interface MethodCallNode extends BaseNode {
  readonly type: 'MethodCall';
  readonly name: string;
  readonly args: ExpressionNode[];
  readonly receiverSpan: SourceSpan | null;
}

/** Postfix invocation: expr(args) - calls the result of expr as a closure */
export interface InvokeNode extends BaseNode {
  readonly type: 'Invoke';
  readonly args: ExpressionNode[];
}

/** Call a closure stored in a variable: $fn(args) or $obj.method(args) */
export interface ClosureCallNode extends BaseNode {
  readonly type: 'ClosureCall';
  readonly name: string; // Variable name (without $)
  readonly accessChain: string[]; // Property access chain (e.g., ['double'] for $math.double)
  readonly args: ExpressionNode[];
}

// ============================================================
// CONTROL FLOW
// ============================================================

/**
 * Conditional: ?($cond) body : else
 * Body can be any simple-body (block, grouped, or postfix-expr).
 *
 * Examples:
 *   ?($x > 0) "positive" : "negative"    — literals
 *   ?($x > 0) ($x * 2) : ($x / 2)        — grouped
 *   ?($x > 0) { complex } : { other }    — blocks
 */
export interface ConditionalNode extends BaseNode {
  readonly type: 'Conditional';
  readonly input: ExpressionNode | null; // null = implied $
  readonly condition: BodyNode | null; // null = truthy check on input (piped form)
  readonly thenBranch: BodyNode;
  readonly elseBranch: BodyNode | ConditionalNode | null;
}

export interface WhileLoopNode extends BaseNode {
  readonly type: 'WhileLoop';
  readonly condition: ExpressionNode; // must evaluate to boolean
  readonly body: BodyNode;
}

export interface DoWhileLoopNode extends BaseNode {
  readonly type: 'DoWhileLoop';
  readonly input: ExpressionNode | null; // null = implied $
  readonly body: BodyNode;
  readonly condition: BodyNode;
}

export interface BlockNode extends BaseNode {
  readonly type: 'Block';
  readonly statements: (StatementNode | AnnotatedStatementNode)[];
}

// ============================================================
// COLLECTION OPERATORS
// ============================================================

/**
 * Collection operator body types.
 * These are the valid forms for the body of each/map/fold operators.
 */
export type IteratorBody =
  | ClosureNode // |x| body or |x, acc = init| body
  | BlockNode // { body }
  | GroupedExprNode // (expr)
  | VariableNode // $fn
  | PostfixExprNode // $ or other simple expression
  | SpreadNode // * (spread element to tuple)
  | HostCallNode; // greet (bare function name)

/**
 * Each expression: sequential iteration returning list of all results.
 *
 * Syntax forms:
 *   collection -> each |x| body
 *   collection -> each { body }
 *   collection -> each (expr)
 *   collection -> each $fn
 *   collection -> each $
 *
 * With accumulator:
 *   collection -> each(init) { body }         -- $@ is accumulator
 *   collection -> each |x, acc = init| body   -- $acc is accumulator
 *
 * Returns: list of all body results (or scan results if accumulator)
 */
export interface EachExprNode extends BaseNode {
  readonly type: 'EachExpr';
  /** The body to execute for each element */
  readonly body: IteratorBody;
  /**
   * Optional accumulator initial value (for block form with $@ access).
   * null when using inline closure with accumulator (it's in the closure params)
   * or when no accumulator is used.
   */
  readonly accumulator: ExpressionNode | null;
}

/**
 * Map expression: parallel iteration returning list of all results.
 *
 * Syntax forms:
 *   collection -> map |x| body
 *   collection -> map { body }
 *   collection -> map (expr)
 *   collection -> map $fn
 *   collection -> map $
 *
 * No accumulator (parallel execution has no "previous").
 * Concurrency limit via ^(limit: N) annotation.
 *
 * Returns: list of all body results (order preserved)
 */
export interface MapExprNode extends BaseNode {
  readonly type: 'MapExpr';
  /** The body to execute for each element (in parallel) */
  readonly body: IteratorBody;
}

/**
 * Fold expression: sequential reduction returning final result only.
 *
 * Syntax forms:
 *   collection -> fold |x, acc = init| body   -- $acc is accumulator
 *   collection -> fold(init) { body }         -- $@ is accumulator
 *   collection -> fold $fn                    -- fn must have accumulator param
 *
 * Accumulator is required.
 *
 * Returns: final accumulated value only
 */
export interface FoldExprNode extends BaseNode {
  readonly type: 'FoldExpr';
  /** The body to execute for each element */
  readonly body: IteratorBody;
  /**
   * Accumulator initial value (for block form with $@ access).
   * null when using inline closure (accumulator is in closure params).
   */
  readonly accumulator: ExpressionNode | null;
}

/**
 * Filter expression: parallel filtering returning elements where predicate is truthy.
 *
 * Syntax forms:
 *   collection -> filter |x| body
 *   collection -> filter { body }
 *   collection -> filter (expr)
 *   collection -> filter $fn
 *
 * Predicate returns truthy/falsy. Elements where predicate is truthy are kept.
 *
 * Returns: list of elements where body was truthy
 */
export interface FilterExprNode extends BaseNode {
  readonly type: 'FilterExpr';
  /** The predicate body to evaluate for each element */
  readonly body: IteratorBody;
}

// ============================================================
// SPREAD OPERATIONS
// ============================================================

/**
 * Sequential spread: $input -> @$closures
 * Chains closures where each receives the previous result.
 *
 * Equivalent to a fold: $input -> [$f, $g, $h] -> @ { $() }
 * - With stored closures: the $ is the current closure, $() invokes it
 * - With inline blocks: $ is the accumulated value directly
 */
export interface ClosureChainNode extends BaseNode {
  readonly type: 'ClosureChain';
  readonly target: ExpressionNode; // The closure(s) to chain
}

// ============================================================
// EXTRACTION OPERATORS
// ============================================================

/**
 * Destructure operator: *<...>
 * Extracts elements from tuples/dicts into variables.
 *
 * Tuple: [1, 2, 3] -> *<$a, $b, $c>
 * Dict:  [name: "x"] -> *<name: $n>
 * Nested: [[1, 2], 3] -> *<*<$a, $b>, $c>
 */
export interface DestructureNode extends BaseNode {
  readonly type: 'Destructure';
  readonly elements: DestructPatternNode[];
}

/**
 * Element in a destructure pattern.
 * Can be: typed variable, key-variable pair, skip placeholder, or nested destructure.
 */
export interface DestructPatternNode extends BaseNode {
  readonly type: 'DestructPattern';
  readonly kind: 'variable' | 'keyValue' | 'skip' | 'nested';
  /** Variable name (for 'variable' and 'keyValue' kinds) */
  readonly name: string | null;
  /** Key name (for 'keyValue' kind - dict destructuring) */
  readonly key: string | null;
  /** Type annotation (for 'variable' and 'keyValue' kinds) */
  readonly typeName: RillTypeName | null;
  /** Nested destructure pattern (for 'nested' kind) */
  readonly nested: DestructureNode | null;
}

/**
 * Slice operator: /<start:stop:step>
 * Extracts a portion of a tuple or string using Python-style slicing.
 *
 * Examples:
 *   $tuple -> /<0:3>       # elements 0, 1, 2
 *   $tuple -> /<::-1>      # reversed
 *   "hello" -> /<1:4>      # "ell"
 */
export interface SliceNode extends BaseNode {
  readonly type: 'Slice';
  /** Start index (null = from beginning) */
  readonly start: SliceBoundNode | null;
  /** Stop index (null = to end) */
  readonly stop: SliceBoundNode | null;
  /** Step (null = 1) */
  readonly step: SliceBoundNode | null;
}

/** A slice bound: number, variable, or grouped expression */
export type SliceBoundNode = NumberLiteralNode | VariableNode | GroupedExprNode;

/**
 * Spread operator: *expr or -> *
 * Converts tuple or dict to args type for unpacking at closure invocation.
 *
 * Prefix form: *[1, 2, 3], *$tuple, *[x: 1, y: 2]
 * Pipe target form: [1, 2, 3] -> *
 *
 * Creates an args value that unpacks into separate arguments when passed to a closure.
 */
export interface SpreadNode extends BaseNode {
  readonly type: 'Spread';
  /** The expression to spread (null when used as pipe target: -> *) */
  readonly operand: ExpressionNode | null;
}

// ============================================================
// TYPE OPERATIONS
// ============================================================

/**
 * Type assertion: expr:type
 * Asserts that the expression evaluates to the specified type.
 * Returns the value unchanged if assertion passes, errors on mismatch.
 *
 * Examples:
 *   fetchData():string                # assert result is string
 *   $val -> :number -> process()      # assert pipe value is number
 *   "hello":string                    # "hello" (pass)
 *   "hello":number                    # Error: expected number, got string
 *
 * When operand is null, it acts on the implicit $:
 *   :string ≡ $:string
 */
export interface TypeAssertionNode extends BaseNode {
  readonly type: 'TypeAssertion';
  /** The expression to assert (null for bare :type which uses $) */
  readonly operand: PostfixExprNode | null;
  /** The expected type */
  readonly typeName: RillTypeName;
}

/**
 * Type check: expr:?type
 * Checks if the expression evaluates to the specified type.
 * Returns true if types match, false otherwise.
 *
 * Examples:
 *   fetchData():?string               # is result a string?
 *   $val -> :?number -> process()     # is pipe value a number?
 *   "hello":?string                   # true
 *   "hello":?number                   # false
 *
 * When operand is null, it checks the implicit $:
 *   :?string ≡ $:?string
 */
export interface TypeCheckNode extends BaseNode {
  readonly type: 'TypeCheck';
  /** The expression to check (null for bare :?type which uses $) */
  readonly operand: PostfixExprNode | null;
  /** The type to check for */
  readonly typeName: RillTypeName;
}

export type SimplePrimaryNode =
  | LiteralNode
  | VariableNode
  | HostCallNode
  | MethodCallNode
  | BlockNode
  | BinaryExprNode
  | UnaryExprNode
  | GroupedExprNode
  | PostfixExprNode
  | TypeAssertionNode
  | TypeCheckNode;

// ============================================================
// UNION TYPE FOR ALL NODES
// ============================================================

export type ASTNode =
  | ScriptNode
  | FrontmatterNode
  | ClosureNode
  | ClosureParamNode
  | StatementNode
  | CaptureNode
  | BreakNode
  | ReturnNode
  | PassNode
  | AssertNode
  | PipeChainNode
  | PostfixExprNode
  | MethodCallNode
  | InvokeNode
  | HostCallNode
  | ClosureCallNode
  | PipeInvokeNode
  | VariableNode
  | ConditionalNode
  | WhileLoopNode
  | DoWhileLoopNode
  | BlockNode
  | StringLiteralNode
  | InterpolationNode
  | NumberLiteralNode
  | BoolLiteralNode
  | TupleNode
  | ListSpreadNode
  | DictNode
  | DictEntryNode
  | BinaryExprNode
  | UnaryExprNode
  | GroupedExprNode
  | ClosureChainNode
  | DestructureNode
  | DestructPatternNode
  | SliceNode
  | SpreadNode
  | TypeAssertionNode
  | TypeCheckNode
  | AnnotatedStatementNode
  | NamedArgNode
  | SpreadArgNode
  | EachExprNode
  | MapExprNode
  | FoldExprNode
  | FilterExprNode
  | RecoveryErrorNode
  | ErrorNode;

// ============================================================
// PARSE OPTIONS
// ============================================================

/**
 * Options for the parser.
 */
export interface ParseOptions {
  /**
   * Enable recovery mode for IDE/tooling scenarios.
   * When true, the parser attempts to recover from errors and
   * returns a partial AST with RecoveryErrorNode entries instead of throwing.
   * Default: false (throws on first error).
   */
  readonly recoveryMode?: boolean;
}

/**
 * Result of parsing with recovery mode enabled.
 * Contains the AST (which may include RecoveryErrorNode entries) and collected errors.
 */
export interface ParseResult {
  /** The parsed AST (may contain RecoveryErrorNode entries in statements) */
  readonly ast: ScriptNode;
  /** Parse errors collected during recovery (empty if no errors) */
  readonly errors: ParseError[];
  /** True if parsing completed without errors */
  readonly success: boolean;
}
