/**
 * Shared TypeScript types for FreshGuard Core
 *
 * These types support the open-source data pipeline freshness monitoring engine.
 * Designed for single-tenant self-hosted installations.
 *
 * @license MIT
 */

// ==============================================
// Core Data Structures
// ==============================================

export type DataSourceType = 'postgres' | 'duckdb' | 'bigquery' | 'snowflake';
export type RuleType = 'freshness' | 'volume_anomaly' | 'schema_change' | 'custom_sql';
export type CheckStatus = 'ok' | 'alert' | 'failed' | 'pending';
export type AlertDestinationType = 'slack' | 'email' | 'pagerduty' | 'webhook';
export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Data source credentials (encrypted in production)
 */
export interface SourceCredentials {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  connectionString?: string;
  sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  additionalOptions?: Record<string, unknown>;
}

/**
 * Data source configuration
 */
export interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  credentials: SourceCredentials;
  isActive: boolean;
  lastTestedAt?: Date;
  lastTestSuccess?: boolean;
  lastError?: string;
  tableCount?: number;
  estimatedSizeBytes?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Monitoring rule configuration
 */
export interface MonitoringRule {
  id: string;
  sourceId: string;
  name: string;
  description?: string;
  tableName: string;
  ruleType: RuleType;

  // Freshness settings
  expectedFrequency?: string;
  toleranceMinutes?: number;
  timestampColumn?: string;

  // Volume anomaly settings
  baselineWindowDays?: number;
  deviationThresholdPercent?: number;
  minimumRowCount?: number;

  // Enhanced baseline configuration
  baselineConfig?: {
    windowDays?: number; // Override baselineWindowDays
    minimumDataPoints?: number; // Minimum required data points for baseline
    timeoutSeconds?: number; // Timeout for baseline calculation queries
    excludeWeekends?: boolean; // Exclude weekend data from baseline
    calculationMethod?: 'mean' | 'median' | 'trimmed_mean'; // Statistical method
    trimmedMeanPercentile?: number; // For trimmed_mean method (0-50)
    seasonalAdjustment?: boolean; // Account for day-of-week patterns
  };

  // Schema change settings
  trackColumnChanges?: boolean;
  trackTableChanges?: boolean;

  // Enhanced schema change configuration
  schemaChangeConfig?: {
    adaptationMode?: 'auto' | 'manual' | 'alert_only';  // Default: 'manual'
    monitoringMode?: 'full' | 'partial';                // Default: 'full'
    trackedColumns?: {
      columns?: string[];           // Column names to monitor (partial mode)
      alertLevel?: 'low' | 'medium' | 'high';  // Default: 'medium'
      trackTypes?: boolean;         // Track data type changes (default: true)
      trackNullability?: boolean;   // Track NOT NULL changes (default: false)
    };
    baselineRefreshDays?: number;   // Auto-refresh baseline after N days (default: 30)
  };

  // Custom SQL settings
  customSql?: string;
  expectedResult?: unknown;

  // Scheduling
  checkIntervalMinutes: number;
  timezone?: string;

  // Status
  isActive: boolean;
  lastCheckAt?: Date;
  lastStatus?: CheckStatus;
  consecutiveFailures?: number;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Alert destination configuration
 */
export interface AlertDestination {
  id: string;
  ruleId: string;
  destinationType: AlertDestinationType;
  destinationAddress: string;
  severityLevel?: SeverityLevel;
  alertOnRecovery?: boolean;
  cooldownMinutes?: number;
  messageTemplate?: string;
  includeQueryResults?: boolean;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Debug information for development and troubleshooting
 */
export interface DebugInfo {
  query?: string;                 // Actual SQL executed (if exposeQueries enabled)
  params?: unknown[];             // Query parameters
  rawError?: string;             // Original database error (if exposeRawErrors enabled)
  suggestion?: string;           // Suggested fix for the issue
  duration?: number;             // Query execution time in milliseconds
  debugId?: string;              // Correlation ID for log tracing
  context?: Record<string, unknown>; // Additional context
}

/**
 * Debug configuration for enhanced error visibility
 */
export interface DebugConfig {
  enabled?: boolean;              // Enable debug mode (auto-detected from NODE_ENV if not specified)
  exposeQueries?: boolean;        // Include actual SQL queries in debug output
  exposeRawErrors?: boolean;      // Include raw database error messages
  logLevel?: 'error' | 'warn' | 'info' | 'debug'; // Minimum log level to output
  correlationId?: string;         // Custom correlation ID for tracing
}

/**
 * Check execution result
 */
export interface CheckResult {
  status: CheckStatus;
  rowCount?: number;
  lastUpdate?: Date;
  lagMinutes?: number;
  deviation?: number;
  baselineAverage?: number;
  schemaChanges?: SchemaChanges;
  error?: string;
  queryExecuted?: string;
  executionDurationMs?: number;
  executedAt: Date;
  nextCheckAt?: Date;

