#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises';
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';
import { createHost } from './host.js';

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

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  try {
    const source = await readFile('agent.rill', 'utf-8');
    const ast = parse(source);

    const { functions, dispose } = createHost();

    const ctx = createRuntimeContext({
      functions,
      callbacks: {
        onLog: (value) => console.log(formatOutput(value)),
      },
    });

    const result = await execute(ast, ctx);
    console.log('[Result]', formatOutput(result.value));

    await dispose();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
