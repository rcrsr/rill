# Custom ESLint Rules

Custom ESLint rules for the rill project.

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

## Testing

Run tests with:

```bash
node eslint-rules/no-duplicate-error-id.test.cjs
```

## Usage

The rule is registered in `eslint.config.js` at the repository root.
