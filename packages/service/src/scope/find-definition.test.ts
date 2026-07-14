import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';
import { findDefinition } from './find-definition.js';

describe('findDefinition', () => {
  it('resolves a variable reference to its capture binding site', () => {
    const source = `1 => $outer
$outer -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.lastIndexOf('$outer') + 1;
    const span = findDefinition(parsed, offset);

    expect(span).not.toBeNull();
    // The binding site is the declaring `$outer` right after `=>`, not the
    // usage site.
    expect(span?.start.offset).toBe(source.indexOf('$outer'));
  });

  it("returns the field access-chain segment's own span, not the whole chain, on a `.field` segment", () => {
    const source = `dict[name: "Alice"] => $person
$person.name -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const chainStart = source.indexOf('$person.name');
    const fieldSegmentStart = source.indexOf('.name', chainStart);
    const offset = fieldSegmentStart + 2; // inside "name"

    const span = findDefinition(parsed, offset);

    expect(span).not.toBeNull();
    // Narrower than the whole chain ("$person.name"): starts at the `.`,
    // not at `$person`.
    expect(span?.start.offset).toBe(fieldSegmentStart);
    expect(span?.start.offset).not.toBe(chainStart);
    expect(span?.end.offset).toBe(fieldSegmentStart + '.name'.length);
  });

  it("returns the bracket-index access-chain segment's own span, not the whole chain, on a `[0]` segment", () => {
    const source = `list[1, 2, 3] => $items
$items[0] -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const chainStart = source.indexOf('$items[0]');
    const bracketSegmentStart = source.indexOf('[0]', chainStart);
    const offset = bracketSegmentStart + 1; // inside "0"

    const span = findDefinition(parsed, offset);

    expect(span).not.toBeNull();
    // Narrower than the whole chain ("$items[0]"): starts at the `[`, not
    // at `$items`.
    expect(span?.start.offset).toBe(bracketSegmentStart);
    expect(span?.start.offset).not.toBe(chainStart);
    expect(span?.end.offset).toBe(bracketSegmentStart + '[0]'.length);
  });

  it('resolves go-to-def on the base `$x` of a `.upper` chain to the `$x` binding site', () => {
    const source = `"hi" => $x
$x.upper -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const chainStart = source.lastIndexOf('$x.upper');
    const offset = chainStart + 1; // inside "$x"

    const span = findDefinition(parsed, offset);

    expect(span).not.toBeNull();
    // The binding site is the declaring `$x` right after `=>`, not the
    // whole `$x.upper` chain at the usage site.
    expect(span?.start.offset).toBe(source.indexOf('$x'));
    expect(source.slice(span?.start.offset, span?.end.offset).trimEnd()).toBe(
      '$x'
    );
  });

  it('returns null for a built-in function name', () => {
    const source = `log(1)
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('log') + 1;
    expect(findDefinition(parsed, offset)).toBeNull();
  });

  it('returns null for a reserved keyword literal', () => {
    const source = `true
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('true') + 1;
    expect(findDefinition(parsed, offset)).toBeNull();
  });

  it('returns null for an unresolved variable reference', () => {
    const source = `$nope -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$nope') + 1;
    expect(findDefinition(parsed, offset)).toBeNull();
  });

  it('tolerates a script with recovery errors and resolves surviving bindings without throwing', () => {
    const source = `1 => $a
|||broken syntax here
$a -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(false);

    const offset = source.lastIndexOf('$a') + 1;
    let span: ReturnType<typeof findDefinition> = null;
    expect(() => {
      span = findDefinition(parsed, offset);
    }).not.toThrow();
    expect(span).not.toBeNull();
  });

  it('returns null for an out-of-range offset', () => {
    const source = '1 => $a\n';
    const parsed = parseWithRecovery(source);

    expect(findDefinition(parsed, source.length + 1000)).toBeNull();
  });

  it('resolves a same-type reassignment read to the nearest preceding capture, not the last one', () => {
    const source = `"hello" => $name
$name -> log
"world" => $name
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$name -> log') + 1;
    const span = findDefinition(parsed, offset);

    expect(span).not.toBeNull();
    expect(span?.start.offset).toBe(source.indexOf('$name'));
    expect(span?.start.offset).not.toBe(source.lastIndexOf('$name'));
  });

  it('does not resolve a `$name` reference to an unrelated dict key of the same name', () => {
    const source = `"x" => $user
dict[user: "Alice"] => $d
$user -> log
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.lastIndexOf('$user') + 1;
    const span = findDefinition(parsed, offset);

    expect(span).not.toBeNull();
    expect(span?.start.offset).toBe(source.indexOf('$user'));
  });
});
