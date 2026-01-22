/**
 * Rill Runtime Tests: Frontmatter
 * Tests for YAML frontmatter parsing at script start
 */

import { parse } from '../src/index.js';
import { describe, expect, it } from 'vitest';

import { run } from './helpers/runtime.js';

describe('Rill Runtime: Frontmatter', () => {
  describe('Parsing', () => {
    it('parses script without frontmatter', () => {
      const ast = parse('"hello"');
      expect(ast.frontmatter).toBeNull();
    });

    it('parses script with empty frontmatter', () => {
      const ast = parse(`---
---
"hello"`);
      expect(ast.frontmatter).not.toBeNull();
      expect(ast.frontmatter?.content.trim()).toBe('');
    });

    it('parses single field frontmatter', () => {
      const ast = parse(`---
model: opus
---
"hello"`);
      expect(ast.frontmatter).not.toBeNull();
      // Frontmatter content is tokenized, spaces may be stripped
      expect(ast.frontmatter?.content).toContain('model');
      expect(ast.frontmatter?.content).toContain('opus');
    });

    it('parses multi-field frontmatter', () => {
      const ast = parse(`---
model: opus
description: Test
timeout: 30
---
"hello"`);
      expect(ast.frontmatter).not.toBeNull();
      expect(ast.frontmatter?.content).toContain('model');
      expect(ast.frontmatter?.content).toContain('opus');
      expect(ast.frontmatter?.content).toContain('description');
      expect(ast.frontmatter?.content).toContain('timeout');
      expect(ast.frontmatter?.content).toContain('30');
    });

    it('preserves newlines between fields', () => {
      const ast = parse(`---
line1: value1
line2: value2
---
0`);
      expect(ast.frontmatter?.content).toContain('\n');
    });

    it('parses frontmatter with array syntax', () => {
      const ast = parse(`---
items: [a, b, c]
---
1`);
      expect(ast.frontmatter?.content).toContain('items');
      expect(ast.frontmatter?.content).toContain('[');
      expect(ast.frontmatter?.content).toContain('a');
    });
  });

  describe('Execution', () => {
    it('executes script with frontmatter', async () => {
      const script = `---
model: sonnet
---
"hello"`;
      expect(await run(script)).toBe('hello');
    });

    it('frontmatter does not affect execution', async () => {
      const script = `---
x: 1
y: 2
---
[1, 2, 3] -> .len`;
      expect(await run(script)).toBe(3);
    });

    it('executes multi-statement script with frontmatter', async () => {
      const script = `---
description: Capture test
---
"a" :> $x
"b" :> $y
[$x, $y]`;
      expect(await run(script)).toEqual(['a', 'b']);
    });

    it('handles frontmatter followed by heredoc', async () => {
      const script = `---
type: template
---
<<MSG
Hello
MSG`;
      expect(await run(script)).toBe('Hello\n');
    });

    it('handles frontmatter with dashes in values', async () => {
      const script = `---
cmd: run-test
---
42`;
      const ast = parse(script);
      expect(ast.frontmatter?.content).toContain('run-test');
      expect(await run(script)).toBe(42);
    });

    it('handles frontmatter with colons in values', async () => {
      const script = `---
time: 10:30
---
42`;
      const ast = parse(script);
      expect(ast.frontmatter?.content).toContain('10');
      expect(ast.frontmatter?.content).toContain('30');
      expect(await run(script)).toBe(42);
    });
  });

  describe('Edge Cases', () => {
    it('requires frontmatter at script start', async () => {
      // Frontmatter-like content after first statement is invalid
      const script = `"hello"
---
not: frontmatter
---`;
      await expect(run(script)).rejects.toThrow();
    });

    it('handles complex expressions after frontmatter', async () => {
      const script = `---
name: test
---
[1, 2, 3] -> each { ($ * 2) }`;
      expect(await run(script)).toEqual([2, 4, 6]);
    });

    it('handles conditionals after frontmatter', async () => {
      const script = `---
enabled: true
---
true -> ? { "yes" } ! { "no" }`;
      expect(await run(script)).toBe('yes');
    });

    it('handles loops after frontmatter', async () => {
      const script = `---
iterations: 3
---
0 -> ($ < 3) @ { ($ + 1) }`;
      expect(await run(script)).toBe(3);
    });
  });
});
