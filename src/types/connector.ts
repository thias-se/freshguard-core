/**
 * Security-focused connector type definitions for FreshGuard Core
 *
 * These types enforce security best practices for database connections,
 * including read-only operations, query validation, and proper error handling.
 *
 * @license MIT
 */

// ==============================================
// Security-Focused Connector Configuration
// ==============================================

/**
 * Secure connector configuration with validated credentials
 * Deployer provides these securely (from env/vault)
 */
export interface ConnectorConfig {
  /** Database host (required) */
  host: string;
  /** Database port (required) */
  port: number;
  /** Database name (required) */
  database: string;
  /** Username - should be read-only service account (required) */
  username: string;
  /** Password - should be from secure store (required) */
  password: string;
  /** Enable SSL/TLS (defaults to true for security) */
  ssl?: boolean;
  /** Connection timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Query timeout in milliseconds (default: 10000) */
  queryTimeout?: number;
  /** Maximum rows returned by queries (default: 1000) */
  maxRows?: number;
  /** Application name for connection identification */
  applicationName?: string;
}

/**
 * Table schema information
 */
export interface TableSchema {
  table: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
  }>;
}

/**
 * Secure connector interface - only allows read-only operations
 * Core uses only these methods - no arbitrary data access
 */
export interface Connector {
  /** Test database connection */
  testConnection(): Promise<boolean>;

  /** List available tables */
  listTables(): Promise<string[]>;

  /** Get table schema information */
  getTableSchema(table: string): Promise<TableSchema>;

  // Constrained freshness check methods only
  /** Get row count for a table */
  getRowCount(table: string): Promise<number>;

  /** Get maximum timestamp value from a column */
  getMaxTimestamp(table: string, column: string): Promise<Date | null>;

  /** Get minimum timestamp value from a column */
  getMinTimestamp(table: string, column: string): Promise<Date | null>;

  /** Get last modified timestamp for a table */
  getLastModified(table: string): Promise<Date | null>;

  /** Close the connection */
  close(): Promise<void>;
}

/**
 * Freshness check result with security-safe error messages
 */
export interface FreshnessResult {
  table: string;
  column: string;
  lastUpdate: Date | null;
  rowCount: number;
  isStale: boolean;
  staleSince?: Date;
  /** Sanitized error message - no database version leaks */
  error?: string;
}

/**
 * Volume anomaly detection result
 */
export interface AnomalyResult {
  table: string;
  currentRowCount?: number;
  baselineRowCount?: number;
  deviationPercent?: number;
  isAnomaly: boolean;
  direction?: 'increase' | 'decrease';
  /** Sanitized error message */
  error?: string;
}

// ==============================================
// Security Configuration
// ==============================================

/**
 * Security settings for connectors
 */
export interface SecurityConfig {
  /** Connection timeout in milliseconds */
  connectionTimeout: number;

  /** Query timeout in milliseconds */
  queryTimeout: number;

  /** Maximum rows returned by any query */
  maxRows: number;

  /** Require SSL/TLS connections */
  requireSSL: boolean;

  /** Allowed query patterns (regex) */
  allowedQueryPatterns: RegExp[];

  /** Blocked SQL keywords */
  blockedKeywords: string[];
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  connectionTimeout: 30000,  // 30 seconds
  queryTimeout: 10000,       // 10 seconds
  maxRows: 1000,
  requireSSL: true,
  allowedQueryPatterns: [
    /^SELECT COUNT\(\*\) FROM/i,
    /^SELECT MAX\(/i,
    /^SELECT MIN\(/i,
    /^DESCRIBE /i,
    /^SHOW /i,
    /^SELECT .+ FROM information_schema\./i,
  ],
  blockedKeywords: [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
    '--', '/*', '*/', 'EXEC', 'EXECUTE', 'xp_', 'sp_'
  ],
};

// ==============================================
// Connector Factory
// ==============================================

/**
 * Database connector types supported by FreshGuard Core
 */
export type ConnectorType = 'postgres' | 'duckdb' | 'bigquery' | 'snowflake';

/**
 * Connector factory configuration
 */
export interface ConnectorFactoryConfig {
  type: ConnectorType;
  config: ConnectorConfig;
  securityConfig?: Partial<SecurityConfig>;
}