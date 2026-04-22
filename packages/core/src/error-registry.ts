/**
 * Error Registry
 * Central error definition registry with template rendering and help URL generation.
 */

// ============================================================
// ERROR CATEGORIES AND SEVERITY
// ============================================================

/** Error category determining error ID prefix */
export type ErrorCategory = 'lexer' | 'parse' | 'runtime' | 'check';

/** Error severity level */
export type ErrorSeverity = 'error' | 'warning';

/**
 * Example demonstrating an error condition.
 * Used in error documentation to show common scenarios.
 */
export interface ErrorExample {
  /** Description of the example scenario (max 100 characters) */
  readonly description: string;
  /** Example code demonstrating the error (max 500 characters) */
  readonly code: string;
}

/** Error registry entry containing all metadata for a single error condition */
export interface ErrorDefinition {
  /** Format: RILL-{category}{3-digit} (e.g., RILL-R001) */
  readonly errorId: string;
  /** Error category (determines ID prefix) */
  readonly category: ErrorCategory;
  /** Severity level (defaults to 'error' when omitted) */
  readonly severity?: ErrorSeverity | undefined;
  /** Human-readable description (max 50 characters) */
  readonly description: string;
  /** Message template with {placeholder} syntax */
  readonly messageTemplate: string;
  /** What causes this error (max 200 characters) */
  readonly cause?: string | undefined;
  /** How to resolve this error (max 300 characters) */
  readonly resolution?: string | undefined;
  /** Example scenarios demonstrating this error (max 3 entries) */
  readonly examples?: ErrorExample[] | undefined;
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
  has(errorId: string): boolean;
  readonly size: number;
  entries(): IterableIterator<[string, ErrorDefinition]>;
}

class ErrorRegistryImpl implements ErrorRegistry {
  private readonly byId: ReadonlyMap<string, ErrorDefinition>;

  constructor(definitions: ErrorDefinition[]) {
    const idMap = new Map<string, ErrorDefinition>();

    for (const def of definitions) {
      idMap.set(def.errorId, def);
    }

    this.byId = idMap;
  }

  get(errorId: string): ErrorDefinition | undefined {
    return this.byId.get(errorId);
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
    category: 'lexer',
    description: 'Unterminated string literal',
    messageTemplate: 'Unterminated string literal at {location}',
    cause:
      'String opened with quote but never closed before end of line or file.',
    resolution:
      'Add closing quote to complete the string, or use multiline strings with triple quotes (""") for multi-line content.',
    examples: [
      {
        description: 'Missing closing quote on single line',
        code: '"hello',
      },
      {
        description: 'Newline inside single-quoted string',
        code: '"hello\nworld"',
      },
    ],
  },
  {
    errorId: 'RILL-L002',
    category: 'lexer',
    description: 'Invalid character',
    messageTemplate: 'Invalid character {char} at {location}',
    cause: 'Character not recognized by the lexer (not part of Rill syntax).',
    resolution:
      'Remove or replace the invalid character. Common causes: unicode characters in identifiers, unsupported operators, or copy-paste artifacts.',
    examples: [
      {
        description: 'Unicode character in code',
        code: '$x → "value"  # → is not valid, use ->',
      },
      {
        description: 'Backtick instead of quote',
        code: '`hello`  # Use "hello" instead',
      },
    ],
  },
  {
    errorId: 'RILL-L003',
    category: 'lexer',
    description: 'Invalid number format',
    messageTemplate: 'Invalid number format: {value}',
    cause:
      'Number contains invalid characters, multiple decimal points, or unsupported notation.',
    resolution:
      'Use valid number format: integers (123), decimals (1.5), or scientific notation (1e5). No underscores, trailing dots, or multiple decimals allowed.',
    examples: [
      {
        description: 'Multiple decimal points',
        code: '1.2.3',
      },
      {
        description: 'Trailing decimal point',
        code: '123.',
      },
      {
        description: 'Leading zeros (octal notation not supported)',
        code: '0123',
      },
    ],
  },
  {
    errorId: 'RILL-L004',
    category: 'lexer',
    description: 'Unterminated multiline string',
    messageTemplate: 'Unterminated multiline string starting at {location}',
    cause: 'Multiline string opened with triple quotes (""") but never closed.',
    resolution:
      'Add closing triple quotes (""") to complete the multiline string.',
    examples: [
      {
        description: 'Missing closing triple quotes',
        code: '"""hello\nworld',
      },
      {
        description: 'Only two closing quotes instead of three',
        code: '"""content""',
      },
    ],
  },
  {
    errorId: 'RILL-L005',
    category: 'lexer',
    description: 'Invalid escape sequence',
    messageTemplate: 'Invalid escape sequence {sequence} at {location}',
    cause: 'Backslash followed by unsupported character in string literal.',
    resolution:
      'Use valid escape sequences: \\n (newline), \\t (tab), \\\\ (backslash), \\" (quote), \\{ (brace). For literal backslash, use \\\\.',
    examples: [
      {
        description: 'Invalid escape character',
        code: '"hello\\xworld"  # \\x not supported',
      },
      {
        description: 'Incomplete escape at end',
        code: '"path\\',
      },
    ],
  },

