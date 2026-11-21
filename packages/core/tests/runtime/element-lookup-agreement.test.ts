/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Every access form finds the same element and projects the same type.
 *
 * One locator decides whether a key or position selects an element, so for a
 * given receiver and key every form that accepts the key agrees on (a) the
 * value it finds, (b) the declared type that value carries, and (c) what a
 * miss does. A form keeps its own key rules and its own miss message; only the
 * lookup and the projection are shared.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

// ============================================================
// FORMS
// ============================================================

type Form =
  | 'literal'
  | 'variable key'
  | 'bracket'
  | 'pipe method'
  | 'pipe selection'
  | 'hierarchical'
  | 'destructure';

const U = 'union(number, string)';

/** The receiver is always bound to `$c`; the key source text is `key`. */
function readOf(
  form: Exclude<Form, 'destructure'>,
  key: string,
  name: string
): { readonly prelude: string; readonly expr: string } {
  switch (form) {
    case 'literal':
      return { prelude: '', expr: `$c.${name}` };
    case 'variable key':
      return { prelude: `${key} => $k\n`, expr: '$c.$k' };
    case 'bracket':
      return { prelude: '', expr: `$c[${key}]` };
    case 'pipe method':
      return { prelude: '', expr: `$c -> .${name}` };
    case 'pipe selection':
      return { prelude: '', expr: `${key} -> $c` };
    default:
      return { prelude: '', expr: `list[${key}] -> $c` };
  }
}

type Tail = 'value' | 'type' | 'default';

interface Receiver {
  readonly label: string;
  /** Binds the receiver to `$c`. */
  readonly setup: string;
  /** Source text of the key. */
  readonly key: string;
  /** Identifier spelling of the key, for the forms that name a field. */
  readonly name: string;
  /** Destructure pattern that binds the element to `$v`, if one applies. */
  readonly pattern?: string;
  readonly forms: readonly Form[];
}

function scriptFor(
  receiver: Receiver,
  form: Form,
  tail: Tail,
  expectedType: string
): string {
  const check = tail === 'type' ? `$v.^type == ${expectedType}` : '$v';
  if (form === 'destructure') {
    return `${receiver.setup}\n$c -> destruct<${receiver.pattern ?? ''}>\n${check}`;
  }
  const { prelude, expr } = readOf(form, receiver.key, receiver.name);
  const head = `${receiver.setup}\n${prelude}${expr}`;
  switch (tail) {
    case 'value':
      return head;
    case 'type':
      return `${head} => $v\n${check}`;
    default:
      return `${head} ?? 5`;
  }
}

// ============================================================
// HITS: SAME VALUE, SAME DECLARED TYPE
// ============================================================

interface Hit extends Receiver {
  readonly value: unknown;
  /** Declared type the element carries. */
  readonly type: string;
}

const NAMED: readonly Form[] = [
  'literal',
  'variable key',
  'bracket',
  'pipe method',
];

/** An ordered value has no method form: `-> .b` is not an element read. */
const ORDERED_NAMED: readonly Form[] = [
  ...NAMED.filter((form) => form !== 'pipe method'),
  'pipe selection',
];

const POSITIONAL: readonly Form[] = [
  'variable key',
  'bracket',
  'pipe selection',
];

/** A map has no named forms; a list input does not descend into it. */
const MAP_FORMS: readonly Form[] = [
  'variable key',
  'bracket',
  'pipe selection',
];

