/**
 * Schema change monitoring algorithm
 * Detects database schema changes and alerts based on configuration
 *
 * Security features:
 * - Input validation to prevent SQL injection
 * - Error sanitization to prevent information disclosure
 * - Timeout protection against long-running queries
 * - Safe parameter validation
 *
 * @module @thias-se/freshguard-core/monitor/schema-changes
 * @license MIT
 */

import type { CheckResult, MonitoringRule, FreshGuardConfig, DebugConfig, SchemaChanges } from '../types.js';
import type { Connector } from '../types/connector.js';
import type { MetadataStorage } from '../metadata/interface.js';
import { validateTableName } from '../validators/index.js';
import {
  QueryError,
  TimeoutError,
  ConfigurationError,
  ErrorHandler
} from '../errors/index.js';
import { DebugErrorFactory, mergeDebugConfig } from '../errors/debug-factory.js';
import type { QueryContext } from '../errors/debug-factory.js';
import { SchemaBaselineManager, SchemaComparer } from './schema-baseline.js';

/**
 * Check database schema changes for a given rule with security validation
 *
 * @param connector - Database connector instance
 * @param rule - Monitoring rule configuration
 * @param metadataStorage - Optional metadata storage for baseline persistence
 * @param config - Optional configuration including debug settings
 * @returns CheckResult with schema change status and sanitized error messages
 */
