/**
 * Core metadata storage abstraction interface
 */

import type { CheckExecution, MonitoringRule } from './types.js';

export interface MetadataStorage {
  /**
   * Save execution result for historical analysis
   */
  saveExecution(execution: CheckExecution): Promise<void>;

  /**
   * Get historical execution data for anomaly detection baseline
   * @param ruleId The monitoring rule ID
   * @param days Number of days to look back
   * @returns Array of execution records
   */
  getHistoricalData(ruleId: string, days: number): Promise<CheckExecution[]>;

  /**
   * Save monitoring rule configuration
   */
  saveRule(rule: MonitoringRule): Promise<void>;

  /**
   * Get monitoring rule by ID
   */
  getRule(ruleId: string): Promise<MonitoringRule | null>;

  /**
   * Initialize storage (create tables, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Close storage connections
   */
  close(): Promise<void>;
}