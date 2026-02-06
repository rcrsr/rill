/**
 * @rcrsr/rill-ext-claude-code
 *
 * Extension for executing Claude Code toolkit operations from rill scripts.
 */

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.1.0';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type {
  TokenCounts,
  TokenUsage,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  SystemMessage,
  AssistantMessage,
  UserMessage,
  ResultMessage,
  ClaudeMessage,
  ClaudeCodeConfig,
  PromptOptions,
  ClaudeCodeResult,
} from './types.js';

// ============================================================
// STREAM PARSER
// ============================================================

export type { StreamParser } from './stream-parser.js';
export { createStreamParser } from './stream-parser.js';

// ============================================================
// RESULT EXTRACTION
// ============================================================

export { extractResult } from './result.js';

// ============================================================
// PROCESS MANAGER
// ============================================================

export type { SpawnResult, SpawnOptions } from './process.js';
export { spawnClaudeCli } from './process.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createClaudeCodeExtension } from './factory.js';
