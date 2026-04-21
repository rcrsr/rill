# rill Host API Types Reference

*TypeStructure, TypeDefinition, TypeProtocol, and structural type system exports*

## RillFieldDef

`RillFieldDef` describes a single field within a compound type. All four compound collection types use `RillFieldDef` to represent their element or field definitions.

```typescript
interface RillFieldDef {
  name?: string;
  type: TypeStructure;
  defaultValue?: RillValue;
  annotations?: Record<string, RillValue>;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | No | Field name. Present for dict, ordered, and closure params. Absent for positional tuple elements |
| `type` | `TypeStructure` | Yes | Structural type of this field or element |
| `defaultValue` | `RillValue` | No | Default value when the field is omitted. `undefined` = field is required. Detect presence with `field.defaultValue !== undefined` |
| `annotations` | `Record<string, RillValue>` | No | Evaluated annotation values keyed by annotation name. Property is absent when no annotations are declared |

See [TypeStructure](#typestructure) for field access patterns per collection type.

---

## TypeStructure

`TypeStructure` is a discriminated union that describes the structural shape of any rill value. The runtime uses it for type checking, type inference, and formatting.

```typescript
type TypeStructure =
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'bool' }
  | { kind: 'datetime' }
  | { kind: 'duration' }
  | { kind: 'list'; element?: TypeStructure }
  | { kind: 'dict'; fields?: Record<string, RillFieldDef>; valueType?: TypeStructure }
  | { kind: 'tuple'; elements?: RillFieldDef[]; valueType?: TypeStructure }
  | { kind: 'ordered'; fields?: RillFieldDef[] }
  | { kind: 'vector'; dimensions: number }
  | { kind: 'closure'; params?: RillFieldDef[]; ret?: TypeStructure }
  | { kind: 'type'; typeName: string }
  | { kind: 'union'; types: TypeStructure[] }
  | { kind: 'stream'; chunk?: TypeStructure; ret?: TypeStructure }
  | { kind: 'any' }
  | { kind: string; data?: unknown }; // catch-all for types without parameterized structure
```

The `kind` field is the discriminator. Leaf variants (`number`, `string`, `bool`, `datetime`, `duration`, `any`) carry no sub-fields. Compound variants carry their structural sub-fields.

### Field Constraints

| Variant | Field | Type | Semantics |
|---------|-------|------|-----------|
| `datetime` | N/A | N/A | Leaf variant. No sub-fields |
| `duration` | N/A | N/A | Leaf variant. No sub-fields |
| `list` | `element` | `TypeStructure \| undefined` | Element type for all list members. Absent when element type is unknown |
| `dict` | `fields` | `Record<string, RillFieldDef> \| undefined` | Named fields with individual types and optional annotations. Present for structural dicts |
| `dict` | `valueType` | `TypeStructure \| undefined` | Value type for all dict values. Present for uniform dicts. No per-field annotations |
| `tuple` | `elements` | `RillFieldDef[] \| undefined` | Ordered positional fields. Index access: `type.elements[i]` |
| `ordered` | `fields` | `RillFieldDef[] \| undefined` | Named ordered fields. Index access: `type.fields[i]`. Present for structural ordered types |
| `ordered` | `valueType` | `TypeStructure \| undefined` | Value type for all ordered values. Present for uniform ordered types |
| `vector` | `dimensions` | `number` | Embedding dimension count |
| `type` | `typeName` | `string` | Name of the registered host type |
| `union` | `types` | `TypeStructure[]` | Non-empty array of member types |
| `closure` | `params` | `RillFieldDef[] \| undefined` | Parameter definitions. Absent when closure is untyped |
| `closure` | `ret` | `TypeStructure \| undefined` | Return type. Absent when return type is unspecified |
| `stream` | `chunk` | `TypeStructure \| undefined` | Optional structural type of each chunk value |
| `stream` | `ret` | `TypeStructure \| undefined` | Optional structural type of the resolved return value |

### Annotation Access Patterns

Host applications read field annotations through the `annotations` property on `RillFieldDef`. The property is optional: absent when no annotations are declared. When present, it is a plain object, never `null`.

| Container | TypeStructure path | Type |
|-----------|-------------------|------|
| `dict` (structural) | `type.fields[fieldName].annotations` | `Record<string, RillValue> \| undefined` |
| `ordered` | `type.fields[index].annotations` | `Record<string, RillValue> \| undefined` |
| `tuple` | `type.elements[index].annotations` | `Record<string, RillValue> \| undefined` |
| `closure` | `type.params[index].annotations` | `Record<string, RillValue> \| undefined` |

Uniform dicts (`dict(string)`) carry no `fields` record and have no per-field annotations.

```typescript
// Reading annotations from a structural dict field
function getFieldDescription(
  type: TypeStructure & { kind: 'dict'; fields: Record<string, RillFieldDef> },
  fieldName: string
): string | undefined {
  const field = type.fields[fieldName];
  if (!field?.annotations) return undefined;
  const desc = field.annotations['description'];
  return typeof desc === 'string' ? desc : undefined;
}
```

### Host Interop Shapes (`toNativeValue`)

`toNativeValue()` converts opaque rill types to plain JavaScript objects. Datetime and duration produce these shapes:

| Type | Native Shape | Fields |
|------|-------------|--------|
| `datetime` | `{ unix: number, iso: string }` | `unix`: UTC ms since epoch. `iso`: ISO 8601 string |
| `duration` | `{ months: number, ms: number }` | `months`: calendar month count. `ms`: fixed milliseconds |

### Exports

```typescript
// Structural type system
export type { TypeStructure, RillFieldDef, RillFieldDescriptor };
export {
  inferStructure,
  inferElementType,
  commonType,
  structureEquals,
  structureMatches,
  formatStructure,
  buildFieldDescriptor,
  paramsToStructuralType,
  structureToTypeValue,
  serializeValue,
  copyValue,
  deserializeValue,
  isIterator,
};

