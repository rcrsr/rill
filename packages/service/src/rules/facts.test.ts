import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ASTNode, ClosureNode, HostCallNode } from '@rcrsr/rill';
import { collectFacts, capturesInSubtree } from './facts.js';
import { traverseForRules } from './traversal.js';
import { resolveOpBody } from './collection-ops.js';

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
    const source = 'list[1, 2] -> fan({ |x|(log($x)) => $f })\n';
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

  it('is true for a bare $ directly in a zero-param closure body', () => {
    const source = '(|| { $ }) => $g\n';
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
      'list[1, 2] -> seq({ $ => $item\n (|| { $item }) => $g\n $g() })\n';
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

  it('is false when the capture sits inside a |x|(...) closure, masked by the closure boundary', () => {
    const source = 'list[1, 2] -> seq({ (|x| { $ => $item }) => $f })\n';
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
  it('hasClosure propagates through nested collection-op and closure boundaries', () => {
    const source =
      'list[1, 2] -> fan({ list[3, 4] -> seq({ (|x| { $x }) => $f }) })\n';
    const root = parse(source);
    const facts = collectFacts(root);

    const fanBody = bodyOfFirstCall(root, 'fan');
    expect(facts.bySubtree.get(fanBody)?.hasClosure).toBe(true);
  });

  it('hasStatusProbe propagates through the closure boundary', () => {
    const source = 'list[1, 2] -> seq({ (|x| { $x.! }) => $f })\n';
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
  it('excludes captures nested inside a closure in the body and returns the rest in source order', () => {
    const source =
      'list[1, 2] -> seq({ $ => $a\n (|x| { $x => $b })\n $ => $c })\n';
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
    const source = '|x|($x * 2) => $double\n$double(5)\n';
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

  it('logs a reference for a Variable nested inside a Closure body (|p|($x))', () => {
    const source = '1 => $x\n(|p|($x)) => $f\n';
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
  it('sets closureOrOpDepth to 1 for a reference inside a Closure body (|x|($x * 2))', () => {
    const source = '|x|($x * 2) => $double\n';
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

  it('sets bindingScopeDepth to 1 for a capture inside a GroupedExpr (("a" => $x))', () => {
    const source = '("a" => $x)\n';
    const root = parse(source);
    const facts = collectFacts(root);

    expect(facts.script.captureLog[0]?.bindingScopeDepth).toBe(1);
  });
});

// ============================================================
// SINGLE-VISIT INVARIANT
// ============================================================

describe('collectFacts single-visit invariant', () => {
  it('records exactly one bySubtree entry per node visited by an independent traversal', () => {
    const source =
      'list[1, 2] -> fan({ list[3, 4] -> seq({ $ => $item\n (|x| { $x.! -> break }) => $f\n $ => $c }) })\n' +
      '|y| ($y * 2) => $double\n' +
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
