/**
 * Validation functions for LLM extension parameters
 *
 * Provides type-safe validation with assertion functions and error handling.
 */

import { RuntimeError, type RillValue } from '@rcrsr/rill';

// ============================================================
// CONSTANTS
// ============================================================

/** Minimum valid temperature value */
export const MIN_TEMPERATURE = 0.0;

/** Maximum valid temperature value */
export const MAX_TEMPERATURE = 2.0;

// ============================================================
// API KEY VALIDATION
// ============================================================

/**
 * Validates that API key is defined and non-empty.
 * Throws if validation fails.
 *
 * @param key - API key to validate
 * @throws Error if key is undefined or empty
 */
export function validateApiKey(key: string | undefined): asserts key is string {
  // EC-1: key is undefined → Error: "api_key is required"
  if (key === undefined) {
    throw new Error('api_key is required');
  }

  // EC-2: key is empty string → Error: "api_key cannot be empty"
  if (key === '') {
    throw new Error('api_key cannot be empty');
  }
}

// ============================================================
// MODEL VALIDATION
// ============================================================

/**
 * Validates that model name is defined and non-empty.
 * Throws if validation fails.
 *
 * @param model - Model name to validate
 * @throws Error if model is undefined or empty
 */
export function validateModel(
  model: string | undefined
): asserts model is string {
  // EC-3: model is undefined or empty → Error: "model is required"
  if (!model) {
    throw new Error('model is required');
  }
}

// ============================================================
// TEMPERATURE VALIDATION
// ============================================================

/**
 * Validates that temperature is within valid range [0, 2].
 * Throws if validation fails.
 *
 * @param temperature - Temperature value to validate
 * @throws Error if temperature is out of range
 */
export function validateTemperature(temperature: number | undefined): void {
  // Allow undefined (optional parameter)
  if (temperature === undefined) {
    return;
  }

  // EC-4: temperature out of range → Error: "temperature must be between 0 and 2"
  if (temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE) {
    throw new Error('temperature must be between 0 and 2');
  }
}

// ============================================================
// MESSAGES VALIDATION
// ============================================================

/**
 * Validates messages array for LLM chat completion.
 * Throws RuntimeError if validation fails.
 *
 * @param messages - Array of message objects to validate
 * @throws RuntimeError if messages are invalid
 */
export function validateMessages(
  messages: Array<Record<string, unknown>>
): void {
  // EC-5: Messages array empty → RuntimeError: "messages list cannot be empty"
  if (messages.length === 0) {
    throw new RuntimeError('RILL-R001', 'messages list cannot be empty');
  }

  // Validate each message
  for (const message of messages) {
    // EC-6: Message lacks `role` → RuntimeError: "message missing required 'role' field"
    if (!('role' in message) || !message['role']) {
      throw new RuntimeError(
        'RILL-R001',
        "message missing required 'role' field"
      );
    }

    // EC-7: Message lacks `content` → RuntimeError: "{role} message requires 'content'"
    if (
      !('content' in message) ||
      message['content'] === undefined ||
      message['content'] === null
    ) {
      const role = String(message['role']);
      throw new RuntimeError('RILL-R001', `${role} message requires 'content'`);
    }
  }
}

// ============================================================
// EMBED TEXT VALIDATION
// ============================================================

/**
 * Validates text for embedding operation.
 * Throws RuntimeError if validation fails.
 *
 * @param text - Text string to validate
 * @throws RuntimeError if text is empty
 */
export function validateEmbedText(text: string): void {
  // EC-8: Embed text empty → RuntimeError: "embed text cannot be empty"
  if (text === '') {
    throw new RuntimeError('RILL-R001', 'embed text cannot be empty');
  }
}

// ============================================================
// EMBED BATCH VALIDATION
// ============================================================

/**
 * Validates and converts RillValue array to string array for batch embedding.
 * Throws RuntimeError if validation fails.
 *
 * @param texts - Array of RillValue items to validate
 * @returns Array of validated strings
 * @throws RuntimeError if batch contains non-strings or empty strings
 */
export function validateEmbedBatch(texts: RillValue[]): string[] {
  const validated: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const item = texts[i];

    // EC-9: Batch contains non-string → RuntimeError: "embed_batch requires list of strings"
    if (typeof item !== 'string') {
      throw new RuntimeError(
        'RILL-R001',
        'embed_batch requires list of strings'
      );
    }

    // EC-10: Batch contains empty string → RuntimeError: "embed text cannot be empty at index {i}"
    if (item === '') {
      throw new RuntimeError(
        'RILL-R001',
        `embed text cannot be empty at index ${i}`
      );
    }

    validated.push(item);
  }

  return validated;
}

// ============================================================
// EMBED MODEL VALIDATION
// ============================================================

/**
 * Validates that embed model is configured and non-empty.
 * Throws RuntimeError if validation fails.
 *
 * @param model - Embed model name to validate
 * @throws RuntimeError if model is not configured
 */
export function validateEmbedModel(
  model: string | undefined
): asserts model is string {
  // EC-11: Embed model falsy → RuntimeError: "embed_model not configured"
  if (!model) {
    throw new RuntimeError('RILL-R001', 'embed_model not configured');
  }
}
