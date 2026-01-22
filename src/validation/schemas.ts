/**
 * Zod validation schemas for FreshGuard Core Phase 2
 *
 * Replaces manual validation functions with declarative Zod schemas
 * for better error handling, type safety, and maintainability.
 *
 * @license MIT
 */

import { z } from 'zod';

// ==============================================
// Constants
// ==============================================

/**
 * SQL reserved keywords that should not be used as identifiers
 */
const SQL_RESERVED_KEYWORDS = [
  // Core SQL keywords
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
  'TABLE', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE',
  'COUNT', 'MAX', 'MIN', 'SUM', 'AVG', 'DISTINCT', 'ORDER', 'GROUP', 'BY',

  // Additional dangerous keywords
  'EXEC', 'EXECUTE', 'TRUNCATE', 'GRANT', 'REVOKE', 'UNION', 'MERGE',
  'CALL', 'DECLARE', 'SET', 'USE', 'SHOW', 'DESCRIBE', 'EXPLAIN',

  // Database-specific system functions and procedures
  'XP_', 'SP_', 'SYS', 'INFORMATION_SCHEMA', 'PERFORMANCE_SCHEMA'
] as const;

/**
 * Dangerous SQL patterns that should not appear in connection strings
 */
const DANGEROUS_SQL_PATTERNS = [
  /drop\s+table/i,
  /delete\s+from/i,
  /insert\s+into/i,
  /update\s+set/i,
  /;\s*drop/i,
  /;\s*delete/i,
  /--/,
  /\/\*/,
  /\*\//,
  /xp_/i,
  /sp_/i
] as const;

// ==============================================
// Base Identifier Schemas
// ==============================================

/**
 * Schema for validating SQL identifiers (base pattern)
 * Allows letters, numbers, underscores, starting with letter or underscore
 */
const BaseIdentifierSchema = z.string()
  .min(1, 'Identifier cannot be empty')
  .max(256, 'Identifier too long (max 256 characters)')
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Identifier must start with letter or underscore, contain only alphanumeric characters and underscores');

/**
 * Schema for validating table names
 * Supports schema.table notation (e.g., "public.users")
 */
export const TableNameSchema = z.string()
  .min(1, 'Table name cannot be empty')
  .max(256, 'Table name too long (max 256 characters)')
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/,
    'Table name must be a valid identifier or schema.table format'
  )
  .refine((name) => {
    // Check each part of schema.table notation against reserved keywords
    const parts = name.split('.');
    return !parts.some(part => SQL_RESERVED_KEYWORDS.includes(part.toUpperCase()));
  }, (name) => ({
    message: `Table name "${name}" contains reserved SQL keywords`
  }))
  .refine((name) => {
    // Additional security check - ensure no dangerous patterns
    return !(/[;\/\*\x00-\x1F\x7F]|--/.exec(name));
  }, 'Table name contains dangerous characters');

/**
 * Schema for validating column names
 * Column names don't support schema notation
 */
export const ColumnNameSchema = BaseIdentifierSchema
  .refine((name) => {
    return !SQL_RESERVED_KEYWORDS.includes(name.toUpperCase());
  }, (name) => ({
    message: `Column name "${name}" is a reserved SQL keyword`
  }));

/**
 * Schema for validating database identifiers (generic)
 */
export const DatabaseIdentifierSchema = z.object({
  identifier: z.string(),
  type: z.enum(['table', 'column']).default('table')
}).transform(({ identifier, type }) => {
  if (type === 'table') {
    return TableNameSchema.parse(identifier);
  } else {
    return ColumnNameSchema.parse(identifier);
  }
});

// ==============================================
// Network and Connection Schemas
// ==============================================

/**
 * Schema for validating hostnames and IP addresses
 */
