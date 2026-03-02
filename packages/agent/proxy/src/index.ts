// ============================================================
// CONCURRENCY
// ============================================================
export type {
  ConcurrencyLimiter,
  ConcurrencyToken,
  ConcurrencyStats,
} from './concurrency.js';
export { createConcurrencyLimiter } from './concurrency.js';

// ============================================================
// CATALOG
// ============================================================
export type { Catalog, CatalogEntry } from './catalog.js';
export { createCatalog } from './catalog.js';

// ============================================================
// ERRORS
// ============================================================
export {
  ProxyError,
  PROXY_CONCURRENCY_LIMIT,
  PROXY_CHILD_CRASH,
  PROXY_TIMEOUT,
  PROXY_AHI_TARGET_MISSING,
  PROXY_SPAWN_ERROR,
  PROXY_PROTOCOL_ERROR,
} from './errors.js';

// ============================================================
// PROCESS MANAGER
// ============================================================
export type { ProcessManager, ActiveProcess } from './process-manager.js';
export { createProcessManager } from './process-manager.js';

// ============================================================
// AHI MEDIATOR
// ============================================================
export { createAhiHandler } from './ahi-mediator.js';

// ============================================================
// CONFIG
// ============================================================
export type { ConcurrencyConfig, ProxyConfig, LogLevel } from './config.js';
export {
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_DRAIN_TIMEOUT_MS,
  DEFAULT_CONCURRENCY,
  loadConfig,
} from './config.js';

// ============================================================
// METRICS
// ============================================================
export type { ProxyMetrics } from './metrics.js';
export { createProxyMetrics } from './metrics.js';

// ============================================================
// PROXY
// ============================================================
export type { AgentProxy } from './proxy.js';
export { createProxy } from './proxy.js';