const HITS: readonly Hit[] = [
  {
    label: 'dict field',
    setup: `dict[a: 1, b: 2] => $c:dict(a: ${U}, b: ${U})`,
    key: '"a"',
    name: 'a',
    pattern: 'a: $v',
    forms: [...NAMED, 'pipe selection', 'hierarchical', 'destructure'],
    value: 1,
    type: U,
  },
  {
    label: 'ordered entry by name',
    setup: `ordered[a: 1, b: "x"] => $c:ordered(a: number, b: ${U})`,
    key: '"b"',
    name: 'b',
    forms: ORDERED_NAMED,
    value: 'x',
    type: U,
  },
  {
    label: 'ordered entry by position',
    setup: `ordered[a: 1, b: "x"] => $c:ordered(a: number, b: ${U})`,
    key: '1',
    name: '',
    forms: POSITIONAL,
    value: 'x',
    type: U,
  },
  {
    label: 'ordered entry by negative position',
    setup: `ordered[a: 1, b: "x"] => $c:ordered(a: number, b: ${U})`,
    key: '-1',
    name: '',
    forms: POSITIONAL,
    value: 'x',
    type: U,
  },
  {
    label: 'list first element',
    setup: `list[1, 2] => $c:list(${U})`,
    key: '0',
    name: '',
    pattern: '$v, _',
    forms: [
      'variable key',
      'bracket',
      'pipe selection',
      'hierarchical',
      'destructure',
    ],
    value: 1,
    type: U,
  },
  {
    label: 'list negative index',
    setup: `list[1, 2] => $c:list(${U})`,
    key: '-1',
    name: '',
    forms: ['variable key', 'bracket', 'pipe selection', 'hierarchical'],
    value: 2,
    type: U,
  },
  {
    label: 'tuple position',
    setup: `tuple[1, "a"] => $c:tuple(number, ${U})`,
    key: '1',
    name: '',
    forms: POSITIONAL,
    value: 'a',
    type: U,
  },
  {
    label: 'tuple negative position',
    setup: `tuple[1, "a"] => $c:tuple(number, ${U})`,
    key: '-1',
    name: '',
    forms: POSITIONAL,
    value: 'a',
    type: U,
  },
  {
    label: 'tuple first position keeps its own declared type',
    setup: `tuple[1, "a"] => $c:tuple(number, ${U})`,
    key: '0',
    name: '',
    forms: POSITIONAL,
    value: 1,
    type: 'number',
  },
  {
    label: 'map entry by atom key',
    setup: 'map[#a: 1, #b: 2] => $c',
    key: '#b',
    name: '',
    forms: MAP_FORMS,
    value: 2,
    type: 'number',
  },
  {
    label: 'map entry by negative number key',
    setup: 'map[1: "x", -1: "y"] => $c',
    key: '-1',
    name: '',
    forms: MAP_FORMS,
    value: 'y',
    type: 'string',
  },
  {
    label: 'dict number-spelled key',
    setup: `dict[1: "x"] => $c:dict(1: ${U})`,
    key: '"1"',
    name: '',
    forms: ['variable key', 'bracket', 'pipe selection'],
    value: 'x',
    type: U,
  },
  {
    label: 'dict bool-spelled key',
    setup: `dict[true: "x"] => $c:dict(true: ${U})`,
    key: '"true"',
    name: '',
    forms: ['variable key', 'bracket', 'pipe selection'],
    value: 'x',
    type: U,
  },
];

const HIT_CASES = HITS.flatMap((receiver) =>
  receiver.forms.map((form) => ({ receiver, form }))
);

describe('element lookup: located value and declared type', () => {
  describe.each(HIT_CASES)('$receiver.label through $form', (c) => {
    it('finds the element', async () => {
      expect(
        await run(scriptFor(c.receiver, c.form, 'value', c.receiver.type))
      ).toEqual(c.receiver.value);
    });

    it('carries the declared type projected from the receiver', async () => {
      expect(
        await run(scriptFor(c.receiver, c.form, 'type', c.receiver.type))
      ).toBe(true);
    });
  });

  it('reports the own type of a located union element', async () => {
    const src = `dict[a: 1] => $c:dict(a: ${U})\n`;
    for (const read of ['$c.a', '$c["a"]', '"a" -> $c', 'list["a"] -> $c']) {
      expect(await run(`${src}${read} => $v\n$v.^effective == number`)).toBe(
        true
      );
    }
  });

  it('projects each element of an iterated declared list', async () => {
    expect(
      await run(`list[1, 2] => $c:list(${U})\n$c -> seq({ $.^type == ${U} })`)
    ).toEqual([true, true]);
  });

  it('projects a nested destructure from the declared position', async () => {
    const src = `list[list[1], list[2]] => $c:list(list(${U}))\n$c -> destruct<destruct<$v>, _>\n`;
    expect(await run(`${src}$v.^type == ${U}`)).toBe(true);
  });
});

