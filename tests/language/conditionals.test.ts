/**
 * Rill Runtime Tests: Conditionals
 * Tests for cond ? then ! else syntax
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Conditionals', () => {
  describe('Basic Conditionals', () => {
    it('executes then branch on true', async () => {
      expect(await run('true ? "yes" ! "no"')).toBe('yes');
    });

    it('passes through on false without else (piped form)', async () => {
      // Piped form preserves the input value when condition is false and no else
      expect(await run('false -> ? "yes"')).toBe(false);
    });

    it('executes then branch on true with else', async () => {
      expect(await run('true ? "yes" ! "no"')).toBe('yes');
    });

    it('executes else branch on false', async () => {
      expect(await run('false ? "yes" ! "no"')).toBe('no');
    });
  });

  describe('Condition Forms', () => {
    it('uses method as condition', async () => {
      expect(
        await run('"hello" -> .contains("ell") ? "found" ! "not found"')
      ).toBe('found');
    });

    it('uses method condition with else', async () => {
      expect(
        await run('"hello" -> .contains("xyz") ? "found" ! "not found"')
      ).toBe('not found');
    });

    it('uses comparison as condition', async () => {
      expect(await run('5 -> ($ > 3) ? "big" ! "small"')).toBe('big');
    });

    it('uses negated condition', async () => {
      expect(await run('"" -> (!.empty) ? "has" ! "empty"')).toBe('empty');
    });

    it('uses bare ? with true', async () => {
      expect(await run('true -> ? "yes" ! "no"')).toBe('yes');
    });

    it('uses bare ? with false', async () => {
      expect(await run('false -> ? "yes" ! "no"')).toBe('no');
    });

    it('rejects non-boolean string in piped conditional', async () => {
      await expect(run('"x" -> ? "yes" ! "no"')).rejects.toThrow(
        'Piped conditional requires boolean, got string'
      );
    });

    it('rejects non-boolean number in piped conditional', async () => {
      await expect(run('42 -> ? "yes" ! "no"')).rejects.toThrow(
        'Piped conditional requires boolean, got number'
      );
    });
  });

  describe('Else-If Chains', () => {
    it('matches first condition', async () => {
      expect(await run('"A" -> .eq("A") ? 1 ! .eq("B") ? 2 ! 3')).toBe(1);
    });

    it('matches second condition', async () => {
      expect(await run('"B" -> .eq("A") ? 1 ! .eq("B") ? 2 ! 3')).toBe(2);
    });

    it('falls through to default', async () => {
      expect(await run('"C" -> .eq("A") ? 1 ! .eq("B") ? 2 ! 3')).toBe(3);
    });

    it('handles long else-if chain', async () => {
      const script =
        '"D" -> .eq("A") ? 1 ! .eq("B") ? 2 ! .eq("C") ? 3 ! .eq("D") ? 4 ! 5';
      expect(await run(script)).toBe(4);
    });
  });

  describe('Implied $', () => {
    it('uses implied $ at statement start', async () => {
      expect(await run('"x" :> $v\n$v -> { .eq("x") ? "yes" ! "no" }')).toBe(
        'yes'
      );
    });

    it('uses implied $ in nested block', async () => {
      expect(
        await run('"hello" -> { .contains("h") ? "has h" ! "no h" }')
      ).toBe('has h');
    });

    it('chains implied $ conditionals', async () => {
      expect(
        await run(`
          "test" -> {
            .contains("t") ? {
              .contains("e") ? "has t and e" ! "has t only"
            } ! {
              "no t"
            }
          }
        `)
      ).toBe('has t and e');
    });
  });

  describe('Return Values', () => {
    it('returns then branch value', async () => {
      expect(await run('true ? "result" ! "other" :> $x\n$x')).toBe('result');
    });

    it('returns else branch value', async () => {
      expect(await run('false ? "result" ! "other" :> $x\n$x')).toBe('other');
    });

    it('returns last expression in multi-statement block', async () => {
      expect(
        await run(`
          true ? {
            "first" :> $a
            "second" :> $b
            $b
          } ! "other"
        `)
      ).toBe('second');
    });
  });

  describe('Empty Block Validation', () => {
    it('rejects empty then block', async () => {
      await expect(run('true ? { }')).rejects.toThrow(
        'Empty blocks are not allowed'
      );
    });

    it('rejects empty else block', async () => {
      await expect(run('true ? "ok" ! { }')).rejects.toThrow(
        'Empty blocks are not allowed'
      );
    });

    it('rejects empty standalone block', async () => {
      await expect(run('"x" -> { }')).rejects.toThrow(
        'Empty blocks are not allowed'
      );
    });

    it('rejects empty for loop block', async () => {
      await expect(run('[1, 2] -> each { }')).rejects.toThrow(
        'Empty blocks are not allowed'
      );
    });

    it('rejects empty while loop block', async () => {
      await expect(run('false @ { }')).rejects.toThrow(
        'Empty blocks are not allowed'
      );
    });

    it('rejects empty function body', async () => {
      await expect(run('|| { } :> $fn')).rejects.toThrow(
        'Empty blocks are not allowed'
      );
    });
  });

  describe('New Syntax Forms', () => {
    it('parses compact form without spaces', async () => {
      expect(await run('true?"yes"!"no"')).toBe('yes');
    });

    it('parses variable as condition', async () => {
      expect(await run('true :> $ok\n$ok ? "yes" ! "no"')).toBe('yes');
    });

    it('parses grouped comparison as condition', async () => {
      expect(await run('(5 > 3) ? "big" ! "small"')).toBe('big');
    });

    it('parses method call as condition', async () => {
      expect(await run('"hello".contains("ell") ? "found" ! "not found"')).toBe(
        'found'
      );
    });

    it('parses piped conditional with block bodies', async () => {
      expect(
        await run(`
          true -> ? {
            "then"
          } ! {
            "else"
          }
        `)
      ).toBe('then');
    });
  });

  describe('Bare Function Calls in Branches', () => {
    it('passes $ implicitly to bare function in then branch', async () => {
      const result = await run(
        '"ERROR" -> .contains("ERROR") ? handle ! "ok"',
        {
          functions: {
            handle: {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `handled:${args[0]}`,
            },
          },
        }
      );
      expect(result).toBe('handled:ERROR');
    });

    it('passes $ implicitly to bare function in else branch', async () => {
      const result = await run(
        '"OK" -> .contains("ERROR") ? "error" ! process',
        {
          functions: {
            process: {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `processed:${args[0]}`,
            },
          },
        }
      );
      expect(result).toBe('processed:OK');
    });

    it('passes $ implicitly to namespaced function in then branch', async () => {
      const result = await run(
        '"ERROR" -> .contains("ERROR") ? app::error ! "ok"',
        {
          functions: {
            'app::error': {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `error:${args[0]}`,
            },
          },
        }
      );
      expect(result).toBe('error:ERROR');
    });

    it('passes $ implicitly to namespaced function in else branch', async () => {
      const result = await run(
        '"OK" -> .contains("ERROR") ? "error" ! app::process',
        {
          functions: {
            'app::process': {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `processed:${args[0]}`,
            },
          },
        }
      );
      expect(result).toBe('processed:OK');
    });

    it('passes $ to both branches when both are bare functions', async () => {
      const result = await run(
        '"ERROR data" -> .contains("ERROR") ? app::error ! app::process',
        {
          functions: {
            'app::error': {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `error:${args[0]}`,
            },
            'app::process': {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `processed:${args[0]}`,
            },
          },
        }
      );
      expect(result).toBe('error:ERROR data');
    });

    it('chains bare functions in else-if', async () => {
      const result = await run(
        '"warn" -> .eq("error") ? handleError ! .eq("warn") ? handleWarn ! handleInfo',
        {
          functions: {
            handleError: {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `error:${args[0]}`,
            },
            handleWarn: {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `warn:${args[0]}`,
            },
            handleInfo: {
              params: [{ name: 'input', type: 'string' }],
              fn: (args) => `info:${args[0]}`,
            },
          },
        }
      );
      expect(result).toBe('warn:warn');
    });
  });
});
