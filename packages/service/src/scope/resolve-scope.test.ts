import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';
import { resolveScopeAt } from './resolve-scope.js';

describe('resolveScopeAt', () => {
  it('resolves a name captured after a closure body reads it (late binding, not a definition-time snapshot)', () => {
    const source = `|x| ($x + $y) => $double
5 => $y
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    // Offset inside the closure body, at "$y" -- textually BEFORE the
    // `5 => $y` capture that defines it. A lexical-at-definition snapshot
    // resolver would omit `y` here; the mutable-outer model includes it
    // because the closure shares its outer scope by reference.
    const offset = source.indexOf('$y') + 1;

    const bindings = resolveScopeAt(parsed, offset);
    const names = bindings.map((binding) => binding.name);

    expect(names).toContain('y');
    expect(names).toContain('double');
  });

  it('resolves a previously-defined closure binding at a later capture (late binding)', () => {
    const source = `|x| ($x * 2) => $double
$double(5) => $result
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$double(5)') + 1;
    const bindings = resolveScopeAt(parsed, offset);

    const closureBinding = bindings.find(
      (binding) => binding.name === 'double'
    );
    expect(closureBinding).toBeDefined();
    expect(closureBinding?.kind).toBe('capture');
  });

  it('surfaces bindings from all four binding constructs, with a PassBlock seeing its parent scope', () => {
    const source = `1 => $outer
|x: number| ($x * 2) => $double
[1, 2, 3] -> destruct<$a, $b, $c>
dict[name: "Alice"] => $person
pass<on_error: #IGNORE> {
  $outer -> log
}
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    // Offset inside the PassBlock body: parent-scope bindings (declared both
    // before and, per the mutable-outer model, anywhere in the same scope)
    // must remain visible since PassBlock shares its parent's scope.
    const offset = source.indexOf('$outer -> log') + 1;
    const bindings = resolveScopeAt(parsed, offset);
    const byName = new Map(bindings.map((binding) => [binding.name, binding]));

    expect(byName.get('outer')?.kind).toBe('capture');
    expect(byName.get('double')?.kind).toBe('capture');
    expect(byName.get('a')?.kind).toBe('destructure');
    expect(byName.get('b')?.kind).toBe('destructure');
    expect(byName.get('c')?.kind).toBe('destructure');
    expect(byName.get('name')?.kind).toBe('dictKey');
  });

  it('surfaces a closureParam binding within the closure body scope', () => {
    const source = `1 => $outer
|x: number| ($x + $outer) => $double
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$x + $outer') + 1;
    const bindings = resolveScopeAt(parsed, offset);
    const byName = new Map(bindings.map((binding) => [binding.name, binding]));

    expect(byName.get('x')?.kind).toBe('closureParam');
    expect(byName.get('outer')?.kind).toBe('capture');
  });

  it('excludes the bare pipe value ($) from the binding list', () => {
    const source = `1 => $a
$a -> { $ * 2 } => $b
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const offset = source.indexOf('$ * 2') + 1;
    const bindings = resolveScopeAt(parsed, offset);

    expect(bindings.some((binding) => binding.name === '')).toBe(false);
    expect(bindings.map((binding) => binding.name)).toContain('a');
  });

  it('tolerates a script with recovery errors and returns surviving bindings without throwing', () => {
    const source = `1 => $a
2 => $b
|||broken syntax here
3 => $c
`;
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);

    const offset = source.indexOf('3 => $c') + 1;
    let bindings: ReturnType<typeof resolveScopeAt> = [];
    expect(() => {
      bindings = resolveScopeAt(parsed, offset);
    }).not.toThrow();

    const names = bindings.map((binding) => binding.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
  });

  it('returns an empty array for an empty script', () => {
    const parsed = parseWithRecovery('');

    expect(resolveScopeAt(parsed, 0)).toEqual([]);
  });

  it('returns an empty array for an out-of-range offset past EOF', () => {
    const source = '1 => $a\n';
    const parsed = parseWithRecovery(source);

    expect(resolveScopeAt(parsed, source.length + 1000)).toEqual([]);
  });
});