// ============================================================
// MISSES: SAME FINDING, EACH FORM'S OWN HALT
// ============================================================

type Expected =
  | { readonly halt: string; readonly message: string }
  | { readonly value: unknown };

interface Miss extends Receiver {
  readonly expected: Partial<Record<Form, Expected>>;
  /** True when `?? 5` recovers the miss in every form that accepts it; false when the miss halts even with a default. */
  readonly recovers: boolean;
}

const R009 = (message: string): Expected => ({ halt: 'RILL_R009', message });
const NOT_INT = (kind: string): Expected => ({
  halt: 'INVALID_INPUT',
  message: `${kind} index must be an integer, got 1.5`,
});

const MISSES: readonly Miss[] = [
  {
    label: 'dict missing field',
    setup: `dict[a: 1] => $c:dict(a: ${U})`,
    key: '"z"',
    name: 'z',
    pattern: 'z: $v',
    forms: [...NAMED, 'pipe selection', 'hierarchical', 'destructure'],
    recovers: true,
    expected: {
      literal: R009("Dict has no field 'z'"),
      'variable key': R009('Undefined dict key: z'),
      bracket: R009('Undefined dict key: z'),
      'pipe method': R009("Dict has no field 'z'"),
      'pipe selection': R009('Undefined dict key: z'),
      hierarchical: R009('Undefined dict key: z'),
      destructure: R009('Undefined dict key: z'),
    },
  },
  {
    label: 'ordered missing name',
    setup: `ordered[a: 1] => $c:ordered(a: ${U})`,
    key: '"z"',
    name: 'z',
    forms: ORDERED_NAMED,
    recovers: true,
    expected: {
      literal: R009('Undefined ordered key: z'),
      'variable key': R009('Undefined ordered key: z'),
      bracket: R009('Undefined ordered key: z'),
      'pipe selection': R009('Undefined ordered key: z'),
    },
  },
  {
    label: 'ordered position out of range',
    setup: `ordered[a: 1] => $c:ordered(a: ${U})`,
    key: '5',
    name: '',
    forms: POSITIONAL,
    recovers: true,
    expected: {
      'variable key': R009('Ordered index out of bounds: 5'),
      bracket: R009('Ordered index out of bounds: 5'),
      'pipe selection': R009('Ordered index out of bounds: 5'),
    },
  },
  {
    label: 'map missing key',
    setup: 'map[#a: 1] => $c',
    key: '#z',
    name: '',
    forms: MAP_FORMS,
    recovers: true,
    expected: {
      'variable key': R009('Undefined map key: #z'),
      bracket: R009('Undefined map key: #z'),
      'pipe selection': R009('Undefined map key: #z'),
    },
  },
  {
    label: 'list index out of range',
    setup: `list[1, 2] => $c:list(${U})`,
    key: '5',
    name: '',
    forms: ['variable key', 'bracket', 'pipe selection', 'hierarchical'],
    recovers: true,
    expected: {
      'variable key': R009('List index out of bounds: 5'),
      bracket: R009('List index out of bounds: 5'),
      'pipe selection': R009('List index out of bounds: 5'),
      hierarchical: R009('List index out of bounds: 5'),
    },
  },
  {
    label: 'list negative index out of range',
    setup: `list[1, 2] => $c:list(${U})`,
    key: '-3',
    name: '',
    forms: ['variable key', 'bracket', 'pipe selection', 'hierarchical'],
    recovers: true,
    expected: {
      'variable key': R009('List index out of bounds: -3'),
      bracket: R009('List index out of bounds: -3'),
      'pipe selection': R009('List index out of bounds: -3'),
      hierarchical: R009('List index out of bounds: -3'),
    },
  },
  {
    label: 'list fractional index',
    setup: `list[1, 2] => $c:list(${U})`,
    key: '1.5',
    name: '',
    forms: ['variable key', 'bracket', 'pipe selection', 'hierarchical'],
    recovers: false,
    expected: {
      'variable key': NOT_INT('List'),
      bracket: NOT_INT('List'),
      'pipe selection': NOT_INT('List'),
      hierarchical: NOT_INT('List'),
    },
  },
  {
    label: 'tuple position out of range',
    setup: `tuple[1, "a"] => $c:tuple(number, ${U})`,
    key: '5',
    name: '',
    forms: POSITIONAL,
    recovers: true,
    expected: {
      'variable key': R009('Tuple index out of bounds: 5'),
      bracket: R009('Tuple index out of bounds: 5'),
      'pipe selection': R009('Tuple index out of bounds: 5'),
    },
  },
];