// Error atom registry
export { registerErrorCode, resolveAtom, atomName };
export type { RillAtom, RillStatus, InvalidateMeta, InvalidMeta, TraceFrame };
export type { ExtensionFactoryCtx };

// Halt formatting
export { formatHalt };
```

### `inferStructure`

```typescript
inferStructure(value: RillValue): TypeStructure
```

Returns the structural type descriptor for any rill value. Primitive values return leaf variants. Compound values return their respective variants with sub-fields populated from the value's actual structure. Callable values return `{ kind: 'closure' }`.

Pure function. Result is a frozen object.

### `inferElementType`

```typescript
inferElementType(elements: RillValue[]): TypeStructure
```

Infers the element type for a list by folding element types left-to-right using `commonType`. Starts with the first element's type and folds each subsequent element's type via `commonType`. When `commonType` returns `null`, throws `RILL-R002`.

| Input | Result |
|-------|--------|
| Empty array | `{ kind: 'any' }` |
| Uniform-type array | Structural type of the common element |
| Same-compound elements with differing sub-structure | Bare compound type (e.g., `{ kind: 'list' }`) |
| Mixed top-level types | Throws `RILL-R002` |

### `commonType`

```typescript
commonType(a: TypeStructure, b: TypeStructure): TypeStructure | null
```

Returns the most specific shared type for two `TypeStructure` values. Used inside `inferElementType` to fold element types.

Cascade order:

| Step | Condition | Result |
|------|-----------|--------|
| Any-narrowing | Either input is `{ kind: 'any' }` | The concrete (non-any) type |
| Structural match | `structureEquals(a, b)` is true | `a` |
| Bare type fallback | Same compound `kind` but structurally unequal | Bare compound type with sub-fields omitted (e.g., `{ kind: 'list' }`) |
| Incompatible | Top-level `kind` values differ | `null` (caller raises `RILL-R002`) |

Pure function, no side effects.

### `structureEquals`

```typescript
structureEquals(a: TypeStructure, b: TypeStructure): boolean
```

Compares two structural types for deep structural equality. Switches on the `kind` discriminator. Leaf variants compare by `kind` alone. Compound variants compare sub-fields recursively.

Pure function. Variants with different `kind` values always return `false`.

### `structureMatches`

```typescript
structureMatches(value: RillValue, type: TypeStructure): boolean
```

Checks if a value matches a structural type descriptor. Used by the `:?` runtime type check operator.

| Type descriptor | Matching behavior |
|-----------------|-------------------|
| `{ kind: 'any' }` | Matches all values |
| Compound variant | Deep structural match against sub-fields |

**Closure parameter default compatibility:**

| Value param `defaultValue` | Type param `defaultValue` | Result |
|---------------------------|--------------------------|--------|
| Present | Absent | `true` (superset satisfies) |
| Absent | Present | `false` (missing contract) |
| Present | Present | `true` if values are deeply equal |
| Absent | Absent | `true` |

Pure function.

### `formatStructure`

```typescript
formatStructure(type: TypeStructure): string
```

Formats a structural type descriptor as a human-readable string.

| Input | Output |
|-------|--------|
| `{ kind: 'number' }` | `"number"` |
| `{ kind: 'string' }` | `"string"` |
| `{ kind: 'bool' }` | `"bool"` |
| `{ kind: 'any' }` | `"any"` |
| `{ kind: 'list', element: { kind: 'number' } }` | `"list(number)"` |
| `{ kind: 'dict', valueType: { kind: 'string' } }` | `"dict(string)"` |
| `{ kind: 'closure', params: [{ name: 'x', type: { kind: 'number' } }] }` | `"closure"` |
| `{ kind: 'tuple', elements: [{ name: 'x', type: { kind: 'number' } }] }` | `"tuple(x: number)"` |

### `buildFieldDescriptor`

```typescript
buildFieldDescriptor(
  structuralType: TypeStructure & { kind: 'dict' },
  fieldName: string,
  location: SourceLocation
): RillFieldDescriptor
```

Builds a frozen `RillFieldDescriptor` for a named field within a structural dict type.

`structuralType` must narrow to `{ kind: 'dict' }` at the call site. The field must exist in `valueType` or `RILL-R003` is thrown.

### RillFieldDescriptor

`RillFieldDescriptor` carries the full `RillFieldDef` for a specific named field. The runtime produces descriptors when evaluating field-access expressions on typed dicts.

```typescript
interface RillFieldDescriptor {
  readonly __rill_field_descriptor: true;
  readonly fieldName: string;
  readonly fieldType: RillFieldDef;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `__rill_field_descriptor` | `true` | Brand field. Distinguishes descriptors from plain dicts |
| `fieldName` | `string` | Name of the accessed field |
| `fieldType` | `RillFieldDef` | Full field definition including type and optional default |

### `paramsToStructuralType`

```typescript
paramsToStructuralType(params: RillParam[]): TypeStructure
```

Builds a `TypeStructure` closure variant from a parameter list. Return type is always `{ kind: 'any' }`. Result is a frozen object.

| Param shape | Maps to |
|-------------|---------|
| `param.type` defined | The `TypeStructure` from `param.type` |
| `param.type` undefined | `{ kind: 'any' }` |

### `structureToTypeValue`

```typescript
structureToTypeValue(type: TypeStructure): RillTypeValue
```

Converts a `TypeStructure` descriptor into the `RillTypeValue` runtime representation used in `RillFunction.returnType` and `RillParam.type` fields.

```typescript
import { structureToTypeValue } from '@rcrsr/rill';

const fn: RillFunction = {
  params: [{ name: 'text', type: { kind: 'string' } }],
  fn: (args) => args.text,
  returnType: structureToTypeValue({ kind: 'string' }),
};
```

### `serializeValue`

```typescript
serializeValue(value: RillValue): unknown
```

Converts a rill value to a JSON-serializable representation. Delegates to `TypeProtocol.serialize` for host types when registered. Primitive and built-in compound types produce plain JS values.

### `deserializeValue`

```typescript
deserializeValue(data: unknown, typeName: string): RillValue
```

Restores a runtime value from serialized data. Looks up the named type's `TypeProtocol.deserialize` function and applies it to `data`. Throws if the type is not registered or the protocol has no `deserialize` implementation.

### `copyValue`

```typescript
copyValue(value: RillValue): RillValue
```

Produces a deep copy of any rill value. Used internally for default value hydration and value isolation. Delegates to `TypeProtocol` for host types when registered.

### `isIterator`

```typescript
isIterator(value: RillValue): boolean
```

Returns `true` when `value` is a lazy rill iterator (produced by `range`, `repeat`, or similar). Use this to guard code that must not consume a sequence prematurely.

---

## ExtensionFactoryCtx

`ExtensionFactoryCtx` is the factory-phase context passed as the second argument to async extension factories.

```typescript
interface ExtensionFactoryCtx {
  registerErrorCode(name: string, kind: string): void;
  readonly signal: AbortSignal;
}
```

| Member | Description |
|--------|-------------|
| `registerErrorCode` | Registers a domain atom by name and kind. Atoms become available as `#NAME` literals in scripts. |
| `signal` | Fires when the runtime disposes before the factory completes. |

See [Host API Reference](ref-host-api.md#factory-scope-context-extensionfactoryctx) for usage examples.

---

## InvalidateMeta

`InvalidateMeta` is the metadata descriptor passed to `ctx.invalidate` and returned by the `detector` in `ctx.catch`.

```typescript
interface InvalidateMeta {
  readonly code: string;
  readonly provider: string;
  raw?: Record<string, unknown>;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | `string` | Registered atom name (e.g. `"TIMEOUT"`). Unregistered names resolve to `#R001`. |
| `provider` | `string` | Origin identifier for the failure (e.g. the extension name). |
| `raw` | `Record<string, unknown>` | Optional provider-specific payload. A `message` key populates the display message. |

---

## InvalidMeta

`InvalidMeta` is the alias used by the `detector` callback in `ctx.catch`. It is identical to `InvalidateMeta`.

```typescript
type InvalidMeta = InvalidateMeta;
```

---

## RillAtom

`RillAtom` is the opaque interned handle for a registered atom. The runtime creates handles exclusively via the atom registry.

```typescript
interface RillAtom {
  readonly __rill_atom: true;
  readonly name: string;
  readonly kind: string;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Bare uppercase atom name without the `#` sigil (e.g. `"TIMEOUT"`) |
| `kind` | `string` | Classification tag supplied at registration (e.g. `"network"`, `"domain"`) |

Use `atomName(atom)` to retrieve the name string. Use `resolveAtom(name)` to look up a handle by name.

```typescript
import { resolveAtom, atomName } from '@rcrsr/rill';

const atom = resolveAtom('TIMEOUT');
atomName(atom);  // "TIMEOUT"
```

---

## RillStatus

`RillStatus` is the fixed-shape metadata sidecar attached to every `RillValue`. Valid values share one frozen empty-status singleton. Invalid values carry a populated clone.

```typescript
interface RillStatus {
  readonly code: RillAtom;
  readonly message: string;
  readonly provider: string;
  readonly raw: Readonly<Record<string, RillValue>>;
  readonly trace: ReadonlyArray<TraceFrame>;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | `RillAtom` | Atom identity. `#ok` means valid; any other atom means invalid. |
| `message` | `string` | Human-readable description. `""` on valid values. |
| `provider` | `string` | Origin identifier. `""` on valid values. |
| `raw` | `Record<string, RillValue>` | Provider-specific payload bag. Frozen empty object on valid values. |
| `trace` | `ReadonlyArray<TraceFrame>` | Append-only trace chain. Empty on valid values. |

---

## TraceFrame

`TraceFrame` is one entry in the append-only trace chain on an invalid value. Frames record origin first, latest last.

```typescript
interface TraceFrame {
  readonly site: string;
  readonly kind: 'host' | 'type' | 'access' | 'guard-caught' | 'guard-rethrow' | 'wrap';
  readonly fn: string;
  readonly wrapped: Readonly<Record<string, RillValue>>;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `site` | `string` | Source location in `file.rill:line[:col]` form. `""` when location is unavailable. |
| `kind` | `TraceKind` | One of the 6 normative kinds below. |
| `fn` | `string` | Host function name, operator, or type op. `""` when not applicable. |
| `wrapped` | `Record<string, RillValue>` | Prior status dict on `wrap` frames. `{}` on all other kinds. |

**Kind values:**

| Kind | Appended when |
|------|---------------|
| `host` | Extension calls `ctx.invalidate`. First frame. |
| `type` | Type assertion or conversion fails. |
| `access` | Invalid value is accessed via pipe, method, or encode. |
| `guard-caught` | A `guard` block catches the halt. |
| `guard-rethrow` | A caught invalid value is re-accessed and halts again. |
| `wrap` | `error "..."` wraps an invalid value. `wrapped` carries prior status. |

---

## TypeDefinition

`TypeDefinition` is the registration contract for host-provided types. Pass instances to `registerType` when configuring the runtime.

```typescript
interface TypeDefinition {
  name: string;
  identity: (v: RillValue) => boolean;
  isLeaf: boolean;
  immutable: boolean;
  methods: Record<string, RillFunction>;
  protocol: TypeProtocol;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique type name. Appears in error messages and `TypeStructure` descriptors |
| `identity` | `(v: RillValue) => boolean` | Yes | Returns `true` when `v` is an instance of this type |
| `isLeaf` | `boolean` | Yes | `true` = type has no sub-structure. `false` = type may carry fields |
| `immutable` | `boolean` | Yes | `true` = values of this type are immutable after construction |
| `methods` | `Record<string, RillFunction>` | Yes | Method functions accessible via `.methodName` on type instances |
| `protocol` | `TypeProtocol` | Yes | Behavioral protocol for formatting, equality, comparison, and serialization |

```typescript
import type { TypeDefinition, TypeProtocol } from '@rcrsr/rill';

const dateType: TypeDefinition = {
  name: 'date',
  identity: (v) => v instanceof Date,
  isLeaf: true,
  immutable: true,
  methods: {
    format: {
      params: [{ name: 'pattern', type: { kind: 'string' } }],
      fn: (args) => (args.$self as Date).toLocaleDateString(),
      returnType: structureToTypeValue({ kind: 'string' }),
    },
  },
  protocol: {
    format: (v) => (v as Date).toISOString(),
    serialize: (v) => (v as Date).toISOString(),
    deserialize: (data) => new Date(data as string),
  },
};
```

---

## TypeProtocol

`TypeProtocol` defines behavioral contracts for a registered host type. All fields are optional except `format`.

```typescript
interface TypeProtocol {
  format: (v: RillValue) => string;
  structure?: (v: RillValue) => TypeStructure;
  eq?: (a: RillValue, b: RillValue) => boolean;
  compare?: (a: RillValue, b: RillValue) => number;
  convertTo?: Record<string, (v: RillValue) => RillValue>;
  serialize?: (v: RillValue) => unknown;
  deserialize?: (data: unknown) => RillValue;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `format` | `(v: RillValue) => string` | Yes | Returns the display string for a value. Used in `log`, string interpolation, and error messages |
| `structure` | `(v: RillValue) => TypeStructure` | No | Returns the structural descriptor for a value. Absent = type has no parameterized structure |
| `eq` | `(a: RillValue, b: RillValue) => boolean` | No | Equality test. Absent = identity comparison (`===`) |
| `compare` | `(a: RillValue, b: RillValue) => number` | No | Ordering: negative, zero, or positive. Absent = type is unordered; `>` and `<` raise `RILL-R002` |
| `convertTo` | `Record<string, (v: RillValue) => RillValue>` | No | Explicit conversion targets for the `-> type` operator. Keys are target type names |
| `serialize` | `(v: RillValue) => unknown` | No | Converts value to JSON-serializable form. Used by `serializeValue` |
| `deserialize` | `(data: unknown) => RillValue` | No | Restores value from serialized data. Used by `deserializeValue` |

```typescript
import type { TypeProtocol } from '@rcrsr/rill';

const dateProtocol: TypeProtocol = {
  format: (v) => (v as Date).toISOString(),
  eq: (a, b) => (a as Date).getTime() === (b as Date).getTime(),
  compare: (a, b) => (a as Date).getTime() - (b as Date).getTime(),
  serialize: (v) => (v as Date).toISOString(),
  deserialize: (data) => new Date(data as string),
};
```

---

## See Also

- [Host API Reference](ref-host-api.md): Complete TypeScript API for embedding rill
- [Host Integration](integration-host.md): Embedding guide and runtime configuration
- [Extensions](integration-extensions.md): Reusable function packages

---

## Migration: 0.18.0 Renamed Exports

v0.18.0 renames 7 exports in `@rcrsr/rill` to remove the `rill`-prefixed naming convention and align with the `TypeStructure` terminology introduced in v0.17.0. All old names are removed; update imports before upgrading.

### Symbol Mapping Table

| Old Name | New Name | Import Change |
|----------|----------|---------------|
| `RillType` | `TypeStructure` | `import type { TypeStructure } from '@rcrsr/rill'` |
| `formatStructuralType` | `formatStructure` | `import { formatStructure } from '@rcrsr/rill'` |
| `inferStructuralType` | `inferStructure` | `import { inferStructure } from '@rcrsr/rill'` |
| `structuralTypeEquals` | `structureEquals` | `import { structureEquals } from '@rcrsr/rill'` |
| `structuralTypeMatches` | `structureMatches` | `import { structureMatches } from '@rcrsr/rill'` |
| `isRillIterator` | `isIterator` | `import { isIterator } from '@rcrsr/rill'` |
| `rillTypeToTypeValue` | `structureToTypeValue` | `import { structureToTypeValue } from '@rcrsr/rill'` |

### Codemod

No automated codemod is available for this rename. Use find-and-replace across your codebase for each old name. The old names do not exist in v0.18.0; TypeScript will report errors at every import site, making all affected locations visible before runtime.
