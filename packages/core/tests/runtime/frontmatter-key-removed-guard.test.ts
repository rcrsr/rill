/**
 * Rill Runtime Tests: Frontmatter Removed-Key Guard
 *
 * Covers the removed-key regex guard in `execute()` for the legacy
 * `use:` / `export:` frontmatter keys, including split-line keys where
 * a line terminator sits between the key and the colon.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Frontmatter removed-key guard', () => {
  describe('use: key', () => {
    it('throws RILL-R060 for a single-line use: key', async () => {
      const script = `---\nuse: math\n---\n"hello"`;
      await expect(run(script, {})).rejects.toHaveProperty(
        'errorId',
        'RILL-R060'
      );
    });

    it('throws RILL-R060 when a newline splits the key from the colon (LF)', async () => {
      const script = `---\nuse\n:\n  math: ./math.rill\n---\n"hello"`;
      await expect(run(script, {})).rejects.toHaveProperty(
        'errorId',
        'RILL-R060'
      );
    });

    it('throws RILL-R060 when a CRLF splits the key from the colon', async () => {
      const script = `---\nuse\r\n:\r\n  math: ./math.rill\n---\n"hello"`;
      await expect(run(script, {})).rejects.toHaveProperty(
        'errorId',
        'RILL-R060'
      );
    });
  });

  describe('export: key', () => {
    it('throws RILL-R060 for a single-line export: key', async () => {
      const script = `---\nexport: result\n---\n"hello"`;
      await expect(run(script, {})).rejects.toHaveProperty(
        'errorId',
        'RILL-R060'
      );
    });

    it('throws RILL-R060 when a newline splits the key from the colon (LF)', async () => {
      const script = `---\nexport\n:\n  result: $x\n---\n"hello"`;
      await expect(run(script, {})).rejects.toHaveProperty(
        'errorId',
        'RILL-R060'
      );
    });

    it('throws RILL-R060 when a CRLF splits the key from the colon', async () => {
      const script = `---\nexport\r\n:\r\n  result: $x\n---\n"hello"`;
      await expect(run(script, {})).rejects.toHaveProperty(
        'errorId',
        'RILL-R060'
      );
    });
  });
});
