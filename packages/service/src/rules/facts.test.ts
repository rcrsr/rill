import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ASTNode, ClosureNode, HostCallNode } from '@rcrsr/rill';
import { collectFacts, capturesInSubtree } from './facts.js';
import { traverseForRules } from './traversal.js';
import { resolveOpBody } from './collection-ops.js';
import { runRules } from './run-rules.js';
import { avoidReassignment } from './avoid-reassignment.js';
import { captureInlineChain } from './capture-inline-chain.js';
import { makeConfig, toParseResult } from './test-support.js';

// ============================================================
// FIXTURE HELPERS
// ============================================================

/** Every node in `root` matching `predicate`, in traversal (enter) order. */
function findAll<T extends ASTNode>(
  root: ASTNode,
  predicate: (n: ASTNode) => n is T
): T[] {
  const found: T[] = [];
  traverseForRules(root, {
    enter(n) {
      if (predicate(n)) found.push(n);
    },
    exit() {},
  });
  return found;
}

/** The first HostCall named `name` in enter order (outermost occurrence first). */
function firstHostCall(root: ASTNode, name: string): HostCallNode {
  const [call] = findAll(
    root,
    (n): n is HostCallNode => n.type === 'HostCall' && n.name === name
  );
  if (!call) throw new Error(`expected a HostCall named '${name}' in fixture`);
  return call;
}

/** The first Closure literal in enter order. */
function firstClosure(root: ASTNode): ClosureNode {
  const [closure] = findAll(
    root,
    (n): n is ClosureNode => n.type === 'Closure'
  );
  if (!closure) throw new Error('expected a Closure in fixture');
  return closure;
}

/** Resolve and assert the body of the first HostCall named `name`. */
function bodyOfFirstCall(root: ASTNode, name: string): ASTNode {
  const body = resolveOpBody(firstHostCall(root, name));
  if (!body) throw new Error(`expected a resolvable body for '${name}'`);
  return body;
}

// ============================================================
// hasBreak
// ============================================================

describe('SubtreeFacts.hasBreak', () => {
  it('is false for a break nested inside a seq, masked by the seq boundary', () => {
    const source = 'list[1, 2] -> fan({ list[3, 4] -> seq({ $ -> break }) })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const fanBody = bodyOfFirstCall(root, 'fan');
    expect(facts.bySubtree.get(fanBody)?.hasBreak).toBe(false);
  });

  it('is true for a break directly in a fan body', () => {
    const source = 'list[1, 2] -> fan({ $ -> break })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const fanBody = bodyOfFirstCall(root, 'fan');
    expect(facts.bySubtree.get(fanBody)?.hasBreak).toBe(true);
  });
});

// ============================================================
// hasSideEffect
// ============================================================

describe('SubtreeFacts.hasSideEffect', () => {
  it('is false for a host call nested inside a closure literal, masked by the closure boundary', () => {
    const source = 'list[1, 2] -> fan({ fn(x) { log($x) } => $f })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const fanBody = bodyOfFirstCall(root, 'fan');
    expect(facts.bySubtree.get(fanBody)?.hasSideEffect).toBe(false);
  });

  it('is true for a bare host call directly in a fan body', () => {
    const source = 'list[1, 2] -> fan({ log($) })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const fanBody = bodyOfFirstCall(root, 'fan');
    expect(facts.bySubtree.get(fanBody)?.hasSideEffect).toBe(true);
  });
});

// ============================================================
// hasBareDollar
// ============================================================

describe('SubtreeFacts.hasBareDollar', () => {
  it('is false for a bare $ nested inside a seq, masked by the collection-op boundary', () => {
    const source = 'list[1, 2] -> fan({ list[3, 4] -> seq({ $ }) })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const fanBody = bodyOfFirstCall(root, 'fan');
    expect(facts.bySubtree.get(fanBody)?.hasBareDollar).toBe(false);
  });

  it('is true for a bare $ directly in a zero-param fn body', () => {
    const source = '(fn { $ }) => $g\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const closure = firstClosure(root);
    expect(facts.bySubtree.get(closure.body)?.hasBareDollar).toBe(true);
  });
});

// ============================================================
// hasExplicitCapture
// ============================================================

describe('SubtreeFacts.hasExplicitCapture', () => {
  it('is true for a top-level $ => $item capture in a seq body', () => {
    const source =
      'list[1, 2] -> seq({ $ => $item\n (fn() { $item }) => $g\n $g() })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const seqBody = bodyOfFirstCall(root, 'seq');
    expect(facts.bySubtree.get(seqBody)?.hasExplicitCapture).toBe(true);
  });

  it('is true when the capture sits inside a nested block-form seq (no Closure barrier)', () => {
    const source = 'list[1, 2] -> seq({ list[3, 4] -> seq({ $ => $item }) })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const outerSeqBody = bodyOfFirstCall(root, 'seq');
    expect(facts.bySubtree.get(outerSeqBody)?.hasExplicitCapture).toBe(true);
  });

  it('is false when the capture sits inside an fn(x) { ... } closure, masked by the closure boundary', () => {
    const source = 'list[1, 2] -> seq({ (fn(x) { $ => $item }) => $f })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const seqBody = bodyOfFirstCall(root, 'seq');
    expect(facts.bySubtree.get(seqBody)?.hasExplicitCapture).toBe(false);
  });
});

