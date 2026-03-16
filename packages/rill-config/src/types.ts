import type { ExtensionManifest, RillValue, SchemeResolver } from '@rcrsr/rill';

export type { ExtensionManifest };

// ============================================================
// CONFIG FILE SHAPE
// ============================================================

export interface RillConfigFile {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly runtime?: string;
  readonly main?: string;
  readonly extensions?: ExtensionsBlock;
  readonly context?: ContextBlock;
  readonly host?: HostBlock;
  readonly modules?: Record<string, string>;
}

export interface ExtensionsBlock {
  readonly mounts: Record<string, string>;
  readonly config?: Record<string, unknown>;
  readonly bindings?: string;
}

export interface ContextBlock {
  readonly schema: Record<string, ContextFieldSchema>;
  readonly values: Record<string, unknown>;
  readonly bindings?: string;
}

export interface ContextFieldSchema {
  readonly type: 'string' | 'number' | 'bool';
}

export interface HostBlock {
  readonly timeout?: number;
  readonly maxCallStackDepth?: number;
  readonly setupTimeout?: number;
}

// ============================================================
// RESOLVED PROJECT TYPES
// ============================================================

export interface ResolvedMount {
  readonly mountPath: string;
  readonly packageSpecifier: string;
  readonly versionConstraint?: string;
}

export interface LoadedProject {
  readonly extTree: Record<string, RillValue>;
  readonly disposes: ReadonlyArray<() => void | Promise<void>>;
  readonly manifests: ReadonlyMap<string, ExtensionManifest>;
}

export interface ResolverConfig {
  readonly resolvers: Record<string, SchemeResolver>;
  readonly configurations: {
    resolvers: Record<string, unknown>;
  };
}

export interface ProjectResult {
  readonly config: RillConfigFile;
  readonly extTree: Record<string, RillValue>;
  readonly disposes: ReadonlyArray<() => void | Promise<void>>;
  readonly resolverConfig: ResolverConfig;
  readonly hostOptions: HostBlock;
  readonly extensionBindings: string;
  readonly contextBindings: string;
}

// ============================================================
// HANDLER INTROSPECTION
// ============================================================

export interface HandlerIntrospection {
  readonly description?: string;
  readonly params: ReadonlyArray<HandlerParam>;
}

export interface HandlerParam {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description?: string;
  readonly defaultValue?: unknown;
}
