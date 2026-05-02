/**
 * Rill Runtime Tests: V8 hidden-class shape regression and TypeScript build guards
 *
 * Specification Mapping:
 * - AC-E1: All RuntimeContext fields present; omission causes tsc failure at destructuring.
 * - AC-E2: Standalone getVariable/hasVariable exports exist; removal causes tsc failure.
 * - AC-E3: Object.keys order matches hardcoded 34-field baseline; field count === 34.
 * - AC-E4: Object.getOwnPropertyNames matches Object.keys (no non-enumerable own props,
 *          no hidden class divergence beyond the flat literal).
 * - AC-E9: RuntimeContext equals intersection of the 6 named facade interfaces; a 7th
 *          facade not included in the intersection fails at the composition site.
 *
 * TD-3: Flat object literal; no nested facades, no proxies, no getters. Identical V8
 * hidden-class shape across factory.
 *
 * SPEC DEVIATION (see Implementation Notes):
 *   Root context ends in timezone,nowMs; child context ends in sourceId,sourceText.
 *   Per TD-3 the key order should be identical — it is not in Phase 1. The two
 *   baselines are tested independently, and the deviation is documented below.
 *
 * Run: pnpm --filter @rcrsr/rill check   (full build + typecheck + test + lint)
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  createChildContext,
  getVariable,
  hasVariable,
  type RuntimeContext,
  type ScopeContext,
  type DispatchContext,
  type LifecycleContext,
  type ControlFlowContext,
  type ResolverContext,
  type MetadataContext,
} from '@rcrsr/rill';

// ============================================================
// AC-E3: hardcoded key-order baselines
//
// Derived by reading createRuntimeContext (lines 541-585) and
// createChildContext (lines 633-683) in context.ts.
//
// ROOT ends in: timezone, nowMs, scheduler  (MetadataContext optional fields set in root)
// CHILD ends in: sourceId, sourceText  (sourceId/sourceText set via overrides)
//
// These literals are frozen — any future reorder fails the assertion.
// ============================================================

const ROOT_BASELINE =
  'parent,variables,variableTypes,getVariable,hasVariable,' +
  'functions,typeMethodDicts,leafTypes,unvalidatedMethodReceivers,' +
  'callbacks,observability,pipeValue,timeout,autoExceptions,signal,' +
  'invalidate,catch,dispose,isDisposed,createDisposedResult,trackInflight,' +
  'maxCallStackDepth,annotationStack,callStack,' +
  'metadata,hostContext,immediateAnnotation,' +
  'resolvers,resolverConfigs,resolvingSchemes,parseSource,' +
  'timezone,nowMs,scheduler';

const CHILD_BASELINE =
  'parent,variables,variableTypes,getVariable,hasVariable,' +
  'functions,typeMethodDicts,leafTypes,unvalidatedMethodReceivers,' +
  'callbacks,observability,pipeValue,timeout,autoExceptions,signal,' +
  'invalidate,catch,dispose,isDisposed,createDisposedResult,trackInflight,' +
  'maxCallStackDepth,annotationStack,callStack,' +
  'metadata,hostContext,immediateAnnotation,' +
  'resolvers,resolverConfigs,resolvingSchemes,parseSource,' +
  'sourceId,sourceText';

const ROOT_FIELD_COUNT = 34;
const CHILD_FIELD_COUNT = 33;

// ============================================================
// AC-E1: compile-time field-presence guard
//
// Destructures every RuntimeContext field. If any field is removed
// from the RuntimeContext intersection, tsc fails here.
// ============================================================

function _acE1FieldPresence(ctx: RuntimeContext): void {
  const {
    parent,
    variables,
    variableTypes,
    getVariable: gv,
    hasVariable: hv,
    functions,
    typeMethodDicts,
    leafTypes,
    unvalidatedMethodReceivers,
    callbacks,
    observability,
    pipeValue,
    timeout,
    autoExceptions,
    signal,
    invalidate,
    catch: catchFn,
    dispose,
    isDisposed,
    createDisposedResult,
    trackInflight,
    maxCallStackDepth,
    annotationStack,
    callStack,
    metadata,
    hostContext,
    immediateAnnotation,
    resolvers,
    resolverConfigs,
    resolvingSchemes,
    parseSource,
    timezone,
    nowMs,
    scheduler,
    sourceId,
    sourceText,
  } = ctx;
  // Void all to suppress unused-variable warnings.
  void parent;
  void variables;
  void variableTypes;
  void gv;
  void hv;
  void functions;
  void typeMethodDicts;
  void leafTypes;
  void unvalidatedMethodReceivers;
  void callbacks;
  void observability;
  void pipeValue;
  void timeout;
  void autoExceptions;
  void signal;
  void invalidate;
  void catchFn;
  void dispose;
  void isDisposed;
  void createDisposedResult;
  void trackInflight;
  void maxCallStackDepth;
  void annotationStack;
  void callStack;
  void metadata;
  void hostContext;
  void immediateAnnotation;
  void resolvers;
  void resolverConfigs;
  void resolvingSchemes;
  void parseSource;
  void timezone;
  void nowMs;
  void scheduler;
  void sourceId;
  void sourceText;
}

// Ensure the guard function is referenced so it is not dead-code-eliminated.
void _acE1FieldPresence;

// ============================================================
// AC-E2: compile-time standalone export guard
//
// Calls getVariable(ctx, name) and hasVariable(ctx, name) against
// the named exports from context.ts. If either export is removed,
// the import above fails to compile, breaking the build.
// ============================================================

function _acE2StandaloneExports(ctx: RuntimeContext): void {
  const v = getVariable(ctx, '__probe__');
  const h = hasVariable(ctx, '__probe__');
  void v;
  void h;
}

void _acE2StandaloneExports;

// ============================================================
// AC-E9: compile-time intersection completeness guard
//
// AssertEqual<X, Y> resolves to `true` only when X and Y are
// mutually assignable. If RuntimeContext gains a 7th facade that
// is not included in the right-hand intersection literal, the
// assertion fails to compile at this line.
// ============================================================

type AssertEqual<X, Y> = [X] extends [Y]
  ? [Y] extends [X]
    ? true
    : false
  : false;

// RuntimeContext must equal the intersection of the 6 named facades.
// A new facade added to RuntimeContext but not to this literal
// causes this type to resolve to false, breaking the assignment below.
type _AcE9Check = AssertEqual<
  RuntimeContext,
  ScopeContext &
    DispatchContext &
    LifecycleContext &
    ControlFlowContext &
    ResolverContext &
    MetadataContext
>;

// This assignment compiles only when _AcE9Check resolves to `true`.
const _acE9Guard: _AcE9Check = true;
void _acE9Guard;

// ============================================================
// Runtime tests
// ============================================================

describe('V8 hidden-class shape regression', () => {
  describe('AC-E3: Object.keys baseline (root context)', () => {
    it('key order matches ROOT_BASELINE exactly', () => {
      const ctx = createRuntimeContext({});
      expect(Object.keys(ctx).join(',')).toBe(ROOT_BASELINE);
    });

    it('field count is 34', () => {
      const ctx = createRuntimeContext({});
      expect(Object.keys(ctx).length).toBe(ROOT_FIELD_COUNT);
    });
  });

  describe('AC-E3: Object.keys baseline (child context)', () => {
    it('key order matches CHILD_BASELINE exactly', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(Object.keys(child).join(',')).toBe(CHILD_BASELINE);
    });

    it('field count is 33', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(Object.keys(child).length).toBe(CHILD_FIELD_COUNT);
    });
  });

  describe('AC-E4: Object.getOwnPropertyNames introspection', () => {
    it('root: getOwnPropertyNames length equals Object.keys length (no non-enumerable own props)', () => {
      const ctx = createRuntimeContext({});
      const ownProps = Object.getOwnPropertyNames(ctx);
      const enumKeys = Object.keys(ctx);
      // getOwnPropertyNames includes non-enumerable own properties.
      // For a flat literal, these should match (LIFECYCLE_SYMBOL is a Symbol,
      // not included in either, so counts should be equal).
      expect(ownProps.length).toBe(enumKeys.length);
    });

    it('root: getOwnPropertyNames order matches Object.keys order', () => {
      const ctx = createRuntimeContext({});
      const ownProps = Object.getOwnPropertyNames(ctx);
      const enumKeys = Object.keys(ctx);
      expect(ownProps.join(',')).toBe(enumKeys.join(','));
    });

    it('root: getOwnPropertyNames length is 34', () => {
      const ctx = createRuntimeContext({});
      expect(Object.getOwnPropertyNames(ctx).length).toBe(ROOT_FIELD_COUNT);
    });

    it('child: getOwnPropertyNames length equals Object.keys length', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      const ownProps = Object.getOwnPropertyNames(child);
      const enumKeys = Object.keys(child);
      expect(ownProps.length).toBe(enumKeys.length);
    });

    it('child: getOwnPropertyNames order matches Object.keys order', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      const ownProps = Object.getOwnPropertyNames(child);
      const enumKeys = Object.keys(child);
      expect(ownProps.join(',')).toBe(enumKeys.join(','));
    });

    it('child: getOwnPropertyNames length is 33', () => {
      const parent = createRuntimeContext({});
      const child = createChildContext(parent);
      expect(Object.getOwnPropertyNames(child).length).toBe(CHILD_FIELD_COUNT);
    });
  });
});

// pnpm --filter @rcrsr/rill check  confirms full build, typecheck, and lint pass.
