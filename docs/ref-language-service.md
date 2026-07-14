# rill Language Service API

*Editor tooling: outline, semantic tokens, formatting, scope resolution, hover, completion, and a 40-rule static checker*

`@rcrsr/rill-language-service` ships editor-tooling providers (outline, semantic tokens, formatting, scope resolution, hover, completion, and a 40-rule static checker) built on `@rcrsr/rill`'s parser and AST. Its version is held exactly equal to `@rcrsr/rill`'s version, character-for-character.

## Subpath Exports

The package splits its surface across three entry points so consumers importing one subpath do not pull in the others. Importing the root or `/scope` never loads the `/rules` engine module.

| Subpath | Exports |
|---------|---------|
| `@rcrsr/rill-language-service` | `documentSymbols`, `semanticTokens`, `formatDocument`, `spanToRange`, `version`, plus `Position`, `Range`, `DocumentSymbol`, `SymbolKind`, `SemanticToken`, `ServiceTokenType`, `TextEdit` |
| `@rcrsr/rill-language-service/scope` | `resolveScopeAt`, `findDefinition`, `getHover`, `getCompletions`, plus `Binding`, `BindingKind`, `HoverInfo`, `CompletionItem`, `CompletionKind` |
| `@rcrsr/rill-language-service/rules` | `createDefaultConfig`, `validateConfig`, `validateRuleCodes`, `runRules`, `RULES`, plus `CheckConfig`, `Diagnostic`, `DiagnosticFix`, `DiagnosticSeverity`, `Rule`, `RuleContext`, `RuleState`, `ValidationError` |

## Root Exports

### `documentSymbols`

```typescript
function documentSymbols(parsed: ParseResult): DocumentSymbol[]
```

Builds a hierarchical outline of a parsed script via core's `walkAst`, producing one entry per top-level capture, closure, and dict key. Each symbol's `range` and `selectionRange` come from `spanToRange`. Tolerates `RecoveryErrorNode` and `PartialExpressionNode` regions from a partial parse tree and never throws. An empty script returns `[]`.

```typescript
interface DocumentSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly children?: DocumentSymbol[] | undefined;
}

type SymbolKind = 'variable' | 'function' | 'field';
```

### `semanticTokens`

```typescript
function semanticTokens(
  parsed: ParseResult,
  tokens: readonly Token[],
  source: string
): SemanticToken[]
```

Produces LSP-style semantic-token deltas. `tokens` and `source` are caller-supplied because `ParseResult` carries neither; callers pass the same `Token[]` from `tokenize()` and the original source text. Each token is classified through core's `TOKEN_HIGHLIGHT_MAP`, then a type-name heuristic reclassifies a `VALID_TYPE_NAMES` identifier inside a `TypeNameExpr`/`TypeConstructor` node from `variableName` to `typeName`. Triple-quote string interpolation (`{expr}`) is sub-tokenized with absolute column positions.

```typescript
interface SemanticToken {
  readonly deltaLine: number;
  readonly deltaStart: number;
  readonly length: number;
  readonly tokenType: ServiceTokenType;
  readonly tokenModifiers: number;
}

type ServiceTokenType = HighlightCategory | 'typeName';
```

### `formatDocument`

```typescript
function formatDocument(parsed: ParseResult, source: string): TextEdit[]
```

Reformats the whole document. Returns a single-element array whose `range` spans the full document and whose `newText` is the formatted source. Well-formed regions are normalized incrementally (trailing whitespace trimmed, CRLF line endings normalized to LF); node-level pretty-printing is not yet implemented. Malformed regions produced by parser error recovery (`RecoveryErrorNode`, `PartialExpressionNode`) are spliced back byte-for-byte from the original source. Formatting is idempotent: `formatDocument(parse(formatDocument(parsed, source)[0].newText), formatDocument(parsed, source)[0].newText)` produces the same `newText` again.

