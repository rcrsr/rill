/**
 * Every field-read form agrees on what a key finds.
 *
 * For each receiver and key that passes the form's key validation, `.?k` is
 * true exactly when `.k ?? sentinel` returns something other than the sentinel
 * and exactly when `.k` does not halt. Method sugar (`.len`, `.params`) is
 * literal-only, and a bool key on a dict without typed keys answers `.?` false
 * while the read form rejects it at key validation.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  toCallable,
  type RillFunction,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

// ============================================================
// FIXTURES
// ============================================================

const SENTINEL = '__sentinel__';

const FUNCTIONS: Record<string, RillFunction> = {
  make_stream: {
    params: [],
    returnType: anyTypeValue,
    fn: () =>
      createRillStream({
        chunks: (async function* () {
          yield 1;
        })(),
        resolve: () => Promise.resolve('resolved'),
        dispose: () => {},
      }),
  },
};

interface ValueOutcome {
  readonly value: unknown;
}

interface HaltOutcome {
  readonly halt: string;
  readonly message: string | RegExp;
}

type Expected = ValueOutcome | HaltOutcome;

interface Row {
  readonly label: string;
  /** Script prelude that binds the receiver to `$r`. */
  readonly setup: string;
  /** Source text of the key. */
  readonly key: string;
  /** Result of every dynamic read form (`.$k`, `.(expr)`). */
  readonly read: Expected;
  /** Identifier spelling of the key, when the literal forms apply. */
  readonly name?: string;
  /** Result of the literal form `.k`. */
  readonly literal?: Expected;
  /** Result of the method forms `-> .k` and postfix `.k`. */
  readonly method?: Expected;
  /** Receiver as one expression, for the postfix form. */
  readonly postfix?: string;
  /** Existence answer where it departs from the read (documented exceptions). */
  readonly exists?: boolean;
}

const NON_DICT = (key: string): Expected => ({
  halt: 'RILL_R003',
  message: `Cannot access field '${key}' on non-dict`,
});

const OUT_OF_BOUNDS = (kind: string, index: number): Expected => ({
  halt: 'RILL_R009',
  message: `${kind} index out of bounds: ${index}`,
});

const NOT_AN_INTEGER = (kind: string): Expected => ({
  halt: 'INVALID_INPUT',
  message: `${kind} index must be an integer, got 1.5`,
});

const TYPE = 'union(1, "a") => $r';
const TYPE_RECEIVER = 'union(1, "a")';
const LIST = 'list[10, 20] => $r';
const ORDERED = 'ordered[a: 1, b: 2] => $r';
const TUPLE = 'tuple[10, "x"] => $r';