export async function checkSchemaChanges(
  connector: Connector,
  rule: MonitoringRule,
  metadataStorage?: MetadataStorage,
  config?: FreshGuardConfig
): Promise<CheckResult> {
  const startTime = Date.now();
  const debugConfig = mergeDebugConfig(config?.debug);
  const debugFactory = new DebugErrorFactory(debugConfig);
  const debugId = `fg-schema-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;

  try {
    // Log debug info at start
    if (debugConfig.enabled) {
      console.log(`[DEBUG-${debugId}] Starting schema change check:`, {
        table: rule.tableName,
        ruleId: rule.id,
        timestamp: new Date().toISOString()
      });
    }

    // Validate input parameters for security
    validateSchemaChangeRule(rule);
    validateTableName(rule.tableName);

    // Initialize managers
    const baselineManager = new SchemaBaselineManager();
    const schemaComparer = new SchemaComparer();

    // Get configuration with defaults
    const schemaConfig = rule.schemaChangeConfig || {};
    const adaptationMode = schemaConfig.adaptationMode || 'manual';
    const monitoringMode = schemaConfig.monitoringMode || 'full';
    const trackTypes = schemaConfig.trackedColumns?.trackTypes !== false;
    const trackNullability = schemaConfig.trackedColumns?.trackNullability === true;

    // Execute schema introspection with timeout protection
    const currentSchema = await executeWithTimeout(
      () => executeSchemaQuery(connector, rule.tableName, debugConfig, debugFactory),
      config?.timeoutMs || 30000,
      'Schema introspection query timeout'
    );

    if (!currentSchema) {
      throw new QueryError('Failed to retrieve current schema', 'schema_query', rule.tableName);
    }

    // Get existing baseline if available
    let baseline: import('../types.js').SchemaBaseline | null = null;
    if (metadataStorage) {
      baseline = await baselineManager.getBaseline(metadataStorage, rule.id);
    }

    // Handle first run - capture baseline and return OK
    if (!baseline) {
      if (debugConfig.enabled) {
        console.log(`[DEBUG-${debugId}] No baseline found, capturing initial schema`);
      }

      if (metadataStorage) {
        await baselineManager.storeBaseline(
          metadataStorage,
          rule.id,
          rule.tableName,
          currentSchema,
          'Initial baseline capture'
        );
      }

      const executedAt = new Date();
      const executionDurationMs = Date.now() - startTime;

      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'ok',
        executionDurationMs,
        executedAt,
        schemaChanges: {
          hasChanges: false,
          addedColumns: [],
          removedColumns: [],
          modifiedColumns: [],
          summary: 'Initial baseline captured',
          changeCount: 0,
          severity: 'low' as const
        }
      }, debugConfig);

      return createSecureCheckResult('ok', {
        executionDurationMs,
        executedAt,
        schemaChanges: {
          hasChanges: false,
          addedColumns: [],
          removedColumns: [],
          modifiedColumns: [],
          summary: 'Initial baseline captured',
          changeCount: 0,
          severity: 'low' as const
        }
      });
    }

    // Compare current schema with baseline
    const schemaChanges = schemaComparer.compareSchemas(
      baseline.schema,
      currentSchema,
      {
        trackTypes,
        trackNullability,
        trackedColumns: schemaConfig.trackedColumns?.columns,
        monitoringMode
      }
    );

    // Determine if we should alert or adapt
    let shouldAlert = schemaChanges.hasChanges;
    let shouldUpdateBaseline = false;
    let adaptationReason = '';

    if (schemaChanges.hasChanges) {
      switch (adaptationMode) {
        case 'auto':
          // Auto-adapt to safe changes only
          const hasSafeChangesOnly = [...schemaChanges.addedColumns, ...schemaChanges.modifiedColumns]
            .every(change => change.impact === 'safe') && schemaChanges.removedColumns.length === 0;

          if (hasSafeChangesOnly) {
            shouldAlert = false;
            shouldUpdateBaseline = true;
            adaptationReason = `Auto-adaptation: ${schemaChanges.summary}`;
          }
          break;

        case 'alert_only':
          // Always alert, never update baseline
          shouldAlert = true;
          shouldUpdateBaseline = false;
          break;

        case 'manual':
        default:
          // Alert on changes, require manual baseline update
          shouldAlert = true;
          shouldUpdateBaseline = false;
          break;
      }
    }

    // Update baseline if needed
    if (shouldUpdateBaseline && metadataStorage) {
      await baselineManager.updateBaseline(
        metadataStorage,
        rule.id,
        currentSchema,
        adaptationReason
      );
    }

    // Determine status
    const status = shouldAlert ? 'alert' : 'ok';
    const executedAt = new Date();
    const executionDurationMs = Date.now() - startTime;

    // Save execution result
    await saveExecutionResult(metadataStorage, {
      ruleId: rule.id,
      status,
      executionDurationMs,
      executedAt,
      schemaChanges
    }, debugConfig);

    if (debugConfig.enabled) {
      console.log(`[DEBUG-${debugId}] Schema check completed:`, {
        status,
        hasChanges: schemaChanges.hasChanges,
        changeCount: schemaChanges.changeCount,
        summary: schemaChanges.summary,
        adaptationMode,
        baselineUpdated: shouldUpdateBaseline
      });
    }

    return createSecureCheckResult(status, {
      executionDurationMs,
      executedAt,
      schemaChanges,
      debugId
    });

  } catch (error) {
    // Use secure error handling to prevent information disclosure
    const userMessage = ErrorHandler.getUserMessage(error);
    const executedAt = new Date();
    const executionDurationMs = Date.now() - startTime;

    // Log debug error information
    if (debugConfig.enabled) {
      console.error(`[DEBUG-${debugId}] Schema change check failed:`, {
        table: rule.tableName,
        ruleId: rule.id,
        error: userMessage,
        rawError: debugConfig.exposeRawErrors && error instanceof Error ? error.message : undefined,
        duration: executionDurationMs
      });
    }

    if (rule?.id) {
      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'failed',
        executionDurationMs,
        executedAt,
        error: userMessage
      }, debugConfig);
    }

    // Create result with debug information
    const result = createSecureCheckResult('failed', {
      error: userMessage,
      executionDurationMs,
      executedAt,
      debugId
    });

    // Add debug information if available
    if (debugConfig.enabled && error instanceof Error && 'debug' in error) {
      result.debug = (error as any).debug;
    }

    return result;
  }
}

/**
 * Save execution result to metadata storage with error handling
 */
async function saveExecutionResult(
  metadataStorage: MetadataStorage | undefined,
  execution: {
    ruleId: string;
    status: 'ok' | 'alert' | 'failed';
    executionDurationMs: number;
    executedAt: Date;
    schemaChanges?: SchemaChanges;
    error?: string;
  },
  debugConfig?: DebugConfig
): Promise<void> {
  if (!metadataStorage) return;

  try {
    await metadataStorage.saveExecution({
      ruleId: execution.ruleId,
      status: execution.status,
      executionDurationMs: execution.executionDurationMs,
      executedAt: execution.executedAt,
      schemaChanges: execution.schemaChanges,
      error: execution.error
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (debugConfig?.enabled) {
      console.error('[DEBUG] Failed to save schema check execution history:', {
        ruleId: execution.ruleId,
        error: errorMessage,
        rawError: debugConfig.exposeRawErrors ? errorMessage : undefined
      });
    } else {
      console.warn(`Failed to save execution history for rule ${execution.ruleId}: ${errorMessage}`);
    }
  }
}

/**
 * Validate monitoring rule parameters for security
 */
function validateSchemaChangeRule(rule: MonitoringRule): void {
  if (!rule) {
    throw new ConfigurationError('Monitoring rule is required');
  }

  if (!rule.tableName || typeof rule.tableName !== 'string') {
    throw new ConfigurationError('Table name is required and must be a string');
  }

  if (rule.tableName.length > 256) {
    throw new ConfigurationError('Table name too long (max 256 characters)');
  }

  // Validate rule type matches
  if (rule.ruleType !== 'schema_change') {
    throw new ConfigurationError('Rule type must be "schema_change" for schema change checks');
  }

  // Validate schema change configuration if provided
  const config = rule.schemaChangeConfig;
  if (config) {
    if (config.adaptationMode && !['auto', 'manual', 'alert_only'].includes(config.adaptationMode)) {
      throw new ConfigurationError('Invalid adaptation mode. Must be auto, manual, or alert_only');
    }

    if (config.monitoringMode && !['full', 'partial'].includes(config.monitoringMode)) {
      throw new ConfigurationError('Invalid monitoring mode. Must be full or partial');
    }

    if (config.trackedColumns?.columns && !Array.isArray(config.trackedColumns.columns)) {
      throw new ConfigurationError('Tracked columns must be an array');
    }

    if (config.baselineRefreshDays && (typeof config.baselineRefreshDays !== 'number' || config.baselineRefreshDays < 1)) {
      throw new ConfigurationError('Baseline refresh days must be a positive number');
    }
  }
}

/**
 * Execute schema introspection using connector methods with proper error handling
 */
async function executeSchemaQuery(
  connector: Connector,
  tableName: string,
  debugConfig: DebugConfig,
  debugFactory: DebugErrorFactory
): Promise<import('../types/connector.js').TableSchema> {
  const startTime = performance.now();

  const queryContext: QueryContext = {
    sql: `connector.getTableSchema('${tableName}')`,
    params: [],
    table: tableName,
    operation: 'schema_query'
  };

  try {
    // Log connector operation in debug mode
    if (debugConfig.enabled) {
      console.log(`[DEBUG] Executing schema introspection via connector:`, {
        table: tableName,
        operation: debugConfig.exposeQueries
          ? `getTableSchema('${tableName}')`
          : '[Schema introspection operation hidden]'
      });
    }

    const schema = await connector.getTableSchema(tableName);

    queryContext.duration = performance.now() - startTime;

    // Validate schema result
    if (!schema || typeof schema !== 'object') {
      throw debugFactory.createQueryError(
        'Invalid schema returned from connector',
        undefined,
        queryContext
      );
    }

    if (!schema.table || typeof schema.table !== 'string') {
      throw debugFactory.createQueryError(
        'Schema missing table name',
        undefined,
        queryContext
      );
    }

    if (!Array.isArray(schema.columns) || schema.columns.length === 0) {
      throw debugFactory.createQueryError(
        'Schema missing or empty columns array',
        undefined,
        queryContext
      );
    }

    // Validate each column
    for (const column of schema.columns) {
      if (!column.name || typeof column.name !== 'string') {
        throw debugFactory.createQueryError(
          'Invalid column name in schema',
          undefined,
          queryContext
        );
      }

      if (!column.type || typeof column.type !== 'string') {
        throw debugFactory.createQueryError(
          'Invalid column type in schema',
          undefined,
          queryContext
        );
      }

      if (typeof column.nullable !== 'boolean') {
        throw debugFactory.createQueryError(
          'Invalid column nullable flag in schema',
          undefined,
          queryContext
        );
      }
    }

    return schema;
  } catch (error) {
    queryContext.duration = performance.now() - startTime;

    // Create enhanced error with debug context
    throw debugFactory.createQueryError(
      'Failed to execute schema introspection via connector',
      error instanceof Error ? error : undefined,
      queryContext
    );
  }
}

/**
 * Execute operation with timeout protection
 */
async function executeWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMessage, 'schema_check', timeoutMs));
    }, timeoutMs);

    operation()
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

/**
 * Create secure check result with consistent structure
 */
function createSecureCheckResult(status: CheckResult['status'], data: Partial<CheckResult>): CheckResult {
  return {
    status,
    executedAt: data.executedAt || new Date(),
    executionDurationMs: data.executionDurationMs,
    ...data
  };
}