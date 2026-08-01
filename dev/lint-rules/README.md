# Custom lint rules

Shared lint rules for the rill ecosystem, run by [oxlint](https://oxc.rs) via
its JS plugin API. The rules use the standard ESLint rule shape (`meta` +
`create(context)` returning AST visitors), which oxlint executes unchanged.

`index.js` bundles them into a single plugin (`meta.name: "rill"`), so they
resolve as `rill/no-duplicate-error-id`.

## Use

Not published and not installable. A repository holds a copy of `dev/`, placed
there by `dev/apply.sh`; see [`../README.md`](../README.md). Reference the
plugin by relative path, which adds no dependency:

```json
{
  "jsPlugins": ["./dev/lint-rules/index.js"],
  "overrides": [
    {
      "files": ["packages/*/src/**/*.{ts,tsx}"],
      "rules": { "rill/no-spec-id-reference": "error" }
    }
  ]
}
```

Rules are opt-in. Loading the plugin registers them; an `overrides` entry turns
one on for a path. `no-spec-id-reference` applies to every repository with a
`conduct/` directory. `no-duplicate-error-id` is specific to repositories that
construct `RuntimeError`, which in practice means `rill` alone.

## Rules

| Rule | Enabled for | Auto-fix |
|------|-------------|----------|
| `no-duplicate-error-id` | `**/src/runtime/**/*.ts` | Yes |
| `no-spec-id-reference` | `packages/*/src/**/*.{ts,tsx}` | No |

### `no-duplicate-error-id`

Detects when RuntimeError message arguments contain the error ID prefix.

**Targets:**
- `new RuntimeError('RILL-R001', 'RILL-R001: message')`
- `RuntimeError.fromNode('RILL-R001', 'RILL-R001: message', node)`

**Auto-fixable:** Strips `RILL-RXXX: ` prefix from message argument.

**Error message:**
> Error message must not include error ID prefix. The ID 'RILL-R001' is already the first parameter.

**Examples:**

```typescript
// Bad
new RuntimeError('RILL-R001', 'RILL-R001: Variable not defined');
RuntimeError.fromNode('RILL-R002', 'RILL-R002: Type mismatch', node);

// Good
new RuntimeError('RILL-R001', 'Variable not defined');
RuntimeError.fromNode('RILL-R002', 'Type mismatch', node);
```

**Edge cases:**
- Non-RuntimeError constructors: ignored (no false positives)
- Dynamic error ID (variable): ignored (cannot statically validate)
- Template literal with complex expression: ignored (only checks literal prefix)

### `no-spec-id-reference`

Rejects internal workflow-artifact ID references in shipped source. These IDs
point at planning documents that are not published, so they are unresolvable for
anyone reading the code, including future maintainers and external contributors.

**Prefix vocabulary**, by family:

| Family | Prefixes |
|--------|----------|
| Requirements | `FR`, `NFR`, `IR`, `IC`, `EC`, `AC` |
| Decisions | `DEC`, `DR`, `DD`, `BC` |
| UX | `UXC`, `UXI`, `UXS`, `UXT` |
| Work items | `TC`, `TD`, `DEBT`, `RI`, `GF`, `LOG`, `OK` |

Matched shape is `PREFIX-<segment>` with word boundaries on both ends, so
compound forms (`AC-FDL-4`, `FR-ERR-14`, `NFR-HSM-7`) are caught whole.

**Scanned surfaces:** line and block comments (including JSDoc), string
literals, template-literal chunks, and JSX text. Never executable syntax — a
TypeScript identifier cannot contain `-`.

**Auto-fixable:** No. Most occurrences pair a real fact with an opaque
reference, and only a human can tell which half to keep.

**Examples:**

```typescript
// Bad
// Negative n halts with #INVALID_INPUT (EC-1).
it('AC-49: range("hello", 5) produces RILL-R001', ...);

// Good
// Negative n halts with #INVALID_INPUT.
it('range("hello", 5) produces RILL-R001', ...);
```

**Never matches:**
- rill error codes — `RILL-R010`, `RILL-P007`, `#TYPE_MISMATCH`, `#INVALID_INPUT`
- a prefix embedded in a longer word — `SPEC-1`, `REC-2`, `ABC-3`
- fiddle's fabricated test error IDs — `'TEST-001'`, `'ERR-001'`, `'COMM-001'`

**Escape hatch:** `// oxlint-disable-next-line rill/no-spec-id-reference`

**Out of scope:**
- `packages/core/tests/`, which still carries these identifiers. Most sit in
  `tests/language/`, the locked language arbiter, which may only change for
  language spec reasons.
- `§` section anchors. The tree mixes internal ones (`§NOD.10.4`) with
  legitimate external citations (`RFC 4648 §5`) and cites of published rill doc
  sections (`see § Error Handling`), and no pattern separates them. The internal
  ones were removed by hand.
- `.rill` fixture files under `packages/*/src/`. The `no-spec-id-reference`
  override in the consuming repository's `.oxlintrc.json` is scoped to `*.{ts,tsx}` because oxlint has no
  `.rill` parser; there is no AST for it to walk, so widening the glob would
  never make the rule run. Fixtures under `packages/fiddle/src/lib/__tests__/fixtures/`
  are not machine-checked and were swept by hand.

## Testing

One test layer covers the custom rules. It requires no JavaScript parser
or `eslint`; oxlint has no built-in `RuleTester`, so it drives the rule
`.cjs` files directly.

### `rule-unit-test.cjs`

Unit tests for rule logic: calls `rule.create(mockContext)` and drives the
returned AST visitors with hand-built ESTree fixture nodes. Covers valid
inputs, invalid inputs (asserting `messageId`/`data`), and — for
`no-duplicate-error-id` — auto-fix output for both string-literal and
template-literal messages, plus the edge cases where the rule must not fire
(non-`RuntimeError` constructors, dynamic error IDs, template literals with a
leading expression).

For `no-spec-id-reference` the mock `sourceCode` also supplies `text`,
`getAllComments()`, and real `getLocFromIndex()` line/column arithmetic, so
reported positions are asserted against columns a reader can look up in the
fixture source. Run from the repository root:

```bash
pnpm test:rules
# or, directly:
node dev/lint-rules/rule-unit-test.cjs
```

It is a root script, so it runs as part of `pnpm check` locally and as its own
step in the CI `deps` job. `pnpm -r run check` does not reach it: `-r` excludes
the workspace root.

## Usage

Within this repository the plugin is registered in the root `.oxlintrc.json`
via `jsPlugins` as `./dev/lint-rules/index.js`, and the rules are enabled for
their target globs through `overrides` entries.
