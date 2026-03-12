import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';

async function run(code: string) {
  const ctx = createRuntimeContext({});
  const result = await execute(parse(code), ctx);
  return result.result;
}

describe('implicit $ property access bug', () => {
  describe('property access on pipe value', () => {
    it('explicit $.field works', async () => {
      const result = await run('dict[a: 1] -> $.a');
      expect(result).toBe(1);
    });

    it('implicit .field should work', async () => {
      // .field should be sugar for $.field
      const result = await run('dict[a: 1] -> .a');
      expect(result).toBe(1);
    });

    it('explicit $.type in condition works', async () => {
      const result = await run(
        'dict[type: "json"] -> ($.type == "json") ? "yes" ! "no"'
      );
      expect(result).toBe('yes');
    });

    it('implicit .type in condition should work', async () => {
      // This currently fails with "Unknown method: type"
      const result = await run(
        'dict[type: "json"] -> (.type == "json") ? "yes" ! "no"'
      );
      expect(result).toBe('yes');
    });

    it('chained implicit property access', async () => {
      const result = await run('dict[a: dict[b: 1]] -> .a.b');
      expect(result).toBe(1);
    });
  });

  describe('method vs property disambiguation', () => {
    it('.len is a method (returns length)', async () => {
      const result = await run('"hello" -> .len');
      expect(result).toBe(5);
    });

    it('.type is a property access (dict field)', async () => {
      const result = await run('dict[type: "test"] -> .type');
      expect(result).toBe('test');
    });
  });

  describe('dict key shadows built-in method name', () => {
    it('returns dict value when key matches built-in method name (non-callable)', async () => {
      // "model" is a vector built-in method. A dict key named "model" should
      // take priority over the built-in, returning the dict's own value.
      const result = await run('dict[model: "gpt-4"] => $msg\n$msg.model');
      expect(result).toBe('gpt-4');
    });

    it('invokes closure when dict key matching built-in name holds a closure', async () => {
      // When the dict value under the shadowing key is a callable, accessing
      // it as a method should invoke the closure, not the built-in.
      const result = await run('dict[model: ||{ "custom" }] => $d\n$d.model()');
      expect(result).toBe('custom');
    });

    it('returns dict value via implicit pipe access when key shadows built-in', async () => {
      // Same as above but using implicit $.field sugar via pipe.
      const result = await run('dict[model: "gpt-4"] -> .model');
      expect(result).toBe('gpt-4');
    });
  });
});