export const HostnameSchema = z.string()
  .min(1, 'Host is required')
  .max(255, 'Host name too long (max 255 characters)')
  .regex(/^[a-zA-Z0-9\-\.]+$/, 'Invalid host name format')
  .refine((host) => {
    // Prevent localhost variations in production (configurable)
    const isLocalhost = /^(localhost|127\.|::1|0\.0\.0\.0)/.test(host);
    return !isLocalhost || process.env.NODE_ENV !== 'production';
  }, 'Localhost connections not allowed in production');

/**
 * Schema for validating port numbers
 */
export const PortSchema = z.number()
  .int('Port must be an integer')
  .min(1, 'Port must be at least 1')
  .max(65535, 'Port must be at most 65535')
  .refine((port) => {
    // Warn about common dangerous ports (FTP, Telnet, etc.)
    const dangerousPorts = [21, 23, 25, 53, 69, 135, 139, 445];
    return !dangerousPorts.includes(port);
  }, 'Port number may be unsafe for database connections');

/**
 * Schema for validating timeout values (milliseconds)
 */
export const TimeoutSchema = z.number()
  .int('Timeout must be an integer')
  .min(1000, 'Timeout must be at least 1000ms (1 second)')
  .max(300000, 'Timeout cannot exceed 300000ms (5 minutes)');

/**
 * Schema for validating query timeout values (shorter than connection timeout)
 */
export const QueryTimeoutSchema = z.number()
  .int('Query timeout must be an integer')
  .min(1000, 'Query timeout must be at least 1000ms (1 second)')
  .max(60000, 'Query timeout cannot exceed 60000ms (1 minute)');

/**
 * Schema for validating maximum row limits
 */
export const MaxRowsSchema = z.number()
  .int('Max rows must be an integer')
  .min(1, 'Max rows must be at least 1')
  .max(10000, 'Max rows cannot exceed 10000');

// ==============================================
// Connector Configuration Schemas
// ==============================================

/**
 * Schema for validating database credentials
 */
export const DatabaseCredentialsSchema = z.object({
  username: z.string()
    .min(1, 'Username is required')
    .max(64, 'Username too long (max 64 characters)')
    .refine((username) => {
      // Prevent obvious injection attempts in username
      return !(/[;\/\*\x00-\x1F\x7F]|--/.exec(username));
    }, 'Username contains invalid characters'),

  password: z.string()
    .min(1, 'Password is required')
    .max(256, 'Password too long (max 256 characters)')
});

/**
 * Schema for validating database names
 */
export const DatabaseNameSchema = z.string()
  .min(1, 'Database name is required')
  .max(64, 'Database name too long (max 64 characters)')
  .regex(/^[a-zA-Z0-9_\-]+$/, 'Database name contains invalid characters (only alphanumeric, underscore, and hyphen allowed)')
  .refine((name) => {
    return !SQL_RESERVED_KEYWORDS.includes(name.toUpperCase());
  }, 'Database name cannot be a reserved SQL keyword');

/**
 * Base connector configuration schema
 */
export const BaseConnectorConfigSchema = z.object({
  host: HostnameSchema,
  port: PortSchema.optional(),
  database: DatabaseNameSchema,
  username: z.string().min(1),
  password: z.string().min(1),
  ssl: z.boolean().default(true),
  timeout: TimeoutSchema.optional(),
  queryTimeout: QueryTimeoutSchema.optional(),
  maxRows: MaxRowsSchema.optional(),
  applicationName: z.string().max(64).optional()
}).refine((config) => {
  // Ensure query timeout is less than connection timeout
  if (config.timeout && config.queryTimeout && config.queryTimeout >= config.timeout) {
    return false;
  }
  return true;
}, {
  message: 'Query timeout must be less than connection timeout',
  path: ['queryTimeout']
});

/**
 * PostgreSQL-specific connector configuration
 */
