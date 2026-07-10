# Custom lint rules

Project-specific lint rules for rill, run by [oxlint](https://oxc.rs) via its
JS plugin API. The rules use the standard ESLint rule shape (`meta` +
`create(context)` returning AST visitors), which oxlint executes unchanged.

`oxlint-plugin.js` bundles the rules into a single plugin (`meta.name: "rill"`),
so they resolve as `rill/no-duplicate-error-id` and `rill/no-cross-mixin-any`.

## Rules

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

### `no-cross-mixin-any`

Forbids `(this as any)` and `(evaluator as any)` in `src/runtime/` mixin files.
Cross-mixin calls must use `EvaluatorInterface`, not `as any`.

**Auto-fixable:** No. Human judgment required for the correct cast target.

## Testing

`lint-glob-self-test.cjs` is a CI self-test that writes a temporary fixture into
`packages/core/src/runtime/`, runs oxlint, and asserts `rill/no-cross-mixin-any`
fires. Run it from `packages/core`:

```bash
pnpm run lint:self-test
```

## Usage

The plugin is registered in `.oxlintrc.json` at the repository root via the
`jsPlugins` field, and the rules are enabled for `src/runtime/**` files through
an `overrides` entry.
