/**
 * Rill Runtime Tests: Capture Type Annotations
 * Tests for type-annotated variable capture ($var:type)
 */

import { describe, expect, it } from 'vitest';

import { run, runFull } from '../helpers/runtime.js';

describe('Rill Runtime: Capture Type Annotations', () => {
  describe('String Type', () => {
    it('captures string with string type', async () => {
      expect(await run('"hello" => $s:string\n$s')).toBe('hello');
    });

    it('rejects number captured as string', async () => {
      await expect(run('42 => $s:string')).rejects.toThrow();
    });

    it('rejects bool captured as string', async () => {
      await expect(run('true => $s:string')).rejects.toThrow();
    });
  });

  describe('Number Type', () => {
    it('captures number with number type', async () => {
      expect(await run('42 => $n:number\n$n')).toBe(42);
    });

    it('captures decimal with number type', async () => {
      expect(await run('3.14 => $n:number\n$n')).toBe(3.14);
    });

    it('captures negative number', async () => {
      expect(await run('-5 => $n:number\n$n')).toBe(-5);
    });

    it('rejects string captured as number', async () => {
      await expect(run('"42" => $n:number')).rejects.toThrow();
    });
  });

  describe('Bool Type', () => {
    it('captures true with bool type', async () => {
      expect(await run('true => $b:bool\n$b')).toBe(true);
    });

    it('captures false with bool type', async () => {
      expect(await run('false => $b:bool\n$b')).toBe(false);
    });

    it('rejects string captured as bool', async () => {
      await expect(run('"true" => $b:bool')).rejects.toThrow();
    });

    it('rejects number captured as bool', async () => {
      await expect(run('1 => $b:bool')).rejects.toThrow();
    });
  });

  describe('List Type', () => {
    it('captures list with list type', async () => {
      expect(await run('[1, 2, 3] => $t:list\n$t')).toEqual([1, 2, 3]);
    });

    it('captures empty list', async () => {
      expect(await run('[] => $t:list\n$t')).toEqual([]);
    });

    it('rejects dict captured as list', async () => {
      await expect(run('[a: 1] => $t:list')).rejects.toThrow();
    });

    it('rejects string captured as list', async () => {
      await expect(run('"abc" => $t:list')).rejects.toThrow();
    });
  });

  describe('Dict Type', () => {
    it('captures dict with dict type', async () => {
      expect(await run('[a: 1, b: 2] => $d:dict\n$d')).toEqual({ a: 1, b: 2 });
    });

    it('captures empty dict', async () => {
      expect(await run('[:] => $d:dict\n$d')).toEqual({});
    });

    it('rejects tuple captured as dict', async () => {
      await expect(run('[1, 2] => $d:dict')).rejects.toThrow();
    });
  });

  describe('Closure Type', () => {
    it('captures closure with closure type', async () => {
      expect(await run('|| { "x" } => $fn:closure\n$fn()')).toBe('x');
    });

    it('captures parameterized closure', async () => {
      expect(await run('|x| { $x } => $fn:closure\n$fn("test")')).toBe('test');
    });

    it('rejects string captured as closure', async () => {
      await expect(run('"fn" => $fn:closure')).rejects.toThrow();
    });
  });

  describe('Type Validation in Context', () => {
    it('validates type in for loop capture', async () => {
      // Each iteration captures as number
      const script = `[1, 2, 3] -> each { $ => $n:number\n$n }`;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('rejects wrong type in for loop', async () => {
      const script = `["a", "b"] -> each { $ => $n:number }`;
      await expect(run(script)).rejects.toThrow();
    });

    it('validates type in conditional branch', async () => {
      const script = `true -> ? { 42 => $n:number\n$n } ! { 0 }`;
      expect(await run(script)).toBe(42);
    });

    it('validates type after function call', async () => {
      const script = `"hello" -> .len => $n:number\n$n`;
      expect(await run(script)).toBe(5);
    });
  });

  describe('Type Annotation with Inline Capture', () => {
    it('validates type in middle of pipe chain', async () => {
      const script = `"hello" => $s:string -> .len`;
      expect(await run(script)).toBe(5);
    });

    it('rejects wrong type in middle of chain', async () => {
      const script = `42 => $s:string -> .str`;
      await expect(run(script)).rejects.toThrow();
    });
  });

  describe('Untyped Capture', () => {
    it('accepts any type without annotation', async () => {
      expect(await run('"string" => $v\n$v')).toBe('string');
      expect(await run('42 => $v\n$v')).toBe(42);
      expect(await run('true => $v\n$v')).toBe(true);
      expect(await run('[1, 2] => $v\n$v')).toEqual([1, 2]);
    });

    it('type-locks variable after first assignment', async () => {
      // Variables are type-locked after first assignment
      const script = `"string" => $v
42 => $v`;
      await expect(run(script)).rejects.toThrow('Type mismatch');
    });

    it('allows reassignment of same type', async () => {
      const script = `"first" => $v
"second" => $v
$v`;
      expect(await run(script)).toBe('second');
    });
  });

  describe('Variables in Result', () => {
    it('captures typed variable in result', async () => {
      const result = await runFull('"hello" => $msg:string');
      expect(result.variables['msg']).toBe('hello');
    });

    it('captures multiple typed variables', async () => {
      const result = await runFull(`"a" => $s:string
42 => $n:number
[$s, $n]`);
      expect(result.variables['s']).toBe('a');
      expect(result.variables['n']).toBe(42);
    });
  });
});
