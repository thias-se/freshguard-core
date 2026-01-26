/**
 * Secure freshness monitoring algorithm
 * Checks if data is stale based on last update timestamp with built-in security measures
 *
 * Security features:
 * - Input validation to prevent SQL injection
 * - Error sanitization to prevent information disclosure
 * - Timeout protection against long-running queries
 * - Safe parameter validation
 *
 * @module @thias-se/freshguard-core/monitor/freshness
 * @license MIT
 */

import type { CheckResult, MonitoringRule, FreshGuardConfig, DebugConfig } from '../types.js';
import type { Database } from '../db/index.js';
import type { MetadataStorage } from '../metadata/interface.js';
import { sql } from 'drizzle-orm';
import { validateTableName, validateColumnName } from '../validators/index.js';
import {
  QueryError,
  TimeoutError,
  ConfigurationError,
  ErrorHandler
} from '../errors/index.js';
import { DebugErrorFactory, mergeDebugConfig } from '../errors/debug-factory.js';
import type { QueryContext } from '../errors/debug-factory.js';

/**
 * Check data freshness for a given rule with security validation
 *
 * @param db - Database connection
 * @param rule - Monitoring rule configuration
 * @param metadataStorage - Optional metadata storage for execution history
 * @param config - Optional configuration including debug settings
 * @returns CheckResult with freshness status and sanitized error messages
 */
