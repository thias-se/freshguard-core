/**
 * Types for metadata storage abstraction
 */

export interface MetadataCheckExecution {
  ruleId: string;
  status: 'ok' | 'alert' | 'failed' | 'pending';
  rowCount?: number;
  lagMinutes?: number;
  deviation?: number;
  baselineAverage?: number;
  currentDeviationPercent?: number;
  schemaChanges?: unknown;
  executionDurationMs?: number;
  executedAt: Date;
  error?: string;
}

export interface MetadataMonitoringRule {
  id: string;
  name: string;
  type: 'freshness' | 'volume' | 'custom';
  config: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MetadataStorageConfig {
  type: 'duckdb' | 'postgresql';
  path?: string; // for DuckDB
  url?: string; // for PostgreSQL

  // PostgreSQL schema customization for self-hosted deployments
  schema?: {
    name?: string; // Schema name (default: 'public')
    tablePrefix?: string; // Table prefix (default: '')
    tables?: {
      checkExecutions?: string;
      monitoringRules?: string;
    };
  };
}