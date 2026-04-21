/**
 * Educational error-handling patterns shown at the end of docs/ref-errors.md.
 *
 * These patterns are not per-error examples (those live on ErrorDefinition.examples).
 * They are pattern-level illustrations consumed by generate-error-docs.ts.
 */

// ============================================================
// PATTERN TYPES
// ============================================================

/**
 * A single example block rendered inside an error-handling pattern's
 * fenced code section. The description is emitted as a `# {description}`
 * comment line above the code body.
 */
export interface ErrorHandlingExample {
  /** Comment line rendered as `# {description}` above the code */
  readonly description: string;
  /** Multi-line rill code body */
  readonly code: string;
}

/**
 * A top-level error-handling pattern section. Each pattern renders as an
 * H3 heading, a prose intro, and a single fenced code block that contains
 * all examples separated by blank lines.
 */
export interface ErrorHandlingPattern {
  /** Section heading (e.g., "Defensive Checks") */
  readonly title: string;
  /** One-line prose introducing the pattern */
  readonly intro: string;
  /** Fence language for the code block (always 'rill') */
  readonly fence: 'rill';
  /** Example blocks rendered inside the fence, separated by blank lines */
  readonly examples: readonly ErrorHandlingExample[];
}

// ============================================================
// PATTERN DATA
// ============================================================

/**
 * Pattern-level illustrations appended to the generated error reference
 * under the "Error Handling Patterns" section. Consumed by
 * `scripts/generate-error-docs.ts`.
 */
export const ERROR_HANDLING_PATTERNS: readonly ErrorHandlingPattern[] = [
  {
    title: 'Defensive Checks',
    intro: 'Prevent runtime errors with existence and type checks:',
    fence: 'rill',
    examples: [
      {
        description: 'Check variable existence before use',
        code: '[apiKey: "secret123"] => $config\n$config.?apiKey ? $config.apiKey ! "default-key"',
      },
      {
        description: 'Check type before method call',
        code: '"test" => $value\n$value :? string ? ($value -> .upper) ! $value',
      },
      {
        description: 'Validate before conversion',
        code: '"42" => $input\n$input -> .is_match("^-?[0-9]+(\\\\.[0-9]+)?$") ? ($input -> number) ! 0',
      },
    ],
  },
  {
    title: 'Default Values',
    intro: 'Provide fallbacks for missing properties:',
    fence: 'rill',
    examples: [
      {
        description: 'Field with default',
        code: '[name: "Alice", age: 30] => $user\n$user.email ?? "no-email@example.com"',
      },
      {
        description: 'Annotation with default',
        code: '|x|($x) => $fn\n$fn.^timeout ?? 30',
      },
      {
        description: 'Dict dispatch with default',
        code: '[a: 1, b: 2, c: 3] => $lookup\n"b" -> $lookup ?? "not found"',
      },
    ],
  },
  {
    title: 'Type Assertions',
    intro: 'Explicitly verify and convert types:',
    fence: 'rill',
    examples: [
      {
        description: 'Assert type before operation',
        code: '"  hello  " => $input\n$input:string -> .trim',
      },
      {
        description: 'Check type before calling method',
        code: '[1, 2, 3] => $items\n$items :? list ? ($items -> .len) ! 0',
      },
      {
        description: 'Convert with validation',
        code: '"42" => $value\n$value -> .is_match("^-?[0-9]+(\\\\.[0-9]+)?$") ? ($value -> number) ! 0',
      },
    ],
  },
];