  // Parse Errors (RILL-P0xx)
  {
    errorId: 'RILL-P001',
    category: 'parse',
    description: 'Unexpected token',
    messageTemplate: 'Unexpected token {token}, expected {expected}',
    cause: 'Token appears in invalid position according to grammar rules.',
    resolution:
      'Check syntax at the indicated position. Common causes: missing operators, mismatched delimiters, or keywords in wrong context.',
    examples: [
      {
        description: 'Missing pipe operator between expressions',
        code: '"hello" "world"  # Missing -> between',
      },
      {
        description: 'Statement starting with operator',
        code: '-> "value"  # Missing left side',
      },
      {
        description: 'Unexpected closing brace',
        code: '{ "value" }}  # Extra closing brace',
      },
    ],
  },
  {
    errorId: 'RILL-P002',
    category: 'parse',
    description: 'Unexpected end of input',
    messageTemplate: 'Unexpected end of input, expected {expected}',
    cause:
      'File or block ended while parser expected more tokens (incomplete expression or statement).',
    resolution:
      'Complete the incomplete construct. Common causes: unclosed blocks, incomplete pipe chains, or missing expression after operator.',
    examples: [
      {
        description: 'Unclosed block',
        code: '{ "value"',
      },
      {
        description: 'Pipe with no target',
        code: '"hello" ->',
      },
      {
        description: 'Incomplete conditional',
        code: '?($x > 0) "yes"  # Missing else branch',
      },
    ],
  },
  {
    errorId: 'RILL-P003',
    category: 'parse',
    description: 'Invalid type annotation',
    messageTemplate: 'Invalid type annotation: {type}',
    cause:
      'Type name not recognized. Rill supports: string, number, bool, closure, list, dict, tuple.',
    resolution:
      'Use valid type name from supported set. Check spelling and casing (types are lowercase).',
    examples: [
      {
        description: 'Uppercase type name',
        code: '$x => String  # Use "string" not "String"',
      },
      {
        description: 'Invalid type name',
        code: '$x => int  # Use "number" for all numeric types',
      },
      {
        description: 'Angle-bracket generic syntax not supported',
        code: '$x => list<string>  # Use list(string) for typed lists',
      },
    ],
  },
  {
    errorId: 'RILL-P004',
    category: 'parse',
    description: 'Invalid expression',
    messageTemplate: 'Invalid expression: {details}',
    cause:
      'Expression structure violates grammar rules or contains unsupported constructs.',
    resolution:
      'Check expression syntax. Common causes: invalid operator combinations, malformed literals, or unsupported language features.',
    examples: [
      {
        description: 'Double operators',
        code: '$x + + $y',
      },
      {
        description: 'Assignment operator (not supported)',
        code: '$x = 5  # Use "5 => $x" instead',
      },
    ],
  },
  {
    errorId: 'RILL-P005',
    category: 'parse',
    description: 'Missing delimiter',
    messageTemplate: 'Missing {delimiter}, found {found}',
    cause:
      'Expected closing delimiter (parenthesis, bracket, brace) not found.',
    resolution:
      'Add the missing delimiter. Check for proper nesting and matching pairs.',
    examples: [
      {
        description: 'Missing closing parenthesis',
        code: 'func($a, $b',
      },
      {
        description: 'Missing closing bracket in tuple',
        code: '[1, 2, 3',
      },
      {
        description: 'Mismatched delimiters',
        code: '{ "value"]  # Opened with { but closed with ]',
      },
    ],
  },
  {
    errorId: 'RILL-P006',
    category: 'parse',
    description: 'Invalid syntax in context',
    messageTemplate: '{message}',
    cause:
      'A syntactic construct was used in a context where it is not allowed.',
    resolution: 'Check that the construct is used in the correct context.',
    examples: [
      {
        description: 'Spread in unsupported position',
        code: '$x.method(...$args)  # spread not supported in method calls',
      },
      {
        description: 'yield outside stream closure',
        code: '|x| yield  # yield requires :stream() return type',
      },
    ],
  },
  {
    errorId: 'RILL-P007',
    category: 'parse',
    description: 'Keyword and bracket not adjacent',
    messageTemplate:
      "keyword and bracket must be adjacent; found whitespace before '{bracket}'",
    cause:
      'Collection keyword (list, ordered, destruct, slice) must be written with its bracket immediately following, no whitespace allowed.',
    resolution:
      "Remove the whitespace between the keyword and its bracket. Write 'list[...]' not 'list [...]'.",
    examples: [
      {
        description: 'list with whitespace before [',
        code: 'list [1, 2]  # Error: use list[1, 2]',
      },
      {
        description: 'ordered with whitespace before [',
        code: 'ordered [a: 1]  # Error: use ordered[a: 1]',
      },
    ],
  },
  {
    errorId: 'RILL-P008',
    category: 'parse',
    description: 'Bare bracket at expression start',
    messageTemplate:
      'Bare [ at expression start is not valid; use list[...] or dict[...]',
    cause:
      'A bare [ token at expression start is ambiguous. Rill requires an explicit keyword prefix to distinguish list and dict literals.',
    resolution:
      'Use list[...] for a list literal or dict[key: val, ...] for a dict literal.',
    examples: [
      {
        description: 'Bare list literal',
        code: '[1, 2, 3]  # Error: use list[1, 2, 3]',
      },
      {
        description: 'Bare dict literal',
        code: '[a: 1, b: 2]  # Error: use dict[a: 1, b: 2]',
      },
    ],
  },
  {
    errorId: 'RILL-P009',
    category: 'parse',
    description: 'Removed sigil syntax',
    messageTemplate: 'Sigil syntax {sigil} was removed; {resolution}',
    cause:
      'Code uses a removed sigil-prefixed collection or extraction form that was replaced by keyword-prefixed syntax.',
    resolution:
      'Replace the sigil form with the keyword-prefixed equivalent. See examples for specific replacements.',
    examples: [
      {
        description: 'Old tuple sigil *[',
        code: '*[1, 2]  # Error: use tuple[1, 2] or ordered[a: 1]',
      },
      {
        description: 'Old destruct sigil *<',
        code: '$ -> *<$a, $b>  # Error: use destruct<$a, $b>',
      },
      {
        description: 'Old slice sigil /<',
        code: '$ -> /<1:3>  # Error: use slice<1:3>',
      },
    ],
  },
  {
    errorId: 'RILL-P010',
    category: 'parse',
    description: 'Invalid AT expression syntax',
    messageTemplate:
      "'@[' and '@$fn' are not valid expressions; use chain(...) to chain collections",
    cause:
      "The '@' token at expression start is only valid as a do-while loop terminator inside a loop body. '@[...]' and '@$fn' are not supported expression forms.",
    resolution:
      'Use chain(...) to chain collection operations, or restructure the expression to use a valid operator.',
    examples: [
      {
        description: 'Invalid @[ at expression start',
        code: '@[1, 2, 3]  # Error: use chain(...) instead',
      },
      {
        description: 'Invalid @$fn at expression start',
        code: '@$transform  # Error: use chain(...) instead',
      },
    ],
  },
  {
    errorId: 'RILL-P011',
    category: 'parse',
    description: 'Expected type name after pipe',
    messageTemplate: "Expected type name after '|'",
    cause:
      "A '|' in a type annotation position was not followed by a valid type name or '$' variable reference.",
    resolution:
      "Provide a valid type name or '$variable' after '|'. Example: 'string|number' or '$T|string'.",
    examples: [
      {
        description: 'Trailing pipe with no type',
        code: '$x: string|  # Error: missing type after |',
      },
    ],
  },
  {
    errorId: 'RILL-P012',
    category: 'parse',
    description: 'Removed syntax used',
    messageTemplate: 'Syntax removed: {details}',
    cause: 'Code uses a syntax form that was removed in a previous version.',
    resolution: 'Migrate to the replacement syntax shown in the error message.',
    examples: [
      {
        description: 'app:: direct-call syntax removed',
        code: 'app::fn()  # Error: use use<host:fn> instead',
      },
      {
        description: '-> export pipe syntax removed',
        code: '"value" -> export  # Error: use last-expression result instead',
      },
    ],
  },
  {
    errorId: 'RILL-P014',
    category: 'parse',
    description: 'Malformed type argument list',
    messageTemplate: '{details}',
    cause:
      'A type argument list has a syntax error: missing comma, closing paren, or invalid argument.',
    resolution:
      'Check the type argument list for missing commas or closing parentheses.',
    examples: [
      {
        description: 'Missing comma between type arguments',
        code: 'list(string number)  # Error: expected , or )',
      },
      {
        description: 'Missing closing paren',
        code: 'dict(key: string  # Error: expected )',
      },
    ],
  },
  {
    errorId: 'RILL-P020',
    category: 'parse',
    description: "Missing ':' in use<> static form",
    messageTemplate: "Expected ':' after scheme in use<>",
    cause:
      "The static form of use<> requires a ':' separating the scheme from the resource path (e.g., use<scheme:path>).",
    resolution:
      "Add ':' after the scheme identifier. Example: use<module:path.to.resource>",
    examples: [
      {
        description: 'Missing colon in use<>',
        code: 'use<module>  # Error: expected scheme:resource',
      },
    ],
  },
  {
    errorId: 'RILL-P021',
    category: 'parse',
    description: 'Empty resource after colon in use<>',
    messageTemplate: "Expected resource identifier after ':' in use<>",
    cause:
      "The static form of use<> requires at least one resource segment after ':'.",
    resolution:
      "Provide a resource path after ':'. Example: use<module:resource>",
    examples: [
      {
        description: 'Empty resource in use<>',
        code: 'use<module:>  # Error: missing resource after colon',
      },
    ],
  },
  {
    errorId: 'RILL-P022',
    category: 'parse',
    description: "Missing '>' to close use<>",
    messageTemplate: "Expected '>' to close use<>",
    cause: "The use<> expression was not closed with a matching '>'.",
    resolution: "Add '>' to close the use<> expression.",
    examples: [
      {
        description: 'Unclosed use<>',
        code: 'use<module:resource  # Error: missing >',
      },
    ],
  },

