import { MountValidationError, NamespaceCollisionError } from './errors.js';
import type { ExtensionManifest, ResolvedMount } from './types.js';

// ============================================================
// MOUNT PATH VALIDATION
// ============================================================

const SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateMountPath(mountPath: string): void {
  if (!mountPath) {
    throw new MountValidationError(`Invalid segment:  in ${mountPath}`);
  }
  const segments = mountPath.split('.');
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new MountValidationError(
        `Invalid segment: ${segment} in ${mountPath}`
      );
    }
  }
}

// ============================================================
// SPECIFIER PARSING
// ============================================================

function parseSpecifier(raw: string): {
  packageSpecifier: string;
  versionConstraint: string | undefined;
} {
  // Local paths have no version constraint
  if (raw.startsWith('./') || raw.startsWith('../')) {
    return { packageSpecifier: raw, versionConstraint: undefined };
  }

  // Scoped packages: @scope/name or @scope/name@version
  if (raw.startsWith('@')) {
    // Find the last '@' after position 1 (skip the leading scope '@')
    const lastAt = raw.lastIndexOf('@', raw.length - 1);
    if (lastAt > 0 && lastAt < raw.length - 1) {
      return {
        packageSpecifier: raw.slice(0, lastAt),
        versionConstraint: raw.slice(lastAt + 1),
      };
    }
    return { packageSpecifier: raw, versionConstraint: undefined };
  }

  // Unscoped packages: name or name@version
  const atIndex = raw.indexOf('@');
  if (atIndex > 0 && atIndex < raw.length - 1) {
    return {
      packageSpecifier: raw.slice(0, atIndex),
      versionConstraint: raw.slice(atIndex + 1),
    };
  }

  return { packageSpecifier: raw, versionConstraint: undefined };
}

// ============================================================
// RESOLVE MOUNTS
// ============================================================

export function resolveMounts(mounts: Record<string, string>): ResolvedMount[] {
  const resolved: ResolvedMount[] = [];

  // Track version constraints per package specifier for conflict detection
  const versionsBySpecifier = new Map<string, string | undefined>();

  for (const [mountPath, rawSpecifier] of Object.entries(mounts)) {
    validateMountPath(mountPath);

    const { packageSpecifier, versionConstraint } =
      parseSpecifier(rawSpecifier);

    // Detect conflicting versions for the same package
    if (versionsBySpecifier.has(packageSpecifier)) {
      const existing = versionsBySpecifier.get(packageSpecifier);
      if (existing !== versionConstraint) {
        const v1 = existing ?? 'unspecified';
        const v2 = versionConstraint ?? 'unspecified';
        throw new MountValidationError(
          `Package ${packageSpecifier} has conflicting versions: ${v1} vs ${v2}`
        );
      }
    } else {
      versionsBySpecifier.set(packageSpecifier, versionConstraint);
    }

    const mount: ResolvedMount =
      versionConstraint !== undefined
        ? { mountPath, packageSpecifier, versionConstraint }
        : { mountPath, packageSpecifier };
    resolved.push(mount);
  }

  return resolved;
}

// ============================================================
// DETECT NAMESPACE COLLISIONS
// ============================================================

export function detectNamespaceCollisions(
  manifests: ReadonlyMap<string, ExtensionManifest>,
  mounts: ResolvedMount[]
): void {
  // Build a map from mountPath -> packageSpecifier for O(1) lookup
  const mountPackage = new Map<string, string>();
  for (const mount of mounts) {
    mountPackage.set(mount.mountPath, mount.packageSpecifier);
  }

  // Build a reverse map from namespace value -> first mountPath that declares it,
  // keyed by owning packageSpecifier. This detects when two different packages
  // declare the same manifest.namespace value.
  const namespaceOwner = new Map<string, { mountPath: string; pkg: string }>();

  for (const [mountPath, manifest] of manifests) {
    const pkg = mountPackage.get(mountPath) ?? mountPath;
    const ns = manifest.namespace;

    if (ns !== undefined) {
      const existing = namespaceOwner.get(ns);
      if (existing !== undefined && existing.pkg !== pkg) {
        throw new NamespaceCollisionError(
          `Namespace ${ns} declared by ${existing.pkg} and ${pkg}`
        );
      }
      if (existing === undefined) {
        namespaceOwner.set(ns, { mountPath, pkg });
      }
    }
  }

  // Check each pair of manifests from different packages for prefix overlap.
  // NOTE: This uses mount paths directly as namespace prefixes. This is valid
  // because per spec (task 1.6), each mount path must start with the manifest's
  // declared namespace, so mount-path prefix overlap implies namespace overlap.
  const mountPaths = Array.from(manifests.keys());

  for (let i = 0; i < mountPaths.length; i++) {
    const pathA = mountPaths[i]!;
    const pkgA = mountPackage.get(pathA) ?? pathA;

    for (let j = i + 1; j < mountPaths.length; j++) {
      const pathB = mountPaths[j]!;
      const pkgB = mountPackage.get(pathB) ?? pathB;

      // Same-package: allowed
      if (pkgA === pkgB) continue;

      // Prefix overlap: a is prefix of b or b is prefix of a
      if (pathB.startsWith(pathA + '.')) {
        throw new NamespaceCollisionError(
          `${pathA} (${pkgA}) is prefix of ${pathB} (${pkgB})`
        );
      }
      if (pathA.startsWith(pathB + '.')) {
        throw new NamespaceCollisionError(
          `${pathB} (${pkgB}) is prefix of ${pathA} (${pkgA})`
        );
      }
    }
  }
}