```typescript
interface TextEdit {
  readonly range: Range;
  readonly newText: string;
}
```

### `spanToRange`

```typescript
function spanToRange(span: SourceSpan): Range
```

Converts a core `SourceSpan` (1-based line/column, core convention) to a `Range` (0-based line/character). `line` becomes `line - 1`; `column` becomes `character = column - 1`. Total function: every input produces a valid `Range`, no error path.

```typescript
interface Position {
  readonly line: number;
  readonly character: number;
}

interface Range {
  readonly start: Position;
  readonly end: Position;
}
```

### `version`

```typescript
const version: string
```

The package's version string, held exactly equal to `@rcrsr/rill`'s version, character-for-character.

## `/scope` Exports

### `resolveScopeAt`

```typescript
function resolveScopeAt(parsed: ParseResult, offset: number): Binding[]
```

Resolves every name in scope at 0-based `offset` and where each is bound. Four binding constructs feed scope: `CaptureNode`, `ClosureParamNode`, `DestructPatternNode`, and dict keys, across four scope kinds: the implicit top-level script root, `Block`, `Closure`, and `GroupedExpr`. A `PassBlock` opens no scope of its own; its body joins the enclosing scope. Bindings support mutable-outer late binding. A bare `$` is excluded from results. Tolerates recovery nodes; when nothing resolves, returns `[]`.

```typescript
interface Binding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly declarationSpan: SourceSpan;
  readonly bindingSite: SourceSpan;
}

type BindingKind = 'capture' | 'closureParam' | 'destructure' | 'dictKey';
```

`declarationSpan` and `bindingSite` coincide for every current binding construct — both point at the binding node's own span.

### `findDefinition`

```typescript
function findDefinition(parsed: ParseResult, offset: number): SourceSpan | null
```

Resolves the binding-introducing span for the identifier at 0-based `offset`, via core's `nodeAtPosition`. On a `.field` or `[0]` access-chain segment, resolves to that segment's own sub-token span rather than the whole chain or the base variable's binding site. Returns `null` for built-in functions/methods, reserved keywords, and any identifier that does not resolve to a visible binding.

### `getHover`

```typescript
function getHover(parsed: ParseResult, offset: number): HoverInfo | null
```

Resolves type and description information for the identifier at 0-based `offset`, or `null` when nothing resolves. A variable resolves to its declared binding site and declared type where a `:type` annotation exists. A closure invocation resolves its signature via core's `introspectHandlerFromAST`. A built-in function, method, or keyword resolves to a static description from `BUILTIN_FUNCTIONS`, `BUILTIN_METHODS`, or `KEYWORDS`. Recovery regions degrade to partial or missing information rather than throwing.

```typescript
interface HoverInfo {
  readonly contents: string;
  readonly range?: Range | undefined;
  readonly type?: string | undefined;
}
```

### `getCompletions`

```typescript
function getCompletions(parsed: ParseResult, offset: number): CompletionItem[]
```

Merges in-scope bindings from `resolveScopeAt` with `BUILTIN_FUNCTIONS`, `BUILTIN_METHODS`, and `KEYWORDS`. An empty or new file returns built-ins and keywords only, with no bindings. A recovery region contributes whatever bindings survive parsing, plus every built-in and keyword.

```typescript
interface CompletionItem {
  readonly label: string;
  readonly kind: CompletionKind;
  readonly detail?: string | undefined;
}

type CompletionKind = 'variable' | 'function' | 'keyword';
```

## `/rules` Exports

### `createDefaultConfig`

```typescript
function createDefaultConfig(): CheckConfig
```

Pure function. Returns a `CheckConfig` with all 40 registered rules set to `'on'` at each rule's own default severity, and `checkerMode` left undefined.

### `validateConfig`

```typescript
function validateConfig(config: CheckConfig): ValidationError[] | null
```

Pure function. Validates a `CheckConfig` and returns an array of `ValidationError` on failure, or `null` on success. Never throws.