  // Runtime Errors (RILL-R0xx)
  {
    errorId: 'RILL-R001',
    category: 'runtime',
    description: 'Parameter type mismatch',
    messageTemplate:
      'Function {function} expects parameter {param} (position {position}) to be {expected}, got {actual}',
    cause:
      'Argument passed to function does not match declared parameter type.',
    resolution:
      'Pass value of correct type, or convert the value before passing. Check function signature for expected types.',
    examples: [
      {
        description: 'String passed to number parameter',
        code: '|x: number| $x * 2\n"5" -> $()',
      },
      {
        description: 'Number passed to string method',
        code: '123 -> .split(",")  # split expects string',
      },
    ],
  },
  {
    errorId: 'RILL-R002',
    category: 'runtime',
    description: 'Operator type mismatch',
    messageTemplate:
      'Operator {operator} cannot be applied to {leftType} and {rightType}',
    cause:
      'Binary operator applied to incompatible types. Rill does not perform implicit type coercion.',
    resolution:
      'Ensure both operands are compatible types. Convert values explicitly if needed using type-specific methods.',
    examples: [
      {
        description: 'Adding string and number',
        code: '"5" + 1  # Error: no implicit coercion',
      },
      {
        description: 'Comparing different types',
        code: '"10" == 10  # Always false, no coercion',
      },
      {
        description: 'Arithmetic on non-numbers',
        code: '"hello" * 2',
      },
    ],
  },
  {
    errorId: 'RILL-R003',
    category: 'runtime',
    description: 'Method receiver type mismatch',
    messageTemplate: 'Method {method} cannot be called on {type}',
    cause:
      'Method called on value of wrong type. String methods require strings, list methods require lists, etc.',
    resolution:
      'Call method on correct type, or convert value before calling. Check method documentation for receiver type.',
    examples: [
      {
        description: 'String method on number',
        code: '123 -> .upper()  # upper() is string method',
      },
      {
        description: 'List method on string',
        code: '"hello" -> .first()  # first() is list method',
      },
    ],
  },
  {
    errorId: 'RILL-R005',
    category: 'runtime',
    description: 'Undefined variable',
    messageTemplate: 'Variable {name} is not defined',
    cause:
      'Variable referenced before assignment, or variable name misspelled.',
    resolution:
      'Assign value to variable before use (value => $var), or check spelling. Variables must be captured before reference.',
    examples: [
      {
        description: 'Variable used before assignment',
        code: '$count + 1  # $count never assigned',
      },
      {
        description: 'Typo in variable name',
        code: '"hi" => $mesage\n$message  # Typo: mesage vs message',
      },
      {
        description: 'Variable out of scope',
        code: '{ "local" => $x }\n$x  # $x only exists inside block',
      },
    ],
  },
  {
    errorId: 'RILL-R006',
    category: 'runtime',
    description: 'Undefined function',
    messageTemplate: 'Function {name} is not defined',
    cause:
      'Function name not found in runtime context (not a built-in or host-provided function).',
    resolution:
      'Check function name spelling, ensure function is provided by host application, or verify module imports.',
    examples: [
      {
        description: 'Misspelled function name',
        code: 'leng("hello")  # Should be length()',
      },
      {
        description: 'Missing host function',
        code: 'app::fetch($url)  # Host must provide app::fetch',
      },
    ],
  },
  {
    errorId: 'RILL-R007',
    category: 'runtime',
    description: 'Undefined method',
    messageTemplate: 'Method {method} is not defined on {type}',
    cause:
      'Method name not supported for the given type, or method name misspelled.',
    resolution:
      'Check method documentation for the type. Verify method name spelling and that it exists for this type.',
    examples: [
      {
        description: 'Method not available on type',
        code: '123 -> .trim()  # trim() only on strings',
      },
      {
        description: 'Misspelled method name',
        code: '"hello" -> .upcase()  # Should be .upper()',
      },
    ],
  },
  {
    errorId: 'RILL-R008',
    category: 'runtime',
    description: 'Undefined annotation',
    messageTemplate: 'Annotation {key} is not defined',
    cause: 'Annotation key accessed but not set on statement or parameter.',
    resolution:
      'Set annotation before accessing (^(key: value)), or check annotation key spelling.',
    examples: [
      {
        description: 'Accessing undefined annotation',
        code: '$stmt.^timeout  # No ^(timeout: ...) set',
      },
    ],
  },
  {
    errorId: 'RILL-R009',
    category: 'runtime',
    description: 'Property not found',
    messageTemplate: 'Property {property} not found on {type}',
    cause: 'Dict key or tuple index does not exist in the value.',
    resolution:
      'Check property name spelling, verify the property exists, or use null-coalescing (??) to provide default. For safe access, use .? operator.',
    examples: [
      {
        description: 'Missing dict key',
        code: '[name: "x"] -> .age  # age key not in dict',
      },
      {
        description: 'Index out of bounds',
        code: '[1, 2, 3] -> [5]  # Only 3 elements (0-2)',
      },
      {
        description: 'Safe alternative',
        code: '[name: "x"] -> .age ?? 0  # Returns 0 if missing',
      },
    ],
  },
  {
    errorId: 'RILL-R010',
    category: 'runtime',
    description: 'Iteration limit exceeded',
    messageTemplate: 'Iteration limit of {limit} exceeded',
    cause:
      'Loop or collection operation exceeded configured iteration limit (prevents infinite loops).',
    resolution:
      'Reduce data size, adjust iteration limit via RuntimeOptions, or check for infinite loop conditions.',
    examples: [
      {
        description: 'Infinite loop without termination',
        code: 'while (true) do { "looping" }  # Never terminates',
      },
      {
        description: 'Large collection with default limit',
        code: 'range(0, 1000000) -> each |x| $x  # May exceed default limit',
      },
    ],
  },
  {
    errorId: 'RILL-R011',
    category: 'runtime',
    description: 'Invalid regex pattern',
    messageTemplate: 'Invalid regex pattern: {pattern}',
    cause:
      'Regular expression pattern has invalid syntax or unsupported features.',
    resolution:
      'Fix regex syntax errors. Check for unescaped special characters, unclosed groups, or invalid quantifiers.',
    examples: [
      {
        description: 'Unclosed group',
        code: '"test" -> .match("(abc")  # Missing closing )',
      },
      {
        description: 'Invalid quantifier',
        code: '"test" -> .match("a{,5}")  # Empty min in range',
      },
    ],
  },
  {
    errorId: 'RILL-R012',
    category: 'runtime',
    description: 'Operation timeout',
    messageTemplate: 'Operation timed out after {timeout}ms',
    cause: 'Function execution exceeded configured timeout duration.',
    resolution:
      'Increase timeout via RuntimeOptions, optimize slow operations, or add ^(timeout: ms) annotation to specific calls.',
    examples: [
      {
        description: 'Slow host function',
        code: 'app::slow_api()  # Times out if exceeds limit',
      },
      {
        description: 'Setting higher timeout',
        code: '^(timeout: 30000) app::slow_api()  # 30 seconds',
      },
    ],
  },
  {
    errorId: 'RILL-R013',
    category: 'runtime',
    description: 'Execution aborted',
    messageTemplate: 'Execution aborted by signal',
    cause: 'Host application cancelled execution via AbortSignal.',
    resolution:
      'This is intentional cancellation, not an error. If unexpected, check host abort signal logic.',
    examples: [
      {
        description: 'User cancellation in UI',
        code: '# Long-running script cancelled by user',
      },
    ],
  },
  {
    errorId: 'RILL-R014',
    category: 'runtime',
    description: 'Auto-exception triggered',
    messageTemplate: 'Auto-exception triggered: pattern {pattern} matched',
    cause:
      'Value matched auto-exception pattern (configured to halt on specific error patterns in output).',
    resolution:
      'Handle error condition that produced the matched pattern, or adjust auto-exception configuration.',
    examples: [
      {
        description: 'API error response',
        code: '# API returned "ERROR:" prefix, auto-exception configured to catch this',
      },
    ],
  },
  {
    errorId: 'RILL-R015',
    category: 'runtime',
    description: 'Assertion failed',
    messageTemplate: 'Assertion failed: {condition}',
    cause: 'Assertion statement evaluated to false.',
    resolution:
      'Fix the condition causing assertion failure, or remove/adjust assertion if condition is incorrect.',
    examples: [
      {
        description: 'Basic assertion',
        code: 'assert $count > 0  # Fails if $count <= 0',
      },
      {
        description: 'Assertion with message',
        code: 'assert $age >= 18 "Must be adult"',
      },
    ],
  },
  {
    errorId: 'RILL-R016',
    category: 'runtime',
    description: 'Error statement executed',
    messageTemplate: 'Error raised: {message}',
    cause: 'Error statement executed explicitly in code.',
    resolution:
      'This is intentional error raising. Fix the condition that triggers the error statement, or handle the error case differently.',
    examples: [
      {
        description: 'Explicit error',
        code: 'error "Invalid configuration"',
      },
      {
        description: 'Conditional error',
        code: '($status == "failed") ? { error "Process failed" } ! "ok"',
      },
    ],
  },
  {
    errorId: 'RILL-R017',
    category: 'runtime',
    description: 'fs extension: unknown mount',
    messageTemplate: 'mount "{mountName}" not configured',
    cause:
      'Script references mount name that does not exist in fs extension configuration, or mount path is invalid.',
    resolution:
      'Verify mount name is correct, ensure mount is configured in createFsExtension() call, and check mount path exists.',
    examples: [
      {
        description: 'Unknown mount',
        code: 'fs::read("unknown", "file.txt")  # Mount "unknown" not in config',
      },
      {
        description: 'Invalid mount path',
        code: '# createFsExtension({ mounts: { data: { path: "/nonexistent", mode: "read" } } })',
      },
    ],
  },
  {
    errorId: 'RILL-R018',
    category: 'runtime',
    description: 'fs extension: path escapes mount boundary',
    messageTemplate: 'path escapes mount boundary',
    cause:
      'Path traversal attempt (using .. or symlinks) escapes configured mount boundary.',
    resolution:
      'Remove path traversal attempts, use paths relative to mount root, or reconfigure mount boundaries.',
    examples: [
      {
        description: 'Path traversal with ..',
        code: 'fs::read("data", "../../etc/passwd")  # Attempts escape',
      },
      {
        description: 'Symlink escape',
        code: 'fs::read("data", "symlink_to_root")  # Symlink points outside mount',
      },
    ],
  },
  {
    errorId: 'RILL-R019',
    category: 'runtime',
    description: 'fs extension: file type not permitted in mount',
    messageTemplate: 'file type not permitted in mount "{mountName}"',
    cause:
      'Filename does not match mount glob pattern (e.g., trying to read .exe when only *.csv allowed).',
    resolution:
      'Use file with allowed extension, or reconfigure mount glob pattern to permit file type.',
    examples: [
      {
        description: 'Glob mismatch',
        code: 'fs::read("csv_only", "data.json")  # Mount configured with glob: "*.csv"',
      },
      {
        description: 'Multiple extensions',
        code: 'fs::read("configs", "app.ini")  # Mount glob: "*.{json,yaml}"',
      },
    ],
  },
  {
    errorId: 'RILL-R020',
    category: 'runtime',
    description: 'fs extension: mount does not permit operation',
    messageTemplate: 'mount "{mountName}" does not permit {operation}',
    cause:
      'Operation (read or write) not permitted by mount mode (e.g., write to read-only mount).',
    resolution:
      'Use mount with appropriate mode, or reconfigure mount to allow operation.',
    examples: [
      {
        description: 'Write to read-only mount',
        code: 'fs::write("readonly", "file.txt", "data")  # Mount mode: "read"',
      },
      {
        description: 'Read from write-only mount',
        code: 'fs::read("writeonly", "file.txt")  # Mount mode: "write"',
      },
    ],
  },
  {
    errorId: 'RILL-R021',
    category: 'runtime',
    description: 'fs extension: permission denied or file not found',
    messageTemplate: 'permission denied: {path}',
    cause:
      'Operating system denied access to file (EACCES/EPERM), or file does not exist (ENOENT).',
    resolution:
      'Check file permissions, verify file exists, ensure user has appropriate access rights.',
    examples: [
      {
        description: 'Permission denied',
        code: 'fs::read("data", "protected.txt")  # File exists but no read permission',
      },
      {
        description: 'File not found',
        code: 'fs::read("data", "missing.txt")  # File does not exist',
      },
    ],
  },
  {
    errorId: 'RILL-R022',
    category: 'runtime',
    description: 'fetch extension: HTTP 4xx client error',
    messageTemplate: '{namespace}: HTTP {status} — {body}',
    cause: 'HTTP request returned a 4xx client error status code.',
    resolution:
      'Check request parameters, verify authentication, or adjust request payload.',
    examples: [
      {
        description: 'HTTP 404 Not Found',
        code: 'fetch::get("api", "/nonexistent")  # Returns 404',
      },
      {
        description: 'HTTP 400 Bad Request',
        code: 'fetch::post("api", "/users", [invalid: "data"])  # Returns 400',
      },
    ],
  },
  {
    errorId: 'RILL-R023',
    category: 'runtime',
    description: 'fetch extension: HTTP 5xx after retries',
    messageTemplate: '{namespace}: HTTP {status} after {retries} retries',
    cause: 'HTTP request returned a 5xx server error after all retry attempts.',
    resolution:
      'Check server status, reduce request frequency, or increase retry limit.',
    examples: [
      {
        description: 'HTTP 503 Service Unavailable',
        code: 'fetch::get("api", "/resource")  # Server returns 503',
      },
    ],
  },
  {
    errorId: 'RILL-R024',
    category: 'runtime',
    description: 'fetch extension: request timeout',
    messageTemplate: '{namespace}: request timeout ({timeoutMs}ms)',
    cause: 'HTTP request exceeded configured timeout duration.',
    resolution:
      'Increase timeout via extension configuration, or optimize server response time.',
    examples: [
      {
        description: 'Slow API endpoint',
        code: 'fetch::get("api", "/slow")  # Times out if exceeds limit',
      },
    ],
  },
  {
    errorId: 'RILL-R025',
    category: 'runtime',
    description: 'fetch extension: network error',
    messageTemplate: '{namespace}: network error — {message}',
    cause:
      'Network request failed (DNS resolution, connection refused, or other network issue).',
    resolution:
      'Check network connectivity, verify server is reachable, or check firewall settings.',
    examples: [
      {
        description: 'Connection refused',
        code: 'fetch::get("api", "/endpoint")  # Server not running',
      },
    ],
  },
  {
    errorId: 'RILL-R026',
    category: 'runtime',
    description: 'fetch extension: invalid JSON response',
    messageTemplate: '{namespace}: invalid JSON response',
    cause: 'Response body could not be parsed as JSON.',
    resolution:
      'Check response Content-Type header, verify server returns valid JSON, or use raw response parsing.',
    examples: [
      {
        description: 'HTML error page returned as JSON',
        code: 'fetch::get("api", "/endpoint")  # Server returns HTML instead of JSON',
      },
    ],
  },

