/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: omitted map members
 *
 * A map behaves like a list. An omitted field of map type, an omitted tuple
 * element of map type, and an omitted map parameter all halt RILL-R044; none
 * is filled with an empty map. A map literal is a literal default.
 */

import { describe, expect } from 'vitest';

import { expectHalt, expectRuntimeError } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('map defaults', () => {
  rule('defaults.required', 'defaults.synthesis').it.each([
    'map(string, number)',
    'list(number)',
  ])('halts RILL-R044 for an omitted dict field of type %s', async (type) => {
    await expectHalt(() => run(`dict[a: 1] -> dict(a: number, b: ${type})`), {
      code: 'RILL_R044',
      messagePattern: "missing required field 'b'",
    });
  });

  rule('defaults.required', 'defaults.synthesis').it.each([
    'map(atom, number)',
    'list(number)',
  ])(
    'halts RILL-R044 for an omitted tuple element of type %s',
    async (type) => {
      await expectHalt(() => run(`tuple[1] -> tuple(number, ${type})`), {
        code: 'RILL_R044',
        messagePattern: 'missing required element at position 1',
      });
    }
  );

  rule('defaults.required', 'defaults.synthesis').it.each([
    'map(string, number)',
    'list(number)',
  ])(
    'halts RILL-R044 for an omitted ordered field of type %s',
    async (type) => {
      await expectHalt(
        () => run(`ordered[a: 1] -> ordered(a: number, b: ${type})`),
        { code: 'RILL_R044', messagePattern: "missing required field 'b'" }
      );
    }
  );

  rule('defaults.required', 'defaults.synthesis').it.each([
    'map(string, number)',
    'list(number)',
  ])(
    'halts RILL-R044 for a parent whose child of type %s has no default',
    async (type) => {
      await expectHalt(
        () => run(`dict[] -> dict(x: dict(a: number = 1, m: ${type}))`),
        { code: 'RILL_R044', messagePattern: "missing required field 'm'" }
      );
    }
  );

  rule('defaults.param-required').it.each([
    'map(atom, number)',
    'list(number)',
  ])('halts RILL-R044 for an omitted parameter of type %s', async (type) => {
    await expectRuntimeError(
      () => run(`fn(m: ${type}) { $m.len } => $f\n$f()`),
      {
        code: 'RILL-R044',
        messagePattern: "Missing argument for parameter 'm'",
      }
    );
  });

  rule('defaults.literal').it(
    'fills a dict field default written as a map literal',
    async () => {
      expect(
        await run(
          'dict[] -> dict(m: map(string, number) = map["x": 1]) -> .m["x"]'
        )
      ).toBe(1);
    }
  );

  rule('defaults.literal').it(
    'binds a parameter default written as a map literal when omitted',
    async () => {
      expect(
        await run(
          'fn(m: map(string, number) = map["x": 1]) { $m["x"] } => $f\n$f()'
        )
      ).toBe(1);
    }
  );
});
