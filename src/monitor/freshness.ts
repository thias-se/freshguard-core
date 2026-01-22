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

import type { CheckResult, MonitoringRule } from '../types.js';
import type { Database } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { validateTableName, validateColumnName } from '../validators/index.js';
import {
  QueryError,
  TimeoutError,
  ConfigurationError,
  ErrorHandler
} from '../errors/index.js';

/**
 * Check data freshness for a given rule with security validation
 *
 * @param db - Database connection
 * @param rule - Monitoring rule configuration
 * @returns CheckResult with freshness status and sanitized error messages
 */
export async function checkFreshness(
  db: Database,
  rule: MonitoringRule
): Promise<CheckResult> {
  const startTime = Date.now();

  try {
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
      () => executeFreshnessQuery(db, rule.tableName, timestampColumn),
      30000, // 30 second timeout
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
      return createSecureCheckResult('alert', {
        rowCount: 0,
        error: 'Table is empty',
        executionDurationMs: Date.now() - startTime,
        executedAt: new Date(),
      });
    }

    // If no timestamp found, return alert
    if (!lastUpdate) {
      return createSecureCheckResult('alert', {
        rowCount,
        error: 'No timestamp found in specified column',
        executionDurationMs: Date.now() - startTime,
        executedAt: new Date(),
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

    return createSecureCheckResult(isStale ? 'alert' : 'ok', {
      rowCount,
      lastUpdate: new Date(lastUpdate),
      lagMinutes: Math.max(0, lagMinutes), // Ensure non-negative
      executionDurationMs: Date.now() - startTime,
      executedAt: new Date(),
    });

  } catch (error) {
    // Use secure error handling to prevent information disclosure
    const userMessage = ErrorHandler.getUserMessage(error);

    return createSecureCheckResult('failed', {
      error: userMessage,
      executionDurationMs: Date.now() - startTime,
      executedAt: new Date(),
    });
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
  timestampColumn: string
): Promise<{ rowCount: number; lastUpdate: Date | null; row: any }> {
  // Build secure query using parameterized identifiers
  const query = sql`
    SELECT
      COUNT(*) as row_count,
      MAX(${sql.identifier(timestampColumn)}) as last_update
    FROM ${sql.identifier(tableName)}
  `;

  try {
    const result = await db.execute(query);
    const row = result[0] as { row_count: string; last_update: Date | null };

    if (!row) {
      throw new QueryError('Query returned empty result set', 'freshness_query', tableName);
    }

    const rowCount = parseInt(row.row_count, 10);
    const lastUpdate = row.last_update;

    return { rowCount, lastUpdate, row };
  } catch (error) {
    // Re-throw with context but let error sanitizer handle the details
    throw new QueryError(
      'Failed to execute freshness query',
      'freshness_query',
      tableName,
      error instanceof Error ? error : undefined
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