export const PostgresConnectorConfigSchema = BaseConnectorConfigSchema.extend({
  schema: z.string().max(64).optional(),
  sslMode: z.enum(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']).default('require')
});

/**
 * DuckDB-specific connector configuration (file-based)
 */
export const DuckDBConnectorConfigSchema = z.object({
  database: z.string()
    .min(1, 'Database path is required')
    .max(1024, 'Database path too long')
    .refine((path) => {
      // Allow :memory: for in-memory databases
      if (path === ':memory:') return true;

      // Prevent directory traversal attacks
      return !path.includes('..') && !path.includes('//');
    }, 'Invalid database path')
    .refine((path) => {
      // Prevent access to system directories
      const systemDirs = ['/etc/', '/sys/', '/proc/', '/dev/', '/var/'];
      return path === ':memory:' || !systemDirs.some(dir => path.startsWith(dir));
    }, 'Cannot access system directories'),
  readOnly: z.boolean().default(true), // Default to read-only for security
  timeout: TimeoutSchema.optional(),
  queryTimeout: QueryTimeoutSchema.optional(),
  maxRows: MaxRowsSchema.optional()
});

/**
 * BigQuery-specific connector configuration
 */
export const BigQueryConnectorConfigSchema = z.object({
  projectId: z.string()
    .min(1, 'Project ID is required')
    .max(63, 'Project ID too long')
    .regex(/^[a-z0-9\-]+$/, 'Project ID must contain only lowercase letters, numbers, and hyphens'),
  keyFilename: z.string().optional(), // Path to service account JSON
  credentials: z.object({}).passthrough().optional(), // Service account JSON object
  dataset: z.string().max(1024).optional(),
  location: z.string().max(64).optional(),
  timeout: TimeoutSchema.optional(),
  queryTimeout: QueryTimeoutSchema.optional(),
  maxRows: MaxRowsSchema.optional()
}).refine((config) => {
  // Must have either keyFilename or credentials
  return config.keyFilename || config.credentials;
}, {
  message: 'Either keyFilename or credentials must be provided',
  path: ['credentials']
});

/**
 * Snowflake-specific connector configuration
 */
export const SnowflakeConnectorConfigSchema = z.object({
  account: z.string()
    .min(1, 'Account is required')
    .max(64, 'Account name too long'),
  username: z.string()
    .min(1, 'Username is required')
    .max(64, 'Username too long'),
  password: z.string()
    .min(1, 'Password is required'),
  warehouse: z.string().max(64).optional(),
  database: DatabaseNameSchema,
  schema: z.string().max(64).optional(),
  role: z.string().max(64).optional(),
  timeout: TimeoutSchema.optional(),
  queryTimeout: QueryTimeoutSchema.optional(),
  maxRows: MaxRowsSchema.optional()
});

// ==============================================
// Input Sanitization Schemas
// ==============================================

/**
 * Schema for sanitizing and validating string inputs
 */
export const SanitizedStringSchema = z.string()
  .min(1, 'Input cannot be empty')
  .max(256, 'Input too long (max 256 characters)')
  .transform((input) => input.trim())
  .refine((input) => input.length > 0, 'Input is empty after sanitization')
  .transform((input) => {
    // Remove dangerous characters
    return input.replace(/[;\/\*\x00-\x1F\x7F]|--/g, '');
  })
  .refine((input) => input.length > 0, 'Input is empty after removing dangerous characters');

/**
 * Schema for validating SQL LIMIT values
 */
export const LimitSchema = z.union([
  z.number().int().min(1).max(10000),
  z.string().transform((val) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) {
      throw new Error('LIMIT must be a valid number');
    }
    return num;
  }).refine((num) => num >= 1 && num <= 10000, 'LIMIT must be between 1 and 10000')
]);

/**
 * Schema for validating connection strings
 */
export const ConnectionStringSchema = z.string()
  .min(1, 'Connection string cannot be empty')
  .max(2048, 'Connection string too long (max 2048 characters)')
  .refine((connStr) => {
    // Must contain host or server specification
    return /(?:host|server|hostname)=/i.test(connStr);
  }, 'Connection string must contain host/server specification')
  .refine((connStr) => {
    // Must not contain dangerous SQL patterns
    return !DANGEROUS_SQL_PATTERNS.some(pattern => pattern.test(connStr));
  }, 'Connection string contains dangerous SQL patterns');