export async function checkFreshness(
  db: Database,
  rule: MonitoringRule,
  metadataStorage?: MetadataStorage,
  config?: FreshGuardConfig
): Promise<CheckResult> {
  const startTime = Date.now();
  const debugConfig = mergeDebugConfig(config?.debug);
  const debugFactory = new DebugErrorFactory(debugConfig);
  const debugId = `fg-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;

  try {
    // Log debug info at start
    if (debugConfig.enabled) {
      console.log(`[DEBUG-${debugId}] Starting freshness check:`, {
        table: rule.tableName,
        ruleId: rule.id,
        timestamp: new Date().toISOString()
      });
    }

    // Validate input parameters for security
    validateFreshnessRule(rule);

    const timestampColumn = rule.timestampColumn || 'updated_at';
    const toleranceMinutes = rule.toleranceMinutes || 60;

    // Validate table and column names to prevent SQL injection
    validateTableName(rule.tableName);
    validateColumnName(timestampColumn);

    // Validate tolerance parameter range
    if (toleranceMinutes < 1 || toleranceMinutes > 10080) { // 1 minute to 1 week
      throw new ConfigurationError('Tolerance minutes must be between 1 and 10080 (1 week)');
    }

    // Execute query with timeout protection
    const queryResult = await executeWithTimeout(
      () => executeFreshnessQuery(db, rule.tableName, timestampColumn, debugConfig, debugFactory),
      config?.timeoutMs || 30000, // Use config timeout or default
      'Freshness check query timeout'
    );

    if (!queryResult?.row) {
      throw new QueryError('Query returned no results', 'freshness_query', rule.tableName);
    }

    const { rowCount, lastUpdate } = queryResult;

    // Validate row count is a valid number
    if (isNaN(rowCount) || rowCount < 0) {
      throw new QueryError('Invalid row count returned from query', 'freshness_query', rule.tableName);
    }

    // If table is empty, return alert with sanitized message
    if (rowCount === 0) {
      const executedAt = new Date();
      const executionDurationMs = Date.now() - startTime;

      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'alert',
        rowCount: 0,
        executionDurationMs,
        executedAt,
        error: 'Table is empty',
      }, debugConfig);

      return createSecureCheckResult('alert', {
        rowCount: 0,
        error: 'Table is empty',
        executionDurationMs,
        executedAt,
      });
    }

    // If no timestamp found, return alert
    if (!lastUpdate) {
      const executedAt = new Date();
      const executionDurationMs = Date.now() - startTime;

      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'alert',
        rowCount,
        executionDurationMs,
        executedAt,
        error: 'No timestamp found in specified column',
      }, debugConfig);

      return createSecureCheckResult('alert', {
        rowCount,
        error: 'No timestamp found in specified column',
        executionDurationMs,
        executedAt,
      });
    }

    // Calculate lag in minutes with safety checks
    const currentTime = Date.now();
    const updateTime = new Date(lastUpdate).getTime();

    // Validate timestamp is not in the future by more than 1 hour (clock skew tolerance)
    if (updateTime > currentTime + 3600000) {
      throw new QueryError('Invalid timestamp: future date detected', 'freshness_query', rule.tableName);
    }

    const lagMs = currentTime - updateTime;
    const lagMinutes = Math.floor(lagMs / 60000);

    // Determine status
    const isStale = lagMinutes > toleranceMinutes;
    const status = isStale ? 'alert' : 'ok';
    const executedAt = new Date();
    const executionDurationMs = Date.now() - startTime;
    const safeLagMinutes = Math.max(0, lagMinutes); // Ensure non-negative

    await saveExecutionResult(metadataStorage, {
      ruleId: rule.id,
      status,
      rowCount,
      lagMinutes: safeLagMinutes,
      executionDurationMs,
      executedAt,
    }, debugConfig);

    return createSecureCheckResult(status, {
      rowCount,
      lastUpdate: new Date(lastUpdate),
      lagMinutes: safeLagMinutes,
      executionDurationMs,
      executedAt,
    });

  } catch (error) {
    // Use secure error handling to prevent information disclosure
    const userMessage = ErrorHandler.getUserMessage(error);
    const executedAt = new Date();
    const executionDurationMs = Date.now() - startTime;

    // Log debug error information
    if (debugConfig.enabled) {
      console.error(`[DEBUG-${debugId}] Freshness check failed:`, {
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
        error: userMessage,
      }, debugConfig);
    }

    // Create result with debug information
    const result = createSecureCheckResult('failed', {
      error: userMessage,
      executionDurationMs,
      executedAt,
      debugId,
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
    rowCount?: number;
    lagMinutes?: number;
    executionDurationMs: number;
    executedAt: Date;
    error?: string;
  },
  debugConfig?: DebugConfig
): Promise<void> {
  if (!metadataStorage) return;

  try {
    await metadataStorage.saveExecution({
      ruleId: execution.ruleId,
      status: execution.status,
      rowCount: execution.rowCount,
      lagMinutes: execution.lagMinutes,
      executionDurationMs: execution.executionDurationMs,
      executedAt: execution.executedAt,
      error: execution.error,
    });
  } catch (error) {
    // Enhanced error logging instead of console.warn
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (debugConfig?.enabled) {
      console.error('[DEBUG] Failed to save execution history:', {
        ruleId: execution.ruleId,
        error: errorMessage,
        rawError: debugConfig.exposeRawErrors ? errorMessage : undefined
      });
    } else {
      // Production: use structured logging if available, fallback to console
      console.warn(`Failed to save execution history for rule ${execution.ruleId}: ${errorMessage}`);
    }
  }
}

/**
 * Validate monitoring rule parameters for security
 */
function validateFreshnessRule(rule: MonitoringRule): void {
  if (!rule) {
    throw new ConfigurationError('Monitoring rule is required');
  }

  if (!rule.tableName || typeof rule.tableName !== 'string') {
    throw new ConfigurationError('Table name is required and must be a string');
  }

  if (rule.tableName.length > 256) {
    throw new ConfigurationError('Table name too long (max 256 characters)');
  }

  if (rule.timestampColumn && typeof rule.timestampColumn !== 'string') {
    throw new ConfigurationError('Timestamp column must be a string');
  }

  if (rule.timestampColumn && rule.timestampColumn.length > 256) {
    throw new ConfigurationError('Timestamp column name too long (max 256 characters)');
  }

  if (rule.toleranceMinutes && (typeof rule.toleranceMinutes !== 'number' || !Number.isInteger(rule.toleranceMinutes))) {
    throw new ConfigurationError('Tolerance minutes must be an integer');
  }

  // Validate rule type matches
  if (rule.ruleType !== 'freshness') {
    throw new ConfigurationError('Rule type must be "freshness" for freshness checks');
  }
}

/**
 * Execute freshness query with proper error handling
 */
async function executeFreshnessQuery(
  db: Database,
  tableName: string,
  timestampColumn: string,
  debugConfig: DebugConfig,
  debugFactory: DebugErrorFactory
): Promise<{ rowCount: number; lastUpdate: Date | null; row: any }> {
  const startTime = performance.now();

  // Build secure query using parameterized identifiers
  const query = sql`
    SELECT
      COUNT(*) as row_count,
      MAX(${sql.identifier(timestampColumn)}) as last_update
    FROM ${sql.identifier(tableName)}
  `;

  const queryString = `SELECT COUNT(*) as row_count, MAX(${timestampColumn}) as last_update FROM ${tableName}`;

  const queryContext: QueryContext = {
    sql: queryString,
    params: [],
    table: tableName,
    column: timestampColumn,
    operation: 'freshness_query'
  };

  try {
    // Log query in debug mode
    if (debugConfig.enabled) {
      console.log(`[DEBUG] Executing freshness query:`, {
        table: tableName,
        column: timestampColumn,
        query: debugConfig.exposeQueries ? queryContext.sql : '[SQL hidden]'
      });
    }

    const result = await db.execute(query);
    const row = result[0] as { row_count: string; last_update: Date | null };

    queryContext.duration = performance.now() - startTime;

    if (!row) {
      throw debugFactory.createQueryError(
        'Query returned empty result set',
        undefined,
        queryContext
      );
    }

    const rowCount = parseInt(row.row_count, 10);
    const lastUpdate = row.last_update;

    return { rowCount, lastUpdate, row };
  } catch (error) {
    queryContext.duration = performance.now() - startTime;

    // Create enhanced error with debug context
    throw debugFactory.createQueryError(
      'Failed to execute freshness query',
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
      reject(new TimeoutError(timeoutMessage, 'freshness_check', timeoutMs));
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
