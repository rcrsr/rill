export interface AhiBinding {
  readonly transport: 'stdio' | 'http';
  readonly url?: string; // required when transport is 'http'
}

export interface StdioRunMessage {
  readonly method: 'run';
  readonly name: string;
  readonly params: Record<string, unknown>;
  readonly config: Record<string, Record<string, unknown>>;
  readonly bindings: Record<string, AhiBinding>;
  readonly timeout: number;
  readonly correlationId: string;
}

export interface StdioRunResult {
  readonly method: 'run.result';
  readonly state: 'completed' | 'failed';
  readonly result?: unknown;
  readonly error?: { code: string; message: string };
  readonly durationMs: number;
}

export interface StdioAhiRequest {
  readonly method: 'ahi';
  readonly id: string;
  readonly target: string;
  readonly params: Record<string, unknown>;
  readonly timeout?: number;
}

export interface StdioAhiResponse {
  readonly method: 'ahi.result';
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { code: string; message: string };
}
