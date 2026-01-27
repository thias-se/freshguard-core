/**
 * DuckDB implementation of metadata storage for self-hosting
 */

import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { MetadataStorage } from './interface.js';
import type { SchemaBaseline, MonitoringRule } from '../types.js';

// Interface types for storage operations
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

export class DuckDBMetadataStorage implements MetadataStorage {
  private instance?: DuckDBInstance;
  private connection?: DuckDBConnection;

  constructor(private readonly dbPath = './freshguard-metadata.db') {}

  async initialize(): Promise<void> {
    if (this.connection) return;

    this.instance = await DuckDBInstance.create(this.dbPath);
    this.connection = await this.instance.connect();

    // Create tables if they don't exist
    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS check_executions (
        rule_id TEXT NOT NULL,
        status TEXT NOT NULL,
        row_count INTEGER,
        lag_minutes DOUBLE,
        baseline_average DOUBLE,
        current_deviation_percent DOUBLE,
        schema_changes TEXT,
        execution_duration_ms INTEGER,
        executed_at TIMESTAMP NOT NULL,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS monitoring_rules (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        table_name TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        expected_frequency TEXT,
        tolerance_minutes INTEGER,
        timestamp_column TEXT,
        baseline_window_days INTEGER,
        deviation_threshold_percent INTEGER,
        minimum_row_count INTEGER,
        track_column_changes BOOLEAN DEFAULT FALSE,
        track_table_changes BOOLEAN DEFAULT FALSE,
        schema_change_config TEXT, -- JSON
        custom_sql TEXT,
        expected_result TEXT, -- JSON
        check_interval_minutes INTEGER NOT NULL,
        timezone TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        last_check_at TIMESTAMP,
        last_status TEXT,
        consecutive_failures INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_baselines (
        id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::TEXT),
        rule_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        schema_snapshot TEXT NOT NULL, -- JSON as text
        schema_hash TEXT NOT NULL,
        captured_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        adaptation_reason TEXT,
        UNIQUE(rule_id)
      );

      CREATE INDEX IF NOT EXISTS idx_executions_rule_time
      ON check_executions(rule_id, executed_at);

      CREATE INDEX IF NOT EXISTS idx_schema_baselines_rule_id
      ON schema_baselines(rule_id);

      CREATE INDEX IF NOT EXISTS idx_schema_baselines_table_name
      ON schema_baselines(table_name);
    `);
  }

  async saveExecution(execution: MetadataExecution): Promise<void> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    await this.connection.run(`
      INSERT INTO check_executions (
        rule_id, status, row_count, lag_minutes,
        baseline_average, current_deviation_percent, schema_changes,
        execution_duration_ms, executed_at, error_message
      ) VALUES (
        '${execution.ruleId}',
        '${execution.status}',
        ${execution.rowCount ?? 'NULL'},
        ${execution.lagMinutes ?? 'NULL'},
        ${execution.baselineAverage ?? 'NULL'},
        ${execution.currentDeviationPercent ?? 'NULL'},
        ${execution.schemaChanges ? `'${JSON.stringify(execution.schemaChanges).replace(/'/g, "''")}'` : 'NULL'},
        ${execution.executionDurationMs ?? 'NULL'},
        '${execution.executedAt.toISOString()}',
        ${execution.error ? `'${execution.error.replace(/'/g, "''")}'` : 'NULL'}
      )
    `);
  }

  async getHistoricalData(ruleId: string, days: number): Promise<MetadataExecution[]> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const reader = await this.connection.runAndReadAll(`
      SELECT
        rule_id, status, row_count, lag_minutes,
        baseline_average, current_deviation_percent, schema_changes,
        execution_duration_ms, executed_at, error_message
      FROM check_executions
      WHERE rule_id = '${ruleId}'
        AND executed_at > '${cutoffDate.toISOString()}'
        AND row_count IS NOT NULL
      ORDER BY executed_at DESC
      LIMIT 1000
    `);
    const rows = reader.getRowObjects();

    return rows.map((row: any) => ({
      ruleId: row.rule_id,
      status: row.status,
      rowCount: row.row_count,
      lagMinutes: row.lag_minutes,
      baselineAverage: row.baseline_average,
      currentDeviationPercent: row.current_deviation_percent,
      schemaChanges: row.schema_changes ? JSON.parse(row.schema_changes) : undefined,
      executionDurationMs: row.execution_duration_ms,
      executedAt: new Date(row.executed_at),
      error: row.error_message || undefined,
    }));
  }

  async saveRule(rule: MonitoringRule): Promise<void> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    // For now, just store minimal fields to satisfy the interface
    await this.connection.run(`
      INSERT OR REPLACE INTO monitoring_rules (
        id, source_id, name, table_name, rule_type, check_interval_minutes,
        is_active, created_at, updated_at
      ) VALUES (
        '${rule.id}',
        '${rule.sourceId}',
        '${rule.name}',
        '${rule.tableName}',
        '${rule.ruleType}',
        ${rule.checkIntervalMinutes},
        ${rule.isActive},
        '${rule.createdAt.toISOString()}',
        '${rule.updatedAt.toISOString()}'
      )
    `);
  }

  async getRule(ruleId: string): Promise<MonitoringRule | null> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    const reader = await this.connection.runAndReadAll(`
      SELECT id, source_id, name, table_name, rule_type, check_interval_minutes,
             is_active, created_at, updated_at
      FROM monitoring_rules
      WHERE id = '${ruleId}'
    `);
    const rows = reader.getRowObjects();

    if (rows.length === 0) return null;

    const row = rows[0] as any;
    return {
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      tableName: row.table_name,
      ruleType: row.rule_type,
      checkIntervalMinutes: row.check_interval_minutes,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async storeSchemaBaseline(baseline: SchemaBaseline, adaptationReason?: string): Promise<void> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    // Use INSERT OR REPLACE to handle updates
    await this.connection.run(`
      INSERT OR REPLACE INTO schema_baselines (
        rule_id,
        table_name,
        schema_snapshot,
        schema_hash,
        captured_at,
        updated_at,
        adaptation_reason
      ) VALUES (
        '${baseline.ruleId}',
        '${baseline.tableName}',
        '${JSON.stringify(baseline.schema).replace(/'/g, "''")}',
        '${baseline.schemaHash}',
        '${baseline.capturedAt.toISOString()}',
        '${new Date().toISOString()}',
        ${adaptationReason ? `'${adaptationReason.replace(/'/g, "''")}'` : 'NULL'}
      )
    `);
  }

  async getSchemaBaseline(ruleId: string): Promise<SchemaBaseline | null> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    const reader = await this.connection.runAndReadAll(`
      SELECT rule_id, table_name, schema_snapshot, schema_hash, captured_at
      FROM schema_baselines
      WHERE rule_id = '${ruleId}'
    `);
    const rows = reader.getRowObjects();

    if (rows.length === 0) return null;

    const row = rows[0] as any;
    return {
      ruleId: row.rule_id,
      tableName: row.table_name,
      schema: JSON.parse(row.schema_snapshot),
      schemaHash: row.schema_hash,
      capturedAt: new Date(row.captured_at),
    };
  }

  async close(): Promise<void> {
    if (this.connection) {
      this.connection.closeSync();
      this.connection = undefined;
    }
    if (this.instance) {
      this.instance.closeSync();
      this.instance = undefined;
    }
  }
}