  // AHI Extension Errors (RILL-R027–RILL-R034)
  {
    errorId: 'RILL-R027',
    category: 'runtime',
    description: 'ahi extension: validation failed (HTTP 400)',
    messageTemplate: '{message}',
    cause: 'Downstream agent rejected the request with HTTP 400.',
    resolution: 'Check request parameters match the downstream agent schema.',
    examples: [
      {
        description: 'Missing required parameter',
        code: 'ahi::parser([])  # Agent expects a non-empty params dict',
      },
    ],
  },
  {
    errorId: 'RILL-R028',
    category: 'runtime',
    description: 'ahi extension: agent unreachable (HTTP 404)',
    messageTemplate: '{message}',
    cause: 'Downstream agent endpoint returned HTTP 404.',
    resolution: 'Verify the agent URL is correct and the agent is deployed.',
    examples: [
      {
        description: 'Wrong agent path',
        code: '# Agent configured with stale URL pointing to removed route',
      },
    ],
  },
  {
    errorId: 'RILL-R029',
    category: 'runtime',
    description: 'ahi extension: downstream exec failed',
    messageTemplate: '{message}',
    cause: 'Downstream agent returned HTTP 500.',
    resolution: 'Check downstream agent logs for the root cause.',
    examples: [
      {
        description: 'Unhandled error in downstream agent',
        code: 'ahi::parser([input: $text])  # Downstream agent crashes',
      },
    ],
  },
  {
    errorId: 'RILL-R030',
    category: 'runtime',
    description: 'ahi extension: timeout exceeded',
    messageTemplate: '{message}',
    cause: 'HTTP request to downstream agent exceeded configured timeout.',
    resolution:
      'Increase the AHI extension timeout or reduce downstream latency.',
    examples: [
      {
        description: 'Slow downstream agent',
        code: '# createAhiExtension({ agents: { slow: { url: "..." } }, timeout: 5000 })',
      },
    ],
  },
  {
    errorId: 'RILL-R031',
    category: 'runtime',
    description: 'ahi extension: connection refused',
    messageTemplate: '{message}',
    cause:
      'Network error contacting downstream agent (DNS failure, connection refused).',
    resolution:
      'Verify the agent URL, ensure the agent is running, and check network access.',
    examples: [
      {
        description: 'Agent not running',
        code: '# Agent configured with http://localhost:4001 but service is down',
      },
    ],
  },
  {
    errorId: 'RILL-R032',
    category: 'runtime',
    description: 'ahi extension: rate limited (HTTP 429)',
    messageTemplate: '{message}',
    cause: 'Downstream agent returned HTTP 429 (rate limited).',
    resolution:
      'Reduce request frequency or increase rate limits on the downstream agent.',
    examples: [
      {
        description: 'Too many concurrent requests',
        code: 'ahi::parser([input: $text])  # Agent enforces per-second request quota',
      },
    ],
  },
  {
    errorId: 'RILL-R033',
    category: 'runtime',
    description: 'ahi extension: extension disposed',
    messageTemplate: '{message}',
    cause: 'AHI extension has been disposed; no further calls are permitted.',
    resolution:
      'Do not call AHI functions after the extension has been disposed.',
    examples: [
      {
        description: 'Call after dispose',
        code: '# Host called extension.dispose() then continued running script',
      },
    ],
  },
  {
    errorId: 'RILL-R034',
    category: 'runtime',
    description: 'ahi extension: downstream HTTP error',
    messageTemplate: '{message}',
    cause: 'Downstream agent returned an unexpected HTTP error status code.',
    resolution:
      'Check the downstream agent for details about the error status.',
    examples: [
      {
        description: 'HTTP 503 Service Unavailable',
        code: 'ahi::parser([input: $text])  # Downstream returns 503',
      },
    ],
  },
  {
    errorId: 'RILL-R035',
    category: 'runtime',
    description: 'ahi extension: agent unresolvable',
    messageTemplate: '{message}',
    cause:
      'Registry could not resolve the symbolic agent name at boot or on first call.',
    resolution:
      'Verify the agent is registered in the registry and the registry URL is correct.',
    examples: [
      {
        description: 'Agent not registered',
        code: '# createAhiExtension({ agents: ["parser"], registry: "http://registry:8080" })\n# Registry has no entry for "parser"',
      },
    ],
  },

