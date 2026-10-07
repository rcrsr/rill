/**
 * Field access, conversion, and iteration over branded runtime values
 * (type values, atoms, vectors, streams, forged callables) must not expose
 * internal fields or raw host objects to scripts.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  createVector,
  type RillFunction,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const NO_PARAMS: RillFunction['params'] = [];

function makeStream(): RillFunction {
  return {
    params: NO_PARAMS,
    returnType: anyTypeValue,
    fn: () =>
      createRillStream({
        chunks: (async function* () {
          yield 1;
        })(),
        resolve: async () => 'resolved',
        dispose: () => undefined,
      }),
  };
}

function makeVec(): RillFunction {
  return {
    params: NO_PARAMS,
    returnType: anyTypeValue,
    fn: () => createVector(new Float32Array([1, 2, 3]), 'test-model'),
  };
}

const FUNCTIONS = { make_stream: makeStream(), make_vec: makeVec() };

/** Asserts the script halts with the given hyphen-form error id. */
async function expectErrorId(source: string, errorId: string): Promise<void> {
  await expectHalt(() => run(source, { functions: FUNCTIONS }), {
    code: errorId.replace('-', '_'),
    hostErrorId: errorId,
  });
}

describe('type value internals are not readable', () => {
  const TYPE = '42.^type => $t\n';

  it('rejects a quoted computed key on a type value', async () => {
    await expectErrorId(`${TYPE}$t.("structure")`, 'RILL-R003');
  });

  it('rejects a literal structure key on a type value', async () => {
    await expectErrorId(`${TYPE}$t.structure`, 'RILL-R003');
  });

  it('rejects a variable computed key on a type value', async () => {
    await expectErrorId(`${TYPE}"structure" => $k\n$t.$k`, 'RILL-R003');
  });

  it('rejects a method-style access to the structure field', async () => {
    await expectErrorId(`${TYPE}$t -> .structure`, 'RILL-R009');
  });

  it('rejects bracket access to the structure field', async () => {
    await expectErrorId(`${TYPE}$t["structure"]`, 'RILL-R002');
  });

  it('rejects alternate-key access that names the structure field', async () => {
    await expectErrorId(`${TYPE}$t.(typeName || structure)`, 'RILL-R002');
  });

  it('reports the structure field as absent via a quoted existence check', async () => {
    expect(await run(`${TYPE}$t.?("structure")`)).toBe(false);
  });

  it('reports the structure field as absent via a literal existence check', async () => {
    expect(await run(`${TYPE}$t.?structure`)).toBe(false);
  });

  it('falls back to the default when reading the structure field', async () => {
    expect(await run(`${TYPE}$t.("structure") ?? "fb"`)).toBe('fb');
  });

  it('rejects converting a type value to a dict with internal fields', async () => {
    await expectErrorId(
      '42.^type -> dict(typeName: string, structure: dict)',
      'RILL-R036'
    );
  });

  it('rejects nested hydration of a type value into a dict with internal fields', async () => {
    await expectHalt(
      () =>
        run('dict[t: 42.^type] -> dict(t: dict(structure: dict))', {
          functions: FUNCTIONS,
        }),
      { code: 'TYPE_MISMATCH' }
    );
  });

  it('rejects destructuring the structure field of a type value', async () => {
    await expectErrorId(`${TYPE}$t -> destruct<structure: $x>`, 'RILL-R002');
  });
});

