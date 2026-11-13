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

// ============================================================
// FORMS
// ============================================================

type Form =
  | 'literal'
  | 'variable key'
  | 'computed key'
  | 'alternatives'
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
    case 'computed key':
      return { prelude: '', expr: `$c.(${key})` };
    case 'alternatives':
      return { prelude: '', expr: `$c.(y || ${name})` };
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
  'computed key',
  'alternatives',
  'bracket',
  'pipe method',
];

/** An ordered value has no method form: `-> .b` is not an element read. */
const ORDERED_NAMED: readonly Form[] = NAMED.filter(
  (form) => form !== 'pipe method'
);

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
    label: 'dict field under a uniform value type',
    setup: `dict[a: 1, b: 2] => $c:dict(${U})`,
    key: '"b"',
    name: 'b',
    pattern: 'b: $v',
    forms: [...NAMED, 'pipe selection', 'hierarchical', 'destructure'],
    value: 2,
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
    forms: ['variable key', 'computed key', 'bracket'],
    value: 'x',
    type: U,
  },
  {
    label: 'ordered entry by negative position',
    setup: `ordered[a: 1, b: "x"] => $c:ordered(a: number, b: ${U})`,
    key: '-1',
    name: '',
    forms: ['variable key', 'computed key', 'bracket'],
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
      'computed key',
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
    forms: [
      'variable key',
      'computed key',
      'bracket',
      'pipe selection',
      'hierarchical',
    ],
    value: 2,
    type: U,
  },
  {
    label: 'tuple position',
    setup: `tuple[1, "a"] => $c:tuple(number, ${U})`,
    key: '1',
    name: '',
    forms: ['variable key', 'computed key', 'bracket'],
    value: 'a',
    type: U,
  },
  {
    label: 'tuple negative position',
    setup: `tuple[1, "a"] => $c:tuple(number, ${U})`,
    key: '-1',
    name: '',
    forms: ['variable key', 'computed key', 'bracket'],
    value: 'a',
    type: U,
  },
  {
    label: 'tuple first position keeps its own declared type',
    setup: `tuple[1, "a"] => $c:tuple(number, ${U})`,
    key: '0',
    name: '',
    forms: ['variable key', 'computed key', 'bracket'],
    value: 1,
    type: 'number',
  },
  {
    label: 'dict typed number key',
    setup: `dict[1: "x"] => $c:dict(${U})`,
    key: '1',
    name: '',
    forms: ['variable key', 'computed key', 'bracket', 'pipe selection'],
    value: 'x',
    type: U,
  },
  {
    label: 'dict typed bool key',
    setup: `dict[true: "x"] => $c:dict(${U})`,
    key: 'true',
    name: '',
    forms: ['variable key', 'computed key', 'bracket', 'pipe selection'],
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
  /** True when `?? 5` recovers the miss in every form that accepts it. */
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
      'variable key': R009("Dict has no field 'z'"),
      'computed key': R009("Dict has no field 'z'"),
      alternatives: R009("Dict has none of the fields 'y', 'z'"),
      bracket: R009('Undefined dict key: z'),
      'pipe method': R009("Dict has no field 'z'"),
      'pipe selection': R009("Dict dispatch: key 'z' not found"),
      hierarchical: R009("Dict dispatch: key 'z' not found"),
      destructure: R009("Key 'z' not found in dict"),
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
      'computed key': R009('Undefined ordered key: z'),
      alternatives: R009("Dict has none of the fields 'y', 'z'"),
      bracket: R009('Undefined ordered key: z'),
    },
  },
  {
    label: 'ordered position out of range',
    setup: `ordered[a: 1] => $c:ordered(a: ${U})`,
    key: '5',
    name: '',
    forms: ['variable key', 'computed key', 'bracket'],
    recovers: true,
    expected: {
      'variable key': R009('Ordered index out of bounds: 5'),
      'computed key': R009('Ordered index out of bounds: 5'),
      bracket: R009('Ordered index out of bounds: 5'),
    },
  },
  {
    label: 'list index out of range',
    setup: `list[1, 2] => $c:list(${U})`,
    key: '5',
    name: '',
    forms: [
      'variable key',
      'computed key',
      'bracket',
      'pipe selection',
      'hierarchical',
    ],
    recovers: true,
    expected: {
      'variable key': R009('List index out of bounds: 5'),
      'computed key': R009('List index out of bounds: 5'),
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
    forms: [
      'variable key',
      'computed key',
      'bracket',
      'pipe selection',
      'hierarchical',
    ],
    recovers: true,
    expected: {
      'variable key': R009('List index out of bounds: -3'),
      'computed key': R009('List index out of bounds: -3'),
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
    forms: [
      'variable key',
      'computed key',
      'bracket',
      'pipe selection',
      'hierarchical',
    ],
    recovers: false,
    expected: {
      'variable key': NOT_INT('List'),
      'computed key': NOT_INT('List'),
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
    forms: ['variable key', 'computed key', 'bracket'],
    recovers: true,
    expected: {
      'variable key': R009('Tuple index out of bounds: 5'),
      'computed key': R009('Tuple index out of bounds: 5'),
      bracket: R009('Tuple index out of bounds: 5'),
    },
  },
  {
    label: 'dict missing typed number key',
    setup: `dict[1: "x"] => $c:dict(${U})`,
    key: '2',
    name: '',
    forms: ['variable key', 'computed key', 'bracket', 'pipe selection'],
    recovers: true,
    expected: {
      'variable key': R009('Undefined dict key: 2'),
      'computed key': R009('Undefined dict key: 2'),
      bracket: R009('Undefined dict key: 2'),
      'pipe selection': R009("Dict dispatch: key '2' not found"),
    },
  },
];

/**
 * Forms whose miss a `??` default does not recover. A destructure has no
 * default syntax at all.
 */
const NO_DEFAULT: ReadonlySet<Form> = new Set(['bracket', 'destructure']);

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
        if (c.receiver.recovers) {
          expect(await run(source)).toBe(5);
        } else {
          await expectHalt(() => run(source), { code: 'INVALID_INPUT' });
        }
      });
    }
  );

  describe.each(MISS_CASES.filter((c) => c.form === 'bracket'))(
    '$receiver.label through $form with a default that does not apply',
    (c) => {
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
    }
  );

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

