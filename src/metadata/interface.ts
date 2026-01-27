/**
 * Core metadata storage abstraction interface
 */

import type { MonitoringRule, SchemaBaseline } from '../types.js';

/**
 * Simplified execution record for metadata storage
 */
interface MetadataExecution {
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

export interface MetadataStorage {
  /**
   * Save execution result for historical analysis
   */
  saveExecution(execution: MetadataExecution): Promise<void>;

  /**
   * Get historical execution data for anomaly detection baseline
   * @param ruleId The monitoring rule ID
   * @param days Number of days to look back
   * @returns Array of execution records
   */
  getHistoricalData(ruleId: string, days: number): Promise<MetadataExecution[]>;

  /**
   * Save monitoring rule configuration
   */
  saveRule(rule: MonitoringRule): Promise<void>;

  /**
   * Get monitoring rule by ID
   */
  getRule(ruleId: string): Promise<MonitoringRule | null>;

  /**
   * Store schema baseline for comparison
   */
  storeSchemaBaseline(baseline: SchemaBaseline, adaptationReason?: string): Promise<void>;

  /**
   * Get schema baseline for a rule
   */
  getSchemaBaseline(ruleId: string): Promise<SchemaBaseline | null>;

  /**
   * Initialize storage (create tables, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Close storage connections
   */
  close(): Promise<void>;
}