describe('atom internals are not readable', () => {
  const ATOM = '#TIMEOUT => $a\n';

  it('rejects a variable computed key on an atom', async () => {
    await expectErrorId(`${ATOM}"atom" => $k\n$a.$k`, 'RILL-R003');
  });

  it('rejects a quoted computed key on an atom', async () => {
    await expectErrorId(`${ATOM}$a.("atom")`, 'RILL-R003');
  });

  it('falls back to the default when reading atom internals', async () => {
    expect(await run(`${ATOM}$a.("atom") ?? "fb"`)).toBe('fb');
  });

  it('rejects dot access to the atom record', async () => {
    await expectErrorId(`${ATOM}$a.atom`, 'RILL-R003');
  });

  it('rejects dispatching a key on an atom', async () => {
    await expectErrorId(`${ATOM}"atom" -> $a`, 'RILL-R002');
  });

  it('rejects converting an atom to an ordered with an internal field', async () => {
    await expectErrorId(`${ATOM}$a -> ordered(atom: any)`, 'RILL-R036');
  });

  it('rejects converting a type value to an ordered with internal fields', async () => {
    await expectErrorId(
      '42.^type -> ordered(typeName: string, structure: dict)',
      'RILL-R036'
    );
  });

  it('rejects hierarchical dispatch into an atom', async () => {
    const out = await run(`${ATOM}list["atom", "name"] -> $a`).catch(
      (e: unknown) => e
    );
    expect(out).toBeInstanceOf(Error);
  });

  it('rejects hierarchical dispatch through a dict into an atom', async () => {
    const out = await run(
      `${ATOM}list["x", "atom", "name"] -> dict[x: $a]`
    ).catch((e: unknown) => e);
    expect(out).toBeInstanceOf(Error);
  });

  it('rejects nested conversion of an atom into an ordered field', async () => {
    const out = await run(
      `${ATOM}dict[o: $a] -> dict(o: ordered(atom: any))`
    ).catch((e: unknown) => e);
    expect(out).toBeInstanceOf(Error);
  });

  it('rejects converting an atom to a dict with an internal field', async () => {
    await expectErrorId(`${ATOM}$a -> dict(atom: any)`, 'RILL-R036');
  });
});

describe('vector internals are not readable or iterable', () => {
  it('rejects dot access to vector data', async () => {
    await expectErrorId('make_vec() => $v\n$v.data', 'RILL-R003');
  });

  it('rejects computed-key access to vector data', async () => {
    await expectErrorId('make_vec() => $v\n$v.("data")', 'RILL-R003');
  });

  it('rejects a variable computed key on a vector', async () => {
    await expectErrorId('make_vec() => $v\n"data" => $k\n$v.$k', 'RILL-R003');
  });

  it('falls back to the default when reading vector internals', async () => {
    expect(
      await run('make_vec() => $v\n$v.("data") ?? "fb"', {
        functions: FUNCTIONS,
      })
    ).toBe('fb');
  });

  it('halts when iterating a vector with seq', async () => {
    await expectErrorId('make_vec() => $v\n$v -> seq({ $ })', 'RILL-R003');
  });

  it('rejects iterating a datetime with seq', async () => {
    await expectErrorId(
      'datetime("2026-03-13T08:00:00Z") -> seq({ $ })',
      'RILL-R002'
    );
  });
});

describe('datetime internals are not readable', () => {
  const DT = 'datetime("2026-03-13T08:00:00Z") => $d\n';

  it('rejects literal, variable and quoted internal keys', async () => {
    await expectErrorId(`${DT}$d.__rill_datetime`, 'RILL-R003');
    await expectErrorId(`${DT}"__rill_datetime" => $k\n$d.$k`, 'RILL-R003');
    await expectErrorId(`${DT}$d.("__rill_datetime")`, 'RILL-R003');
  });

  it('falls back to the default when reading internal keys', async () => {
    expect(await run(`${DT}$d.("__rill_datetime") ?? "fb"`)).toBe('fb');
  });
});

describe('duration internals are not readable', () => {
  const DUR = 'duration(0, 2) => $d\n';

  it('rejects literal, variable and quoted internal keys', async () => {
    await expectErrorId(`${DUR}$d.__rill_duration`, 'RILL-R003');
    await expectErrorId(`${DUR}"__rill_duration" => $k\n$d.$k`, 'RILL-R003');
    await expectErrorId(`${DUR}$d.("__rill_duration")`, 'RILL-R003');
  });

  it('falls back to the default when reading internal keys', async () => {
    expect(await run(`${DUR}$d.("__rill_duration") ?? "fb"`)).toBe('fb');
  });
});

