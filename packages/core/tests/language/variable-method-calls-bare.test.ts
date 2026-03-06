import { describe, it, expect } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('Variable Method Calls', () => {
  describe('.len method', () => {
    it('calls .len on list variable', async () => {
      expect(await run('[0,1,2] => $v\n$v.len')).toBe(3);
    });

    it('calls .len on string variable', async () => {
      expect(await run('"hello" => $s\n$s.len')).toBe(5);
    });

    it('calls .len on dict variable', async () => {
      expect(await run('[a:1, b:2] => $d\n$d.len')).toBe(2);
    });

    it('variable.len equals literal.len for lists', async () => {
      const script = `[0,1,2].len => $l1
[0,1,2] => $v
$v.len => $l2
$l1 == $l2`;
      expect(await run(script)).toBe(true);
    });

    it('variable.len equals literal.len for strings', async () => {
      const script = `"test".len => $l1
"test" => $v
$v.len => $l2
$l1 == $l2`;
      expect(await run(script)).toBe(true);
    });
  });

  describe('other built-in methods', () => {
    it('calls .trim on string variable', async () => {
      expect(await run('"  hello  " => $s\n$s.trim')).toBe('hello');
    });

    it('calls .upper on string variable', async () => {
      expect(await run('"hello" => $s\n$s.upper')).toBe('HELLO');
    });

    it('calls .lower on string variable', async () => {
      expect(await run('"HELLO" => $s\n$s.lower')).toBe('hello');
    });

    it('calls .head on list variable', async () => {
      expect(await run('[1,2,3] => $list\n$list.head')).toBe(1);
    });

    it('calls .tail on list variable', async () => {
      expect(await run('[1,2,3] => $list\n$list.tail')).toBe(3);
    });

    it('calls .empty on list variable', async () => {
      expect(await run('[] => $list\n$list.empty')).toBe(true);
      expect(await run('[1] => $list\n$list.empty')).toBe(false);
    });
  });

  describe('consistency with pipe syntax', () => {
    it('$v.method equals $v -> .method', async () => {
      expect(await run('"hello" => $v\n$v.len')).toBe(
        await run('"hello" => $v\n$v -> .len')
      );
    });

    it('$v.trim equals $v -> .trim', async () => {
      expect(await run('"  test  " => $v\n$v.trim')).toBe(
        await run('"  test  " => $v\n$v -> .trim')
      );
    });
  });
});
