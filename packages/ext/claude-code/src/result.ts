/**
 * Result extraction from Claude Code message streams.
 * Accumulates tokens, costs, and text from parsed messages.
 */

import type {
  ClaudeMessage,
  ClaudeCodeResult,
  TokenCounts,
  TokenUsage,
  TextBlock,
} from './types.js';

/**
 * Extracts complete ClaudeCodeResult from parsed message stream.
 * Accumulates token counts across assistant messages and extracts cost/duration from final result message.
 *
 * @param messages - Parsed stream messages (ClaudeMessage[])
 * @returns Complete result dict with text, tokens, cost, and exitCode
 */
export function extractResult(
  messages: readonly ClaudeMessage[]
): ClaudeCodeResult {
  // Initialize accumulation state
  const tokens: TokenCounts = {
    prompt: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: 0,
  };
  const textParts: string[] = [];
  let cost = 0;
  let duration = 0;
  let exitCode = 0;

  // Iterate messages and accumulate
  for (const msg of messages) {
    if (msg.type === 'assistant') {
      // Accumulate token counts from usage field
      if (msg.message.usage) {
        accumulateTokens(tokens, msg.message.usage);
      }

      // Extract text content from content blocks
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          textParts.push((block as TextBlock).text);
        }
      }
    } else if (msg.type === 'result') {
      // Extract cost and duration from final result message
      cost = msg.cost_usd;
      duration = msg.duration_ms;
      exitCode = msg.is_error ? 1 : 0;

      // Include final usage from result message
      accumulateTokens(tokens, msg.usage);
    }
  }

  return {
    result: textParts.join(''),
    tokens,
    cost,
    exitCode,
    duration,
  };
}

/**
 * Accumulates token counts from usage field into TokenCounts structure.
 * Maps usage fields to TokenCounts fields:
 * - input_tokens -> prompt
 * - output_tokens -> output
 * - cache_creation.ephemeral_5m_input_tokens -> cacheWrite5m
 * - cache_creation.ephemeral_1h_input_tokens -> cacheWrite1h
 * - cache_read_input_tokens -> cacheRead
 *
 * @param tokens - TokenCounts accumulator (mutated)
 * @param usage - TokenUsage from assistant message or result message
 */
function accumulateTokens(tokens: TokenCounts, usage: TokenUsage): void {
  // Accumulate input tokens (non-cached prompt)
  if (usage.input_tokens !== undefined) {
    (tokens as { prompt: number }).prompt += usage.input_tokens;
  }

  // Accumulate output tokens
  if (usage.output_tokens !== undefined) {
    (tokens as { output: number }).output += usage.output_tokens;
  }

  // Accumulate cache write tokens (5-minute)
  if (usage.cache_creation?.ephemeral_5m_input_tokens !== undefined) {
    (tokens as { cacheWrite5m: number }).cacheWrite5m +=
      usage.cache_creation.ephemeral_5m_input_tokens;
  }

  // Accumulate cache write tokens (1-hour)
  if (usage.cache_creation?.ephemeral_1h_input_tokens !== undefined) {
    (tokens as { cacheWrite1h: number }).cacheWrite1h +=
      usage.cache_creation.ephemeral_1h_input_tokens;
  }

  // Accumulate cache read tokens
  if (usage.cache_read_input_tokens !== undefined) {
    (tokens as { cacheRead: number }).cacheRead +=
      usage.cache_read_input_tokens;
  }
}
