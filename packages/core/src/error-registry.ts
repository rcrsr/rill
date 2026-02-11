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
        description: 'Generic type syntax not supported',
        code: '$x => list<string>  # Use "list" only',
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
    description: 'Deprecated capture arrow syntax',
    messageTemplate: 'The capture arrow syntax changed from :> to =>',
    cause:
      'Code uses old capture arrow syntax (:>) instead of current syntax (=>).',
    resolution:
      'Replace :> with => for all variable captures. This change was made in version 0.4.0.',
    examples: [
      {
        description: 'Old capture syntax',
        code: '"value" :> $x  # Change to "value" => $x',
      },
      {
        description: 'Old typed capture',
        code: '5 :> $x:number  # Change to 5 => $x:number',
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
    errorId: 'RILL-R004',
    category: 'runtime',
    description: 'Type conversion failure',
    messageTemplate: 'Cannot convert {value} to {targetType}',
    cause:
      'Value cannot be converted to target type (invalid format or incompatible types).',
    resolution:
      'Ensure value has valid format for target type. For string-to-number: check numeric format. For parse operations: validate input structure.',
    examples: [
      {
        description: 'Invalid number string',
        code: '"abc" -> .num()  # Not a valid number',
      },
      {
        description: 'Cannot serialize closure',
        code: 'fn() => "test" end -> json()',
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
        code: '(true) @ { "looping" }  # Never terminates',
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