### `validateRuleCodes`

```typescript
function validateRuleCodes(codes: readonly string[]): ValidationError[] | null
```

Pure function. Validates each code in `codes` against the 40 codes in `RULES`, returning a `ValidationError` with `code: 'UNKNOWN_RULE_CODE'` for each unrecognized entry, or `null` when every code is known.

```typescript
interface ValidationError {
  readonly code: string;
  readonly message: string;
  readonly ruleCode?: string | undefined;
}
```

### `runRules`

```typescript
function runRules(
  parsed: ParseResult,
  source: string,
  config: CheckConfig,
  rules?: readonly Rule[]
): Diagnostic[]
```

Runs the 40-rule static checker over `parsed.ast` in two linear passes: a bottom-up fact-collection pass, then a top-down rule-dispatch pass. Total node visits equal 2n, independent of nesting depth, and no rule re-walks a subtree. `source` is required because formatting rules, the naming-convention fix, and diagnostic context lines all read the raw source text. The optional fourth `rules` parameter defaults to the shared `RULES` registry; pass a subset for testing or a custom rule set. The fact-collection pass populates a capture tracker and the `assertedHostCalls` set once, shared across every rule in the dispatch pass. Diagnostics are returned sorted by line, then column. `runRules` owns final severity resolution, applying each rule's `on`/`off`/`warn` state and then `config.severity` as a global override. Tolerates recovery nodes without throwing. A single rule that throws is isolated: its contribution is skipped and every other rule still reports. Measures a p95 near 35 milliseconds on a 2,000-line document on typical developer hardware, roughly 5x the single-pass providers. It runs 40 rules across two passes, not a separate walk per rule. The wider 250 ms ceiling in `latency.test.ts` is a shared-CI-runner flake guard, not a latency claim.

```typescript
interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly location: SourceLocation;
  readonly context: string;
  readonly fix: DiagnosticFix | null;
}

type DiagnosticSeverity = 'error' | 'warning' | 'info';

interface DiagnosticFix {
  readonly description: string;
  readonly applicable: boolean;
  readonly range: SourceSpan;
  readonly replacement: string;
}
```

Only the `NAMING_SNAKE_CASE` and `UNNECESSARY_ASSERTION` rules ever produce a non-null `fix`.

```typescript
interface CheckConfig {
  readonly rules: Record<string, RuleState>;
  readonly checkerMode?: 'strict' | 'permissive' | undefined;
  readonly severity?: DiagnosticSeverity | undefined;
}

type RuleState = 'on' | 'off' | 'warn';
```

### `RULES`

```typescript
const RULES: readonly Rule[]
```

Frozen registry of all 40 built-in rules. Importing `/rules` triggers each rule module's self-registration before `RULES` is snapshotted and frozen. Registry order carries no consumer-visible meaning; `runRules` sorts diagnostics independently by location.

```typescript
interface Rule {
  readonly code: string;
  readonly nodeTypes: readonly NodeType[];
  readonly defaultSeverity: DiagnosticSeverity;
  validate(node: ASTNode, context: RuleContext): Diagnostic[];
}
```

`RuleContext` (the second argument to `Rule.validate`) is also exported from `/rules` for consumers writing custom rules:

```typescript
interface RuleContext {
  readonly source: string;
  readonly variables: Map<string, SourceLocation>;
  readonly variableScopes: Map<string, ASTNode | null>;
  readonly scopeStack: ASTNode[];
  readonly assertedHostCalls: Set<ASTNode>;
  readonly checkerMode?: 'strict' | 'permissive' | undefined;
}
```

## See Also

- [Host API Reference](ref-host-api.md): Complete TypeScript API exports for the core runtime
- [Host Integration](integration-host.md): Embedding guide and runtime configuration
- [Host API Types](ref-host-api-types.md): TypeStructure, TypeDefinition, TypeProtocol exports
