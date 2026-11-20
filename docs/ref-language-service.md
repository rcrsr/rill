# rill Language Service API

*Editor tooling: outline, semantic tokens, formatting, scope resolution, hover, go-to-definition, completion, and a static checker*

`@rcrsr/rill-language-service` ships editor-tooling providers (outline, semantic tokens, formatting, scope resolution, hover, go-to-definition, completion, and a static checker with 62 rule codes) built on `@rcrsr/rill`'s parser and AST. Its version is held exactly equal to `@rcrsr/rill`'s version, character-for-character.

## Subpath Exports

The package splits its surface across three entry points so consumers importing one subpath do not pull in the others. Importing the root or `/scope` never loads the `/rules` engine module.

| Subpath | Exports |
|---------|---------|
| `@rcrsr/rill-language-service` | `documentSymbols`, `semanticTokens`, `formatDocument`, `spanToRange`, `version`, plus `Position`, `Range`, `DocumentSymbol`, `SymbolKind`, `SemanticToken`, `ServiceTokenType`, `TextEdit` |
| `@rcrsr/rill-language-service/scope` | `resolveScopeAt`, `findDefinition`, `getHover`, `getCompletions`, plus `Binding`, `BindingKind`, `HoverInfo`, `CompletionItem`, `CompletionKind` |
| `@rcrsr/rill-language-service/rules` | `createDefaultConfig`, `validateConfig`, `validateRuleCodes`, `runRules`, `RULES`, `capturesInSubtree`, plus `CheckConfig`, `Diagnostic`, `DiagnosticFix`, `DiagnosticSeverity`, `Rule`, `RuleCategory`, `RuleContext`, `RuleState`, `ValidationError`, `AstFacts`, `CaptureEntry`, `ScriptFacts`, `SubtreeFacts` |

---

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

---

## `/scope` Exports

### `resolveScopeAt`

```typescript
function resolveScopeAt(parsed: ParseResult, offset: number): Binding[]
```

Resolves every name in scope at 0-based `offset` and where each is bound. Four binding constructs feed scope: `CaptureNode`, `ClosureParamNode`, `DestructPatternNode`, and dict keys, across four scope kinds: the implicit top-level script root, `Block`, `Closure`, and `GroupedExpr`. A `PassBlock` body opens its own scope, matching the runtime: a capture made inside a `pass` body is not visible after it. Bindings support mutable-outer late binding. A bare `$` is excluded from results. Tolerates recovery nodes; when nothing resolves, returns `[]`.

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

---

## `/rules` Exports

### `createDefaultConfig`

```typescript
function createDefaultConfig(): CheckConfig
```

Pure function. Returns a `CheckConfig` with all registered rules set to `'on'` at each rule's own default severity, and `checkerMode` left undefined.

### `validateConfig`

```typescript
function validateConfig(config: CheckConfig): ValidationError[] | null
```

Pure function. Validates a `CheckConfig` and returns an array of `ValidationError` on failure, or `null` on success. Never throws.

### `validateRuleCodes`

```typescript
function validateRuleCodes(codes: readonly string[]): ValidationError[] | null
```

Pure function. Validates each code in `codes` against every code in `RULES`. Returns a `ValidationError` with `code: 'UNKNOWN_RULE_CODE'` for each unrecognized entry, or `null` when every code is known.

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

Runs the static checker's registered rules over `parsed.ast` in two linear passes. First a bottom-up fact-collection pass, then a top-down rule-dispatch pass. Total node visits equal 2n, independent of nesting depth, and no rule re-walks a subtree. `source` is required because formatting rules, the naming-convention fix, and diagnostic context lines all read the raw source text. The optional fourth `rules` parameter defaults to the shared `RULES` registry; pass a subset for testing or a custom rule set. The fact-collection pass populates a capture tracker and the `assertedHostCalls` set once, shared across every rule in the dispatch pass. Diagnostics are returned sorted by line, then column. `runRules` owns final severity resolution, applying each rule's `on`/`off`/`warn` state and then `config.severity` as a global override. Tolerates recovery nodes without throwing. A single rule that throws is isolated: its contribution is skipped and every other rule still reports. Measures a p95 near 42 milliseconds on a flat 2,000-line document on typical developer hardware, roughly 6x the single-pass providers. It runs every registered rule across two passes, not a separate walk per rule. On flat input the two-pass engine costs about 20% more than the per-rule sub-walks it replaced, because a shallow subtree is cheap to re-walk. On deeply nested input it is 153x faster, because nothing re-walks a subtree at all. The guard in `latency.test.ts` fails when the median of paired `runRules` to parse time ratios exceeds 1.5x, so it tracks the cost relative to parsing rather than an absolute time.

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
  readonly additionalEdits?: readonly DiagnosticEdit[];
}