/** Forms whose miss a `??` default does not recover. A destructure has no default syntax at all. */
const NO_DEFAULT: ReadonlySet<Form> = new Set(['destructure']);

const MISS_CASES = MISSES.flatMap((receiver) =>
  receiver.forms.map((form) => ({
    receiver,
    form,
    expected: receiver.expected[form],
  }))
);

describe('element lookup: miss behaviour', () => {
  describe.each(MISS_CASES)('$receiver.label through $form', (c) => {
    it('halts with the form message', async () => {
      const expected = c.expected;
      if (expected === undefined || !('halt' in expected)) {
        throw new Error('row declares no halt');
      }
      await expectHalt(() => run(scriptFor(c.receiver, c.form, 'value', U)), {
        code: expected.halt,
        messagePattern: expected.message,
      });
    });
  });

  describe.each(MISS_CASES.filter((c) => !NO_DEFAULT.has(c.form)))(
    '$receiver.label through $form with a default',
    (c) => {
      it('resolves to the default only when the miss is recoverable', async () => {
        const source = scriptFor(c.receiver, c.form, 'default', U);
        const expected = c.expected;
        if (c.receiver.recovers) {
          expect(await run(source)).toBe(5);
        } else if (expected !== undefined && 'halt' in expected) {
          await expectHalt(() => run(source), { code: expected.halt });
        } else {
          throw new Error('row declares no halt');
        }
      });
    }
  );

  describe.each(
    MISS_CASES.filter((c) => c.form === 'bracket' && !c.receiver.recovers)
  )('$receiver.label through $form with a default that does not apply', (c) => {
    it('still halts with the form message', async () => {
      const expected = c.expected;
      if (expected === undefined || !('halt' in expected)) {
        throw new Error('row declares no halt');
      }
      const source = scriptFor(c.receiver, c.form, 'default', U);
      await expectHalt(() => run(source), {
        code: expected.halt,
        messagePattern: expected.message,
      });
    });
  });

  it('takes the own type for a default that replaces a miss', async () => {
    const src = `dict[a: 1] => $c:dict(a: ${U})\n`;
    for (const read of ['$c.z', '"z" -> $c', 'list["z"] -> $c']) {
      expect(await run(`${src}${read} ?? 5 => $v\n$v.^type == number`)).toBe(
        true
      );
    }
  });
});

// ============================================================
// EXISTENCE, LITERAL LIST DISPATCH, SELECTED CALLABLES, KEY IDENTITY
// ============================================================