  // Collection literal, conversion, chain, and list dispatch errors (RILL-R036–RILL-R042)
  {
    errorId: 'RILL-R036',
    category: 'runtime',
    description: 'Incompatible convert source/target',
    messageTemplate: 'cannot convert {source} to {target}',
    cause:
      'The `-> type` form does not support conversion between the given source and target types. -> string accepts any source type. -> number accepts only string (must be numeric) and bool (produces 0 or 1). Other targets (-> boolean, -> list, -> dict, -> tuple, -> ordered) have their own accepted sources.',
    resolution:
      'Check the target type. Use -> string to convert any value to its string representation. For -> number, only string and bool sources are accepted. Verify the source type matches the accepted sources for the target type.',
    examples: [
      {
        description: 'String to list conversion',
        code: '"hello" -> list  # Not allowed',
      },
    ],
  },
  {
    errorId: 'RILL-R037',
    category: 'runtime',
    description: 'dict -> ordered without structural signature',
    messageTemplate:
      'dict to ordered conversion requires structural type signature',
    cause:
      'Converting a dict to ordered with -> ordered requires an explicit ordered(field: type, ...) type signature to determine field order.',
    resolution:
      'Provide a structural type signature: $dict -> ordered(name: string, age: number)',
    examples: [
      {
        description: 'Missing structural signature',
        code: '$dict -> ordered  # Ambiguous field order',
      },
    ],
  },
  {
    errorId: 'RILL-R038',
    category: 'runtime',
    description: 'Non-parseable string to number',
    messageTemplate: 'cannot convert string "{value}" to number',
    cause: 'The string does not represent a valid number.',
    resolution:
      'Ensure the string contains a valid numeric format before converting with -> number.',
    examples: [
      {
        description: 'Non-numeric string',
        code: '"hello" -> number  # Not a number',
      },
    ],
  },
  {
    errorId: 'RILL-R039',
    category: 'runtime',
    description: 'Retired: type-value variable dispatch (`:>` form)',
    messageTemplate: 'expected type value, got {actual}',
    cause:
      'This error was raised by the legacy `:>$var` conversion form when the variable did not hold a type value. The `:>` operator has been removed; variable dispatch now falls through to RILL-R002 when the target variable does not hold a dispatchable value.',
    resolution:
      'This error code is no longer thrown. If a variable pipe target produces an unexpected dispatch error, see RILL-R002.',
    examples: [
      {
        description:
          'Legacy: `:>$var` where $var held a string (no longer thrown; produces RILL-R002)',
        code: '# "list" => $t\n# "hello" :> $t  # was: expected type value, got string',
      },
    ],
  },
  {
    errorId: 'RILL-R040',
    category: 'runtime',
    description: 'chain() non-closure argument',
    messageTemplate: 'chain() argument must be a closure or list of closures',
    cause:
      'The chain() built-in received a value that is neither a closure nor a list of closures.',
    resolution: 'Pass a single closure or a list of closures to chain().',
    examples: [
      {
        description: 'Passing a number to chain()',
        code: '5 -> chain(42)  # 42 is not a closure',
      },
    ],
  },
  {
    errorId: 'RILL-R041',
    category: 'runtime',
    description: 'List dispatch non-integer index',
    messageTemplate: 'list index must be an integer',
    cause: 'The index piped to a list[...] dispatch is not an integer.',
    resolution:
      'Ensure the index is a whole number. Use math operations to convert if needed.',
    examples: [
      {
        description: 'Floating-point index',
        code: '1.5 -> list["a", "b"]  # Not an integer',
      },
    ],
  },
  {
    errorId: 'RILL-R042',
    category: 'runtime',
    description: 'List dispatch index out of range',
    messageTemplate: 'list index {n} out of range (length: {m})',
    cause:
      'The index piped to a list[...] dispatch is outside the valid range.',
    resolution: 'Use an index within [0, length-1] or add a fallback with ??.',
    examples: [
      {
        description: 'Index beyond end',
        code: '5 -> list["a", "b"]  # Only 2 elements (indices 0-1)',
      },
    ],
  },
  {
    errorId: 'RILL-R043',
    category: 'runtime',
    description: 'Non-producing closure body or script',
    messageTemplate: '{context} produced no value',
    cause:
      'A closure body or script contains no statements that produce a value.',
    resolution:
      'Ensure the closure body or script ends with an expression that produces a value.',
    examples: [
      {
        description: 'Empty closure body',
        code: '|x: number| { }  # No value produced',
      },
      {
        description: 'Script with only comments',
        code: '# just a comment  # No value produced',
      },
    ],
  },
  {
    errorId: 'RILL-R044',
    category: 'runtime',
    description: 'Missing required member in conversion',
    messageTemplate:
      "cannot convert {source} to {target}: missing required member '{name}'",
    cause:
      'The `-> type` form requires all fields/elements without defaults to be present in the source value.',
    resolution:
      'Supply the missing field or element in the source value, or add a default to the type annotation.',
    examples: [
      {
        description: 'Dict missing a required field',
        code: '[name: "Alice"] -> dict(name: string, age: number)  # age is missing',
      },
      {
        description: 'Tuple missing a required element',
        code: 'tuple["a"] -> tuple(string, number)  # element at position 1 is missing',
      },
    ],
  },

