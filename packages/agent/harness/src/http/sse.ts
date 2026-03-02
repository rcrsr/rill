/**
 * SSE event buffering for rill-agent harness.
 *
 * Extracted from host.ts so the HTTP transport and any other
 * consumer can share the same store without importing host.ts.
 */

// ============================================================
// SSE EVENT TYPE
// ============================================================

/**
 * A single buffered SSE event for replay to late-connecting clients.
 */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

// ============================================================
// SSE STORE INTERFACE
// ============================================================

/**
 * Holds the two Maps that populate during execution
 * and route handlers read from to serve SSE clients.
 */
export interface SseStore {
  readonly eventBuffers: Map<string, SseEvent[]>;
  readonly subscribers: Map<string, (event: SseEvent) => void>;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Creates a new, empty SseStore.
 */
export function createSseStore(): SseStore {
  return {
    eventBuffers: new Map<string, SseEvent[]>(),
    subscribers: new Map<string, (event: SseEvent) => void>(),
  };
}

// ============================================================
// PUSH EVENT
// ============================================================

/**
 * Appends a new SSE event to the session buffer and notifies any
 * live subscriber. Safe to call with no subscriber registered.
 */
export function pushSseEvent(
  store: SseStore,
  sessionId: string,
  event: string,
  data: unknown
): void {
  const payload: SseEvent = { event, data: JSON.stringify(data) };
  const buf = store.eventBuffers.get(sessionId) ?? [];
  buf.push(payload);
  store.eventBuffers.set(sessionId, buf);
  const subscriber = store.subscribers.get(sessionId);
  if (subscriber !== undefined) subscriber(payload);
}
