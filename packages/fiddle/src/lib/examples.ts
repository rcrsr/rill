/**
 * Code examples registry for rill fiddle
 */

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface CodeExample {
  readonly id: string;
  readonly label: string;
  readonly source: string;
}

// ============================================================
// EXAMPLE REGISTRY
// ============================================================

const EXAMPLES: Record<string, CodeExample> = {
  'hello-world': {
    id: 'hello-world',
    label: 'Hello World',
    source: '"Hello, world!"',
  },
  variables: {
    id: 'variables',
    label: 'Variables',
    source: `"hello" => $greeting
$greeting -> .upper => $shouted
"{$shouted}!"`,
  },
  pipes: {
    id: 'pipes',
    label: 'Pipes',
    source: `"  hello world  " -> .trim -> .split(" ") -> .join("-")`,
  },
  functions: {
    id: 'functions',
    label: 'Functions',
    source: `range(0, 5) -> each { $ * 2 }`,
  },
  conditionals: {
    id: 'conditionals',
    label: 'Conditionals',
    source: `5 -> ($ > 3) ? "big" ! "small"`,
  },
};

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Load a code example by ID.
 *
 * @param id - Example identifier
 * @returns CodeExample if found, undefined otherwise
 */
export function loadExample(id: string): CodeExample | undefined {
  return EXAMPLES[id];
}
