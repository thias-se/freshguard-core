/**
 * Schema baseline management for schema change monitoring
 * Handles storage, retrieval and comparison of database schema baselines
 *
 * Security features:
 * - Input validation to prevent SQL injection
 * - Safe schema comparison algorithms
 * - Sanitized error messages
 *
 * @module @thias-se/freshguard-core/monitor/schema-baseline
 * @license MIT
 */

import type { SchemaBaseline, SchemaChanges, ColumnChange } from '../types.js';
import type { TableSchema } from '../types/connector.js';
import type { MetadataStorage } from '../metadata/interface.js';
import { ConfigurationError, MetadataStorageError } from '../errors/index.js';
import { createHash } from 'crypto';

/**
 * Manager for schema baseline operations
 */
export class SchemaBaselineManager {
  /**
   * Store a new schema baseline
   */
  async storeBaseline(
    metadataStorage: MetadataStorage,
    ruleId: string,
    tableName: string,
    schema: TableSchema,
    adaptationReason?: string
  ): Promise<void> {
    if (!metadataStorage) {
      throw new ConfigurationError('Metadata storage is required for schema baseline management');
    }

    if (!ruleId || typeof ruleId !== 'string') {
      throw new ConfigurationError('Rule ID is required and must be a string');
    }

    if (!tableName || typeof tableName !== 'string') {
      throw new ConfigurationError('Table name is required and must be a string');
    }

    if (!schema?.table || !Array.isArray(schema.columns)) {
      throw new ConfigurationError('Valid table schema is required');
    }

    try {
      const schemaHash = this.generateSchemaHash(schema);
      const baseline: SchemaBaseline = {
        ruleId,
        tableName,
        schema,
        capturedAt: new Date(),
        schemaHash
      };

      await metadataStorage.storeSchemaBaseline(baseline, adaptationReason);
    } catch (error) {
      throw new MetadataStorageError(
        'Failed to store schema baseline',
        'schema_baseline_storage',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get existing schema baseline for a rule
   */
  async getBaseline(metadataStorage: MetadataStorage, ruleId: string): Promise<SchemaBaseline | null> {
    if (!metadataStorage) {
      throw new ConfigurationError('Metadata storage is required for schema baseline management');
    }

    if (!ruleId || typeof ruleId !== 'string') {
      throw new ConfigurationError('Rule ID is required and must be a string');
    }

    try {
      return await metadataStorage.getSchemaBaseline(ruleId);
    } catch (error) {
      throw new MetadataStorageError(
        'Failed to retrieve schema baseline',
        'schema_baseline_retrieval',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update existing baseline with new schema
   */
  async updateBaseline(
    metadataStorage: MetadataStorage,
    ruleId: string,
    newSchema: TableSchema,
    adaptationReason: string
  ): Promise<void> {
    if (!metadataStorage) {
      throw new ConfigurationError('Metadata storage is required for schema baseline management');
    }

    if (!adaptationReason || typeof adaptationReason !== 'string') {
      throw new ConfigurationError('Adaptation reason is required for baseline updates');
    }

    await this.storeBaseline(metadataStorage, ruleId, newSchema.table, newSchema, adaptationReason);
  }

  /**
   * Generate consistent hash for schema comparison
   */
  private generateSchemaHash(schema: TableSchema): string {
    // Create deterministic string representation of schema
    const normalizedColumns = schema.columns
      .slice() // Create copy to avoid mutation
      .sort((a, b) => a.name.localeCompare(b.name)) // Sort by name for consistency
      .map(col => `${col.name}:${col.type.toLowerCase()}:${col.nullable ? 'null' : 'notnull'}`)
      .join('|');

    const schemaString = `${schema.table}:${normalizedColumns}`;
    return createHash('sha256').update(schemaString).digest('hex');
  }
}

/**
 * Schema comparison utility
 */
export class SchemaComparer {
  /**
   * Compare two schemas and detect changes
   */
  compareSchemas(
    baseline: TableSchema,
    current: TableSchema,
    config: {
      trackTypes?: boolean;
      trackNullability?: boolean;
      trackedColumns?: string[];
      monitoringMode?: 'full' | 'partial';
    } = {}
  ): SchemaChanges {
    if (!baseline || !current) {
      throw new ConfigurationError('Both baseline and current schemas are required for comparison');
    }

    const trackTypes = config.trackTypes !== false; // Default: true
    const trackNullability = config.trackNullability === true; // Default: false
    const monitoringMode = config.monitoringMode || 'full';

    // Create column maps for efficient lookup
    const baselineColumns = new Map(baseline.columns.map(col => [col.name, col]));
    const currentColumns = new Map(current.columns.map(col => [col.name, col]));

    const addedColumns: ColumnChange[] = [];
    const removedColumns: ColumnChange[] = [];
    const modifiedColumns: ColumnChange[] = [];

    // If partial mode, filter to only tracked columns
    const columnsToCheck = monitoringMode === 'partial' && config.trackedColumns
      ? config.trackedColumns
      : Array.from(new Set([...baselineColumns.keys(), ...currentColumns.keys()]));

    // Check for added columns
    for (const [columnName, column] of currentColumns) {
      if (!columnsToCheck.includes(columnName)) continue;

      if (!baselineColumns.has(columnName)) {
        addedColumns.push({
          columnName,
          changeType: 'added',
          newValue: `${column.type}${column.nullable ? ' NULL' : ' NOT NULL'}`,
          impact: 'safe'
        });
      }
    }

    // Check for removed columns and modifications
    for (const [columnName, baselineColumn] of baselineColumns) {
      if (!columnsToCheck.includes(columnName)) continue;

      const currentColumn = currentColumns.get(columnName);

      if (!currentColumn) {
        // Column was removed
        removedColumns.push({
          columnName,
          changeType: 'removed',
          oldValue: `${baselineColumn.type}${baselineColumn.nullable ? ' NULL' : ' NOT NULL'}`,
          impact: 'breaking'
        });
      } else if (trackTypes || trackNullability) {
        // Check for type or nullability changes
        const changes: ColumnChange[] = [];

        if (trackTypes && this.normalizeType(baselineColumn.type) !== this.normalizeType(currentColumn.type)) {
          changes.push({
            columnName,
            changeType: 'type_changed',
            oldValue: baselineColumn.type,
            newValue: currentColumn.type,
            impact: this.determineTypeChangeImpact(baselineColumn.type, currentColumn.type)
          });
        }

        if (trackNullability && baselineColumn.nullable !== currentColumn.nullable) {
          changes.push({
            columnName,
            changeType: 'nullability_changed',
            oldValue: baselineColumn.nullable ? 'NULL' : 'NOT NULL',
            newValue: currentColumn.nullable ? 'NULL' : 'NOT NULL',
            impact: currentColumn.nullable ? 'safe' : 'breaking' // Adding NOT NULL is breaking
          });
        }

        modifiedColumns.push(...changes);
      }
    }

    // Calculate summary
    const changeCount = addedColumns.length + removedColumns.length + modifiedColumns.length;
    const hasChanges = changeCount > 0;

    // Determine severity based on impact
    const severity = this.calculateSeverity(addedColumns, removedColumns, modifiedColumns);

    // Generate summary message
    const summary = this.generateSummary(addedColumns, removedColumns, modifiedColumns);

    return {
      hasChanges,
      addedColumns,
      removedColumns,
      modifiedColumns,
      summary,
      changeCount,
      severity
    };
  }

  /**
   * Normalize database type names for comparison
   */
  private normalizeType(type: string): string {
    return type.toLowerCase()
      .replace(/varchar\(\d+\)/g, 'varchar')
      .replace(/char\(\d+\)/g, 'char')
      .replace(/decimal\(\d+,?\d*\)/g, 'decimal')
      .replace(/numeric\(\d+,?\d*\)/g, 'numeric')
      .trim();
  }

  /**
   * Determine impact level for type changes
   */
  private determineTypeChangeImpact(oldType: string, newType: string): 'safe' | 'warning' | 'breaking' {
    const normalizedOld = this.normalizeType(oldType);
    const normalizedNew = this.normalizeType(newType);

    // Safe expansions (usually backwards compatible)
    const safeChanges = [
      ['varchar', 'text'],
      ['int', 'bigint'],
      ['integer', 'bigint'],
      ['int', 'numeric'],
      ['integer', 'numeric'],
      ['smallint', 'int'],
      ['smallint', 'integer'],
      ['smallint', 'bigint']
    ];

    for (const [from, to] of safeChanges) {
      if (normalizedOld === from && normalizedNew === to) {
        return 'safe';
      }
    }

    // Warning changes (might be compatible but risky)
    const warningChanges = [
      ['bigint', 'int'],
      ['numeric', 'int'],
      ['text', 'varchar']
    ];

    for (const [from, to] of warningChanges) {
      if (normalizedOld === from && normalizedNew === to) {
        return 'warning';
      }
    }

    // Everything else is potentially breaking
    return 'breaking';
  }

  /**
   * Calculate overall severity based on changes
   */
  private calculateSeverity(
    addedColumns: ColumnChange[],
    removedColumns: ColumnChange[],
    modifiedColumns: ColumnChange[]
  ): 'low' | 'medium' | 'high' {
    const allChanges = [...addedColumns, ...removedColumns, ...modifiedColumns];

    if (allChanges.some(change => change.impact === 'breaking')) {
      return 'high';
    }

    if (allChanges.some(change => change.impact === 'warning') || removedColumns.length > 0) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    addedColumns: ColumnChange[],
    removedColumns: ColumnChange[],
    modifiedColumns: ColumnChange[]
  ): string {
    const parts: string[] = [];

    if (addedColumns.length > 0) {
      parts.push(`${addedColumns.length} column${addedColumns.length === 1 ? '' : 's'} added`);
    }

    if (removedColumns.length > 0) {
      parts.push(`${removedColumns.length} column${removedColumns.length === 1 ? '' : 's'} removed`);
    }

    if (modifiedColumns.length > 0) {
      const typeChanges = modifiedColumns.filter(c => c.changeType === 'type_changed').length;
      const nullabilityChanges = modifiedColumns.filter(c => c.changeType === 'nullability_changed').length;

      if (typeChanges > 0) {
        parts.push(`${typeChanges} type change${typeChanges === 1 ? '' : 's'}`);
      }
      if (nullabilityChanges > 0) {
        parts.push(`${nullabilityChanges} nullability change${nullabilityChanges === 1 ? '' : 's'}`);
      }
    }

    return parts.length > 0 ? parts.join(', ') : 'No changes detected';
  }
}