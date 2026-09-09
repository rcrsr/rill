/**
 * Rill Runtime Tests: Lexer
 * Tests for lexer-level source handling: byte-order-mark and control
 * characters that are not specific to any single construct.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Lexer', () => {
  describe('UTF-8 Byte-Order-Mark', () => {
    it('skips a leading BOM at the very start of the source', async () => {
      const script = '﻿"hello"';
      expect(await run(script)).toBe('hello');
    });

    it('rejects a BOM anywhere other than position 0', async () => {
      const script = '"a" -> $﻿x';
      await expect(run(script)).rejects.toThrow('Unexpected character');
    });
  });

  describe('Bare carriage return in single-line strings', () => {
    it('rejects a bare CR inside a single-line string literal', async () => {
      const script = '"hello\r world"';
      await expect(run(script)).rejects.toThrow('Unterminated string literal');
    });

    it('still accepts a CRLF pair as the line ending before a string', async () => {
      const script = '"before"\r\n"hello"';
      expect(await run(script)).toBe('hello');
    });
  });
});
