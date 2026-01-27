/**
 * PostgreSQL implementation of metadata storage using existing Drizzle schema
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, and, desc, gt } from 'drizzle-orm';
import postgres from 'postgres';
import type { MetadataStorage } from './interface.js';
import type { MetadataStorageConfig } from './types.js';
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
import { checkExecutions, monitoringRules, schemaBaselines } from '../db/schema.js';
import { SchemaConfigResolver } from './schema-config.js';
import { MetadataStorageError, ErrorHandler } from '../errors/index.js';

export class PostgreSQLMetadataStorage implements MetadataStorage {
  private client?: postgres.Sql;
  private db?: ReturnType<typeof drizzle>;
  // Schema configuration for future use with custom table names
  // private _schemaConfig: ResolvedSchemaConfig;

  constructor(
    private connectionUrl: string,
    metadataConfig?: MetadataStorageConfig
  ) {
    // Resolve schema configuration with defaults (for validation)
    // Schema configuration validation happens in constructor but isn't used yet
    // TODO: Implement custom table names using resolved configuration
    if (metadataConfig?.schema) {
      new SchemaConfigResolver(metadataConfig);
    }
  }

  async initialize(): Promise<void> {
    if (this.db) return;

    try {
      this.client = postgres(this.connectionUrl);
      this.db = drizzle(this.client);

      // Test connection by attempting a simple query
      await this.db.execute(sql`SELECT 1`);
    } catch (error) {
      const sanitizedError = ErrorHandler.sanitize(error);
      throw MetadataStorageError.initializationFailed(sanitizedError.message);
    }
  }

  async saveExecution(execution: MetadataExecution): Promise<void> {
    if (!this.db) {
      throw MetadataStorageError.initializationFailed('Storage not initialized');
    }

    try {
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
    } catch (error) {
      const sanitizedError = ErrorHandler.sanitize(error);
      throw MetadataStorageError.saveExecutionFailed(execution.ruleId, sanitizedError);
    }
  }

  async getHistoricalData(ruleId: string, days: number): Promise<MetadataExecution[]> {
    if (!this.db) {
      throw MetadataStorageError.initializationFailed('Storage not initialized');
    }

    try {
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
    } catch (error) {
      const sanitizedError = ErrorHandler.sanitize(error);
      throw MetadataStorageError.getHistoricalDataFailed(ruleId, days, sanitizedError);
    }
  }

  async saveRule(rule: MonitoringRule): Promise<void> {
    if (!this.db) {
      throw MetadataStorageError.initializationFailed('Storage not initialized');
    }

    try {
      await this.db
        .insert(monitoringRules)
        .values({
          id: rule.id,
          sourceId: rule.sourceId,
          name: rule.name,
          ruleType: rule.ruleType,
          tableName: rule.tableName,
          checkIntervalMinutes: rule.checkIntervalMinutes,
          isActive: rule.isActive,
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt,
        })
        .onConflictDoUpdate({
          target: monitoringRules.id,
          set: {
            name: rule.name,
            ruleType: rule.ruleType,
            updatedAt: rule.updatedAt,
          },
        });
    } catch (error) {
      const sanitizedError = ErrorHandler.sanitize(error);
      throw MetadataStorageError.saveRuleFailed(rule.id, sanitizedError);
    }
  }

  async getRule(ruleId: string): Promise<MonitoringRule | null> {
    if (!this.db) {
      throw MetadataStorageError.initializationFailed('Storage not initialized');
    }

    try {
      const results = await this.db
        .select({
          id: monitoringRules.id,
          sourceId: monitoringRules.sourceId,
          name: monitoringRules.name,
          tableName: monitoringRules.tableName,
          ruleType: monitoringRules.ruleType,
          checkIntervalMinutes: monitoringRules.checkIntervalMinutes,
          isActive: monitoringRules.isActive,
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
        sourceId: row.sourceId,
        name: row.name,
        tableName: row.tableName,
        ruleType: row.ruleType as import('../types.js').RuleType,
        checkIntervalMinutes: row.checkIntervalMinutes || 5,
        isActive: row.isActive || false,
        createdAt: row.createdAt || new Date(),
        updatedAt: row.updatedAt || new Date(),
      };
    } catch (error) {
      const sanitizedError = ErrorHandler.sanitize(error);
      throw MetadataStorageError.getRuleFailed(ruleId, sanitizedError);
    }
  }

  async storeSchemaBaseline(baseline: SchemaBaseline, adaptationReason?: string): Promise<void> {
    if (!this.db) {
      throw MetadataStorageError.initializationFailed('Database not initialized');
    }

    try {
      // Use Drizzle with ON CONFLICT to handle updates
      await this.db
        .insert(schemaBaselines)
        .values({
          ruleId: baseline.ruleId,
          tableName: baseline.tableName,
          schemaSnapshot: baseline.schema,
          schemaHash: baseline.schemaHash,
          capturedAt: baseline.capturedAt,
          updatedAt: new Date(),
          adaptationReason: adaptationReason || null,
        })
        .onConflictDoUpdate({
          target: [schemaBaselines.ruleId],
          set: {
            tableName: baseline.tableName,
            schemaSnapshot: baseline.schema,
            schemaHash: baseline.schemaHash,
            capturedAt: baseline.capturedAt,
            updatedAt: new Date(),
            adaptationReason: adaptationReason || null,
          },
        });
    } catch (error) {
      const sanitizedError = ErrorHandler.sanitize(error);
      throw new MetadataStorageError(
        'Failed to store schema baseline',
        'storeSchemaBaseline',
        { ruleId: baseline.ruleId },
        sanitizedError
      );
    }
  }

  async getSchemaBaseline(ruleId: string): Promise<SchemaBaseline | null> {
    if (!this.db) {
      throw MetadataStorageError.initializationFailed('Database not initialized');
    }

    try {
      const results = await this.db
        .select({
          ruleId: schemaBaselines.ruleId,
          tableName: schemaBaselines.tableName,
          schema: schemaBaselines.schemaSnapshot,
          schemaHash: schemaBaselines.schemaHash,
          capturedAt: schemaBaselines.capturedAt,
        })
        .from(schemaBaselines)
        .where(sql`${schemaBaselines.ruleId} = ${ruleId}`)
        .limit(1);

      if (results.length === 0) return null;

      const row = results[0];
      if (!row) return null;

      return {
        ruleId: row.ruleId,
        tableName: row.tableName,
        schema: row.schema as any, // JSONB column
        schemaHash: row.schemaHash,
        capturedAt: row.capturedAt,
      };
    } catch (error) {
      const sanitizedError = ErrorHandler.sanitize(error);
      throw new MetadataStorageError(
        'Failed to get schema baseline',
        'getSchemaBaseline',
        { ruleId },
        sanitizedError
      );
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = undefined;
      this.db = undefined;
    }
  }
}