describe('element lookup: bracket default covers only the right-most access', () => {
  // The same lookup through a variable receiver and a postfix receiver.
  const RECEIVERS = [
    {
      label: 'variable receiver',
      dict: 'dict[a: 1] => $d\n$d',
      numDict: 'dict[1: "x"] => $d\n$d',
      list: 'list[1, 2] => $l\n$l',
    },
    {
      label: 'postfix receiver',
      dict: 'dict[a: 1] => $d\n($d)',
      numDict: 'dict[1: "x"] => $d\n($d)',
      list: 'list[1, 2] => $l\n($l)',
    },
    {
      label: 'literal receiver',
      dict: 'dict[a: 1]',
      numDict: 'dict[1: "x"]',
      list: 'list[1, 2]',
    },
  ] as const;

  describe.each(RECEIVERS)('through a $label', (r) => {
    it('returns the default for an absent string key', async () => {
      expect(await run(`${r.dict}["z"] ?? 0`)).toBe(0);
    });

    rule('selection.key-no-mask').it(
      'halts #TYPE_MISMATCH for a number selector on a dict, even with a default',
      async () => {
        await expectHalt(() => run(`${r.dict}[2] ?? 0`), {
          code: 'TYPE_MISMATCH',
        });
        await expectHalt(() => run(`${r.numDict}[1] ?? 0`), {
          code: 'TYPE_MISMATCH',
        });
      }
    );

    rule('selection.key-no-mask').it(
      'halts #TYPE_MISMATCH for a bool selector on a dict, even with a default',
      async () => {
        await expectHalt(() => run(`${r.dict}[true] ?? 0`), {
          code: 'TYPE_MISMATCH',
        });
        await expectHalt(() => run(`${r.numDict}[true] ?? 0`), {
          code: 'TYPE_MISMATCH',
        });
      }
    );

    it('returns the element for the string spelling of a number key', async () => {
      expect(await run(`${r.numDict}["1"] ?? 0`)).toBe('x');
    });

    it('returns the default for an out-of-range index', async () => {
      expect(await run(`${r.list}[9] ?? 0`)).toBe(0);
    });

    it('halts when the selector reads a missing field', async () => {
      await expectHalt(() => run(`${r.dict}[dict[a: 1].zz] ?? 0`), {
        code: 'RILL_R009',
      });
    });

    it('halts when a miss precedes the right-most bracket', async () => {
      await expectHalt(() => run(`${r.dict}["x"]["b"] ?? 0`), {
        code: 'RILL_R009',
      });
    });

    it('halts for a wrong key type', async () => {
      await expectHalt(() => run(`${r.list}["x"] ?? 0`), {
        code: 'RILL_R002',
      });
    });
  });

  it('halts a selector error through a method-call receiver', async () => {
    await expectHalt(() => run('dict[a: 1] => $d\n$d -> .keys()[$d.zz] ?? 0'), {
      code: 'RILL_R009',
    });
  });

  it('recovers an out-of-range index through a method-call receiver', async () => {
    expect(await run('dict[a: 1] => $d\n$d -> .keys()[5] ?? 0')).toBe(0);
  });

  it('halts when the field before a bracket is missing', async () => {
    await expectHalt(() => run('dict[a: 1] => $d\n$d -> .b[1] ?? 0'), {
      code: 'RILL_R009',
    });
    await expectHalt(() => run('dict[a: 1] => $d\n$d.b[1] ?? 0'), {
      code: 'RILL_R009',
    });
  });
});

describe('element lookup: map receiver', () => {
  it('halts a named field read with the no-fields error', async () => {
    await expectHalt(() => run('map["a": 1] => $c\n$c.a'), {
      code: 'RILL_R003',
    });
  });

  it('halts a wrong-kind selector in every form, even with a default', async () => {
    const setup = 'map[#a: 1] => $c\n"a" => $k\n';
    for (const read of ['$c.$k', '$c["a"]', '"a" -> $c', '$c.?["a"]']) {
      await expectHalt(() => run(`${setup}${read} ?? 5`), {
        code: 'TYPE_MISMATCH',
      });
    }
  });

  it('answers a named existence check with false', async () => {
    expect(await run('map["a": 1] => $c\n$c.?a')).toBe(false);
  });
});