interface DiagnosticEdit {
  readonly range: SourceSpan;
  readonly replacement: string;
}
```

Only the `NAMING_SNAKE_CASE`, `UNNECESSARY_ASSERTION`, `DECLARED_TYPE_PROBE`, and `SPACING_DECLARATION` rules ever produce a non-null `fix`. `range`/`replacement` is the primary/anchor edit; `additionalEdits`, when present, are disjoint edits accompanying it (e.g. renaming every reference to a declaration renamed by the anchor edit). Appliers must apply every edit — the primary `range`/`replacement` and each `additionalEdits` entry — in descending offset order (last edit first). Otherwise earlier edits shift the offsets of later ones and renames dangle references.

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

Frozen registry of all built-in rules. See [Lint Rules](integration-cli.md#lint-rules) for the full list of rule codes, categories, defaults, and descriptions. Importing `/rules` triggers each rule module's self-registration before `RULES` is snapshotted and frozen. Registry order carries no consumer-visible meaning; `runRules` sorts diagnostics independently by location.

The atom rules read `BUILTIN_ATOMS` and `ERROR_CODES` from `@rcrsr/rill`. `ATOM_CASE_MISMATCH` fires on an atom literal that differs from a builtin atom only by case, such as `#timeout`. `ATOM_NOT_ERROR_CODE` fires on `==`, `!=`, `.eq`, or `.ne` in operator, method, or pipe form between `.!code` and an atom that is neither `#ok` nor in `ERROR_CODES`, since the comparison halts `#TYPE_MISMATCH`. `ATOM_DISCARDED` fires on a statement that is a lone atom and not the last statement of its script or block, or the only statement of a script, which is usually a comment missing its space after `#`. `ON_LIST_SINGLE` fires on `guard` or `retry` with `on: list[#X]` holding one code and suggests `on: #X`.

`CONDITION_TYPE` fires when the condition of a conditional, `while`, `do ... while`, or `assert` is a bare non-boolean literal. The message names the literal's rill type. The runtime halts the same conditions with `RILL-R002`. It performs no type inference and does not flag variables, host calls, method calls, or comparisons.

`TUPLE_ONE_POSITION` fires on `tuple(T)` with one argument in a type position, including nested inside union members and other type arguments. A one-argument tuple type names exactly one position. The message suggests `:tuple` to accept a tuple of any length or `list(T)` for a sequence. It does not flag `tuple` with no arguments, `tuple` with two or more arguments, or a tuple value such as `tuple[1]`.

`EQUALITY_NO_OVERLAP` fires on `==` and `!=`, and on `.eq` and `.ne` in operator or pipe form, between operands of statically known type whose types never overlap, since the comparison halts `#TYPE_MISMATCH`. A known operand is a scalar literal, a collection literal, or `expr:T` with a static type name. A collection literal is judged by its kind alone, with no element or field constraints. It also fires on `.has`, `.has_any`, and `.has_all` when the receiver is a list literal of scalar literals and the sought value, or each candidate, is a scalar literal of another kind. It never reports a mismatch between two dict shapes, and it stays silent on any operand it cannot type statically.

`PIPE_CONVERTS_INNER` fires on a pipe into `list(T)`, `dict(...)`, or `tuple(...)` when the source is statically known and holds scalars of another kind than the target. The message suggests `-> :T` to check without converting. It stays silent on unknowable sources, matching kinds, the `:` form, and non-scalar or bare targets.

`PIPE_ZERO_PARAM_TARGET` fires on a function with no parameters used as a pipe target, since the piped value is an excess argument and the call halts `RILL-R045`. It stays silent on functions with a parameter, on block targets, and on zero-parameter functions that are not pipe targets.

`UNNECESSARY_ASSERTION` fires on an assertion of a string, number, bool, list, tuple, or dict literal to its own bare type. It does not flag an atom or an ordered literal, a parameterized assertion, or a literal asserted to a different type.

`DECLARED_TYPE_PROBE` (info, category `types`) fires when `.^type` is read from a value declared with a union, or with a collection whose element or field type holds one. The read reports the declared type, not the value's own type, so the message suggests `.^effective`. The receiver is a direct `expr:T`, a declaration, a pass-through pipe step, or a variable bound once with a declared type. It stays silent on computed results, element reads, undeclared values, and pipes longer than one step. Its fix replaces the `type` key with `effective`.