// ============================================================
// hasClosure / hasStatusProbe - unmasked facts
// ============================================================

describe('SubtreeFacts.hasClosure and hasStatusProbe', () => {
  it('hasClosure propagates through nested collection-op and fn boundaries', () => {
    const source =
      'list[1, 2] -> fan({ list[3, 4] -> seq({ (fn(x) { $x }) => $f }) })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const fanBody = bodyOfFirstCall(root, 'fan');
    expect(facts.bySubtree.get(fanBody)?.hasClosure).toBe(true);
  });

  it('hasStatusProbe propagates through the fn boundary', () => {
    const source = 'list[1, 2] -> seq({ (fn(x) { $x.! }) => $f })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const seqBody = bodyOfFirstCall(root, 'seq');
    expect(facts.bySubtree.get(seqBody)?.hasStatusProbe).toBe(true);
  });
});

// ============================================================
// capturesInSubtree
// ============================================================

describe('capturesInSubtree', () => {
  it('excludes captures nested inside a fn in the body and returns the rest in source order', () => {
    const source =
      'list[1, 2] -> seq({ $ => $a\n (fn(x) { $x => $b })\n $ => $c })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const seqBody = bodyOfFirstCall(root, 'seq');
    const names = capturesInSubtree(facts, seqBody).map((c) => c.name);

    expect(names).toEqual(['a', 'c']);
  });
});

// ============================================================
// referenceLog
// ============================================================

describe('ScriptFacts.referenceLog', () => {
  it('logs a ClosureCall as a reference to its callee name ($double(5))', () => {
    const source = 'fn(x) { $x * 2 } => $double\n$double(5)\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const names = facts.script.referenceLog.map((entry) => entry.name);
    expect(names).toContain('double');
  });

  it('logs a reference for a Variable nested inside a DictEntry value', () => {
    const source = '1 => $x\ndict[a: $x]\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const names = facts.script.referenceLog.map((entry) => entry.name);
    expect(names).toContain('x');
  });

  it('logs a reference for a Variable nested inside a HostCall argument (foo($x))', () => {
    const source = '1 => $x\nlog($x)\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const names = facts.script.referenceLog.map((entry) => entry.name);
    expect(names).toContain('x');
  });

  it('logs a reference for a Variable nested inside a MethodCall argument ($x -> .m($y))', () => {
    const source = '1 => $x\n2 => $y\n$x -> .plus($y)\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const names = facts.script.referenceLog.map((entry) => entry.name);
    expect(names).toContain('y');
  });

  it('logs a reference for a Variable nested inside a GuardBlock body (guard { $x })', () => {
    const source = '1 => $x\nguard { $x }\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const names = facts.script.referenceLog.map((entry) => entry.name);
    expect(names).toContain('x');
  });

  it('logs a reference for a Variable nested inside a Closure body (fn(p) { $x })', () => {
    const source = '1 => $x\n(fn(p) { $x }) => $f\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const names = facts.script.referenceLog.map((entry) => entry.name);
    expect(names).toContain('x');
  });
});

// ============================================================
// closureOrOpDepth / bindingScopeDepth
// ============================================================

