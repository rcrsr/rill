/**
 * Extension configuration data and lookup.
 * Maps extension names to npm packages, factory names, and required config fields.
 */

// ============================================================
// TYPES
// ============================================================

/**
 * Configuration metadata for a rill extension.
 */
export interface ExtensionConfig {
  /** Extension name (lowercase) */
  readonly name: string;
  /** NPM package name */
  readonly npmPackage: string;
  /** Required environment variables for configuration */
  readonly envVars: readonly string[];
  /** Factory function name (exported from package) */
  readonly factoryName: string;
  /** Configuration object shape (field names and types) */
  readonly configShape: Record<string, string>;
  /** Namespace for host functions (e.g., 'anthropic' -> 'anthropic::message') */
  readonly namespace: string;
}

/**
 * Preset configuration combining extensions and starter pattern.
 */
export interface PresetConfig {
  /** List of extension names to include */
  readonly extensions: readonly string[];
  /** Starter pattern name for template selection */
  readonly starterPattern: string;
}

// ============================================================
// ERROR CLASSES
// ============================================================

/**
 * Validation error for invalid configuration.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ============================================================
// EXTENSION CONFIGURATIONS
// ============================================================

/**
 * Static configuration map for supported extensions.
 * Data sourced from extension factory signatures and type definitions.
 */
const EXTENSIONS: ReadonlyArray<ExtensionConfig> = [
  // LLM Extensions
  {
    name: 'anthropic',
    npmPackage: '@rcrsr/rill-ext-anthropic',
    envVars: ['ANTHROPIC_API_KEY'],
    factoryName: 'createAnthropicExtension',
    configShape: {
      api_key: 'string',
      model: 'string',
      temperature: 'number',
      base_url: 'string',
      max_tokens: 'number',
      system: 'string',
      max_retries: 'number',
      timeout: 'number',
      embed_model: 'string',
    },
    namespace: 'anthropic',
  },
  {
    name: 'openai',
    npmPackage: '@rcrsr/rill-ext-openai',
    envVars: ['OPENAI_API_KEY'],
    factoryName: 'createOpenAIExtension',
    configShape: {
      api_key: 'string',
      model: 'string',
      temperature: 'number',
      base_url: 'string',
      max_tokens: 'number',
      system: 'string',
      max_retries: 'number',
      timeout: 'number',
      embed_model: 'string',
    },
    namespace: 'openai',
  },
  {
    name: 'gemini',
    npmPackage: '@rcrsr/rill-ext-gemini',
    envVars: ['GEMINI_API_KEY'],
    factoryName: 'createGeminiExtension',
    configShape: {
      api_key: 'string',
      model: 'string',
      temperature: 'number',
      base_url: 'string',
      max_tokens: 'number',
      system: 'string',
      max_retries: 'number',
      timeout: 'number',
      embed_model: 'string',
    },
    namespace: 'gemini',
  },
  {
    name: 'claude-code',
    npmPackage: '@rcrsr/rill-ext-claude-code',
    envVars: [],
    factoryName: 'createClaudeCodeExtension',
    configShape: {
      binaryPath: 'string',
      defaultTimeout: 'number',
      dangerouslySkipPermissions: 'boolean',
      settingSources: 'string',
    },
    namespace: 'claude-code',
  },

  // Vector Database Extensions
  {
    name: 'qdrant',
    npmPackage: '@rcrsr/rill-ext-qdrant',
    envVars: [],
    factoryName: 'createQdrantExtension',
    configShape: {
      url: 'string',
      apiKey: 'string',
      collection: 'string',
      dimensions: 'number',
      distance: 'string',
      timeout: 'number',
    },
    namespace: 'qdrant',
  },
  {
    name: 'pinecone',
    npmPackage: '@rcrsr/rill-ext-pinecone',
    envVars: ['PINECONE_API_KEY'],
    factoryName: 'createPineconeExtension',
    configShape: {
      apiKey: 'string',
      index: 'string',
      namespace: 'string',
      timeout: 'number',
    },
    namespace: 'pinecone',
  },
  {
    name: 'chroma',
    npmPackage: '@rcrsr/rill-ext-chroma',
    envVars: [],
    factoryName: 'createChromaExtension',
    configShape: {
      url: 'string',
      collection: 'string',
      embeddingFunction: 'string',
      timeout: 'number',
    },
    namespace: 'chroma',
  },
];

// ============================================================
// PRESET CONFIGURATIONS
// ============================================================

/**
 * Static preset configuration map.
 * Each preset bundles specific extensions with a starter pattern.
 */
const PRESETS: Record<string, PresetConfig> = {
  rag: {
    extensions: ['anthropic', 'qdrant'],
    starterPattern: 'search-focused',
  },
  chatbot: {
    extensions: ['anthropic'],
    starterPattern: 'conversation-loop',
  },
};

// ============================================================
// LOOKUP FUNCTIONS
// ============================================================

/**
 * Get extension configuration by name.
 * Case-insensitive lookup returns config metadata or null.
 *
 * @param name - Extension name (e.g., 'anthropic', 'QDRANT')
 * @returns ExtensionConfig if found, null otherwise
 *
 * @example
 * ```typescript
 * const config = getExtensionConfig('anthropic');
 * // Returns: { name: 'anthropic', npmPackage: '@rcrsr/rill-ext-anthropic', ... }
 *
 * const sameConfig = getExtensionConfig('ANTHROPIC');
 * // Returns same result (case-insensitive)
 *
 * const unknown = getExtensionConfig('unknown');
 * // Returns: null
 * ```
 */
export function getExtensionConfig(name: string): ExtensionConfig | null {
  const normalized = name.toLowerCase();
  return EXTENSIONS.find((ext) => ext.name === normalized) ?? null;
}

/**
 * Resolve preset configuration by name.
 * Case-insensitive lookup returns extensions and starter pattern.
 *
 * @param name - Preset name (e.g., 'rag', 'chatbot')
 * @returns PresetConfig with extensions and starter pattern
 * @throws ValidationError if preset name is unknown
 *
 * @example
 * ```typescript
 * const config = resolvePreset('rag');
 * // Returns: { extensions: ['anthropic', 'qdrant'], starterPattern: 'search-focused' }
 *
 * const sameConfig = resolvePreset('RAG');
 * // Returns same result (case-insensitive)
 *
 * resolvePreset('unknown');
 * // Throws: ValidationError: Unknown preset: unknown. Valid: rag, chatbot
 * ```
 */
export function resolvePreset(name: string): PresetConfig {
  const normalized = name.toLowerCase();
  const preset = PRESETS[normalized];

  if (!preset) {
    const validPresets = Object.keys(PRESETS).join(', ');
    throw new ValidationError(
      `Unknown preset: ${name}. Valid: ${validPresets}`
    );
  }

  return preset;
}
