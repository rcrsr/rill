/**
 * Type definitions for Claude Code extension.
 * Defines message types, token tracking, and result structures.
 */

// ============================================================
// TOKEN TRACKING
// ============================================================

/**
 * Token count breakdown from Claude Code CLI.
 * Tracks prompt tokens, cache operations, and output tokens.
 */
export interface TokenCounts {
  /** Non-cached prompt tokens */
  readonly prompt: number;
  /** Tokens written to 5-minute cache */
  readonly cacheWrite5m: number;
  /** Tokens written to 1-hour cache */
  readonly cacheWrite1h: number;
  /** Tokens read from cache */
  readonly cacheRead: number;
  /** Output tokens generated */
  readonly output: number;
}

/**
 * Token usage data from Claude API response.
 * Maps to TokenCounts fields via extraction logic.
 */
export interface TokenUsage {
  /** Non-cached input tokens */
  readonly input_tokens?: number | undefined;
  /** Generated output tokens */
  readonly output_tokens?: number | undefined;
  /** Legacy cache write tokens (deprecated) */
  readonly cache_creation_input_tokens?: number | undefined;
  /** Cache read tokens */
  readonly cache_read_input_tokens?: number | undefined;
  /** Structured cache creation tracking */
  readonly cache_creation?:
    | {
        /** 5-minute cache write tokens */
        readonly ephemeral_5m_input_tokens?: number | undefined;
        /** 1-hour cache write tokens */
        readonly ephemeral_1h_input_tokens?: number | undefined;
      }
    | undefined;
}

// ============================================================
// CONTENT BLOCKS
// ============================================================

/**
 * Text content block.
 */
export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

/**
 * Tool use request block.
 */
export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/**
 * Tool result response block.
 */
export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string | unknown;
  readonly is_error?: boolean | undefined;
}

/**
 * Content block variants for message content arrays.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// ============================================================
// CLAUDE MESSAGES (Discriminated Union)
// ============================================================

/**
 * System initialization message.
 * First message in stream, establishes session config.
 */
export interface SystemMessage {
  readonly type: 'system';
  readonly subtype: 'init';
  readonly model: string;
  readonly tools?: readonly unknown[] | undefined;
  readonly mcp_servers?: readonly unknown[] | undefined;
}

/**
 * Assistant response message.
 * Contains text and tool use blocks.
 */
export interface AssistantMessage {
  readonly type: 'assistant';
  readonly message: {
    readonly content: readonly ContentBlock[];
    readonly usage?: TokenUsage | undefined;
  };
}

/**
 * User message with tool results.
 * Contains tool result blocks.
 */
export interface UserMessage {
  readonly type: 'user';
  readonly message: {
    readonly content: readonly ContentBlock[];
  };
}

/**
 * Result message with cost and duration.
 * Final message in stream with aggregated metrics.
 */
export interface ResultMessage {
  readonly type: 'result';
  readonly cost_usd: number;
  readonly duration_ms: number;
  readonly is_error: boolean;
  readonly usage: TokenUsage;
}

/**
 * Discriminated union of all Claude Code message types.
 * Discriminant field: `type`
 */
export type ClaudeMessage =
  | SystemMessage
  | AssistantMessage
  | UserMessage
  | ResultMessage;

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Claude Code integration.
 */
export interface ClaudeCodeConfig {
  /** Path to Claude Code CLI binary (default: 'claude') */
  readonly binaryPath?: string | undefined;
  /** Default timeout in milliseconds (default: 120000) */
  readonly defaultTimeout?: number | undefined;
}

/**
 * Options for prompt execution.
 */
export interface PromptOptions {
  /** Execution timeout in milliseconds (overrides defaultTimeout) */
  readonly timeout?: number | undefined;
}

// ============================================================
// RESULT TYPE
// ============================================================

/**
 * Complete result from Claude Code prompt execution.
 * Aggregates all stream messages into single structure.
 */
export interface ClaudeCodeResult {
  /** Combined text result from all assistant messages */
  readonly result: string;
  /** Token count breakdown */
  readonly tokens: TokenCounts;
  /** Total cost in USD */
  readonly cost: number;
  /** Exit code from CLI process (0 = success) */
  readonly exitCode: number;
  /** Total execution duration in milliseconds */
  readonly duration: number;
}