const ROWS: readonly Row[] = [
  {
    label: 'type value, present inner',
    setup: TYPE,
    key: '"inner"',
    name: 'inner',
    read: { value: [1, 'a'] },
    literal: { value: [1, 'a'] },
    method: { value: [1, 'a'] },
    postfix: TYPE_RECEIVER,
  },
  {
    label: 'type value, absent outer',
    setup: TYPE,
    key: '"outer"',
    name: 'outer',
    read: { halt: 'RILL_R003', message: /Type value has no property "outer"/ },
    literal: {
      halt: 'RILL_R003',
      message: /Type value has no property "outer"/,
    },
    method: {
      halt: 'RILL_R003',
      message: /Type value has no property "outer"/,
    },
    postfix: TYPE_RECEIVER,
  },
  {
    label: 'type value, number key',
    setup: TYPE,
    key: '0',
    read: { halt: 'RILL_R002', message: 'Cannot index type' },
  },
  {
    label: 'string, method sugar key len',
    setup: '"abc" => $r',
    key: '"len"',
    name: 'len',
    read: NON_DICT('len'),
    literal: { value: 3 },
    method: { value: 3 },
    postfix: '"abc"',
    exists: false,
  },
  {
    label: 'list, first position',
    setup: LIST,
    key: '1',
    read: { value: 20 },
  },
  {
    label: 'list, negative position',
    setup: LIST,
    key: '-1',
    read: { value: 20 },
  },
  {
    label: 'list, out of bounds',
    setup: LIST,
    key: '5',
    read: OUT_OF_BOUNDS('List', 5),
  },
  {
    label: 'list, string key',
    setup: LIST,
    key: '"a"',
    name: 'a',
    read: NON_DICT('a'),
    literal: NON_DICT('a'),
  },
  {
    label: 'list, fractional index',
    setup: LIST,
    key: '1.5',
    read: NOT_AN_INTEGER('List'),
  },
  {
    label: 'ordered, entry name',
    setup: ORDERED,
    key: '"a"',
    name: 'a',
    read: { value: 1 },
    literal: { value: 1 },
  },
  {
    label: 'ordered, missing name',
    setup: ORDERED,
    key: '"z"',
    name: 'z',
    read: { halt: 'RILL_R009', message: 'Undefined ordered key: z' },
    literal: { halt: 'RILL_R009', message: 'Undefined ordered key: z' },
  },
  { label: 'ordered, position', setup: ORDERED, key: '1', read: { value: 2 } },
  {
    label: 'ordered, out of bounds',
    setup: ORDERED,
    key: '5',
    read: OUT_OF_BOUNDS('Ordered', 5),
  },
  { label: 'tuple, position', setup: TUPLE, key: '1', read: { value: 'x' } },
  {
    label: 'tuple, out of bounds',
    setup: TUPLE,
    key: '5',
    read: OUT_OF_BOUNDS('Tuple', 5),
  },
  {
    label: 'tuple, string key',
    setup: TUPLE,
    key: '"a"',
    name: 'a',
    read: NON_DICT('a'),
    literal: NON_DICT('a'),
  },
  {
    label: 'closure, method sugar key params',
    setup: '|x|($x) => $r',
    key: '"params"',
    name: 'params',
    read: NON_DICT('params'),
    literal: { value: { x: {} } },
    exists: false,
  },
  {
    label: 'stream, step field',
    setup: 'make_stream() => $r',
    key: '"done"',
    name: 'done',
    read: { value: false },
    literal: { value: false },
    method: { value: false },
  },
  {
    label: 'stream, non-step field',
    setup: 'make_stream() => $r',
    key: '"chunk"',
    name: 'chunk',
    read: { halt: 'RILL_R009', message: "Dict has no field 'chunk'" },
    literal: { halt: 'RILL_R009', message: "Dict has no field 'chunk'" },
    method: { halt: 'RILL_R009', message: "Dict has no field 'chunk'" },
  },
  {
    label: 'dict, own field',
    setup: 'dict[a: 1] => $r',
    key: '"a"',
    name: 'a',
    read: { value: 1 },
    literal: { value: 1 },
    method: { value: 1 },
    postfix: 'dict[a: 1]',
  },
  {
    label: 'dict, missing field',
    setup: 'dict[a: 1] => $r',
    key: '"b"',
    name: 'b',
    read: { halt: 'RILL_R009', message: "Dict has no field 'b'" },
    literal: { halt: 'RILL_R009', message: "Dict has no field 'b'" },
    method: { halt: 'RILL_R009', message: "Dict has no field 'b'" },
    postfix: 'dict[a: 1]',
  },
  {
    label: 'dict with typed keys, number key',
    setup: 'dict[1: "one"] => $r',
    key: '1',
    read: { value: 'one' },
  },
  {
    label: 'dict with typed keys, missing number key',
    setup: 'dict[1: "one"] => $r',
    key: '2',
    read: { halt: 'RILL_R009', message: 'Undefined dict key: 2' },
  },
  {
    label: 'dict without typed keys, number key',
    setup: 'dict[a: 1] => $r',
    key: '1',
    read: { halt: 'RILL_R002', message: 'Cannot index dict' },
  },
];

// ============================================================
// HELPERS
// ============================================================

function isValue(expected: Expected): expected is ValueOutcome {
  return 'value' in expected;
}

/** Run `source` and compare to `expected`, a value or an exact halt. */
async function expectOutcome(
  source: string,
  expected: Expected
): Promise<void> {
  if (isValue(expected)) {
    expect(await run(source, { functions: FUNCTIONS })).toEqual(expected.value);
    return;
  }
  await expectHalt(() => run(source, { functions: FUNCTIONS }), {
    code: expected.halt,
    messagePattern: expected.message,
  });
}

/** A fractional index halts in every form, including existence and `??`. */
function isFractional(expected: Expected): boolean {
  return !isValue(expected) && expected.halt === 'INVALID_INPUT';
}

// ============================================================
// MATRIX
// ============================================================

/** Existence answer for a read: the read's own halt when fractional. */
function existenceOutcome(read: Expected, override?: boolean): Expected {
  return isFractional(read) ? read : { value: override ?? isValue(read) };
}

/** `??` result for a read: the sentinel exactly when the read halts. */
function coalesceOutcome(read: Expected): Expected {
  return isValue(read) || isFractional(read) ? read : { value: SENTINEL };
}

const LITERAL_ROWS = ROWS.filter((row) => row.name !== undefined);
const METHOD_ROWS = ROWS.filter((row) => row.method !== undefined);
const POSTFIX_ROWS = ROWS.filter((row) => row.postfix !== undefined);
const AGREEMENT_ROWS = ROWS.filter(
  (row) => row.exists === undefined && !isFractional(row.read)
);