describe('stream internals are not readable', () => {
  const STREAM = 'make_stream() => $s\n';

  it('rejects a variable computed key on the stream resolve function', async () => {
    await expectErrorId(
      `${STREAM}"__rill_stream_resolve" => $k\n$s.$k`,
      'RILL-R009'
    );
  });

  it('falls back to the default when reading the stream resolve function', async () => {
    expect(
      await run(`${STREAM}$s.("__rill_stream_resolve") ?? "fb"`, {
        functions: FUNCTIONS,
      })
    ).toBe('fb');
  });

  it('rejects computed-key access to the stream resolve function', async () => {
    await expectErrorId(`${STREAM}$s.("__rill_stream_resolve")`, 'RILL-R009');
  });

  it('rejects literal access to the stream resolve function', async () => {
    await expectErrorId(`${STREAM}$s.__rill_stream_resolve`, 'RILL-R009');
  });

  it.each([
    '__rill_stream_dispose',
    '__rill_stream_chunk_type',
    '__rill_stream',
  ])('rejects computed-key access to the stream field %s', async (key) => {
    await expectErrorId(`${STREAM}$s.("${key}")`, 'RILL-R009');
  });

  it('reports the stream resolve field as absent via an existence check', async () => {
    expect(
      await run(`${STREAM}$s.?("__rill_stream_resolve")`, {
        functions: FUNCTIONS,
      })
    ).toBe(false);
  });
});

describe('forged script callables are rejected', () => {
  const FORGE_TYPE =
    'dict(__type: string = "callable", kind: string = "script", params: list = list[], body: dict = dict[type: "NumberLiteral", value: 42], definingScope: dict = dict[])';

  it('rejects calling a callable forged through dict conversion', async () => {
    await expectErrorId(`dict[] -> ${FORGE_TYPE} => $f\n$f()`, 'RILL-R002');
  });

  it('rejects a forged callable hydrated into a closure parameter', async () => {
    await expectErrorId(
      '|x: dict(__type: string = "callable", kind: string = "script")| { $x } => $f\n$f(dict[])',
      'RILL-R002'
    );
  });

  it('rejects a forged callable built from a closure parameter default', async () => {
    await expectErrorId(
      '|x: dict(__type: string = "callable", kind: string = "script") = dict[]| { $x } => $f\n$f()',
      'RILL-R002'
    );
  });

  it('rejects a forged callable built through an ordered parameter type', async () => {
    await expectErrorId(
      '|x: ordered(__type: string = "callable", kind: string = "script")| { $x } => $f\n$f(ordered[])',
      'RILL-R002'
    );
  });
});

describe('spreading branded values is rejected', () => {
  it('rejects spreading a type value into a dict literal', async () => {
    await expectErrorId('42.^type => $t\ndict[...$t]', 'RILL-R002');
  });

  it('rejects spreading a type value into a closure call', async () => {
    await expectErrorId(
      '42.^type => $t\n|x| { $x } => $g\n$g(...$t)',
      'RILL-R001'
    );
  });
});

