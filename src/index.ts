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
export { checkFreshness, checkVolumeAnomaly, checkSchemaChanges } from './monitor/index.js';

// Export connectors
export { PostgresConnector, DuckDBConnector, BigQueryConnector, SnowflakeConnector, MySQLConnector, RedshiftConnector } from './connectors/index.js';

// Export database utilities
export { createDatabase, schema } from './db/index.js';
export type { Database } from './db/index.js';

// Export metadata storage abstraction
export { createMetadataStorage, DuckDBMetadataStorage, PostgreSQLMetadataStorage } from './metadata/index.js';
export type { MetadataStorage, MetadataStorageConfig } from './metadata/index.js';

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
  SchemaChanges,
  ColumnChange,
  SchemaBaseline,
} from './types.js';
