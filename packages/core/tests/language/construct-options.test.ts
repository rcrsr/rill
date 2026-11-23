/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: control statement options
 *
 * A control statement (`guard`, `retry`, `timeout`, `pass`, and the loop `do`)
 * takes its options as a dict in parentheses after the keyword. These tests
 * cover the parenthesized form, the removed angle-bracket form, the literal
 * bound rule, spreads, and the options type each keyword is checked against.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

/** The error id parsing `source` raises; fails the test when it parses. */
function parseErrorId(source: string): string {
  try {
    parse(source);
  } catch (err) {
    expect(err).toBeInstanceOf(ParseError);
    return (err as ParseError).errorId;
  }
  throw new Error(`expected a parse error for: ${source}`);
}

/** The message parsing `source` raises; fails the test when it parses. */
function parseErrorMessage(source: string): string {
  try {
    parse(source);
  } catch (err) {
    expect(err).toBeInstanceOf(ParseError);
    return (err as ParseError).message;
  }
  throw new Error(`expected a parse error for: ${source}`);
}

describe('options in angle brackets', () => {
  const { it: ruleIt } = rule('construct-options.parens');

  ruleIt.each([
    ['guard', 'guard<on: #TIMEOUT> { 1 }'],
    ['retry', 'retry<limit: 3> { 1 }'],
    ['timeout', 'timeout<total: duration("1s")> { 1 }'],
    ['pass', 'pass<async: true> { 1 }'],
    ['do', 'do<limit: 10> { $ + 1 } while ($ < 3)'],
  ])(
    '%s rejects keyword< with RILL-P025 naming the parenthesized form',
    (keyword, source) => {
      expect(parseErrorId(source)).toBe('RILL-P025');
      expect(parseErrorMessage(source)).toContain(`${keyword}(`);
    }
  );

  ruleIt('rejects a space before the angle bracket for retry', () => {
    expect(parseErrorId('retry <limit: 3> { 1 }')).toBe('RILL-P025');
  });

  ruleIt('names the new option for the renamed retry bound', () => {
    expect(parseErrorMessage('retry<limit: 3> { 1 }')).toContain('attempts');
  });

  ruleIt('names ignore_halts for the removed pass suppression option', () => {
    expect(parseErrorMessage('pass<on_error: #IGNORE> { 1 / 0 }')).toContain(
      'ignore_halts: true'
    );
  });

  ruleIt('rejects while ... do< with RILL-P025', () => {
    expect(parseErrorId('while ($ < 5) do<limit: 100> { $ + 1 }')).toBe(
      'RILL-P025'
    );
  });
});

describe('options order and values', () => {
  const { it: ruleIt } = rule(
    'construct-options.order',
    'construct-options.values'
  );

  ruleIt('accepts options in any order', async () => {
    expect(await run('retry(on: #TIMEOUT, attempts: 2) { 1 }')).toBe(1);
    expect(await run('retry(attempts: 2, on: #TIMEOUT) { 1 }')).toBe(1);
  });

  ruleIt('evaluates an option value as an expression', async () => {
    expect(
      await run(
        'true => $on\n"x" -> pass(ignore_halts: $on, async: (1 == 2)) { 1 / 0 }'
      )
    ).toBe('x');
  });

  ruleIt('evaluates a timeout limit from a variable', async () => {
    expect(
      await run('duration("1s") => $d\ntimeout(total: $d) { "done" }')
    ).toBe('done');
  });
});

