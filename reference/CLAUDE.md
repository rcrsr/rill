# Maintaining reference/

`reference/` is the normative specification of rill 0.24.0. Every other source conforms to it:
the runtime, the locked tests, `docs/`, and the language service. A wrong rule here becomes a
wrong runtime later, so a rule is written only from decided behavior and observed evidence.

[FORMAT.md](FORMAT.md) is the authoring format: frontmatter, sections, ids, markers, Errors
tables, examples, and the hash lock. This file covers how to keep the reference correct over
time. Read both before changing any file here.

## Gates

Run all four after every change. Each must end with 0 errors.

```bash
pnpm ref lint           # per-file format
pnpm ref check          # cross-file ids, depends, xrefs, grammar, errors, lock, open decisions
pnpm test:examples      # runs every ```rill fence; pending fences run and must fail
pnpm vitest run scripts/reference   # only when scripts/reference/ changed
```

`pnpm ref check --issues` confirms every pending issue is still open. It calls `gh`, so run it
before a PR and before a release, not in CI. CI verifies pending fences through `pnpm test:examples`
and pending rules only through `--issues`, which the release SOP runs.

Length warnings (over 150 lines) are allowed but tracked. A file over 200 lines is an error:
split it into two concepts, never into "part 1" and "part 2".

## Where a fact comes from

Every rule states one of two things:

| Kind | Source | Marker |
|------|--------|--------|
| Built behavior | Observed on the current runtime, and pinned by a locked test | no tag |
| Decided, unbuilt behavior | An open GitHub issue that records the decision | `{pending #N}` |

Never write a rule from memory, from `docs/`, or from a source comment. `docs/` describes the
released version and drifts; source comments state intent, not behavior.

### Probing the runtime

Probe built behavior against `packages/core/dist`, not by reading source. Build first so `dist`
matches `main`:

```bash
pnpm --filter @rcrsr/rill build
```

Then run sources through `parse` and `execute` from `packages/core/dist/index.js` in a scratch
script outside the repo. Record the exact result or error id and message for each case, plus the
commit you probed. Probe the edges, not just the happy path: empty inputs, wrong kinds, extra and
missing arguments, nesting, and the interaction with `guard`.

### Catchability

The Catchable column of an Errors table is verified, never inferred from the error family.
Run the failing source inside `guard { ... } => $r` and read `$r.!code`. A halt that escapes the
guard is not catchable. Record `No` only after observing the escape.

### When the runtime disagrees with a decision

1. Do not encode the runtime's behavior as a rule, and do not encode the decision as built.
2. File a GitHub issue on `rcrsr/rill` with the probe evidence: source, observed result, expected
   result, and the commit probed.
3. Write the decided behavior as a `{pending #N}` rule naming that issue, or, when nothing is
   decided, add `Open decision: #N` to Notes and a row to the README Open decisions table.

File every defect you find while writing, even when it is outside the file you are working on.
An unfiled defect is lost.

## Pending rules, trackers, and open decisions

- A `{pending #N}` rule is decided. The issue tracks the work to build it. A tracker issue such as
  #571 may hold dozens of pending rules and still have open details.
- An open decision is a question with no answer yet. It is never a rule. It appears as
  `Open decision: #N, <the question>.` in Notes, and as a README row whose Concept column names
  every concept that carries the note. `pnpm ref check` enforces both directions.
- When a decision is made, replace the Notes line with a pending rule, and remove the concept from
  the README row. Remove the row when no concept remains.
- When a pending rule's issue closes, remove the tag, cite the rule from a locked test, and change
  any example fence from ```` ```rill pending=N ```` to ```` ```rill ````. A pending fence that
  starts passing before its issue closes fails `pnpm test:examples`; remove the fence tag then.
  Rules keep their tags until the issue closes.
- Frontmatter `issues` lists exactly the issues that some pending rule or pending fence in the file
  uses. Lint fails a missing one and warns on a stale one.
- An inconsistency the owner chooses to collect rather than file goes in
  [INCONSISTENCIES.md](INCONSISTENCIES.md), grouped under a heading per topic, with the probe
  evidence in the row. It never becomes a rule or a Notes line until it is decided and filed.
  Add a row whenever you find one, even outside the file you are working on.

## Syntax in rule text and examples

The reference uses 0.24.0 syntax everywhere outside Notes, even where 0.23.0 does not parse it yet.
Such an example is a ```` ```rill pending=N ```` fence.

- Functions are written with `fn`: `fn(x: number) { $x + 1 }`, `fn { $ * 2 }`. The `|x| body`
  literal is removed by #571 and appears only in Notes, as a removal.
- Control statement options use parentheses: `retry(attempts: 3)`, `do(limit: 100)` (#578).
- Host calls use `use<ext:name> => $app`, then `$app.fn()`. Never write `ns::fn()`.
- A removed form appears only in Notes, with the error it now raises.

Prefer a form that runs today when it states the same fact. For example, write a block argument
`seq({ $ * 10 })` rather than a pending `fn` literal when the example is about `seq`, not `fn`.

## Ownership and citation

Every fact has one owning rule. Before adding a rule, search for an existing owner:

```bash
grep -rn "RILL-R044" reference --include=*.md     # who states this error
pnpm ref query --dependents defaults.param        # who cites this rule
```

- When an owner exists, cite it in backticks and do not restate it. A restated fact drifts.
- When two rules state the same fact, keep the one in the concept the fact belongs to, narrow the
  other, and repoint citations. Re-run `pnpm ref check` to catch dangling references.
- Interactions prose outside rule bodies only points at owners; it never says MUST or MAY.
- `depends` names concepts in the same or an earlier chapter, in README order. A file that needs a
  later chapter's concept is in the wrong chapter, or the fact belongs to the later concept.

## The hash lock

`reference.lock` is generated. Never edit it by hand.

- After adding, removing, or changing any rule, run `pnpm ref lock` and commit the lock with the
  change.
- When check reports `xref-drift`, a rule changed under an owner that cites it. Read the owner. Fix
  it if the change affects it. Then run `pnpm ref lock --reviewed <owner>`. Never pass
  `--reviewed` or `--all` without reading each flagged owner.

## Tests

`packages/core/tests/language/` is hash-locked. Change it only for a language spec change,
together with `bash scripts/check-test-lock.sh --update`. Never edit a locked test to make the
reference pass.

- Frontmatter `tests` lists the locked test files that exercise the concept. When adding a concept,
  search the test directory for its syntax and error ids and list every file that covers it.
- Built rules without a citing test are reported as info during the pilot, which ends when
  [AUDIT.md](AUDIT.md) closes. Citing a built rule from an existing locked test, or adding a
  locked test for an untested built rule, is an allowed lock change. Never change an existing
  test's body to make a rule pass.

## Citation limits

This folder is published. Never cite `conduct/` paths, ADR numbers or names, or workflow ids such
as `AC-*`, `FR-*`, or `IR-*`, in any file here, Notes included. Cite rule ids, rill error ids and
codes, grammar productions, and GitHub issues. `pnpm ref lint` fails a forbidden citation.

## Adding a concept

1. Pick the chapter by dependency, not by topic name. Check the README chapter order.
2. Find the grammar productions in `docs/ref-grammar.ebnf`, the error ids in
   `packages/core/src/error-registry.ts`, and the locked tests that exercise the concept.
3. Probe the built behavior, including every error path and its catchability.
4. Write the file per FORMAT.md. Cite existing owners instead of restating them.
5. List new open decisions in the README, and link a new chapter folder from the README table.
6. Run `pnpm ref lock`, then all four gates.

## Commits

- One concern per commit: a concept, a chapter, or a tooling change.
- Commit messages describe the reference and tooling change and may cite GitHub issues. They never
  cite workflow artifacts.
- Run `pnpm check` before opening a PR.