// ==============================================
// Monitoring Rule Schemas
// ==============================================

/**
 * Schema for validating freshness monitoring rules
 */
export const FreshnessRuleSchema = z.object({
  id: z.string().uuid().optional(),
  sourceId: z.string().uuid(),
  tableName: TableNameSchema,
  columnName: ColumnNameSchema,
  toleranceMinutes: z.number()
    .int('Tolerance must be an integer')
    .min(1, 'Tolerance must be at least 1 minute')
    .max(10080, 'Tolerance cannot exceed 10080 minutes (1 week)'),
  checkIntervalMinutes: z.number()
    .int('Check interval must be an integer')
    .min(1, 'Check interval must be at least 1 minute')
    .max(1440, 'Check interval cannot exceed 1440 minutes (1 day)'),
  isActive: z.boolean().default(true)
});

/**
 * Schema for validating volume anomaly monitoring rules
 */
export const VolumeRuleSchema = z.object({
  id: z.string().uuid().optional(),
  sourceId: z.string().uuid(),
  tableName: TableNameSchema,
  baselineWindowDays: z.number()
    .int('Baseline window must be an integer')
    .min(1, 'Baseline window must be at least 1 day')
    .max(365, 'Baseline window cannot exceed 365 days'),
  deviationThreshold: z.number()
    .min(0, 'Deviation threshold must be non-negative')
    .max(10, 'Deviation threshold cannot exceed 1000%')
    .transform((val) => val / 100), // Convert percentage to decimal
  checkIntervalMinutes: z.number()
    .int('Check interval must be an integer')
    .min(15, 'Check interval must be at least 15 minutes')
    .max(1440, 'Check interval cannot exceed 1440 minutes (1 day)'),
  isActive: z.boolean().default(true)
});

// ==============================================
// Export all schemas
// ==============================================

export const schemas = {
  // Identifier schemas
  TableNameSchema,
  ColumnNameSchema,
  DatabaseIdentifierSchema,

  // Network schemas
  HostnameSchema,
  PortSchema,
  TimeoutSchema,
  QueryTimeoutSchema,
  MaxRowsSchema,

  // Connector configuration schemas
  BaseConnectorConfigSchema,
  PostgresConnectorConfigSchema,
  DuckDBConnectorConfigSchema,
  BigQueryConnectorConfigSchema,
  SnowflakeConnectorConfigSchema,
  DatabaseCredentialsSchema,
  DatabaseNameSchema,

  // Input sanitization schemas
  SanitizedStringSchema,
  LimitSchema,
  ConnectionStringSchema,

  // Monitoring rule schemas
  FreshnessRuleSchema,
  VolumeRuleSchema
} as const;

/**
 * Type utilities for extracting types from schemas
 */
export type TableName = z.infer<typeof TableNameSchema>;
export type ColumnName = z.infer<typeof ColumnNameSchema>;
export type DatabaseIdentifier = z.infer<typeof DatabaseIdentifierSchema>;
export type BaseConnectorConfig = z.infer<typeof BaseConnectorConfigSchema>;
export type PostgresConnectorConfig = z.infer<typeof PostgresConnectorConfigSchema>;
export type DuckDBConnectorConfig = z.infer<typeof DuckDBConnectorConfigSchema>;
export type BigQueryConnectorConfig = z.infer<typeof BigQueryConnectorConfigSchema>;
export type SnowflakeConnectorConfig = z.infer<typeof SnowflakeConnectorConfigSchema>;
export type FreshnessRule = z.infer<typeof FreshnessRuleSchema>;
export type VolumeRule = z.infer<typeof VolumeRuleSchema>;