describe('closureOrOpDepth and bindingScopeDepth', () => {
  it('sets closureOrOpDepth to 1 for a reference inside a Closure body (fn(x) { $x * 2 })', () => {
    const source = 'fn(x) { $x * 2 } => $double\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const xRef = facts.script.referenceLog.find((entry) => entry.name === 'x');
    expect(xRef?.closureOrOpDepth).toBe(1);
  });

  it('sets closureOrOpDepth to 1 for a reference inside a bare-block collection-op body ([1] -> seq({ $c }))', () => {
    const source = '1 => $c\n[1] -> seq({ $c })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const refs = facts.script.referenceLog.filter(
      (entry) => entry.name === 'c'
    );
    const innerRef = refs.find((entry) => entry.closureOrOpDepth === 1);
    expect(innerRef).toBeDefined();
  });

  it('sets bindingScopeDepth to 1 for a capture inside a pass body', () => {
    const source = 'pass { 1 => $y }\n';
    const facts = collectFacts(parse(source));

    expect(facts.script.captureLog[0]?.bindingScopeDepth).toBe(1);
  });

  it('sets closureOrOpDepth to 0 for a reference inside a pass body', () => {
    const source = '1 => $x\npass { $x }\n';
    const facts = collectFacts(parse(source));

    const ref = facts.script.referenceLog.find((entry) => entry.name === 'x');
    expect(ref?.closureOrOpDepth).toBe(0);
  });

  it('sets bindingScopeDepth to 1 for a capture inside a GroupedExpr (("a" => $x))', () => {
    const source = '("a" => $x)\n';
    const root = parse(source);
    const facts = collectFacts(root);

    expect(facts.script.captureLog[0]?.bindingScopeDepth).toBe(1);
  });

  it('sets bindingScopeDepth above 0 for a capture inside a string interpolation', () => {
    const source = '"a {1 => $x} b"\n';
    const facts = collectFacts(parse(source));

    expect(facts.script.captureLog[0]?.bindingScopeDepth).toBeGreaterThan(0);
  });

  it('does not report reassignment for a name captured only inside an earlier interpolation', () => {
    const source = '"{1 => $q}" => $s\n2 => $q\n$q\n';

    const result = runRules(toParseResult(source), source, makeConfig(), [
      avoidReassignment,
      captureInlineChain,
    ]);

    // Line 2 followed by a bare `$q` is a genuine inline-chain candidate on
    // its own; the interpolation capture must add nothing else.
    expect(result.map((d) => [d.code, d.location.line])).toEqual([
      ['CAPTURE_INLINE_CHAIN', 2],
    ]);
  });
});

// ============================================================
// SINGLE-VISIT INVARIANT
// ============================================================

describe('collectFacts single-visit invariant', () => {
  it('records exactly one bySubtree entry per node visited by an independent traversal', () => {
    const source =
      'list[1, 2] -> fan({ list[3, 4] -> seq({ $ => $item\n (fn(x) { $x.! -> break }) => $f\n $ => $c }) })\n' +
      'fn(y) { $y * 2 } => $double\n' +
      '$x.!code\n';
    const root = parse(source);
    const facts = collectFacts(root);

    let nodeCount = 0;
    traverseForRules(root, {
      enter() {
        nodeCount++;
      },
      exit() {},
    });

    expect(facts.bySubtree.size).toBe(nodeCount);
  });
});

// ============================================================
// mixedListVars / mixedDictVars
// ============================================================

describe('mixedListVars and mixedDictVars', () => {
  const facts = (source: string) => collectFacts(parse(source)).script;

  it('collects a name captured once from a mixed list literal', () => {
    const script = facts('list[list[1], list["a"]] => $l\n');
    expect([...script.mixedListVars]).toEqual(['l']);
    expect(script.mixedDictVars.size).toBe(0);
  });

  it('collects a name captured once from a mixed-value dict literal', () => {
    const script = facts('dict[a: 1, b: "x"] => $d\n');
    expect([...script.mixedDictVars]).toEqual(['d']);
    expect(script.mixedListVars.size).toBe(0);
  });

  it('skips a name captured twice', () => {
    const script = facts('list[list[1], list["a"]] => $l\n5 => $l\n');
    expect(script.mixedListVars.size).toBe(0);
  });

  it('skips a name rebound by a destructure', () => {
    const script = facts(
      'list[list[1], list["a"]] => $l\nlist[1, 2] -> destruct<$l, $m>\n'
    );
    expect(script.mixedListVars.size).toBe(0);
  });

  it('skips a name that is also a fn parameter', () => {
    const script = facts(
      'list[list[1], list["a"]] => $l\nfn(l) { $l } => $f\n'
    );
    expect(script.mixedListVars.size).toBe(0);
  });

  it('skips a literal that is not mixed or has further pipes', () => {
    const script = facts(
      'list[list[1], list[2]] => $a\nlist[list[1], list["a"]] -> .len => $b\n'
    );
    expect(script.mixedListVars.size).toBe(0);
  });
});

// ============================================================
// dictLiteralVars
// ============================================================

describe('dictLiteralVars', () => {
  const facts = (source: string) => collectFacts(parse(source)).script;

  it('collects a name captured once from a dict literal', () => {
    const script = facts('dict[a: 1] => $d\n');
    expect([...script.dictLiteralVars.keys()]).toEqual(['d']);
    expect(script.dictLiteralVars.get('d')?.type).toBe('Dict');
  });

  it('collects a name captured once from an ordered literal', () => {
    const script = facts('ordered[a: 1] => $o\n');
    expect(script.dictLiteralVars.get('o')?.type).toBe('OrderedLiteral');
  });

  it('skips a name captured twice', () => {
    const script = facts('dict[a: 1] => $d\n5 => $d\n');
    expect(script.dictLiteralVars.size).toBe(0);
  });

  it('skips a name that is also a fn parameter', () => {
    const script = facts('dict[a: 1] => $d\nfn(d) { $d } => $f\n');
    expect(script.dictLiteralVars.has('d')).toBe(false);
  });

  it('skips a non-literal head', () => {
    const script = facts('list[1] => $l\n5 => $n\n');
    expect(script.dictLiteralVars.size).toBe(0);
  });
});

