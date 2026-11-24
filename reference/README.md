---
chapters:
  - conventions
  - lexical
  - program
  - values
  - types
  - variables
  - expressions
  - callables
  - control-flow
  - collections
  - errors
  - limits
  - host-boundary
  - builtins
---

# rill Language Reference

*The normative specification of rill 0.24.0, one concept per file.*

> **rill 0.24.0, unreleased.** The current release is 0.23.0. Rules marked `{pending #N}` describe
> 0.24.0 behavior that the current release does not have yet.

## Scope

This reference states what a rill script means: its syntax, its static rules, and its evaluation.
It does not teach the language and does not explain why a rule exists. For a guided introduction,
read the [Guide](../docs/guide-getting-started.md). For the TypeScript embedding API, read the
[Host API](../docs/ref-host-api.md).

## Authority

| Source | Role |
|--------|------|
| `reference/` | The specification. Every other source conforms to it. |
| `packages/core/tests/language/` | Proof that the runtime satisfies each built rule. A test cites the rules it proves. |
| `docs/` | Guides and lookup tables for the released version. They link rules and never restate them as their own. |

A rule without a `{pending}` tag is built: the current runtime satisfies it. Test citation is incomplete
during the pilot and is being added incrementally, so a built rule may not yet have a locked test citing it. [AUDIT.md](AUDIT.md) tracks the work to
cite every rule before 0.24.0. A disagreement between a built rule and the runtime is a runtime defect.

## Reading a rule

```markdown
r[union.reduce] A union drops a member another member accepts
A member that another member accepts MUST be dropped. A union left with one member MUST
reduce to that member.
```

- `union.reduce` is the symbolic id. It is stable, and links and tests use it.
- The text after it is the full form, a one-line summary.
- The body states the rule. MUST, MUST NOT, and MAY carry their RFC 2119 meanings.

See [FORMAT.md](FORMAT.md) for the complete authoring format.

## Chapters

Chapters are ordered by dependency. A concept depends only on concepts in its own chapter or an
earlier one.

| Chapter | Covers |
|---------|--------|
| [conventions](conventions/) | Notation and the vocabulary of halts |
| [lexical](lexical/) | Source text, whitespace and comments, identifiers, keywords, tokens |
| [program](program/) | Scripts, frontmatter, statements, annotations, the return value |
| [values](values/) | The value model, equality, vacancy |
| [types](types/) | Type values, type forms, built-in types, maps, declarations, assertions, carried types, type locks, conversion |
| [variables](variables/) | Variables, `$` binding, scope, capture |
| [expressions](expressions/) | Operators, arithmetic, logical operators, pipes, pipe targets, access forms, selection, dispatch, existence, destructure, slice, spread, interpolation |
| [callables](callables/) | Blocks, functions, parameters, invocation |
| [control-flow](control-flow/) | Control statements and their options, loops |
| [collections](collections/) | `seq`, `fan`, `filter`, `fold`, `acc`, `sort`, slicing |
| [errors](errors/) | Invalid values, recovery, `assert`, `error` |
| [limits](limits/) | Call depth, calls in flight, slicing results, nesting depth, the host timeout, string length, the datetime range |
| [host-boundary](host-boundary/) | `use`, and what a script observes of host functions and resources |
| builtins (not yet written) | Built-in methods and functions |

## Open decisions

Questions that belong to 0.24.0 but are not decided yet. The reference states no rule for them
until they are. 0.24.0 does not ship while this list is non-empty.

None. Every 0.24.0 question is decided.

## Deferred past 0.24.0

Concepts stated here but not built for 0.24.0. Their open questions do not block the release.

| Issue | Question | Concept |
|-------|----------|---------|
| [#599](https://github.com/rcrsr/rill/issues/599), [#595](https://github.com/rcrsr/rill/issues/595) | Whether `.annotations` on a tuple type returns a map | `introspection` |
| [#629](https://github.com/rcrsr/rill/issues/629) | The name of strict mode, and whether it flags a block passed to a construct or an operator | `strict-mode` |

## Known inconsistencies

[INCONSISTENCIES.md](INCONSISTENCIES.md) collects observed disagreements between built rules, or
between a rule and the runtime, that nobody has decided yet. None is a rule. 0.24.0 does not ship
until [#670](https://github.com/rcrsr/rill/issues/670) decides each one.