  // Debug information (only populated in debug mode)
  debugId?: string;               // Correlation ID for log tracing
  debug?: DebugInfo;              // Enhanced debug information
}

/**
 * Check execution record (stored in database)
 */
export interface CheckExecution {
  id: string;
  ruleId: string;
  sourceId: string;
  status: CheckStatus;
  errorMessage?: string;
  queryExecuted?: string;
  executionDurationMs?: number;
  rowCount?: number;
  lastUpdate?: Date;
  lagMinutes?: number;
  baselineAverage?: number;
  currentDeviationPercent?: number;
  schemaChanges?: unknown;
  executedAt: Date;
  nextCheckAt?: Date;
}

// ==============================================
// Schema Change Monitoring Types
// ==============================================

/**
 * Column change detected in schema monitoring
 */
export interface ColumnChange {
  columnName: string;
  changeType: 'added' | 'removed' | 'type_changed' | 'nullability_changed';
  oldValue?: string;
  newValue?: string;
  impact: 'safe' | 'warning' | 'breaking';
}

/**
 * Schema changes result from monitoring
 */
export interface SchemaChanges {
  hasChanges: boolean;
  addedColumns: ColumnChange[];
  removedColumns: ColumnChange[];
  modifiedColumns: ColumnChange[];
  summary: string;
  changeCount: number;
  severity: 'low' | 'medium' | 'high';
}

/**
 * Schema baseline for comparison
 */
export interface SchemaBaseline {
  ruleId: string;
  tableName: string;
  schema: import('./types/connector.js').TableSchema;
  capturedAt: Date;
  schemaHash: string;
}

/**
 * Alert log entry
 */
export interface AlertLogEntry {
  id: string;
  executionId: string;
  ruleId: string;
  alertType: string;
  destinationType: AlertDestinationType;
  destinationAddress: string;
  subject?: string;
  messageContent?: string;
  alertSeverity: SeverityLevel;
  status: 'pending' | 'sent' | 'failed';
  deliveryAttempts: number;
  lastAttemptAt?: Date;
  errorMessage?: string;
  externalId?: string;
  sentAt?: Date;
  createdAt: Date;
}

// ==============================================
// API Request/Response Types
// ==============================================

/**
 * Request to create a data source
 */
export interface CreateSourceRequest {
  name: string;
  type: DataSourceType;
  credentials: SourceCredentials;
}

/**
 * Response from testing a data source connection
 */
export interface TestConnectionResponse {
  success: boolean;
  tableCount?: number;
  tables?: string[];
  error?: string;
}

/**
 * Request to create a monitoring rule
 */
export interface CreateRuleRequest {
  sourceId: string;
  name: string;
  description?: string;
  tableName: string;
  ruleType: RuleType;

  // Freshness settings
  toleranceMinutes?: number;
  timestampColumn?: string;

  // Volume anomaly settings
  baselineWindowDays?: number;
  deviationThresholdPercent?: number;
  minimumRowCount?: number;

  // Scheduling
  checkIntervalMinutes: number;

  // Alert destinations
  alertDestinations?: Omit<AlertDestination, 'id' | 'ruleId' | 'createdAt'>[];
}

/**
 * Request to update a monitoring rule
 */
export interface UpdateRuleRequest {
  name?: string;
  description?: string;
  isActive?: boolean;
  toleranceMinutes?: number;
  deviationThresholdPercent?: number;
  checkIntervalMinutes?: number;
}

/**
 * Request to manually trigger a check
 */
export interface TriggerCheckRequest {
  ruleId: string;
}

/**
 * Response from triggering a check
 */
export interface TriggerCheckResponse {
  executionId: string;
  result: CheckResult;
}


// ==============================================
// Configuration Types
// ==============================================

/**
 * Self-hosting configuration file
 */
export interface FreshGuardConfig {
  sources: Record<string, {
    type: DataSourceType;
    url?: string;
    credentials?: SourceCredentials;
  }>;
  rules: {
    id: string;
    sourceId: string;
    table: string;
    type: RuleType;
    frequency: number;
    tolerance?: number;
    alerts: {
      type: AlertDestinationType;
      address: string;
    }[];
  }[];
  scheduler?: {
    enabled: boolean;
    timezone?: string;
  };

  // Runtime configuration
  timeoutMs?: number;             // Global timeout for operations
  debug?: DebugConfig;            // Debug configuration for enhanced error visibility
}