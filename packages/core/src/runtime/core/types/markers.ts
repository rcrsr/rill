/**
 * Shared marker interfaces for forward declarations.
 *
 * These interfaces break circular dependencies between values.ts,
 * type-structures.ts, and callable.ts. Actual types are defined in callable.ts.
 */

// Forward declaration - actual callable types defined in callable.ts
// This avoids circular dependency
export interface CallableMarker {
  readonly __type: 'callable';
}

// Forward declaration for field descriptors
export interface FieldDescriptorMarker {
  readonly __rill_field_descriptor: true;
}
