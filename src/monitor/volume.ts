/**
 * Secure volume anomaly detection algorithm
 * Detects when row counts deviate significantly from historical baseline with built-in security measures
 *
 * Security features:
 * - Input validation to prevent SQL injection
 * - Error sanitization to prevent information disclosure
 * - Timeout protection against long-running queries
 * - Historical data access controls
 * - Statistical validation and overflow protection
 *
 * @module @thias-se/freshguard-core/monitor/volume
 * @license MIT
 */

import type { CheckResult, MonitoringRule } from '../types.js';
import type { Database } from '../db/index.js';
import type { MetadataStorage } from '../metadata/interface.js';
import { sql } from 'drizzle-orm';
import { validateTableName } from '../validators/index.js';
import {
  QueryError,
  TimeoutError,
  ConfigurationError,
  MonitoringError,
  ErrorHandler
} from '../errors/index.js';

/**
 * Check volume anomaly for a given rule with security validation
 *
 * @param db - Database connection
 * @param rule - Monitoring rule configuration
 * @param metadataStorage - Metadata storage for historical data
 * @returns CheckResult with volume anomaly status and sanitized error messages
 */
export async function checkVolumeAnomaly(
  db: Database,
  rule: MonitoringRule,
  metadataStorage?: MetadataStorage
): Promise<CheckResult> {
  const startTime = Date.now();

  try {
    // Validate input parameters for security
    validateVolumeRule(rule);

    const baselineWindowDays = rule.baselineWindowDays || 30;
    const deviationThresholdPercent = rule.deviationThresholdPercent || 20;
    const minimumRowCount = rule.minimumRowCount || 0;

    // Validate table name to prevent SQL injection
    validateTableName(rule.tableName);

    // Validate configuration parameters
    validateVolumeParameters(baselineWindowDays, deviationThresholdPercent, minimumRowCount);

    // Get current row count with timeout protection
    const currentRowCount = await executeWithTimeout(
      () => getCurrentRowCount(db, rule.tableName),
      30000, // 30 second timeout
      'Volume check row count query timeout'
    );

    // Skip check if below minimum threshold
    if (currentRowCount < minimumRowCount) {
      const executedAt = new Date();
      const executionDurationMs = Date.now() - startTime;

      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'ok',
        rowCount: currentRowCount,
        deviation: 0,
        baselineAverage: currentRowCount,
        executionDurationMs,
        executedAt,
      });

      return createSecureCheckResult('ok', {
        rowCount: currentRowCount,
        deviation: 0,
        baselineAverage: currentRowCount,
        executionDurationMs,
        executedAt,
      });
    }

    // Get historical data with graceful fallback
    let historicalData: { rowCount: number }[] = [];
    if (metadataStorage) {
      try {
        const executions = await executeWithTimeout(
          () => metadataStorage.getHistoricalData(rule.id, baselineWindowDays),
          30000,
          'Volume check historical data query timeout'
        );
        historicalData = executions
          .filter(e => e.rowCount !== undefined)
          .map(e => ({ rowCount: e.rowCount! }));
      } catch (error) {
        // Graceful fallback: treat as fresh installation with no history
        console.warn(`Metadata storage unavailable, treating as fresh installation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        historicalData = [];
      }
    }

    // If not enough historical data, return ok (can't determine baseline yet)
    if (historicalData.length < 3) {
      const executedAt = new Date();
      const executionDurationMs = Date.now() - startTime;

      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'ok',
        rowCount: currentRowCount,
        deviation: 0,
        baselineAverage: currentRowCount,
        executionDurationMs,
        executedAt,
      });

      return createSecureCheckResult('ok', {
        rowCount: currentRowCount,
        deviation: 0,
        baselineAverage: currentRowCount,
        executionDurationMs,
        executedAt,
      });
    }

    // Calculate baseline statistics with security validation
    const baseline = calculateSecureBaseline(historicalData, currentRowCount);

    // Determine if this is an anomaly
    const isAnomaly = baseline.deviationPercent > deviationThresholdPercent;
    const status = isAnomaly ? 'alert' : 'ok';
    const executedAt = new Date();
    const executionDurationMs = Date.now() - startTime;

    // Save execution result to metadata storage
    await saveExecutionResult(metadataStorage, {
      ruleId: rule.id,
      status,
      rowCount: currentRowCount,
      deviation: baseline.deviationPercent,
      baselineAverage: baseline.mean,
      executionDurationMs,
      executedAt,
    });

    return createSecureCheckResult(status, {
      rowCount: currentRowCount,
      deviation: baseline.deviationPercent,
      baselineAverage: baseline.mean,
      executionDurationMs,
      executedAt,
    });

  } catch (error) {
    // Use secure error handling to prevent information disclosure
    const userMessage = ErrorHandler.getUserMessage(error);
    const executedAt = new Date();
    const executionDurationMs = Date.now() - startTime;

    if (rule?.id) {
      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'failed',
        executionDurationMs,
        executedAt,
        error: userMessage,
      });
    }

    return createSecureCheckResult('failed', {
      error: userMessage,
      executionDurationMs,
      executedAt,
    });
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
    deviation?: number;
    baselineAverage?: number;
    executionDurationMs: number;
    executedAt: Date;
    error?: string;
  }
): Promise<void> {
  if (!metadataStorage) return;

  try {
    await metadataStorage.saveExecution({
      ruleId: execution.ruleId,
      status: execution.status,
      rowCount: execution.rowCount,
      deviation: execution.deviation,
      baselineAverage: execution.baselineAverage,
      executionDurationMs: execution.executionDurationMs,
      executedAt: execution.executedAt,
      error: execution.error,
    });
  } catch (error) {
    // Don't fail the entire check if metadata storage fails
    console.warn(`Failed to save execution history: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate monitoring rule parameters for volume anomaly detection
 */
function validateVolumeRule(rule: MonitoringRule): void {
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
  if (rule.ruleType !== 'volume_anomaly') {
    throw new ConfigurationError('Rule type must be "volume_anomaly" for volume anomaly checks');
  }

  if (!rule.id || typeof rule.id !== 'string') {
    throw new ConfigurationError('Rule ID is required and must be a string');
  }
}

/**
 * Validate volume detection parameters
 */
function validateVolumeParameters(
  baselineWindowDays: number,
  deviationThresholdPercent: number,
  minimumRowCount: number
): void {
  // Validate baseline window
  if (typeof baselineWindowDays !== 'number' || !Number.isInteger(baselineWindowDays)) {
    throw new ConfigurationError('Baseline window days must be an integer');
  }
  if (baselineWindowDays < 1 || baselineWindowDays > 365) {
    throw new ConfigurationError('Baseline window days must be between 1 and 365');
  }

  // Validate deviation threshold
  if (typeof deviationThresholdPercent !== 'number' || deviationThresholdPercent < 0) {
    throw new ConfigurationError('Deviation threshold percent must be a positive number');
  }
  if (deviationThresholdPercent > 1000) {
    throw new ConfigurationError('Deviation threshold percent cannot exceed 1000%');
  }

  // Validate minimum row count
  if (typeof minimumRowCount !== 'number' || !Number.isInteger(minimumRowCount)) {
    throw new ConfigurationError('Minimum row count must be an integer');
  }
  if (minimumRowCount < 0) {
    throw new ConfigurationError('Minimum row count cannot be negative');
  }
}

/**
 * Get current row count with error handling
 */
async function getCurrentRowCount(db: Database, tableName: string): Promise<number> {
  try {
    const countQuery = sql`SELECT COUNT(*) as row_count FROM ${sql.identifier(tableName)}`;
    const countResult = await db.execute(countQuery);

    if (!countResult || countResult.length === 0) {
      throw new QueryError('Row count query returned no results', 'volume_count', tableName);
    }

    const row = countResult[0] as { row_count: string };
    const rowCount = parseInt(row.row_count, 10);

    if (isNaN(rowCount) || rowCount < 0) {
      throw new QueryError('Invalid row count returned from query', 'volume_count', tableName);
    }

    // Check for overflow protection (2^53 - 1 is safe integer limit)
    if (rowCount > Number.MAX_SAFE_INTEGER) {
      throw new QueryError('Row count exceeds safe integer limit', 'volume_count', tableName);
    }

    return rowCount;
  } catch (error) {
    throw new QueryError(
      'Failed to get current row count',
      'volume_count',
      tableName,
      error instanceof Error ? error : undefined
    );
  }
}


/**
 * Calculate baseline statistics with security validation
 */
function calculateSecureBaseline(
  historicalData: { rowCount: number }[],
  currentRowCount: number
): { mean: number; deviationPercent: number } {
  try {
    if (historicalData.length === 0) {
      return { mean: currentRowCount, deviationPercent: 0 };
    }

    // Extract row counts and validate
    const historicalCounts = historicalData.map((h) => h.rowCount);

    // Check for statistical validity
    if (historicalCounts.some(count => isNaN(count) || count < 0)) {
      throw new MonitoringError('Invalid historical data detected', 'volume', undefined, undefined);
    }

    // Calculate mean safely (avoid overflow)
    const sum = historicalCounts.reduce((a, b) => {
      const result = a + b;
      if (result > Number.MAX_SAFE_INTEGER) {
        throw new MonitoringError('Historical data sum overflow', 'volume', undefined, undefined);
      }
      return result;
    }, 0);

    const mean = sum / historicalCounts.length;

    // Calculate deviation percentage safely
    let deviationPercent = 0;
    if (mean > 0) {
      const deviation = Math.abs(currentRowCount - mean);
      deviationPercent = (deviation / mean) * 100;

      // Validate result is reasonable
      if (isNaN(deviationPercent) || deviationPercent === Infinity) {
        deviationPercent = 0;
      }
    }

    return {
      mean: Math.round(mean),
      deviationPercent: Math.round(deviationPercent * 100) / 100 // Round to 2 decimal places
    };
  } catch (error) {
    // If calculation fails, return safe defaults
    return { mean: currentRowCount, deviationPercent: 0 };
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
      reject(new TimeoutError(timeoutMessage, 'volume_check', timeoutMs));
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