  {
    errorId: 'RILL-R045',
    category: 'runtime',
    description: 'Too many arguments passed to callable',
    messageTemplate: 'Expected {expected} args, got {actual}',
    cause:
      'The number of arguments passed to a callable exceeds the number of declared parameters.',
    resolution:
      'Remove the excess arguments or add more parameters to the callable definition.',
    examples: [
      {
        description: 'Too many arguments to a two-param closure',
        code: '|x: number, y: number| { x + y } -> app::call(1, 2, 3)  # 3 args, 2 params',
      },
    ],
  },

  // Resolver errors (RILL-R050–RILL-R059)
  {
    errorId: 'RILL-R050',
    category: 'runtime',
    description: 'Module not found in resolver config',
    messageTemplate: "Module '{resource}' not found in resolver config",
    cause: 'The module ID is absent from the moduleResolver config map.',
    resolution:
      'Add an entry for the module ID to the moduleResolver config object.',
    examples: [
      {
        description: 'Missing module entry',
        code: '# moduleResolver config lacks key for the requested module',
      },
    ],
  },
  {
    errorId: 'RILL-R051',
    category: 'runtime',
    description: 'Module file read failure',
    messageTemplate: "Failed to read module '{resource}': {reason}",
    cause: 'The file path mapped to the module ID could not be read.',
    resolution:
      'Verify the file path exists and the process has read permission.',
    examples: [
      {
        description: 'File does not exist',
        code: '# Path in moduleResolver config points to a missing file',
      },
    ],
  },
  {
    errorId: 'RILL-R052',
    category: 'runtime',
    description: 'Extension not found in resolver config',
    messageTemplate: "Extension '{name}' not found in resolver config",
    cause: 'The extension name is absent from the extResolver config map.',
    resolution:
      'Add an entry for the extension name to the extResolver config object.',
    examples: [
      {
        description: 'Missing extension entry',
        code: '# extResolver config lacks key for the requested extension',
      },
    ],
  },
  {
    errorId: 'RILL-R053',
    category: 'runtime',
    description: 'Member path not found in extension',
    messageTemplate: "Member '{path}' not found in extension '{name}'",
    cause: 'The dot-path member does not exist in the extension value.',
    resolution:
      'Verify the member path matches the structure of the extension dict.',
    examples: [
      {
        description: 'Nonexistent member',
        code: '# ext::qdrant.missing — "missing" key not in qdrant extension',
      },
    ],
  },
  {
    errorId: 'RILL-R054',
    category: 'runtime',
    description: 'No resolver registered for scheme',
    messageTemplate: "No resolver registered for scheme '{scheme}'",
    cause:
      'A use<> expression referenced a scheme with no registered resolver.',
    resolution:
      'Register a resolver for the scheme via RuntimeOptions.resolvers. Example: resolvers: { myScheme: myResolver }.',
    examples: [
      {
        description: 'Unregistered scheme',
        code: 'use<db:users>  # no resolver registered for "db"',
      },
    ],
  },
  {
    errorId: 'RILL-R055',
    category: 'runtime',
    description: 'Circular resolution detected',
    messageTemplate:
      'Circular resolution detected: {key} is already being resolved',
    cause:
      'A use<> resolver returned source that re-entered the same scheme:resource key.',
    resolution:
      'Remove the circular dependency from module sources. Ensure module A does not directly or indirectly use<module:A>.',
    examples: [
      {
        description: 'Self-referencing module',
        code: '# module:a source contains use<module:a>',
      },
    ],
  },
  {
    errorId: 'RILL-R056',
    category: 'runtime',
    description: 'Resolver callback threw an error',
    messageTemplate: "Resolver error for '{scheme}:{resource}': {message}",
    cause:
      'The registered resolver function for the given scheme threw an exception.',
    resolution:
      'Inspect the original error message in the RILL-R056 detail and fix the resolver implementation.',
    examples: [
      {
        description: 'Network error in resolver',
        code: '# resolver throws "connection refused"',
      },
    ],
  },
  {
    errorId: 'RILL-R057',
    category: 'runtime',
    description: 'use<> identifier must resolve to string',
    messageTemplate: 'use<> identifier must resolve to string, got {type}',
    cause:
      'Variable or computed form of use<> evaluated to a non-string value.',
    resolution:
      'Ensure the variable or expression inside use<> evaluates to a string of the form "scheme:resource".',
    examples: [
      {
        description: 'Variable holds a number',
        code: '42 => $id\nuse<$id>  # $id must be a string',
      },
    ],
  },
  {
    errorId: 'RILL-R058',
    category: 'runtime',
    description: "use<> identifier must contain ':' scheme separator",
    messageTemplate: "use<> identifier must contain ':' scheme separator",
    cause:
      'The dynamic use<> string did not contain a colon separating scheme from resource.',
    resolution:
      'Ensure the string has the format "scheme:resource". Example: "module:greetings".',
    examples: [
      {
        description: 'Missing colon',
        code: '"nocolon" => $id\nuse<$id>  # missing : separator',
      },
    ],
  },
  {
    errorId: 'RILL-R059',
    category: 'runtime',
    description: 'moduleResolver config is not a plain object',
    messageTemplate: 'moduleResolver config must be a plain object',
    cause: 'The config passed to moduleResolver is not a plain object.',
    resolution:
      'Pass a plain object as the moduleResolver config (e.g., { myModule: "/app/mod.rill" }). Paths must be absolute; resolve them before passing in.',
    examples: [
      {
        description: 'Non-object config',
        code: '# moduleResolver config was null or an array',
      },
    ],
  },

  // Legacy syntax removal errors (RILL-R060)
  {
    errorId: 'RILL-R060',
    category: 'runtime',
    description: 'Removed frontmatter key used',
    messageTemplate: 'Frontmatter key removed: {details}',
    cause:
      'Script uses a frontmatter key that was removed in a previous version.',
    resolution: 'Migrate to the replacement shown in the error message.',
    examples: [
      {
        description: 'use: frontmatter key removed',
        code: '---\nuse:\n  - myMod: ./mod.rill\n---\n# Error: use use<module:...> expression instead',
      },
      {
        description: 'export: frontmatter key removed',
        code: '---\nexport:\n  - $result\n---\n# Error: use last-expression result instead',
      },
    ],
  },

  // parseSource not configured (RILL-R061)
  {
    errorId: 'RILL-R061',
    category: 'runtime',
    description: 'parseSource not configured in RuntimeContext',
    messageTemplate:
      "Resolver error for '{scheme}:{resource}': parseSource is not configured on RuntimeContext — provide parseSource in RuntimeOptions to use source resolvers",
    cause:
      'A resolver returned { kind: "source" } but RuntimeOptions.parseSource was not provided.',
    resolution:
      'Pass parseSource in RuntimeOptions when constructing the runtime context. parseSource is required for resolvers that return source text.',
    examples: [
      {
        description: 'Missing parseSource option',
        code: '# resolver returns { kind: "source", text: "..." } but host did not pass parseSource',
      },
    ],
  },

