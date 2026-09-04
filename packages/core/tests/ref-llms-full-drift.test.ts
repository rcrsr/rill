/**
 * docs/ref-llms-full.txt drift test
 *
 * docs/ref-llms-full.txt is generated from the 8 fragments under docs/llm/,
 * concatenated in the order docs/ref-llms.txt enumerates them, by
 * packages/core/scripts/generate-llms-full.ts. This test regenerates the
 * bundle in-memory and asserts it is byte-identical to the committed file,
 * so an edited fragment that was not regenerated fails CI instead of
 * silently drifting from the published bundle.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { buildLlmsFullContent } from '../scripts/generate-llms-full.js';

const coreDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const projectRoot = path.resolve(coreDir, '..', '..');
const bundlePath = path.join(projectRoot, 'docs', 'ref-llms-full.txt');

describe('docs/ref-llms-full.txt', () => {
  it('is byte-identical to the concatenation of docs/llm/ fragments', () => {
    const committed = fs.readFileSync(bundlePath, 'utf-8');
    const regenerated = buildLlmsFullContent(projectRoot);

    expect(regenerated).toBe(committed);
  });
});
