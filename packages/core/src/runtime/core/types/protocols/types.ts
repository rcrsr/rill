/**
 * Shared Protocol Type Definitions
 *
 * `TypeProtocol` and `TypeDefinition` live here so that per-type protocol
 * modules can depend on them without importing from ../registrations.js,
 * which would create a circular dependency.
 */

import type { RillValue, TypeStructure } from '../structures.js';
import type { RillFunction } from '../../callable.js';

/** Protocol functions that define per-type behavior. */
export interface TypeProtocol {
  format: (v: RillValue) => string;
  structure?: ((v: RillValue) => TypeStructure) | undefined;
  eq?: ((a: RillValue, b: RillValue) => boolean) | undefined;
  compare?: ((a: RillValue, b: RillValue) => number) | undefined;
  convertTo?: Record<string, (v: RillValue) => RillValue> | undefined;
  serialize?: ((v: RillValue) => unknown) | undefined;
  deserialize?: ((data: unknown) => RillValue) | undefined;
}

/** A single type registration record. One per built-in type. */
export interface TypeDefinition {
  name: string;
  identity: (v: RillValue) => boolean;
  isLeaf: boolean;
  immutable: boolean;
  methods: Record<string, RillFunction>;
  protocol: TypeProtocol;
}