// ============================================================
// access-derived facts
// ============================================================

describe('access-derived facts', () => {
  const script = (source: string) => collectFacts(parse(source)).script;

  it('counts .$k as dynamic', () => {
    expect(
      script('dict[a: 1] => $d\n"a" => $k\n$d.$k\n').hasDynamicFieldAccess
    ).toBe(true);
  });

  it('counts [expr] with a computed expression as dynamic', () => {
    expect(
      script('dict[a: 1] => $d\n"a" => $k\n$d[$k]\n').hasDynamicFieldAccess
    ).toBe(true);
  });

  it('counts a string-literal bracket as dynamic', () => {
    expect(script('dict[a: 1] => $d\n$d["a"]\n').hasDynamicFieldAccess).toBe(
      true
    );
  });

  it('counts a .?[expr] probe final access as dynamic', () => {
    expect(
      script('dict[a: 1] => $d\n"a" => $k\n$d.?[$k]\n').hasDynamicFieldAccess
    ).toBe(true);
  });

  it('does not count a static number index as dynamic', () => {
    expect(script('list[1, 2] => $l\n$l[0]\n').hasDynamicFieldAccess).toBe(
      false
    );
  });

  it('does not count a negative number index as dynamic', () => {
    expect(script('list[1, 2] => $l\n$l[-1]\n').hasDynamicFieldAccess).toBe(
      false
    );
  });

  it('does not count a .?[0] probe as dynamic', () => {
    expect(script('list[1, 2] => $l\n$l.?[0]\n').hasDynamicFieldAccess).toBe(
      false
    );
  });

  it('collects the field name of a .?field probe', () => {
    expect([
      ...script('dict[a: 1] => $d\n$d.?a\n').literalFieldAccessNames,
    ]).toEqual(['a']);
  });

  it('sees .?len as a len field access', () => {
    const source = 'list[1] => $l\n$l.?len\n';
    const root = parse(source);
    expect(collectFacts(root).bySubtree.get(root)?.hasLenFieldAccess).toBe(
      true
    );
  });

  it('sees .?[i] as a bracket access', () => {
    const source = 'list[1] => $l\n$l.?[0]\n';
    const root = parse(source);
    expect(collectFacts(root).bySubtree.get(root)?.hasBracketAccess).toBe(true);
  });
});

// ============================================================
// declaredTypes, entriesVars, entriesBodies
// ============================================================

describe('declaredTypes', () => {
  const script = (source: string) => collectFacts(parse(source)).script;

  it('records a typed capture bound once', () => {
    expect(script('5 => $n:number\n').declaredTypes.get('n')).toEqual({
      kind: 'static',
      typeName: 'number',
    });
  });

  it('records a typed fn param bound once', () => {
    expect(
      script('fn(x: number) { $x } => $f\n').declaredTypes.get('x')
    ).toEqual({
      kind: 'static',
      typeName: 'number',
    });
  });

  it('omits a name bound twice', () => {
    expect(script('5 => $n:number\n6 => $n\n').declaredTypes.has('n')).toBe(
      false
    );
  });

  it('omits a typed param used in two closures', () => {
    const source = 'fn(x: number) { $x } => $f\nfn(x: number) { $x } => $g\n';
    expect(script(source).declaredTypes.has('x')).toBe(false);
  });
});

describe('entriesVars and entriesBodies', () => {
  const script = (source: string) => collectFacts(parse(source)).script;

  it('puts a variable captured from an .entries read in entriesVars', () => {
    expect([
      ...script('dict[a: 1] => $d\n$d.entries => $p\n').entriesVars,
    ]).toEqual(['p']);
  });

  it('puts a collection-op body fed by an .entries stage in entriesBodies', () => {
    const source = 'dict[a: 1] => $d\n$d -> .entries -> seq({ $ })\n';
    const root = parse(source);
    const body = bodyOfFirstCall(root, 'seq');
    expect(collectFacts(root).script.entriesBodies.has(body)).toBe(true);
  });

  it('puts a body fed by an entriesVars variable in entriesBodies', () => {
    const source = 'dict[a: 1] => $d\n$d.entries => $p\n$p -> seq({ $ })\n';
    const root = parse(source);
    const body = bodyOfFirstCall(root, 'seq');
    expect(collectFacts(root).script.entriesBodies.has(body)).toBe(true);
  });

  it('adds nothing for a list literal input', () => {
    const facts = script('list[list[1]] -> seq({ $ })\n');
    expect(facts.entriesVars.size).toBe(0);
    expect(facts.entriesBodies.size).toBe(0);
  });
});
