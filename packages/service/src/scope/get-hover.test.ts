import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';
import { getHover } from './get-hover.js';

describe('getHover', () => {
  it("shows a variable's declared type from its closure-param annotation", () => {
    const source = `|x: number| ($x + 1) => $double
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$x + 1') + 1;
    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    expect(hover?.type).toBe('number');
  });

  it('hovers a `.field` access-chain segment on its own sub-token span, distinct from the whole chain', () => {
    const source = `dict[name: "Alice"] => $person
$person.name -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const chainStart = source.indexOf('$person.name');
    const fieldSegmentStart = source.indexOf('.name', chainStart);
    const offset = fieldSegmentStart + 2;

    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    expect(hover?.contents).toContain('name');
    // `.name` starts right after `$person` (7 characters into the line);
    // a resolver folding the whole chain into one span would instead start
    // at column 0 (the `$` of `$person`).
    expect(hover?.range?.start.character).toBe('$person'.length);
    expect(hover?.range?.start.character).not.toBe(0);
  });

  it('hovers a `[0]` bracket-index access-chain segment on its own sub-token span, distinct from the whole chain', () => {
    const source = `list[1, 2, 3] => $items
$items[0] -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const chainStart = source.indexOf('$items[0]');
    const bracketSegmentStart = source.indexOf('[0]', chainStart);
    const offset = bracketSegmentStart + 1; // inside "0"

    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    expect(hover?.contents).toContain('index');
    // `[0]` starts right after `$items` (6 characters into the line); a
    // resolver folding the whole chain into one span would instead start
    // at column 0 (the `$` of `$items`).
    expect(hover?.range?.start.character).toBe('$items'.length);
    expect(hover?.range?.start.character).not.toBe(0);
  });

  it('hovers a bare variable base of a `.method()` chain on just `$name`, not the whole chain', () => {
    const source = `"hi" => $x
$x.upper() -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const chainStart = source.lastIndexOf('$x.upper()');
    const offset = chainStart + 1; // inside "$x"

    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    // The range covers only `$x` (2 characters), not the trailing
    // `.upper()` method call.
    const line = source.split('\n')[1]!;
    expect(hover?.range?.start.character).toBe(0);
    expect(
      line.slice(hover!.range!.start.character, hover!.range!.end.character)
    ).toBe('$x');
  });

  it('hovers the base `$person` of `$person.name` on just `$person`, not the whole chain', () => {
    const source = `dict[name: "Alice"] => $person
$person.name -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const chainStart = source.lastIndexOf('$person.name');
    const offset = chainStart + 1; // inside "$person"

    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    const line = source.split('\n')[1]!;
    expect(hover?.range?.start.character).toBe(0);
    expect(
      line.slice(hover!.range!.start.character, hover!.range!.end.character)
    ).toBe('$person');
  });

  it('returns a static description for a built-in function', () => {
    const source = `log(1)
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('log') + 1;
    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    expect(hover?.contents).toContain('log');
    expect(hover?.type).toBeUndefined();
  });

  it('returns a static description for a reserved keyword', () => {
    const source = `true
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('true') + 1;
    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    expect(hover?.contents).toContain('true');
  });

  it('returns the introspected signature for a closure invocation', () => {
    const source = `|x: number| ($x * 2) => $double
$double(5) => $result
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$double(5)') + 1;
    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    expect(hover?.type).toContain('x: number');
  });

  it('returns null for an unresolved variable reference', () => {
    const source = `$nope -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$nope') + 1;
    expect(getHover(parsed, offset)).toBeNull();
  });

  it('tolerates a script with recovery errors and degrades without throwing', () => {
    const source = `1 => $a
|||broken syntax here
$a -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(false);

    const offset = source.lastIndexOf('$a') + 1;
    let hover: ReturnType<typeof getHover> = null;
    expect(() => {
      hover = getHover(parsed, offset);
    }).not.toThrow();
    expect(hover).not.toBeNull();
  });

  it('returns null for an out-of-range offset', () => {
    const source = '1 => $a\n';
    const parsed = parseWithRecovery(source);

    expect(getHover(parsed, source.length + 1000)).toBeNull();
  });

  it('resolves a same-type reassignment read to the nearest preceding capture, not a later one', () => {
    // The first capture carries a `:string` annotation; the reassignment
    // does not (same-type reassignments need not repeat it). A last-wins
    // resolver would match the read to the untyped reassignment and report
    // no declared type; the nearest-preceding fix reports `string`.
    const source = `"hello" => $name: string
$name -> log
"world" => $name
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$name -> log') + 1;
    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    expect(hover?.type).toBe('string');
  });

  it('does not hover a `$name` reference onto an unrelated dict key of the same name', () => {
    const source = `"x" => $user
dict[user: "Alice"] => $d
$user -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.lastIndexOf('$user') + 1;
    const hover = getHover(parsed, offset);

    expect(hover).not.toBeNull();
    expect(hover?.contents).toBe('variable `user`');
  });
});