`ANY_CAPTURE_LOCK` (error, category `types`) fires on a second capture into a variable first captured with `:any` when the new value has a different type. `:any` locks the variable to the first value's own type, so the re-capture halts `RILL-R001`. The message suggests annotating the first capture with a `union(...)`. It applies in the same or a parent scope. It stays silent on unknown types, a first capture not annotated `any`, a union-declared first value that admits the second, the same type, and sibling scopes. It has no fix. `ScriptFacts` gains a required `captureValueTypes` field that this rule reads, and `declaredTypes` now also records a plain capture of a declared value.

`SPACING_DECLARATION` (info, category `formatting`) fires on a space between a collection keyword and its bracket (`list [1]`) or between a written type and its bracket (`list(number) [1]`), and on anything other than one space between a written type and a scalar or atom value (`string"x"`, `union(#a, #b)   #a`). Each spaced form parses the same as the preferred one, so the rule is the only signal. Its fix removes the space before a bracket or sets the gap to one space.

`MIXED_ELEMENT_TYPE_READ` fires when `.^type` or `.^effective` is read from a list literal of distinct compound shapes, or from the result of iterating a dict literal of distinct value shapes with `seq`, `fan`, `filter`, `acc`, `.values`, or `.entries`. The receiver may be the literal, a pipe from it, or a variable captured once from it. A list holding distinct shapes has a union element type, so the read reports that union, not one shared type. An element read from an undeclared list carries its own type, so `.^type` read on an element inside an iteration body reports that element's type and the rule stays silent there. The message suggests a type check such as `:?list(list)` when only the kind matters. It does not flag lists of uniform shape or any receiver that is not a plain literal.

`TYPE_EXTRA_KEY` fires on a postfix `expr:T` or `expr:?T`, a pipe-form bare `:T` or `:?T`, a typed capture `=> $x:T`, an inline closure pipe target whose first parameter is typed, and a typed closure parameter whose dict default carries keys the type does not name. The source must be a statically known dict or ordered literal, or a variable captured once from one. The message names the extra keys and the halt (`#TYPE_MISMATCH` or `RILL-R001`, or "is false" for the `:?` probe) and suggests naming the key in the type; for a dict it also suggests converting first with `-> T`. It stays silent on union members, list elements, tuple positions, typed `destruct<>` elements, closure return types, stream types, arguments to a named closure call, and host data. `ScriptFacts` gains an additive `dictLiteralVars` field that this rule reads.

`SIGNATURE_BARE_KEY` fires when a `.signature` read is compared with `==`, `!=`, `.eq`, or `.ne` (operator or pipe form) to a non-interpolated string literal that spells a non-identifier key bare. A signature prints such a key quoted, so the comparison is always false (true for `!=`). The message shows the bare and printed spellings and suggests quoting the key in the string. It stays silent on interpolated strings, operands that are not a literal, and a `.signature` read with a default or existence check.

`ENTRIES_PAIR_AS_LIST` fires when an `.entries` pair is treated as a list. An `.entries` result, direct, through pass-through steps, or via a variable captured once from it, checked with `:T`, `expr:T`, `:?T`, or a typed capture against `list(list)` or `list(list(T))`, halts `#TYPE_MISMATCH` because a tuple does not satisfy `list`, except `:?T`, which yields `false`. A pair used with a list-only method or field read (`$.head`, `.tail`) halts `RILL-R003`, and `-> dict` on a pair halts `RILL-R036`. The pair is a bare `$` heading a statement in an `.entries`-fed body (not a `$` rebound by a later pipe step, step argument, or branch), the first parameter of an `.entries`-fed closure, a method-shorthand body such as `seq({ .head })`, or `$d.entries[n]`. The message suggests checking `list(tuple(string, T))` or reading `$pair[0]` and `$pair[1]`. It stays silent on positional reads, destructuring, `seq`, `.len` on the result or on a pair, `.at`, a pair converted with `-> list`, `-> list(list)`, `-> :list`, a nested branch body, lists of lists that do not come from `.entries`, and host data. `ScriptFacts` gains additive `declaredTypes`, `entriesVars`, and `entriesBodies` fields that this rule and the dispatch rules read.

`DISPATCH_SELECTOR_NOT_STRING` fires when a value that is only numbers, bools, or atoms enters a dict dispatch table, either a `-> dict[...]` literal or a `-> $table` variable bound once to a dict literal or typed `dict`. The dispatch halts `#TYPE_MISMATCH` before any lookup, even when the table carries a `??` default. The message names the selector type and suggests converting first with `-> string`. It stays silent on a string or unknown selector, and on ordered, list, and tuple targets, which are not dict dispatch.

`DISPATCH_MISSING_MEMBER` fires when a union of string literals enters a dict dispatch table with no key for some member, so that member halts `RILL-R009`. The message names the missing members and the halt id. It stays silent when the table has a default, when any key is dynamic, spread, or computed, and when the selector is not a union of string literals.