describe('legitimate field access is preserved', () => {
  const val = (src: string) => run(src, { functions: FUNCTIONS });

  it('reads iterator done, value and next', async () => {
    expect(await val('range(0, 3) => $i\n$i.done')).toBe(false);
    expect(await val('range(5, 8) => $i\n$i.value')).toBe(5);
    expect(await val('range(5, 8) => $i\n$i.next() => $n\n$n.value')).toBe(6);
  });

  it('reads stream step fields in every access form', async () => {
    const S = 'make_stream() => $s\n';
    expect(await val(`${S}$s.done`)).toBe(false);
    expect(await val(`${S}$s.next() => $st\n$st.value`)).toBe(1);
    expect(await val(`${S}$s.("done")`)).toBe(false);
    expect(await val(`${S}$s.?done`)).toBe(true);
    expect(await val(`${S}$s()`)).toBe('resolved');
  });

  it('halts on a stale stream step', async () => {
    await expectErrorId(
      'make_stream() => $s\n$s.next() => $a\n$s.next()',
      'RILL-R002'
    );
  });

  it('reads a plain dict through every access form', async () => {
    const D = 'dict[a: 1, b: "x"] => $d\n';
    expect(await val(`${D}$d.a`)).toBe(1);
    expect(await val(`${D}"b" => $k\n$d.($k)`)).toBe('x');
    expect(await val(`${D}$d.("a")`)).toBe(1);
    expect(await val(`${D}$d.?a`)).toBe(true);
    expect(await val(`${D}$d.?z`)).toBe(false);
    expect(await val(`${D}$d.z ?? "fb"`)).toBe('fb');
    expect(await val(`${D}$d.(z || a)`)).toBe(1);
    expect(await val('dict[1: "one"] => $d\n$d[1]')).toBe('one');
  });

  it('reads ordered values by key and entries', async () => {
    const O = 'ordered[a: 1, b: 2] => $o\n';
    expect(await val(`${O}$o.("b")`)).toBe(2);
    expect(await val(`${O}$o.entries`)).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('reads type value name and signature', async () => {
    expect(await val('number => $t\n$t.name')).toBe('number');
    expect(await val('5 => $v\n$v.^type.signature')).toBe('number');
  });

  it('reads datetime, duration and vector properties', async () => {
    expect(await val('datetime("2026-03-13T08:00:00Z") => $d\n$d.unix')).toBe(
      1773388800000
    );
    expect(await val('duration(0, 2) => $d\n$d.months')).toBe(2);
    expect(await val('make_vec() => $v\n$v.model')).toBe('test-model');
  });

  it('reports false for existence checks on scalars and lists', async () => {
    expect(await val('"abc" => $v\n$v.?x')).toBe(false);
    expect(await val('5 => $v\n$v.?x')).toBe(false);
    expect(await val('list[1] => $v\n$v.?x')).toBe(false);
    expect(await val('true => $v\n$v.?x')).toBe(false);
  });

  it('iterates list, dict, iterator and stream with seq', async () => {
    expect(await val('list[1, 2] -> seq({ $ + 1 })')).toEqual([2, 3]);
    expect(await val('dict[a: 1] -> seq({ $.value })')).toEqual([1]);
    expect(await val('range(0, 3) -> seq({ $ })')).toEqual([0, 1, 2]);
    expect(await val('make_stream() -> seq({ $ })')).toEqual([1]);
  });
});

describe('method-call and path forms reject blocked keys', () => {
  const TYPE = '42.^type => $t\n';
  const STREAM = 'make_stream() => $s\n';

  it('rejects a method-call read of the structure field on a type value', async () => {
    await expectErrorId(`${TYPE}$t.structure()`, 'RILL-R009');
  });

  it('rejects a pipe-target read of the stream resolve function', async () => {
    await expectErrorId(`${STREAM}$s -> .__rill_stream_resolve`, 'RILL-R009');
  });

  it('rejects a method-call read of the stream resolve function', async () => {
    await expectErrorId(`${STREAM}$s.__rill_stream_resolve()`, 'RILL-R009');
  });

  it('rejects a pipe-target read of the structure field on a type value', async () => {
    await expectErrorId(`${TYPE}$t -> .structure`, 'RILL-R009');
  });

  it('rejects a closure call through a path into a type value', async () => {
    await expectErrorId(`${TYPE}5 -> $t.structure`, 'RILL-R003');
  });

  it('reports a missing method on a stream as a missing field', async () => {
    await expectErrorId(`${STREAM}$s.bogus()`, 'RILL-R009');
  });

  it('skips a blocked stream key in alternatives and resolves a step key', async () => {
    expect(
      await run(`${STREAM}$s.(__rill_stream_resolve || done)`, {
        functions: FUNCTIONS,
      })
    ).toBe(false);
  });

  it('yields an empty result when every stream alternative is blocked', async () => {
    expect(
      await run(
        `${STREAM}$s.(__rill_stream_resolve || __rill_stream_dispose)`,
        { functions: FUNCTIONS }
      )
    ).toBeNull();
  });

  it('reports the stream resolve field as absent via a literal existence check', async () => {
    expect(
      await run(`${STREAM}$s.?__rill_stream_resolve`, { functions: FUNCTIONS })
    ).toBe(false);
  });

  it('reports a variable-key existence check as absent on the stream resolve field', async () => {
    expect(
      await run(`${STREAM}"__rill_stream_resolve" => $k\n$s.?($k)`, {
        functions: FUNCTIONS,
      })
    ).toBe(false);
  });

  it('reports a variable-key existence check as absent on a type value', async () => {
    expect(await run(`${TYPE}"structure" => $k\n$t.?($k)`)).toBe(false);
  });

  it('rejects destructuring the stream resolve function', async () => {
    await expectErrorId(
      `${STREAM}$s -> destruct<__rill_stream_resolve: $x>`,
      'RILL-R009'
    );
  });

  it('keeps stream next callable as a method and pipe target', async () => {
    expect(
      await run(`${STREAM}$s.next() => $n\n$n.value`, { functions: FUNCTIONS })
    ).toBe(1);
  });
});
