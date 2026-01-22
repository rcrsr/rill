import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '../src/index.js';

async function run(code: string) {
  const ctx = createRuntimeContext({});
  const result = await execute(parse(code), ctx);
  return result.value;
}

describe('implicit $ property access bug', () => {
  describe('property access on pipe value', () => {
    it('explicit $.field works', async () => {
      const result = await run('[a: 1] -> $.a');
      expect(result).toBe(1);
    });

    it('implicit .field should work', async () => {
      // .field should be sugar for $.field
      const result = await run('[a: 1] -> .a');
      expect(result).toBe(1);
    });

    it('explicit $.type in condition works', async () => {
      const result = await run(
        '[type: "json"] -> ($.type == "json") ? "yes" ! "no"'
      );
      expect(result).toBe('yes');
    });

    it('implicit .type in condition should work', async () => {
      // This currently fails with "Unknown method: type"
      const result = await run(
        '[type: "json"] -> (.type == "json") ? "yes" ! "no"'
      );
      expect(result).toBe('yes');
    });

    it('chained implicit property access', async () => {
      const result = await run('[a: [b: 1]] -> .a.b');
      expect(result).toBe(1);
    });
  });

  describe('method vs property disambiguation', () => {
    it('.len is a method (returns length)', async () => {
      const result = await run('"hello" -> .len');
      expect(result).toBe(5);
    });

    it('.type is a property access (dict field)', async () => {
      const result = await run('[type: "test"] -> .type');
      expect(result).toBe('test');
    });
  });
});
