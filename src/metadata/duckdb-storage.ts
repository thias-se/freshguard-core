/**
 * DuckDB implementation of metadata storage for self-hosting
 */

import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { MetadataStorage } from './interface.js';
import type { CheckExecution, MonitoringRule } from './types.js';

export class DuckDBMetadataStorage implements MetadataStorage {
  private instance?: DuckDBInstance;
  private connection?: DuckDBConnection;

  constructor(private dbPath: string = './freshguard-metadata.db') {}

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
        deviation DOUBLE,
        baseline_average DOUBLE,
        execution_duration_ms INTEGER,
        executed_at TIMESTAMP NOT NULL,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS monitoring_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL, -- JSON as text
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_executions_rule_time
      ON check_executions(rule_id, executed_at);
    `);
  }

  async saveExecution(execution: CheckExecution): Promise<void> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    await this.connection.run(`
      INSERT INTO check_executions (
        rule_id, status, row_count, lag_minutes, deviation,
        baseline_average, execution_duration_ms, executed_at, error
      ) VALUES (
        '${execution.ruleId}',
        '${execution.status}',
        ${execution.rowCount ?? 'NULL'},
        ${execution.lagMinutes ?? 'NULL'},
        ${execution.deviation ?? 'NULL'},
        ${execution.baselineAverage ?? 'NULL'},
        ${execution.executionDurationMs ?? 'NULL'},
        '${execution.executedAt.toISOString()}',
        ${execution.error ? `'${execution.error.replace(/'/g, "''")}'` : 'NULL'}
      )
    `);
  }

  async getHistoricalData(ruleId: string, days: number): Promise<CheckExecution[]> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const reader = await this.connection.runAndReadAll(`
      SELECT
        rule_id, status, row_count, lag_minutes, deviation,
        baseline_average, execution_duration_ms, executed_at, error
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
      deviation: row.deviation,
      baselineAverage: row.baseline_average,
      executionDurationMs: row.execution_duration_ms,
      executedAt: new Date(row.executed_at),
      error: row.error || undefined,
    }));
  }

  async saveRule(rule: MonitoringRule): Promise<void> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    await this.connection.run(`
      INSERT OR REPLACE INTO monitoring_rules (
        id, name, type, config, created_at, updated_at
      ) VALUES (
        '${rule.id}',
        '${rule.name}',
        '${rule.type}',
        '${JSON.stringify(rule.config).replace(/'/g, "''")}',
        '${rule.createdAt.toISOString()}',
        '${rule.updatedAt.toISOString()}'
      )
    `);
  }

  async getRule(ruleId: string): Promise<MonitoringRule | null> {
    if (!this.connection) throw new Error('DuckDB storage not initialized');

    const reader = await this.connection.runAndReadAll(`
      SELECT id, name, type, config, created_at, updated_at
      FROM monitoring_rules
      WHERE id = '${ruleId}'
    `);
    const rows = reader.getRowObjects();

    if (rows.length === 0) return null;

    const row = rows[0] as any;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      config: JSON.parse(row.config),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
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