  // Context key not found (RILL-R062)
  {
    errorId: 'RILL-R062',
    category: 'runtime',
    description: 'Context key not found',
    messageTemplate: "Context key '{key}' not found",
    cause: 'The requested dot-path key does not exist in the context config.',
    resolution:
      'Ensure the key is present in the context configuration passed to contextResolver.',
    examples: [
      {
        description: 'Missing top-level key',
        code: '# use<context:timeout> but "timeout" is not in context config',
      },
    ],
  },

  // Context path segment not a dict (RILL-R063)
  {
    errorId: 'RILL-R063',
    category: 'runtime',
    description: 'Context path segment is not a dict',
    messageTemplate: "Context path '{path}': '{segment}' is not a dict",
    cause:
      'A dot-path segment resolves to a non-dict value, so traversal cannot continue.',
    resolution:
      'Ensure each intermediate segment in the dot-path is a nested dict in the context config.',
    examples: [
      {
        description: 'Non-dict intermediate segment',
        code: '# use<context:limits.max_tokens> but "limits" is a string, not a dict',
      },
    ],
  },

  // Type conversion: string to number (RILL-R064)
  {
    errorId: 'RILL-R064',
    category: 'runtime',
    description: 'Cannot convert string to number',
    messageTemplate: 'Cannot convert string "{value}" to number',
    cause:
      'The string value is not a valid numeric representation or is empty/whitespace.',
    resolution:
      'Ensure the string contains a valid number before converting. Use as(number) only on numeric strings.',
    examples: [
      {
        description: 'Non-numeric string conversion',
        code: '"hello" -> as(number)  # Error: not a valid number',
      },
    ],
  },

  // Type conversion: string to bool (RILL-R065)
  {
    errorId: 'RILL-R065',
    category: 'runtime',
    description: 'Cannot convert string to bool',
    messageTemplate: 'Cannot convert string "{value}" to bool',
    cause: 'Only the strings "true" and "false" can convert to bool.',
    resolution: 'Use the exact strings "true" or "false" for bool conversion.',
    examples: [
      {
        description: 'Invalid bool string',
        code: '"yes" -> as(bool)  # Error: only "true"/"false" allowed',
      },
    ],
  },

  // Type conversion: number to bool (RILL-R066)
  {
    errorId: 'RILL-R066',
    category: 'runtime',
    description: 'Cannot convert number to bool',
    messageTemplate: 'Cannot convert number {value} to bool',
    cause:
      'Only the numbers 0 and 1 can convert to bool. Other numeric values have no bool equivalent.',
    resolution: 'Use 0 (false) or 1 (true) for number-to-bool conversion.',
    examples: [
      {
        description: 'Non-binary number conversion',
        code: '42 -> as(bool)  # Error: only 0 and 1 allowed',
      },
    ],
  },

  // JSON serialization: value not serializable (RILL-R067)
  {
    errorId: 'RILL-R067',
    category: 'runtime',
    description: 'Value is not JSON-serializable',
    messageTemplate: '{typeName} are not JSON-serializable',
    cause:
      'The value type cannot be represented in JSON. Only strings, numbers, bools, lists, and dicts serialize.',
    resolution:
      'Convert the value to a serializable type before JSON operations. Extract data from closures or iterators first.',
    examples: [
      {
        description: 'Closure in JSON context',
        code: '|x| $x + 1 -> as(string)  # Error: closures not serializable',
      },
    ],
  },

  // Method registration: frozen type registration (RILL-R068)
  {
    errorId: 'RILL-R068',
    category: 'runtime',
    description: 'Type registration is frozen',
    messageTemplate:
      "Cannot populate methods on type '{typeName}': registration is frozen",
    cause:
      'The type registration object was deep-frozen, preventing method assignment.',
    resolution:
      'Ensure type registrations are not deep-frozen before calling populateBuiltinMethods.',
    examples: [
      {
        description: 'Frozen registration object',
        code: '# Object.freeze(registration) prevents method population',
      },
    ],
  },

  // Context validation: function missing description (RILL-R069)
  {
    errorId: 'RILL-R069',
    category: 'runtime',
    description: 'Function missing required description',
    messageTemplate:
      "Function '{name}' requires description (requireDescriptions enabled)",
    cause:
      'The requireDescriptions option is enabled but the function has no description.',
    resolution:
      'Add a description field to the function definition, or disable requireDescriptions.',
    examples: [
      {
        description: 'Missing function description',
        code: '# registerFunction("greet", { fn: ... }) with requireDescriptions: true',
      },
    ],
  },

  // Context validation: parameter missing description (RILL-R070)
  {
    errorId: 'RILL-R070',
    category: 'runtime',
    description: 'Parameter missing required description',
    messageTemplate:
      "Parameter '{paramName}' of function '{functionName}' requires description (requireDescriptions enabled)",
    cause:
      'The requireDescriptions option is enabled but a parameter has no description annotation.',
    resolution:
      'Add a description annotation to each parameter, or disable requireDescriptions.',
    examples: [
      {
        description: 'Missing parameter description',
        code: '# param { name: "x", annotations: {} } with requireDescriptions: true',
      },
    ],
  },

  // Context validation: duplicate type registration (RILL-R071)
  {
    errorId: 'RILL-R071',
    category: 'runtime',
    description: 'Duplicate type registration',
    messageTemplate: "Duplicate type registration '{typeName}'",
    cause:
      'Two type registrations share the same name. Each type name must be unique.',
    resolution: 'Remove or rename the duplicate type registration.',
    examples: [
      {
        description: 'Duplicate type name',
        code: '# Two registrations both named "string"',
      },
    ],
  },

  // Context validation: missing format protocol (RILL-R072)
  {
    errorId: 'RILL-R072',
    category: 'runtime',
    description: 'Type missing format protocol',
    messageTemplate: "Type '{typeName}' missing required format protocol",
    cause:
      'Every type registration must include a format function in its protocol.',
    resolution: 'Add a format function to the type registration protocol.',
    examples: [
      {
        description: 'Missing format in protocol',
        code: '# TypeRegistration { name: "custom", protocol: {} } missing format',
      },
    ],
  },

  // Context validation: duplicate method on type (RILL-R073)
  {
    errorId: 'RILL-R073',
    category: 'runtime',
    description: 'Duplicate method on type',
    messageTemplate: "Duplicate method '{methodName}' on type '{typeName}'",
    cause: 'A method with the same name is registered twice on the same type.',
    resolution:
      'Remove the duplicate method registration or rename one of them.',
    examples: [
      {
        description: 'Method registered twice',
        code: '# Type "string" has two methods both named "split"',
      },
    ],
  },

  // Value validation: empty vector (RILL-R074)
  {
    errorId: 'RILL-R074',
    category: 'runtime',
    description: 'Vector requires at least one dimension',
    messageTemplate: 'Vector data must have at least one dimension',
    cause:
      'An empty Float32Array was passed to createVector. Vectors must have at least one element.',
    resolution: 'Provide a non-empty Float32Array when creating vectors.',
    examples: [
      {
        description: 'Zero-dimension vector',
        code: '# createVector(new Float32Array([]), "model") fails',
      },
    ],
  },

  // Extension validation: missing event field (RILL-R075)
  {
    errorId: 'RILL-R075',
    category: 'runtime',
    description: 'Event missing event field',
    messageTemplate: 'Event must include non-empty event field',
    cause:
      'The event object passed to emitExtensionEvent has no event field or the field is empty.',
    resolution: 'Include a non-empty string event field in the event object.',
    examples: [
      {
        description: 'Empty event field',
        code: '# emitExtensionEvent(ctx, { event: "" }) fails',
      },
    ],
  },

