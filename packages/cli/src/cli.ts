#!/usr/bin/env node
/**
 * Rill CLI - Run rill scripts from the command line
 *
 * @deprecated Use rill-exec or rill-eval commands instead. This file will be removed in v1.0.
 *
 * Usage:
 *   npx tsx src/cli.ts <script.rill>
 *   npx tsx src/cli.ts -e "code"
 *   echo "code" | npx tsx src/cli.ts -
 */

import * as fs from 'fs';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';
import { formatOutput } from './cli-shared.js';

async function run(source: string): Promise<void> {
  const ctx = createRuntimeContext({
    callbacks: {
      onLog: (value) => console.log(formatOutput(value)),
    },
  });

  try {
    const ast = parse(source);
    const result = await execute(ast, ctx);
    console.log(formatOutput(result.value));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: rill <script.rill> | rill -e "code" | rill -');
    process.exit(1);
  }

  let source: string;
  const arg0 = args[0]!;

  if (arg0 === '-e') {
    // Inline code: rill -e "code"
    if (!args[1]) {
      console.error('Missing code after -e');
      process.exit(1);
    }
    source = args[1];
  } else if (arg0 === '-') {
    // Stdin: echo "code" | rill -
    source = fs.readFileSync(0, 'utf-8');
  } else {
    // File: rill script.rill
    if (!fs.existsSync(arg0)) {
      console.error(`File not found: ${arg0}`);
      process.exit(1);
    }
    source = fs.readFileSync(arg0, 'utf-8');
  }

  await run(source);
}

main();
