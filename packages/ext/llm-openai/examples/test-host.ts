#!/usr/bin/env -S pnpm exec tsx
/**
 * Test Host for @rcrsr/rill-ext-openai
 *
 * Wires up the OpenAI extension with the rill runtime for testing.
 * Works with OpenAI, or any OpenAI-compatible server (LM Studio, Ollama, vLLM).
 *
 * Usage:
 *   pnpm exec tsx examples/test-host.ts                  # Run built-in demo
 *   pnpm exec tsx examples/test-host.ts --help           # Show help
 *   pnpm exec tsx examples/test-host.ts -e 'expr'        # Run inline expression
 *   pnpm exec tsx examples/test-host.ts script.rill      # Run script file
 *
 * Environment:
 *   OPENAI_API_KEY   API key (required)
 *   OPENAI_MODEL     Model name (default: "gpt-4o")
 *   OPENAI_BASE_URL  Base URL (default: https://api.openai.com/v1)
 */

import { readFile } from 'node:fs/promises';
import {
  parse,
  execute,
  createRuntimeContext,
  hoistExtension,
} from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/index.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';

const BUILT_IN_DEMO = `llm::message("What is 2 + 2? Reply in one sentence.") => $r
$r.content -> log
$r.model -> log("Model: {$r.model}")
$r.usage.input + $r.usage.output -> log("Tokens: {$r.usage.input} in, {$r.usage.output} out")`;

const HELP_TEXT = `
Test Host for @rcrsr/rill-ext-openai

Usage:
  test-host.ts                  Run built-in demo script
  test-host.ts --help           Show this help message
  test-host.ts -h               Show this help message
  test-host.ts -e '<expr>'      Run inline expression
  test-host.ts <file>           Run script from file

Environment:
  OPENAI_API_KEY   API key (required)
  OPENAI_MODEL     Model name (default: "${DEFAULT_MODEL}")
  OPENAI_BASE_URL  Base URL (default: ${DEFAULT_BASE_URL})

Examples:
  # OpenAI
  OPENAI_API_KEY=sk-... test-host.ts -e 'llm::message("Hello") -> $.content -> log'

  # LM Studio
  OPENAI_BASE_URL=http://localhost:1234/v1 OPENAI_API_KEY=lm-studio OPENAI_MODEL=local test-host.ts

  # Ollama
  OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama OPENAI_MODEL=llama3.2 test-host.ts

  # Script file
  test-host.ts my-script.rill
`;

// ============================================================
// HELPERS
// ============================================================

function formatOutput(value: RillValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null && '__type' in value) {
    return '[closure]';
  }
  return JSON.stringify(value, null, 2);
}

async function parseArgs(argv: string[]): Promise<string> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const eIndex = argv.indexOf('-e');
  if (eIndex !== -1 && eIndex + 1 < argv.length) {
    return argv[eIndex + 1] as string;
  }

  if (argv.length > 0 && !argv[0]!.startsWith('-')) {
    const filePath = argv[0]!;
    try {
      return await readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to read file: ${message}`);
      process.exit(1);
    }
  }

  return BUILT_IN_DEMO;
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  try {
    const source = await parseArgs(process.argv.slice(2));

    const baseUrl = process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
    const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error('Error: OPENAI_API_KEY environment variable is required');
      process.exit(1);
    }

    console.error(`[test-host] Endpoint: ${baseUrl}`);
    console.error(`[test-host] Model: ${model}`);

    const ext = createOpenAIExtension({
      api_key: apiKey,
      model,
      base_url: baseUrl,
    });

    const { functions, dispose } = hoistExtension('llm', ext);

    const ctx = createRuntimeContext({
      functions,
      callbacks: {
        onLog: (value) => console.log(formatOutput(value)),
        onLogEvent: (event) => {
          console.error(`[event] ${event.event} (${event.duration}ms)`);
        },
      },
    });

    const ast = parse(source);

    const preview = source.length > 80 ? source.slice(0, 80) + '...' : source;
    console.error(`[test-host] Running: ${preview.replace(/\n/g, ' ')}`);

    const startTime = Date.now();
    const result = await execute(ast, ctx);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[test-host] Done in ${elapsed}s`);
    console.error(`[test-host] Result: ${formatOutput(result.value)}`);

    dispose?.();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