describe('element lookup: existence check', () => {
  const dynamicHits = HIT_CASES.filter((c) => c.form === 'bracket');

  it.each(dynamicHits)(
    'answers true for $receiver.label found through .?',
    async (c) => {
      expect(await run(`${c.receiver.setup}\n$c.?[${c.receiver.key}]`)).toBe(
        true
      );
    }
  );

  it.each(MISS_CASES.filter((c) => c.form === 'bracket'))(
    'answers false for $receiver.label missed through .?',
    async (c) => {
      const fractional = c.receiver.label.includes('fractional');
      const source = `${c.receiver.setup}\n$c.?[${c.receiver.key}]`;
      if (fractional) {
        await expectHalt(() => run(source), { code: 'INVALID_INPUT' });
      } else {
        expect(await run(source)).toBe(false);
      }
    }
  );
});

describe('element lookup: literal list dispatch', () => {
  it('selects by index and counts a negative index from the end', async () => {
    expect(await run('1 -> list[10, 20]')).toBe(20);
    expect(await run('-1 -> list[10, 20]')).toBe(20);
  });

  it('halts out of range and recovers with a default', async () => {
    await expectHalt(() => run('5 -> list[10, 20]'), {
      code: 'RILL_R009',
      messagePattern: 'List index out of bounds: 5',
    });
    expect(await run('5 -> list[10, 20] ?? 7')).toBe(7);
  });

  it('halts on a fractional index even with a default', async () => {
    await expectHalt(() => run('1.5 -> list[10, 20] ?? 7'), {
      code: 'INVALID_INPUT',
      messagePattern: 'List index must be an integer, got 1.5',
    });
  });
});

describe('element lookup: selected callable', () => {
  it('returns a variable dict fn with params uncalled', async () => {
    expect(
      await run('dict[a: fn(x) { "k{$x}" }] => $d\n"a" -> $d => $f\n$f("a")')
    ).toBe('ka');
  });

  it('runs a variable dict held block with the key as $', async () => {
    expect(await run('dict[a: { "k{$}" }] => $d\n"a" -> $d')).toBe('ka');
  });

  it('runs a literal dict held block with the key as $', async () => {
    expect(await run('"a" -> dict[a: { "k{$}" }]')).toBe('ka');
  });

  it('returns a literal dict fn with user-named params uncalled', async () => {
    expect(await run('"a" -> dict[a: fn(x) { "k{$x}" }] => $f\n$f("a")')).toBe(
      'ka'
    );
  });

  it('runs the terminal held block of a hierarchical path with the last key', async () => {
    expect(
      await run('dict[a: dict[b: { "k{$}" }]] => $d\nlist["a", "b"] -> $d')
    ).toBe('kb');
  });
});

describe('element lookup: key identity', () => {
  const SETUP = 'dict[1: "n", one: "s"] => $c';

  it.each([
    ['number-spelled key', '"1"', 'n'],
    ['identifier key', '"one"', 's'],
  ])('finds the %s in every form', async (_label, key, value) => {
    expect(await run(`${SETUP}\n${key} => $k\n$c.$k`)).toBe(value);
    expect(await run(`${SETUP}\n$c[${key}]`)).toBe(value);
    expect(await run(`${SETUP}\n${key} -> $c`)).toBe(value);
    expect(await run(`${SETUP}\n$c.?[${key}]`)).toBe(true);
  });

  it.each(['__proto__', 'constructor'])(
    'never finds the inherited member %s in any form',
    async (key) => {
      const setup = 'dict[a: 1] => $c';
      expect(await run(`${setup}\n$c.?["${key}"]`)).toBe(false);
      await expectHalt(() => run(`${setup}\n$c["${key}"]`), {
        code: 'RILL_R009',
      });
      await expectHalt(() => run(`${setup}\n"${key}" -> $c`), {
        code: 'RILL_R009',
      });
      await expectHalt(() => run(`${setup}\n$c -> destruct<${key}: $v>`), {
        code: 'RILL_R009',
      });
    }
  );

  it('finds an own __proto__ field in every form', async () => {
    const setup = 'dict["__proto__": "p"] => $c';
    expect(await run(`${setup}\n$c["__proto__"]`)).toBe('p');
    expect(await run(`${setup}\n"__proto__" -> $c`)).toBe('p');
    expect(await run(`${setup}\n$c.?["__proto__"]`)).toBe(true);
  });
});

