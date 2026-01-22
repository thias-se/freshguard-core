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

  // Schema change settings
  trackColumnChanges?: boolean;
  trackTableChanges?: boolean;

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
 * Check execution result
 */
export interface CheckResult {
  status: CheckStatus;
  rowCount?: number;
  lastUpdate?: Date;
  lagMinutes?: number;
  deviation?: number;
  baselineAverage?: number;
  error?: string;
  queryExecuted?: string;
  executionDurationMs?: number;
  executedAt: Date;
  nextCheckAt?: Date;
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
}