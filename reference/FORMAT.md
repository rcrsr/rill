# Reference format

*How every file under `reference/` is written. `pnpm ref lint` and `pnpm ref check` enforce every MUST here that a machine can check, and CI runs both.*

## Files

1. One file per atomic concept. Target 40 to 150 lines. Split a file that passes 200.
2. Every file follows the section order below. Omit a section with nothing to say. Never write "N/A".
3. Prose outside Examples and Notes is normative.
4. The reference describes rill 0.24.0. Syntax is 0.24.0 syntax everywhere. A form removed in
   0.24.0 appears only in Notes, as a removal.
5. Write the rule, not the reasoning. At most one sentence of rationale per file.
6. Never cite an ADR, a `conduct/` path, or a workflow identifier. Cite rule ids, error ids, error
   codes, grammar productions, and GitHub issues.
7. No tutorial voice: no "you", "we", or "let's". Present tense. Active voice.

## Frontmatter

```yaml
---
id: union                           # concept id, see "Ids"
title: Union types
status: normative                   # normative | removed
since: 0.24.0                       # first release with this shape
issues: [574]                       # open issues whose rules this file states
grammar: [union-type, union-member] # productions that exist in docs/ref-grammar.ebnf today
errors: [RILL-R001, TYPE_MISMATCH]  # error ids and error codes the Errors table names
depends: [type-value, structural-typing]
tests: [union-types.test.ts]        # files under packages/core/tests/language/
---
```

- `issues` lists only open issues. A rule built since the issue closed drops it.
- `grammar` lists productions present in `docs/ref-grammar.ebnf`. A production new in 0.24.0 is
  written in the Syntax section under a `{pending #N}` rule and stays out of this list until built.
- `depends` names concept ids in the same chapter or an earlier one.
- `status: removed` keeps a concept id resolvable after the concept is dropped. Its body names the
  replacement.

## Sections

| Order | Heading | Content | Normative |
|-------|---------|---------|-----------|
| 1 | `# Title` + definition | One sentence: what the concept is | Yes |
| 2 | `## Syntax` | EBNF excerpt, lexical notes | Yes |
| 3 | `## Static rules` | What parse and check time accept or reject | Yes |
| 4 | `## Evaluation` | Runtime semantics, numbered steps where order matters | Yes |
| 5 | `## Interactions` | Rules that exist only where this concept meets another | Yes |
| 6 | `## Errors` | Table: condition, error, catchable | Yes |
| 7 | `## Examples` | `rill` fences, run by the examples harness | No |
| 8 | `## Notes` | Implementation limits, removed forms, open decisions | No |

Files in `conventions/` define the vocabulary this layout relies on. They choose their own H2
headings. Every other rule in this file applies to them.

## Ids

Every rule has two names.

| Form | Example | Used by | Stability |
|------|---------|---------|-----------|
| Symbolic id | `union.reduce` | Tests, anchors, links, halt messages | Never changes once published |
| Full form | A union drops a member another member accepts | Readers, the build report, test output | May be reworded if the meaning stays |

The symbolic id is `<concept>.<rule>`.

- **Concept** is the file's `id`: a kebab-case noun, singular where English allows, unique across
  the reference. A new file takes its filename from its concept.
- **Rule** is a kebab-case slug of 1 to 3 words, unique within its concept.
- A built-in method's concept is `<receiver>.<method>`, such as `string.trim`. No rule id may equal
  a concept id, so the concept `string` never has a rule slug `trim`.
- A chapter folder is never part of an id. A chapter MAY group its files in subfolders, which
  are never part of an id either. Moving a file changes its URL and nothing else.
- A slug never changes meaning. A changed rule takes a new slug. The old one moves to Notes as
  superseded and is never reused.

The full form is one sentence-case clause of 80 characters or fewer, unique within its file, with
no trailing period. It summarizes the rule. The body under it states the rule completely.

## Rule markers

A marker sits on its own line, followed by the rule body.

```markdown
r[union.reduce] A union drops a member another member accepts
A member that another member accepts MUST be dropped. A union left with one member MUST
reduce to that member.
```

A rule that `main` does not satisfy yet ends its marker with `{pending #N}`, naming the open issue
that builds it:

```markdown
r[union.conversion] A pipe into a union converts through one member {pending #574}
```

The rule body runs from the marker to the next marker or heading. It may span paragraphs and
contain fences.

A rule body uses RFC 2119 keywords in uppercase: MUST, MUST NOT, MAY. Lowercase "must" carries no
normative force, so avoid it in rule bodies.

One marker states one testable fact. Two facts that can fail independently get two markers.

## Build state

- A rule without `{pending}` is built: `main` satisfies it, and a locked test cites it.
  During the pilot an uncited built rule is reported, not failed. `pnpm ref check --strict`
  fails it, and becomes the CI gate once the test backfill completes.
- A `{pending #N}` rule needs no test. The PR that builds it removes the tag, adds the citing test,
  and removes any locked test that pinned the old behavior.
- `pnpm ref check --issues` confirms every pending issue is still open. It calls `gh`, so it runs
  locally and before a release, not in CI.
- A decision not yet made is never a rule. The file names it in Notes as "Open decision: #N", and
  `README.md` lists it under Open decisions.

## Test citations

A test under `packages/core/tests/language/` cites the rules it proves with the `rule()` helper:

```ts
rule('union.reduce', 'union.flatten')
  .it('drops a type member that another member accepts', async () => { ... });
```

Only that directory is scanned. Citing an unknown or pending rule is an error.

## Errors table

| Condition | Error | Catchable |
|-----------|-------|-----------|
| The value matches no member in an assertion | `#TYPE_MISMATCH` | Yes |
| A parameter's value matches no member | RILL-R001 | No |

"Error" holds an error code (`#TYPE_MISMATCH`), an error id (`RILL-R001`), or both. Every code
and id in the table MUST appear in the frontmatter `errors` list, without the `#`, and every entry
in that list MUST appear in the table. See
`conventions/halt.md` for the terms.

## Examples

- A ` ```rill ` fence runs in the examples harness. End it with `# Result: <value>`.
- A fence that must halt carries `# Error:` on its first line.
- A fence that needs an unbuilt rule is ` ```rill pending=574 `. The harness skips it until the
  issue closes, and the checker then fails it until the tag is removed.
- A block that spans lines opens with `{` at the end of a line, indents each statement two
  spaces, and closes with `}` on its own line. A one-statement block stays on one line.
- A ` ```text ` fence never runs. Use it for syntax shapes, not for code that should run.

## Notes

Notes are informative. They hold:

- forms removed in 0.24.0 and the error they now raise
- implementation limits pinned by tests but not part of the language
- superseded rule ids
- `Open decision: #N` for undecided questions that belong to this concept
