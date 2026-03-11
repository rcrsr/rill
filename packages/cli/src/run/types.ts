/**
 * Type definitions for rill-run.
 */

// ============================================================
// CONFIG FILE TYPES
// ============================================================

/**
 * A single extension entry in the config file.
 */
export interface ExtensionEntry {
  readonly package: string;
  readonly config?: Record<string, unknown> | undefined;
}

/**
 * Shape of the rill-config.json file.
 */
export interface ConfigFile {
  readonly extensions: Record<string, ExtensionEntry>;
  readonly modules?: Record<string, string> | undefined;
  readonly bindings?: string | undefined;
}

// ============================================================
// CLI TYPES
// ============================================================

/**
 * Parsed CLI options from process.argv.
 */
export interface RunCliOptions {
  readonly scriptPath?: string | undefined;
  readonly scriptArgs: string[];
  readonly config: string;
  readonly format: 'human' | 'json' | 'compact';
  readonly verbose: boolean;
  readonly maxStackDepth: number;
  readonly explain?: string | undefined;
  readonly emitBindings?: boolean | undefined;
}