describe('element lookup: type value receiver', () => {
  const FORMS: readonly string[] = [
    'string => $c\n$c.name',
    'string => $c\n$c -> .name',
  ];

  it.each(FORMS)('reads the name property through %j', async (source) => {
    expect(await run(source)).toBe('string');
  });

  it('does not index a type value by variable key or probe it by bracket', async () => {
    for (const body of ['$c.$k', '$c.?$k', '$c.?["name"]', '$c.$k ?? "d"']) {
      await expectHalt(() => run(`string => $c\n"name" => $k\n${body}`), {
        code: 'RILL_R002',
        messagePattern: 'Cannot index type',
      });
    }
  });

  it('answers a literal probe from the same lookup', async () => {
    expect(await run('string => $c\n$c.?name')).toBe(true);
    expect(await run('string => $c\n$c.?bogus')).toBe(false);
  });

  it('halts for a missing property in every read form', async () => {
    await expectHalt(() => run('string => $c\n$c.bogus'), {
      code: 'RILL_R003',
    });
  });

  it('does not index a type value by bracket', async () => {
    await expectHalt(() => run('string => $c\n$c["name"]'), {
      code: 'RILL_R002',
      messagePattern: 'Cannot index type',
    });
  });
});

describe('element lookup: dispatch with a key that cannot address a field', () => {
  const KEYS = [
    ['a tuple', 'tuple[1]', 'tuple'],
    ['a dict', 'dict[a: 1]', 'dict'],
    ['a fn', 'fn(x) { $x }', 'fn'],
  ] as const;

  describe.each(KEYS)('%s key', (_label, key, typeName) => {
    rule('selection.key-type').it(
      'halts #TYPE_MISMATCH without a default',
      async () => {
        await expectHalt(() => run(`dict[a: 1] => $d\n${key} -> $d`), {
          code: 'TYPE_MISMATCH',
          messagePattern: `Dict key must be string, got ${typeName}`,
        });
      }
    );

    rule('selection.key-no-mask').it(
      'halts #TYPE_MISMATCH with a default',
      async () => {
        await expectHalt(() => run(`dict[a: 1] => $d\n${key} -> $d ?? 9`), {
          code: 'TYPE_MISMATCH',
          messagePattern: `Dict key must be string, got ${typeName}`,
        });
      }
    );
  });

  it('still recovers an absent string key with a default', async () => {
    expect(await run('dict[a: 1] => $d\n"z" -> $d ?? 9')).toBe(9);
  });
});

describe('element lookup: a non-string selector on a dict halts alike in every form', () => {
  const SETUP = 'dict[a: 1] => $d\n1 => $n\n';
  const FORMS = [
    ['bracket with a default', '$d[1] ?? 0'],
    ['dispatch with a default', '1 -> $d ?? 0'],
    ['variable key with a default', '$d.$n ?? 0'],
    ['existence check by variable', '$d.?$n'],
    ['existence check by bracket', '$d.?[1]'],
    ['hierarchical dispatch', 'list[1] -> $d'],
  ] as const;

  describe.each(FORMS)('%s', (_label, read) => {
    rule('selection.key-type', 'selection.key-no-mask', 'existence.bracket').it(
      'halts #TYPE_MISMATCH with the one message',
      async () => {
        await expectHalt(() => run(`${SETUP}${read}`), {
          code: 'TYPE_MISMATCH',
          messagePattern: 'Dict key must be string, got number',
        });
      }
    );

    it('is caught by guard', async () => {
      expect(
        await run(`${SETUP}guard { ${read} } => $r\n$r.!code == #TYPE_MISMATCH`)
      ).toBe(true);
    });
  });
});