`COLLECTION_ARITY` fires on a `seq`, `fan`, `filter`, `sort`, `start_when`, `stop_when`, `iterate`, or `chain` call whose function argument does not take exactly one argument, and on a `fold` or `acc` call whose function does not take exactly two. A block argument counts the unnamed params it reads; an `fn` literal counts its declared params. Too few params halts `RILL-R045`; a surplus required param halts `RILL-R044`. The rule has `error` severity in the `collections` category. It stays silent when the argument is neither a block nor an `fn` literal.

`BLOCK_CAPTURE` fires on a bare block captured into a variable, as in `{ 5 } => $x`. The block runs where it is written and `$x` holds its result, not a function. The message names both fixes: write `fn { ... }` to store a function, or drop the braces to bind the result. It also fires on a call `$x()` when `$x` was captured once from such a block and the block's last statement provably yields no function: a scalar literal, arithmetic, logic, a comparison, an interpolated string, or a collection literal. A block that ends in a call, a variable, or a piped chain may yield a function, as in `{ $app.make() } => $f`, so a call on its capture stays silent. The rule has `warning` severity in the `closures` category. It stays silent on `fn` literals and on blocks that are arguments, branches, or collection entries, and on a block that continues the chain, as in `{ 5 } -> { $ + 1 } => $x`.

`DISPATCH_FN_ENTRY` fires when a string literal, or a union of string literals, enters a dict dispatch table and a selected entry is an `fn` literal. Dispatch returns a selected function uncalled, so the entry never runs; the message suggests writing a bare block to have dispatch run it, or calling the result. The rule has `warning` severity in the `conditionals` category. It stays silent on list targets selected by a numeric index.

`DICT_KEY_SPELLING` fires on each dict literal, ordered literal, or dispatch table entry whose key is a bare number or bool. A dict key is always a string, so `dict[1: "n"]` stores the key `"1"`. The message shows the stored string and suggests quoting the key to write that spelling directly. It also fires on each number or bool element of a multi-key list key, once per element, because `dict[[0.50, 2]: "a"]` halts RILL-R002; the message tells you to quote the element. It stays silent on identifier, quoted, and computed keys.

`FOLD_INTERMEDIATES` fires on an adjacent `acc(...) -> .tail` pair. The running-totals list is built for every step, then thrown away except for the last element. `fold(...)` computes the same final value directly. Only adjacent operator-consumer pairs in one pipe chain are recognized. The capture-then-subscript form (`acc(...) => $t` followed later by `$t[-1]`) needs whole-script analysis and stays silent.

`THROWAWAY_CAPTURE` fires when a top-level capture is never referenced, or referenced exactly once away from its capture site. A single use on the statement immediately following the capture is not "away from its capture". That adjacent-head shape belongs to `CAPTURE_INLINE_CHAIN` instead.

`AVOID_REASSIGNMENT` and `LOOP_OUTER_CAPTURE` open a scope for a closure body, a loop body, a `pass` body, a `timeout<>` body, a `guard` body, a `retry<>` body, and each `{ }` branch of a conditional. Reassigning an outer variable inside one of these bodies is flagged, matching the runtime halt `RILL-R001`, which `guard` and `retry` catch and so hide; reusing a body-local name afterwards or in a sibling body is not. A brace-less conditional branch and a grouped expression open no checker scope. `LOOP_OUTER_CAPTURE` fires only for `seq`, `fan`, `fold`, `filter`, `acc`, `while`, and `do-while` bodies, not `pass`, `timeout<>`, `guard`, `retry<>`, or conditional branches.

```typescript
interface Rule {
  readonly code: string;
  readonly nodeTypes: readonly NodeType[];
  readonly defaultSeverity: DiagnosticSeverity;
  readonly category: RuleCategory;
  validate(node: ASTNode, context: RuleContext): Diagnostic[];
}

type RuleCategory =
  | 'naming'
  | 'flow'
  | 'collections'
  | 'loops'
  | 'conditionals'
  | 'closures'
  | 'types'
  | 'strings'
  | 'errors'
  | 'formatting'
  | 'anti-patterns';
```

Every rule in `RULES` carries a `category`. Custom rules must supply one of the 11 values above.

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

`scopeStack` holds the enclosing closures, loop-body blocks, and `pass` bodies, innermost last.

---

## See Also

- [Host API Reference](ref-host-api.md): Complete TypeScript API exports for the core runtime
- [Host Integration](integration-host.md): Embedding guide and runtime configuration
- [Host API Types](ref-host-api-types.md): TypeStructure, TypeDefinition, TypeProtocol exports