describe('options type', () => {
  const { it: ruleIt } = rule('construct-options.dict');

  ruleIt('halts #TYPE_MISMATCH for an unknown option', async () => {
    await expectHalt(() => run('retry(attempts: 3, bogus: 1) { 1 }'), {
      code: 'TYPE_MISMATCH',
      messagePattern: /bogus/,
    });
  });

  ruleIt('halts #TYPE_MISMATCH when a required option is missing', async () => {
    await expectHalt(() => run('retry(on: #TIMEOUT) { 1 }'), {
      code: 'TYPE_MISMATCH',
      messagePattern: /attempts/,
    });
  });

  ruleIt('halts #TYPE_MISMATCH for retry with no options', async () => {
    await expectHalt(() => run('retry { 1 }'), { code: 'TYPE_MISMATCH' });
    await expectHalt(() => run('retry() { 1 }'), { code: 'TYPE_MISMATCH' });
  });

  ruleIt(
    'halts #TYPE_MISMATCH when retry is given the removed limit option',
    async () => {
      await expectHalt(() => run('retry(limit: 3) { 1 }'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  ruleIt('halts #TYPE_MISMATCH for a value of the wrong type', async () => {
    await expectHalt(() => run('guard(on: "TIMEOUT") { 1 }'), {
      code: 'TYPE_MISMATCH',
    });
  });

  ruleIt('accepts an empty option list for every keyword', async () => {
    expect(await run('guard() { 1 }')).toBe(1);
    expect(await run('timeout() { 2 }')).toBe(2);
    expect(await run('"x" -> pass() { 3 }')).toBe('x');
    expect(await run('0 -> while ($ < 3) do() { $ + 1 }')).toBe(3);
    expect(await run('0 -> do() { $ + 1 } while ($ < 3)')).toBe(3);
  });

  ruleIt('catches an option halt with an enclosing guard', async () => {
    expect(
      await run('guard { retry(attempts: 3, bogus: 1) { 1 } } => $r\n$r.!')
    ).toBe(true);
  });

  ruleIt(
    'does not let a guard catch the halt its own options raise',
    async () => {
      await expectHalt(() => run('guard(bogus: 1) { 1 }'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );
});

describe('literal bounds', () => {
  const { it: ruleIt } = rule('construct-options.literal-bound');

  ruleIt.each([
    ['a variable attempts', 'retry(attempts: $n) { 1 }'],
    ['zero attempts', 'retry(attempts: 0) { 1 }'],
    ['a fractional limit', 'do(limit: 1.5) { $ + 1 } while ($ < 3)'],
    ['a computed attempts', 'retry(attempts: (1 + 2)) { 1 }'],
    ['a spread in retry', 'retry(...$d) { 1 }'],
    ['a spread in do', 'do(...$d) { $ + 1 } while ($ < 3)'],
    ['a spread in while-do', 'while ($ < 3) do(...$d) { $ + 1 }'],
    ['a variable limit in while-do', 'while ($ < 3) do(limit: $n) { $ + 1 }'],
    ['a computed key in retry', 'retry(($k): 3) { 1 }'],
    ['a variable key in retry', 'retry($k: 3) { 1 }'],
  ])('rejects %s with RILL-P004', (_name, source) => {
    expect(parseErrorId(source)).toBe('RILL-P004');
  });

  ruleIt('accepts written positive integer bounds', async () => {
    expect(await run('retry(attempts: 1) { 1 }')).toBe(1);
    expect(await run('0 -> while ($ < 5) do(limit: 100) { $ + 1 }')).toBe(5);
    expect(await run('0 -> do(limit: 100) { $ + 1 } while ($ < 5)')).toBe(5);
  });

  ruleIt(
    'halts #INVALID_INPUT when a loop exceeds its written limit',
    async () => {
      await expect(
        run('0 -> while ($ < 100) do(limit: 3) { $ + 1 }')
      ).rejects.toThrow(/exceeded 3 iterations/);
    }
  );
});

describe('spreads', () => {
  const { it: ruleIt } = rule('construct-options.spread');

  ruleIt('accepts a spread in guard', async () => {
    expect(
      await run(
        'dict[on: #RILL_R002] => $p\nguard(...$p) { 1 / 0 } => $r\n$r.!'
      )
    ).toBe(true);
  });

  ruleIt('accepts a spread in timeout', async () => {
    expect(
      await run('dict[total: duration("1s")] => $p\ntimeout(...$p) { "done" }')
    ).toBe('done');
  });

  ruleIt('accepts a spread in pass', async () => {
    expect(
      await run('dict[ignore_halts: true] => $p\n"x" -> pass(...$p) { 1 / 0 }')
    ).toBe('x');
  });

  ruleIt(
    'halts #INVALID_INPUT when a spread repeats a written option',
    async () => {
      await expectHalt(
        () => run('dict[on: #TIMEOUT] => $p\nguard(on: #AUTH, ...$p) { 1 }'),
        { code: 'INVALID_INPUT', messagePattern: /on/ }
      );
      await expectHalt(
        () =>
          run(
            'dict[total: duration("1s")] => $p\ntimeout(total: duration("2s"), ...$p) { 1 }'
          ),
        { code: 'INVALID_INPUT' }
      );
    }
  );

  ruleIt(
    'halts #INVALID_INPUT when a computed key repeats a written option',
    async () => {
      await expectHalt(
        () => run('"on" => $k\nguard(on: #AUTH, ($k): #TIMEOUT) { 1 }'),
        { code: 'INVALID_INPUT' }
      );
    }
  );

  ruleIt('halts RILL-R002 when the spread is not a dict', async () => {
    await expect(run('guard(...5) { 1 }')).rejects.toThrow(
      expect.objectContaining({ errorId: 'RILL-R002' })
    );
  });
});

describe('written duplicates', () => {
  it('rejects a repeated written option with RILL-P027', () => {
    expect(parseErrorId('retry(attempts: 2, attempts: 3) { 1 }')).toBe(
      'RILL-P027'
    );
    expect(parseErrorId('pass(async: true, async: false) { 1 }')).toBe(
      'RILL-P027'
    );
  });
});

describe('space before the parenthesis', () => {
  const { it: ruleIt } = rule('construct-options.space');

  ruleIt('parses guard (on: #X) { ... }', async () => {
    expect(() => parse('guard (on: #TIMEOUT) { 1 }')).not.toThrow();
    expect(await run('guard (on: #TIMEOUT) { 1 }')).toBe(1);
  });

  ruleIt('parses retry (attempts: 3) { ... }', async () => {
    expect(await run('retry (attempts: 3) { 1 }')).toBe(1);
  });
});

describe('statements with no options', () => {
  const { it: ruleIt } = rule('construct-options.none');

  ruleIt('keeps the meaning of guard { }', async () => {
    expect(await run('guard { 1 / 0 } ?? 9')).toBe(9);
  });

  ruleIt('keeps the meaning of pass { }', async () => {
    expect(await run('"x" -> pass { 1 / 0 }').catch(() => 'halted')).toBe(
      'halted'
    );
    expect(await run('"x" -> pass { 1 }')).toBe('x');
  });

  ruleIt('keeps the meaning of do { }', async () => {
    expect(await run('0 -> do { $ + 1 } while ($ < 5)')).toBe(5);
  });

  ruleIt('legalizes pass() with an empty option list', async () => {
    expect(await run('"x" -> pass() { 1 }')).toBe('x');
  });
});

describe('pass ignore_halts', () => {
  const { it: ruleIt } = rule('construct-options.dict');

  rule('construct-options.dict', 'pass.ignore').it(
    'yields the piped value when the body halts catchably',
    async () => {
      expect(await run('"x" -> pass(ignore_halts: true) { 1 / 0 }')).toBe('x');
    }
  );

  ruleIt('halts #TYPE_MISMATCH for a non-bool async value', async () => {
    await expectHalt(() => run('"x" -> pass(async: 1) { 1 }'), {
      code: 'TYPE_MISMATCH',
    });
  });

  rule('construct-options.dict', 'pass.ignore').it(
    'lets error halts propagate',
    async () => {
      await expect(
        run('"x" -> pass(ignore_halts: true) { error "boom" }')
      ).rejects.toThrow(/boom/);
    }
  );

  rule('construct-options.dict', 'pass.ignore').it(
    'lets assert halts propagate',
    async () => {
      await expect(
        run('"x" -> pass(ignore_halts: true) { assert false "nope" }')
      ).rejects.toThrow(/nope/);
    }
  );

  rule('construct-options.dict', 'pass.ignore', 'break.not-halt').it(
    'lets break propagate out of the body',
    async () => {
      expect(
        await run(
          '0 -> while ($ < 5) do { pass(ignore_halts: true) { break } }'
        )
      ).toBe(0);
    }
  );

  rule('construct-options.dict', 'pass.ignore', 'break.not-halt').it(
    'lets return propagate out of the body',
    async () => {
      expect(
        await run('5 -> { pass(ignore_halts: true) { 7 -> return }\n9 }')
      ).toBe(7);
    }
  );
});

describe('options written as bare values', () => {
  const { it: ruleIt } = rule('construct-options.named');

  ruleIt.each([
    'retry(3) { 1 }',
    'guard(1) { 1 }',
    '5 -> pass(true) { 1 }',
    '0 -> while ($ < 2) do(5) { $ + 1 }',
    'retry(attempts: 2, 3) { 1 }',
  ])('rejects %s with RILL-P001', (source) => {
    expect(parseErrorId(source)).toBe('RILL-P001');
  });
});

describe('timeout recognized by what follows it', () => {
  const { it: ruleIt } = rule('construct-options.timeout-context');

  ruleIt('keeps a host function named timeout callable', async () => {
    expect(
      await run('timeout(1)', {
        functions: { timeout: { signature: 'fn(n: number)', fn: () => 7 } },
      })
    ).toBe(7);
  });

  ruleIt('rejects a body that starts on a later line with RILL-P004', () => {
    expect(parseErrorId('timeout(total: duration("100ms"))\n{ 1 }')).toBe(
      'RILL-P004'
    );
  });

  ruleIt(
    'opens a block when the options end before { on the same line',
    async () => {
      expect(await run('timeout() { 1 }')).toBe(1);
    }
  );
});
