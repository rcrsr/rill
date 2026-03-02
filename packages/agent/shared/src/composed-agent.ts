import type {
  ScriptNode,
  RuntimeContext,
  RillValue,
  ExtensionResult,
} from '@rcrsr/rill';
import type { AgentCard } from './card.js';

/**
 * A fully composed agent ready for execution.
 */
export interface ComposedAgent {
  readonly context: RuntimeContext;
  readonly ast: ScriptNode;
  readonly modules: Record<string, Record<string, RillValue>>;
  dispose(): Promise<void>;
  readonly card: AgentCard;
  readonly extensions: Record<string, ExtensionResult>;
}
