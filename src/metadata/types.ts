/**
 * Types for metadata storage abstraction
 */

export interface CheckExecution {
  ruleId: string;
  status: 'ok' | 'alert' | 'failed';
  rowCount?: number;
  lagMinutes?: number;
  deviation?: number;
  baselineAverage?: number;
  executionDurationMs?: number;
  executedAt: Date;
  error?: string;
}

export interface MonitoringRule {
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
}