describe('element lookup: existence check', () => {
  const dynamicHits = HIT_CASES.filter(
    (c) =>
      c.form === 'computed key' && c.receiver.label !== 'dict typed bool key'
  );

  it.each(dynamicHits)(
    'answers true for $receiver.label found through .?',
    async (c) => {
      expect(await run(`${c.receiver.setup}\n$c.?(${c.receiver.key})`)).toBe(
        true
      );
    }
  );

  it.each(MISS_CASES.filter((c) => c.form === 'computed key'))(
    'answers false for $receiver.label missed through .?',
    async (c) => {
      const fractional = c.receiver.label.includes('fractional');
      const source = `${c.receiver.setup}\n$c.?(${c.receiver.key})`;
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
  it('passes the key as the argument of a variable dict closure with params', async () => {
    expect(await run('dict[a: |x|("k{$x}")] => $d\n"a" -> $d')).toBe('ka');
  });

  it('runs a zero-param variable dict closure with the key as $', async () => {
    expect(await run('dict[a: { "k{$}" }] => $d\n"a" -> $d')).toBe('ka');
  });

  it('runs a literal dict closure with the key as $', async () => {
    expect(await run('"a" -> dict[a: { "k{$}" }]')).toBe('ka');
  });

  it('halts for a literal dict closure with user-named params', async () => {
    await expectHalt(() => run('"a" -> dict[a: |x|("k{$x}")]'), {
      code: 'RILL_R002',
      messagePattern: 'Dispatch does not provide arguments',
    });
  });

  it('invokes the terminal closure of a hierarchical path with the last key', async () => {
    expect(
      await run('dict[a: dict[b: { "k{$}" }]] => $d\nlist["a", "b"] -> $d')
    ).toBe('kb');
  });
});

describe('element lookup: key identity', () => {
  const SETUP = 'dict[1: "n", "1": "s"] => $c';

  it.each([
    ['number key', '1', 'n'],
    ['string key', '"1"', 's'],
  ])('keeps the %s distinct in every form', async (_label, key, value) => {
    expect(await run(`${SETUP}\n${key} => $k\n$c.$k`)).toBe(value);
    expect(await run(`${SETUP}\n$c.(${key})`)).toBe(value);
    expect(await run(`${SETUP}\n$c[${key}]`)).toBe(value);
    expect(await run(`${SETUP}\n${key} -> $c`)).toBe(value);
    expect(await run(`${SETUP}\n$c.?(${key})`)).toBe(true);
  });

  it.each(['__proto__', 'constructor'])(
    'never finds the inherited member %s in any form',
    async (key) => {
      const setup = 'dict[a: 1] => $c';
      expect(await run(`${setup}\n$c.?("${key}")`)).toBe(false);
      await expectHalt(() => run(`${setup}\n$c.("${key}")`), {
        code: 'RILL_R009',
      });
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
    expect(await run(`${setup}\n$c.("__proto__")`)).toBe('p');
    expect(await run(`${setup}\n$c["__proto__"]`)).toBe('p');
    expect(await run(`${setup}\n"__proto__" -> $c`)).toBe('p');
    expect(await run(`${setup}\n$c.?("__proto__")`)).toBe(true);
  });
});

describe('element lookup: type value receiver', () => {
  const FORMS: readonly string[] = [
    'string => $c\n$c.name',
    'string => $c\n"name" => $k\n$c.$k',
    'string => $c\n$c.("name")',
    'string => $c\n$c.(y || name)',
    'string => $c\n$c -> .name',
  ];

  it.each(FORMS)('reads the name property through %j', async (source) => {
    expect(await run(source)).toBe('string');
  });

  it('answers .? from the same lookup', async () => {
    expect(await run('string => $c\n$c.?("name")')).toBe(true);
    expect(await run('string => $c\n$c.?("bogus")')).toBe(false);
  });

  it('halts for a missing property in every read form', async () => {
    for (const read of ['$c.bogus', '$c.("bogus")', '$c.(y || bogus)']) {
      await expectHalt(() => run(`string => $c\n${read}`), {
        code: 'RILL_R003',
      });
    }
  });
});