describe('field read forms agree', () => {
  describe.each(ROWS)('$label', (row) => {
    const keyed = `${row.setup}\n${row.key} => $k\n`;

    it('reads through a variable key', async () => {
      await expectOutcome(`${keyed}$r.$k`, row.read);
    });

    it('reads through a computed key', async () => {
      await expectOutcome(`${row.setup}\n$r.(${row.key})`, row.read);
    });

    it('answers .? for a variable key from the read', async () => {
      await expectOutcome(
        `${keyed}$r.?$k`,
        existenceOutcome(row.read, row.exists)
      );
    });

    it('answers .? for a computed key from the read', async () => {
      await expectOutcome(
        `${row.setup}\n$r.?(${row.key})`,
        existenceOutcome(row.read, row.exists)
      );
    });

    it('returns the sentinel from ?? exactly when the read halts', async () => {
      await expectOutcome(
        `${keyed}$r.$k ?? "${SENTINEL}"`,
        coalesceOutcome(row.read)
      );
    });
  });

  describe.each(AGREEMENT_ROWS)('$label', (row) => {
    it('agrees that .? is true exactly when the read does not halt', async () => {
      const keyed = `${row.setup}\n${row.key} => $k\n`;
      const read = await run(`${keyed}$r.$k ?? "${SENTINEL}"`, {
        functions: FUNCTIONS,
      });
      const exists = await run(`${keyed}$r.?$k`, { functions: FUNCTIONS });
      expect(exists).toBe(read !== SENTINEL);
      expect(exists).toBe(isValue(row.read));
    });
  });

  describe.each(LITERAL_ROWS)('$label, literal key', (row) => {
    const name = row.name ?? '';
    const literal = row.literal ?? row.read;

    it('reads through a literal key', async () => {
      await expectOutcome(`${row.setup}\n$r.${name}`, literal);
    });

    it('answers .? for a literal key', async () => {
      await expectOutcome(
        `${row.setup}\n$r.?${name}`,
        existenceOutcome(literal, row.exists)
      );
    });

    it('coalesces a literal miss with ??', async () => {
      await expectOutcome(
        `${row.setup}\n$r.${name} ?? "${SENTINEL}"`,
        coalesceOutcome(literal)
      );
    });
  });

  describe.each(METHOD_ROWS)('$label, pipe method', (row) => {
    it('reads through a pipe method form', async () => {
      await expectOutcome(
        `${row.setup}\n$r -> .${row.name ?? ''}`,
        row.method ?? row.read
      );
    });
  });

  describe.each(POSTFIX_ROWS)('$label, postfix', (row) => {
    it('reads through a postfix literal key', async () => {
      await expectOutcome(
        `${row.postfix ?? ''}.${row.name ?? ''}`,
        row.method ?? row.read
      );
    });
  });
});

describe('field read forms: alternatives', () => {
  it('reads the first alternative a type value defines', async () => {
    expect(await run(`${TYPE}\n$r.(outer || inner)`)).toEqual([1, 'a']);
  });

  it('halts naming every alternative a type value lacks', async () => {
    await expectHalt(() => run(`${TYPE}\n$r.(outer || nope)`), {
      code: 'RILL_R003',
      messagePattern: /Type value has none of the properties "outer", "nope"/,
    });
  });

  it('coalesces a type value with no alternative using ??', async () => {
    expect(await run(`${TYPE}\n$r.(outer || nope) ?? "${SENTINEL}"`)).toBe(
      SENTINEL
    );
  });

  it('reads the first alternative an ordered value defines', async () => {
    expect(await run(`${ORDERED}\n$r.(z || b)`)).toBe(2);
  });

  it('halts when no alternative exists on an ordered value', async () => {
    await expectHalt(() => run(`${ORDERED}\n$r.(z || y)`), {
      code: 'RILL_R009',
      messagePattern: "Dict has none of the fields 'z', 'y'",
    });
  });

  it('halts when no alternative exists on a dict', async () => {
    await expectHalt(() => run('dict[a: 1] => $r\n$r.(z || y)'), {
      code: 'RILL_R009',
      messagePattern: "Dict has none of the fields 'z', 'y'",
    });
  });

  it('reads the first alternative a stream defines', async () => {
    expect(
      await run('make_stream() => $r\n$r.(chunk || done)', {
        functions: FUNCTIONS,
      })
    ).toBe(false);
  });

  it('rejects a list receiver', async () => {
    await expectHalt(() => run(`${LIST}\n$r.(a || b)`), {
      code: 'RILL_R002',
      messagePattern: 'Alternative access requires dict, got list',
    });
  });
});

