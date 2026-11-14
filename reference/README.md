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

A rule without a `{pending}` tag is built: the current runtime satisfies it, and at least one
locked test cites it. A disagreement between a built rule and the runtime is a runtime defect.

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
| lexical | Source text, tokens, comments, literals |
| [program](program/) | Scripts, frontmatter, statements, annotations, the return value |
| [values](values/) | The value model, equality, vacancy |
| [types](types/) | Type values, type forms, built-in types, maps, declarations, assertions, carried types, type locks, conversion |
| [variables](variables/) | Variables, `$` binding, scope, capture |
| [expressions](expressions/) | Pipes, selection, dispatch, existence, destructure, slice, spread, interpolation, operators |
| [callables](callables/) | Blocks, functions, parameters, invocation |
| [control-flow](control-flow/) | Control statements and their options, loops |
| [collections](collections/) | `seq`, `fan`, `filter`, `fold`, `acc`, `sort`, slicing |
| [errors](errors/) | Invalid values, recovery, `assert`, `error` |
| limits | Iteration, concurrency, call depth, timeouts |
| [host-boundary](host-boundary/) | `use`, and what a script observes of host functions and resources |
| builtins | Built-in methods and functions |

## Open decisions

Questions that belong to 0.24.0 but are not decided yet. The reference states no rule for them
until they are. 0.24.0 does not ship while this list is non-empty.

| Issue | Question | Concept |
|-------|----------|---------|
| [#595](https://github.com/rcrsr/rill/issues/595) | Reading a default on a tuple position from the type | `introspection` |
| [#563](https://github.com/rcrsr/rill/issues/563) | The type of the pairs `.entries` returns | `dict` |
| [#569](https://github.com/rcrsr/rill/issues/569) | The halt for a typed capture that fails its assertion | `assertion`, `type-lock` |
| [#571](https://github.com/rcrsr/rill/issues/571) | The name of strict mode and the scope of a bare block | `strict-mode` |
| [#568](https://github.com/rcrsr/rill/issues/568) | What a read that does not select an entry does with a held block | `code-block` |
| [#579](https://github.com/rcrsr/rill/issues/579) | The literal form of a duration | `duration` |
| [#613](https://github.com/rcrsr/rill/issues/613) | Whether `fan`, `filter`, and `sort` share the 10,000-element ceiling | `iteration` |
| [#614](https://github.com/rcrsr/rill/issues/614) | Whether an `ordered` is a collection source | `sort` |
| [#615](https://github.com/rcrsr/rill/issues/615) | Which of tuple, ordered, and iterator destructure, slice, and spread accept | `destruct`, `slice`, `spread` |
| [#617](https://github.com/rcrsr/rill/issues/617) | Whether a capture inside an interpolation escapes to the enclosing scope | `interpolation` |
| [#618](https://github.com/rcrsr/rill/issues/618) | Whether the type after `use<...>` is checked | `use` |
| [#619](https://github.com/rcrsr/rill/issues/619) | Which `use<...>` failures `guard` catches | `use` |
