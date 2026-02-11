import 'dotenv/config';
import {
  type HostFunctionDefinition,
  hoistExtension,
  createRuntimeContext,
  prefixFunctions,
} from '@rcrsr/rill';
import { createAnthropicExtension } from '@rcrsr/rill-ext-anthropic';

// ============================================================
// EXTENSION SETUP
// ============================================================

const anthropic = hoistExtension('anthropic', createAnthropicExtension({
  api_key: process.env.API_KEY,
  model: process.env.MODEL ?? '',
  temperature: undefined,
  base_url: process.env.BASE_URL ?? '',
  max_tokens: undefined,
  system: process.env.SYSTEM ?? '',
  max_retries: undefined,
  timeout: undefined,
  embed_model: process.env.EMBED_MODEL ?? '',
}));

// ============================================================
// APP FUNCTIONS
// ============================================================

const appFunctions: Record<string, HostFunctionDefinition> = {
  // TODO: Add your custom host functions here
  // Example:
  // greet: {
  //   fn: async (args) => `Hello, ${args[0]}!`,
  //   params: [{ name: 'name', type: 'string' }],
  //   returns: { type: 'string' },
  // },
};

// ============================================================
// CREATE HOST
// ============================================================

export function createHost() {
  const functions = {
    ...anthropic.functions,
    ...prefixFunctions('app', appFunctions),
  };

  const dispose = async () => {
    await anthropic.dispose?.();
  };

  return { functions, dispose };
}