// ============================================================
// EXISTENCE DOES NOT INVOKE
// ============================================================

describe('field existence checks', () => {
  function propertyDict(counter: { calls: number }): Record<string, unknown> {
    return {
      prop: toCallable(
        {
          params: [
            {
              name: 'self',
              type: { kind: 'any' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          returnType: anyTypeValue,
          fn: () => {
            counter.calls += 1;
            return 'computed';
          },
        },
        true
      ),
    };
  }

  it.each([
    ['literal', '$d.?prop'],
    ['variable', '"prop" => $k\n$d.?$k'],
    ['computed', '$d.?("prop")'],
  ])('does not invoke a property callable for a %s key', async (_, source) => {
    const counter = { calls: 0 };
    const result = await run(source, {
      variables: { d: propertyDict(counter) as never },
    });
    expect(result).toBe(true);
    expect(counter.calls).toBe(0);
  });

  it('invokes a property callable for a read', async () => {
    const counter = { calls: 0 };
    const result = await run('$d.prop', {
      variables: { d: propertyDict(counter) as never },
    });
    expect(result).toBe('computed');
    expect(counter.calls).toBe(1);
  });
});

// ============================================================
// DECLARED TYPE PROJECTION
// ============================================================

describe('declared type projection', () => {
  const U = 'union(number, string)';
  const DECL = `dict[a: 1] => $d:dict(a: ${U})\n`;

  it('projects the declared type for a literal key', async () => {
    expect(await run(`${DECL}$d.a.^type == ${U}`)).toBe(true);
  });

  it('projects the declared type for a variable key', async () => {
    expect(await run(`${DECL}"a" => $k\n$d.$k.^type == ${U}`)).toBe(true);
  });

  it('projects the declared type for an alternative key', async () => {
    expect(await run(`${DECL}$d.(z || a).^type == ${U}`)).toBe(true);
  });

  it('projects the declared type for a computed key', async () => {
    expect(await run(`${DECL}$d.("a").^type == ${U}`)).toBe(true);
  });

  it('projects the declared type for a bracket key', async () => {
    expect(await run(`${DECL}$d["a"].^type == ${U}`)).toBe(true);
  });

  it('projects the declared type for a pipe selection', async () => {
    expect(await run(`${DECL}"a" -> $d => $v\n$v.^type == ${U}`)).toBe(true);
  });

  it('locks a capture from any access form to the declared type', async () => {
    for (const read of ['$d.a', '$d.("a")', '"a" -> $d', '$d["a"]']) {
      expect(await run(`${DECL}${read} => $v\n"x" => $v\n$v`)).toBe('x');
    }
  });

  it('reports the own type through .^effective', async () => {
    expect(await run(`${DECL}$d.a.^effective == number`)).toBe(true);
    expect(await run(`${DECL}"a" => $k\n$d.$k.^effective == number`)).toBe(
      true
    );
    expect(await run(`${DECL}$d.(z || a).^effective == number`)).toBe(true);
    expect(await run(`${DECL}$d.("a").^effective == number`)).toBe(true);
    expect(await run(`${DECL}"a" -> $d => $v\n$v.^effective == number`)).toBe(
      true
    );
  });
});

describe('pipe selection from a declared collection', () => {
  const U = 'union(number, string)';

  it('projects the element type of a declared list', async () => {
    const src = `list[1, 2] => $l:list(${U})\n`;
    expect(await run(`${src}0 -> $l => $v\n$v.^type == ${U}`)).toBe(true);
    expect(await run(`${src}-1 -> $l => $v\n$v.^type == ${U}`)).toBe(true);
  });

  it('projects along a hierarchical path', async () => {
    const src = `dict[a: dict[b: 1]] => $d:dict(a: dict(b: ${U}))\n`;
    expect(
      await run(`${src}list["a", "b"] -> $d => $v\n$v.^type == ${U}`)
    ).toBe(true);
  });

  it('takes the own type when the selected value is invoked', async () => {
    expect(
      await run('dict[a: |x|("s")] => $d\n"a" -> $d => $v\n$v.^type == string')
    ).toBe(true);
  });

  it('takes the own type for an undeclared collection', async () => {
    expect(
      await run('dict[a: 1] => $d\n"a" -> $d => $v\n$v.^type == number')
    ).toBe(true);
  });

  it('takes the own type for a dispatch default', async () => {
    expect(
      await run(
        `dict[a: 1] => $d:dict(a: ${U})\n"z" -> $d ?? 5 => $v\n$v.^type == number`
      )
    ).toBe(true);
  });
});
