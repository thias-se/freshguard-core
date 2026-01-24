/**
 * PostgreSQL implementation of metadata storage using existing Drizzle schema
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, and, desc, gt } from 'drizzle-orm';
import postgres from 'postgres';
import type { MetadataStorage } from './interface.js';
import type { CheckExecution, MonitoringRule } from './types.js';
import { checkExecutions, monitoringRules } from '../db/schema.js';

export class PostgreSQLMetadataStorage implements MetadataStorage {
  private client?: postgres.Sql;
  private db?: ReturnType<typeof drizzle>;

  constructor(private connectionUrl: string) {}

  async initialize(): Promise<void> {
    if (this.db) return;

    this.client = postgres(this.connectionUrl);
    this.db = drizzle(this.client);
  }

  async saveExecution(execution: CheckExecution): Promise<void> {
    if (!this.db) throw new Error('PostgreSQL storage not initialized');

    await this.db.insert(checkExecutions).values({
      ruleId: execution.ruleId,
      sourceId: execution.ruleId, // Use ruleId as sourceId for simplicity
      status: execution.status,
      rowCount: execution.rowCount,
      lagMinutes: execution.lagMinutes,
      baselineAverage: execution.baselineAverage?.toString(),
      currentDeviationPercent: execution.deviation?.toString(),
      executionDurationMs: execution.executionDurationMs,
      executedAt: execution.executedAt,
      errorMessage: execution.error,
    });
  }

  async getHistoricalData(ruleId: string, days: number): Promise<CheckExecution[]> {
    if (!this.db) throw new Error('PostgreSQL storage not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const results = await this.db
      .select({
        ruleId: checkExecutions.ruleId,
        status: checkExecutions.status,
        rowCount: checkExecutions.rowCount,
        lagMinutes: checkExecutions.lagMinutes,
        deviation: checkExecutions.currentDeviationPercent,
        baselineAverage: checkExecutions.baselineAverage,
        executionDurationMs: checkExecutions.executionDurationMs,
        executedAt: checkExecutions.executedAt,
        error: checkExecutions.errorMessage,
      })
      .from(checkExecutions)
      .where(
        and(
          sql`${checkExecutions.ruleId} = ${ruleId}`,
          gt(checkExecutions.executedAt, cutoffDate),
          sql`${checkExecutions.rowCount} IS NOT NULL`
        )
      )
      .orderBy(desc(checkExecutions.executedAt))
      .limit(1000);

    return results.map(row => ({
      ruleId: row.ruleId,
      status: row.status as 'ok' | 'alert' | 'failed',
      rowCount: row.rowCount || undefined,
      lagMinutes: row.lagMinutes || undefined,
      deviation: row.deviation ? parseFloat(row.deviation) : undefined,
      baselineAverage: row.baselineAverage ? parseFloat(row.baselineAverage) : undefined,
      executionDurationMs: row.executionDurationMs || undefined,
      executedAt: row.executedAt || new Date(),
      error: row.error || undefined,
    }));
  }

  async saveRule(rule: MonitoringRule): Promise<void> {
    if (!this.db) throw new Error('PostgreSQL storage not initialized');

    await this.db
      .insert(monitoringRules)
      .values({
        id: rule.id,
        sourceId: rule.id, // Use id as sourceId for simplicity
        name: rule.name,
        ruleType: rule.type,
        tableName: 'unknown', // Required field, set default
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })
      .onConflictDoUpdate({
        target: monitoringRules.id,
        set: {
          name: rule.name,
          ruleType: rule.type,
          updatedAt: rule.updatedAt,
        },
      });
  }

  async getRule(ruleId: string): Promise<MonitoringRule | null> {
    if (!this.db) throw new Error('PostgreSQL storage not initialized');

    const results = await this.db
      .select({
        id: monitoringRules.id,
        name: monitoringRules.name,
        type: monitoringRules.ruleType,
        createdAt: monitoringRules.createdAt,
        updatedAt: monitoringRules.updatedAt,
      })
      .from(monitoringRules)
      .where(sql`${monitoringRules.id} = ${ruleId}`)
      .limit(1);

    if (results.length === 0) return null;

    const row = results[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      type: row.type as 'freshness' | 'volume' | 'custom',
      config: {}, // Default empty config
      createdAt: row.createdAt || new Date(),
      updatedAt: row.updatedAt || new Date(),
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = undefined;
      this.db = undefined;
    }
  }
}