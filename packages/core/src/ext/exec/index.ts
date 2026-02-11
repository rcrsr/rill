/**
 * exec Extension Factory
 *
 * Provides sandboxed command execution via allowlist/blocklist security controls.
 * Each declared command becomes a function with argument validation and process isolation.
 */

import type { ExtensionResult } from '../../runtime/ext/extensions.js';
import type { RillValue } from '../../runtime/core/values.js';
import {
  type CommandConfig,
  type CommandResult,
  runCommand,
} from './runner.js';

// ============================================================
// TYPES
// ============================================================

/** exec extension configuration */
export interface ExecConfig {
  /** Command definitions keyed by command name */
  commands: Record<string, CommandConfig>;
  /** Global timeout in milliseconds (default: 30000 = 30s) */
  timeout?: number | undefined;
  /** Global output size limit in bytes (default: 1048576 = 1MB) */
  maxOutputSize?: number | undefined;
  /** Inherit parent process environment (default: false) */
  inheritEnv?: boolean | undefined;
}

// Re-export CommandConfig for consumers
export type { CommandConfig };

// ============================================================
// FACTORY
// ============================================================

/**
 * Create exec extension with sandboxed command execution.
 *
 * Generates one host function per declared command.
 * Each function validates arguments and spawns processes with security controls.
 * Returns dispose() function to abort in-flight processes.
 *
 * @param config - Command definitions and defaults
 * @returns ExtensionResult with command functions and dispose
 *
 * @example
 * ```typescript
 * const execExt = createExecExtension({
 *   commands: {
 *     git: {
 *       binary: 'git',
 *       allowedArgs: ['status', '--short', 'log'],
 *       cwd: '/home/user/repo'
 *     }
 *   }
 * });
 * ```
 */
export function createExecExtension(config: ExecConfig): ExtensionResult {
  // Apply defaults
  const globalTimeout = config.timeout ?? 30000; // 30s
  const globalMaxOutputSize = config.maxOutputSize ?? 1048576; // 1MB
  const inheritEnv = config.inheritEnv ?? false;

  // Track in-flight processes for dispose
  const abortControllers: AbortController[] = [];

  // Helper: get effective timeout (command-specific or global)
  const getTimeout = (commandConfig: CommandConfig): number => {
    return commandConfig.timeout ?? globalTimeout;
  };

  // Helper: get effective maxBuffer (command-specific or global)
  const getMaxBuffer = (commandConfig: CommandConfig): number => {
    return commandConfig.maxBuffer ?? globalMaxOutputSize;
  };

  // Helper: get effective env (merge parent env if inheritEnv, then overlay command env)
  const getEnv = (
    commandConfig: CommandConfig
  ): Record<string, string> | undefined => {
    if (!inheritEnv && !commandConfig.env) {
      return undefined; // No env needed
    }

    const baseEnv: Record<string, string> = {};

    // Copy process.env if inheritEnv is true, filtering out undefined
    if (inheritEnv) {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          baseEnv[key] = value;
        }
      }
    }

    // Overlay command-specific env
    if (commandConfig.env) {
      Object.assign(baseEnv, commandConfig.env);
    }

    return baseEnv;
  };

  // ============================================================
  // GENERATE COMMAND FUNCTIONS
  // ============================================================

  const functions: Record<string, unknown> = {};

  for (const [commandName, commandConfig] of Object.entries(config.commands)) {
    // Create function for this command
    const commandFn = async (args: RillValue[]): Promise<RillValue> => {
      // Extract args and stdin from RillValue array
      const argsParam = (args[0] as RillValue[] | undefined) ?? [];
      const stdinParam = args[1] as string | undefined;

      // Convert args to string array
      const stringArgs = argsParam.map((arg) => String(arg));

      // Create abort controller for this execution
      const controller = new AbortController();
      abortControllers.push(controller);

      try {
        // Build effective config with merged defaults
        const effectiveConfig: CommandConfig = {
          ...commandConfig,
          timeout: getTimeout(commandConfig),
          maxBuffer: getMaxBuffer(commandConfig),
          env: getEnv(commandConfig),
        };

        // Execute command
        const result: CommandResult = await runCommand(
          commandName,
          effectiveConfig,
          stringArgs,
          stdinParam,
          controller.signal
        );

        // Return as dict
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } finally {
        // Remove from tracking list
        const index = abortControllers.indexOf(controller);
        if (index !== -1) {
          abortControllers.splice(index, 1);
        }
      }
    };

    // Add to functions object with HostFunctionDefinition structure
    functions[commandName] = {
      params: [
        {
          name: 'args',
          type: 'list',
          description: 'Command arguments',
          defaultValue: [],
        },
        {
          name: 'stdin',
          type: 'string',
          description: 'Standard input data',
          defaultValue: '',
        },
      ],
      fn: commandFn,
      description:
        commandConfig.description ?? `Execute ${commandName} command`,
      returnType: 'dict',
    };
  }

  // ============================================================
  // INTROSPECTION FUNCTION
  // ============================================================

  const commands = async (): Promise<RillValue[]> => {
    const result: RillValue[] = [];

    for (const [name, commandConfig] of Object.entries(config.commands)) {
      result.push({
        name,
        description: commandConfig.description ?? '',
      });
    }

    return result;
  };

  functions['commands'] = {
    params: [],
    fn: commands,
    description: 'List all configured commands',
    returnType: 'list',
  };

  // ============================================================
  // DISPOSE FUNCTION
  // ============================================================

  const dispose = async (): Promise<void> => {
    // Abort all in-flight processes
    for (const controller of abortControllers) {
      controller.abort();
    }

    // Clear tracking array
    abortControllers.length = 0;
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  return {
    ...functions,
    dispose,
  } as ExtensionResult;
}
