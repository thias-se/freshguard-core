/**
 * FreshGuard Core - Open Source Data Pipeline Freshness Monitoring
 *
 * This is the public API for @thias-se/freshguard-core.
 * Use this package to build self-hosted monitoring solutions.
 *
 * @module @thias-se/freshguard-core
 * @license MIT
 */

// Export monitoring functions
export { checkFreshness, checkVolumeAnomaly } from './monitor/index.js';

// Export connectors
export { PostgresConnector, DuckDBConnector, BigQueryConnector, SnowflakeConnector } from './connectors/index.js';

// Export database utilities
export { createDatabase, schema } from './db/index.js';
export type { Database } from './db/index.js';

// Export error classes for proper error handling
export {
  FreshGuardError,
  SecurityError,
  ConnectionError,
  TimeoutError,
  QueryError,
  ConfigurationError,
  MonitoringError,
  ErrorHandler,
  createError
} from './errors/index.js';

// Re-export types for convenience
export type {
  DataSource,
  MonitoringRule,
  CheckResult,
  CheckExecution,
  AlertDestination,
  SourceCredentials,
  DataSourceType,
  RuleType,
  CheckStatus,
  AlertDestinationType,
  FreshGuardConfig,
} from './types.js';
