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
  columns: {
    name: string;
    type: string;
    nullable: boolean;
  }[];
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

  /** Enable detailed logging for debugging */
  enableDetailedLogging?: boolean;

  /** Enable query complexity analysis */
  enableQueryAnalysis?: boolean;

  /** Maximum query risk score to allow (0-100) */
  maxQueryRiskScore?: number;

  /** Maximum query complexity score to allow (0-100) */
  maxQueryComplexityScore?: number;
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
    // FreshGuard Core monitoring patterns (v0.9.1+) - Updated to handle all whitespace and quoted identifiers
    /^SELECT\s+COUNT\(\*\)(?:\s+as\s+\w+)?\s+FROM\s+[`"]?\w+[`"]?$/is,                    // getRowCount: SELECT COUNT(*) [as alias] FROM table
    /^SELECT\s+MAX\([`"]?\w+[`"]?\)(?:\s+as\s+\w+)?\s+FROM\s+[`"]?\w+[`"]?$/is,           // getMaxTimestamp: SELECT MAX(column) [as alias] FROM table
    /^SELECT\s+MIN\([`"]?\w+[`"]?\)(?:\s+as\s+\w+)?\s+FROM\s+[`"]?\w+[`"]?$/is,           // getMinTimestamp: SELECT MIN(column) [as alias] FROM table

    // Schema introspection queries
    /^DESCRIBE\s+[`"]?\w+[`"]?$/i,                                                         // DESCRIBE table
    /^SHOW\s+(TABLES|COLUMNS)(?:\s+FROM\s+[`"]?\w+[`"]?)?$/i,                            // SHOW TABLES, SHOW COLUMNS FROM table

    // Information schema queries (cross-database compatibility)
    /^SELECT\s+.+?\s+FROM\s+information_schema\.\w+/is,                                  // PostgreSQL/MySQL information_schema
    /^SELECT[\s\S]+?FROM[\s\S]+?information_schema\.\w+/is,                              // Multi-line information_schema queries
    /^SELECT[\s\S]+?FROM[\s\S]*`[^`]*\.INFORMATION_SCHEMA\.\w+`/is,                      // BigQuery INFORMATION_SCHEMA (backticks)

    // MySQL-specific patterns with backticks
    /^SELECT\s+table_name\s+FROM\s+information_schema\.tables\s+WHERE\s+table_schema\s*=\s*\?/is, // MySQL table listing
    /^SELECT\s+column_name,\s*data_type,\s*is_nullable\s+FROM\s+information_schema\.columns/is,   // MySQL schema query

    // Redshift-specific patterns (PostgreSQL compatibility)
    /^SELECT\s+tablename\s+FROM\s+pg_tables/is,                                          // Redshift table listing using pg_tables
    /^SELECT\s+[\s\S]*?FROM\s+svv_table_info/is,                                         // Redshift system view queries

    // Test connection queries
    /^SELECT\s+1(?:\s+as\s+\w+)?$/i,                                                     // SELECT 1 [as alias] (connection test)
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
export type ConnectorType = 'postgres' | 'duckdb' | 'bigquery' | 'snowflake' | 'mysql' | 'redshift';

/**
 * Connector factory configuration
 */
export interface ConnectorFactoryConfig {
  type: ConnectorType;
  config: ConnectorConfig;
  securityConfig?: Partial<SecurityConfig>;
}