  // Module resolution: unknown module (RILL-R076)
  {
    errorId: 'RILL-R076',
    category: 'runtime',
    description: 'Unknown module resource',
    messageTemplate: "Unknown module '{resource}'",
    cause:
      'The module resolver received a resource identifier it does not recognize.',
    resolution:
      'Use a valid module resource. The ext module resolver only handles the "ext" resource.',
    examples: [
      {
        description: 'Invalid module resource',
        code: 'use<module:unknown>  # Error: unknown module',
      },
    ],
  },

  // Callable validation: invalid default value (RILL-R077)
  {
    errorId: 'RILL-R077',
    category: 'runtime',
    description: 'Invalid parameter default value',
    messageTemplate:
      "Invalid defaultValue for parameter '{paramName}': expected {expectedType}, got {actualType}",
    cause: 'The default value type does not match the declared parameter type.',
    resolution:
      'Ensure the defaultValue matches the parameter type in the function definition.',
    examples: [
      {
        description: 'Type mismatch in default',
        code: '# param { name: "x", type: "number", defaultValue: "hello" }',
      },
    ],
  },

  // Legacy :> conversion syntax (RILL-R078)
  // Registered for documentation; parser emission wired in Phase 3 task 3.1.
  {
    errorId: 'RILL-R078',
    category: 'parse',
    description: 'Legacy :> conversion syntax',
    messageTemplate:
      "Legacy ':>' conversion syntax removed; use '-> {target}' instead",
    cause:
      "The parser encountered the legacy ':>type' conversion operator. The '->' pipe operator is now the unified syntax for both closure dispatch and type conversion dispatch.",
    resolution:
      "Replace ':>type' with '-> type'. The target type keyword follows the pipe directly: '-> :>string' becomes '-> string', '-> :>ordered(...)' becomes '-> ordered(...)'.",
    examples: [
      {
        description: 'Before (legacy syntax triggers RILL-R078)',
        code: '42 -> :>string\n"3.14" -> :>number\nlist[1, 2] -> :>tuple',
      },
      {
        description: 'After (current syntax)',
        code: '42 -> string\n"3.14" -> number\nlist[1, 2] -> tuple',
      },
    ],
  },

  // Legacy loop syntax: pre-loop @ (RILL-R079)
  {
    errorId: 'RILL-R079',
    category: 'parse',
    description: 'Legacy pre-loop @ syntax',
    messageTemplate: 'Migration error: use `while (cond) do { body }`',
    cause:
      "The parser encountered the legacy pre-loop '@' operator. The 'while (cond) do { body }' syntax is now the canonical while-loop form.",
    resolution:
      "Replace '(cond) @ { body }' with 'while (cond) do { body }'. For annotated loops, use 'do<limit: N> { body } while (cond)'.",
    examples: [
      {
        description: 'Before (legacy syntax triggers RILL-R079)',
        code: '0 -> ($ < 3) @ { $ + 1 }',
      },
      {
        description: 'After (current syntax)',
        code: '0 -> while ($ < 3) do { $ + 1 }',
      },
    ],
  },

  // Legacy loop syntax: post-loop @ (RILL-R080)
  {
    errorId: 'RILL-R080',
    category: 'parse',
    description: 'Legacy post-loop @ syntax',
    messageTemplate: 'Migration error: use `do { body } while (cond)`',
    cause:
      "The parser encountered the legacy post-loop '@' operator. The 'do { body } while (cond)' syntax is now the canonical do-while form.",
    resolution:
      "Replace '@ { body } ? (cond)' with 'do { body } while (cond)'. For seeded loops, pipe the seed: 'seed -> do { body } while (cond)'.",
    examples: [
      {
        description: 'Before (legacy syntax triggers RILL-R080)',
        code: '0 -> @ { $ + 1 } ? ($ < 3)',
      },
      {
        description: 'After (current syntax)',
        code: '0 -> do { $ + 1 } while ($ < 3)',
      },
    ],
  },

  // Legacy loop syntax: bare ^(limit:) annotation (RILL-R081)
  {
    errorId: 'RILL-R081',
    category: 'parse',
    description: 'Legacy ^(limit:) loop annotation syntax',
    messageTemplate: 'Migration error: use `do<limit: N> { body }`',
    cause:
      "The parser encountered the legacy '^(limit: N)' annotation form for loop limits. The 'do<limit: N>' construct option is now the canonical syntax.",
    resolution:
      "Replace '^(limit: N) @ { body }' with 'do<limit: N> { body } while (cond)' or 'while (cond) do<limit: N> { body }'.",
    examples: [
      {
        description: 'Before (legacy syntax triggers RILL-R081)',
        code: '0 -> ^(limit: 10) @ { $ + 1 } ? ($ < 3)',
      },
      {
        description: 'After (current syntax)',
        code: '0 -> do<limit: 10> { $ + 1 } while ($ < 3)',
      },
    ],
  },

  // Check Errors (RILL-C0xx)
  {
    errorId: 'RILL-C001',
    category: 'check',
    description: 'File not found',
    messageTemplate: 'File not found: {path}',
    cause: 'Specified file path does not exist in filesystem.',
    resolution:
      'Verify file path is correct, check file exists, or create the file if it should exist.',
    examples: [
      {
        description: 'Nonexistent file',
        code: 'rill-check missing.rill',
      },
      {
        description: 'Wrong file extension',
        code: 'rill-check script.txt  # Should be script.rill',
      },
    ],
  },
  {
    errorId: 'RILL-C002',
    category: 'check',
    description: 'File unreadable',
    messageTemplate: 'File unreadable: {path}',
    cause: 'File exists but cannot be read (permission denied or IO error).',
    resolution:
      'Check file permissions, ensure read access, or verify file is not locked by another process.',
    examples: [
      {
        description: 'Permission denied',
        code: 'rill-check protected.rill  # File exists but no read permission',
      },
    ],
  },
  {
    errorId: 'RILL-C003',
    category: 'check',
    description: 'Invalid configuration',
    messageTemplate: 'Invalid configuration: {details}',
    cause: 'Configuration file or options contain invalid values or structure.',
    resolution:
      'Fix configuration syntax, ensure all required fields are present, and values are of correct type.',
    examples: [
      {
        description: 'Invalid JSON in config',
        code: '# .rillrc.json contains malformed JSON',
      },
      {
        description: 'Unknown config option',
        code: '# Config contains unsupported option key',
      },
    ],
  },
  {
    errorId: 'RILL-C004',
    category: 'check',
    description: 'Fix collision detected',
    messageTemplate: 'Fix collision detected for {location}',
    cause:
      'Multiple auto-fix rules attempt to modify the same source location.',
    resolution:
      'Apply fixes one at a time, or disable conflicting lint rules. Some fixes may need manual resolution.',
    examples: [
      {
        description: 'Overlapping fix ranges',
        code: '# Two rules try to fix same code section',
      },
    ],
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
 * Format: https://github.com/rcrsr/rill/blob/v{version}/docs/ref-errors.md#{errorId}
 * Error ID is lowercased in anchor.
 *
 * @param errorId - Error identifier (format: RILL-{category}{3-digit}, e.g., RILL-R001)
 * @param version - Semver version (format: X.Y.Z)
 * @returns Documentation URL, or empty string if inputs are invalid
 *
 * @example
 * getHelpUrl("RILL-R001", "0.4.1")
 * // Returns: "https://github.com/rcrsr/rill/blob/v0.4.1/docs/ref-errors.md#rill-r001"
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
  return `https://github.com/rcrsr/rill/blob/v${version}/docs/ref-errors.md#${anchor}`;
}
