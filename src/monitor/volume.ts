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

import type { CheckResult, MonitoringRule, FreshGuardConfig, DebugConfig } from '../types.js';
import type { Connector } from '../types/connector.js';
import type { MetadataStorage } from '../metadata/interface.js';
import { validateTableName } from '../validators/index.js';
import {
  TimeoutError,
  ConfigurationError,
  ErrorHandler
} from '../errors/index.js';
import { DebugErrorFactory, mergeDebugConfig } from '../errors/debug-factory.js';
import type { QueryContext } from '../errors/debug-factory.js';
import { BaselineConfigResolver } from './baseline-config.js';
import { BaselineCalculator } from './baseline-calculator.js';

/**
 * Check volume anomaly for a given rule with security validation
 *
 * @param connector - Database connector instance
 * @param rule - Monitoring rule configuration
 * @param metadataStorage - Metadata storage for historical data
 * @param config - Optional configuration including debug settings
 * @returns CheckResult with volume anomaly status and sanitized error messages
 */
export async function checkVolumeAnomaly(
  connector: Connector,
  rule: MonitoringRule,
  metadataStorage?: MetadataStorage,
  config?: FreshGuardConfig
): Promise<CheckResult> {
  const startTime = process.hrtime.bigint();
  const debugConfig = mergeDebugConfig(config?.debug);
  const debugFactory = new DebugErrorFactory(debugConfig);
  const debugId = `fg-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;

  try {
    // Log debug info at start
    if (debugConfig.enabled) {
      console.log(`[DEBUG-${debugId}] Starting volume anomaly check:`, {
        table: rule.tableName,
        ruleId: rule.id,
        timestamp: new Date().toISOString()
      });
    }

    // Validate input parameters for security
    validateVolumeRule(rule);

    // Resolve baseline configuration with enhanced options and backwards compatibility
    const baselineConfigResolver = new BaselineConfigResolver(rule);
    const baselineConfig = baselineConfigResolver.getConfig();

    // Extract commonly used values for backwards compatibility
    const baselineWindowDays = baselineConfig.windowDays;
    const deviationThresholdPercent = baselineConfig.deviationThresholdPercent;
    const minimumRowCount = baselineConfig.minimumRowCount;
    const timeoutMs = baselineConfig.timeoutSeconds * 1000;

    // Validate table name to prevent SQL injection
    validateTableName(rule.tableName);

    // Validate configuration parameters (now handled by BaselineConfigResolver)
    // But keep legacy validation for backwards compatibility
    validateVolumeParameters(baselineWindowDays, deviationThresholdPercent, minimumRowCount);

    // Get current row count with timeout protection
    const currentRowCount = await executeWithTimeout(
      () => getCurrentRowCount(connector, rule.tableName, debugConfig, debugFactory),
      config?.timeoutMs || timeoutMs,
      'Volume check row count query timeout'
    );

    // Skip check if below minimum threshold
    if (currentRowCount < minimumRowCount) {
      const executedAt = new Date();
      const executionDurationMs = Number(process.hrtime.bigint() - startTime) / 1000000;

      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'ok',
        rowCount: currentRowCount,
        deviation: 0,
        baselineAverage: currentRowCount,
        executionDurationMs,
        executedAt,
      }, debugConfig);

      return createSecureCheckResult('ok', {
        rowCount: currentRowCount,
        deviation: 0,
        baselineAverage: currentRowCount,
        executionDurationMs,
        executedAt,
      });
    }

    // Get historical data with graceful fallback
    let historicalExecutions: import('../metadata/types.js').MetadataCheckExecution[] = [];
    if (metadataStorage) {
      try {
        historicalExecutions = await executeWithTimeout(
          () => metadataStorage.getHistoricalData(rule.id, baselineWindowDays),
          timeoutMs,
          'Volume check historical data query timeout'
        );
      } catch (error) {
        // Enhanced error logging for metadata retrieval failure
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (debugConfig.enabled) {
          console.error(`[DEBUG-${debugId}] Metadata storage unavailable:`, {
            ruleId: rule.id,
            error: errorMessage,
            rawError: debugConfig.exposeRawErrors ? errorMessage : undefined,
            fallback: 'treating as fresh installation'
          });
        } else {
          console.warn(`Metadata storage unavailable, treating as fresh installation: ${errorMessage}`);
        }

        // Graceful fallback: treat as fresh installation with no history
        historicalExecutions = [];
      }
    }

    // Calculate baseline using enhanced calculator
    const baselineCalculator = new BaselineCalculator(baselineConfig);
    const baselineResult = baselineCalculator.calculateBaseline(historicalExecutions, currentRowCount);

    // If not enough historical data, return ok (can't determine baseline yet)
    if (baselineResult.dataPointsUsed < baselineConfig.minimumDataPoints) {
      const executedAt = new Date();
      const executionDurationMs = Number(process.hrtime.bigint() - startTime) / 1000000;

      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'ok',
        rowCount: currentRowCount,
        deviation: 0,
        baselineAverage: currentRowCount,
        executionDurationMs,
        executedAt,
      }, debugConfig);

      return createSecureCheckResult('ok', {
        rowCount: currentRowCount,
        deviation: 0,
        baselineAverage: currentRowCount,
        executionDurationMs,
        executedAt,
      });
    }

    // Determine if this is an anomaly using enhanced baseline result
    const isAnomaly = baselineResult.deviationPercent > deviationThresholdPercent;
    const status = isAnomaly ? 'alert' : 'ok';
    const executedAt = new Date();
    const executionDurationMs = Number(process.hrtime.bigint() - startTime) / 1000000;

    // Save execution result to metadata storage
    await saveExecutionResult(metadataStorage, {
      ruleId: rule.id,
      status,
      rowCount: currentRowCount,
      deviation: baselineResult.deviationPercent,
      baselineAverage: baselineResult.mean,
      executionDurationMs,
      executedAt,
    }, debugConfig);

    return createSecureCheckResult(status, {
      rowCount: currentRowCount,
      deviation: baselineResult.deviationPercent,
      baselineAverage: baselineResult.mean,
      executionDurationMs,
      executedAt,
    });

  } catch (error) {
    // Use secure error handling to prevent information disclosure
    const userMessage = ErrorHandler.getUserMessage(error);
    const executedAt = new Date();
    const executionDurationMs = Number(process.hrtime.bigint() - startTime) / 1000000;

    // Log debug error information
    if (debugConfig.enabled) {
      console.error(`[DEBUG-${debugId}] Volume anomaly check failed:`, {
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
    deviation?: number;
    baselineAverage?: number;
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
      deviation: execution.deviation,
      baselineAverage: execution.baselineAverage,
      executionDurationMs: execution.executionDurationMs,
      executedAt: execution.executedAt,
      error: execution.error,
    });
  } catch (error) {
    // Enhanced error logging instead of console.warn
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (debugConfig?.enabled) {
      console.error('[DEBUG] Failed to save volume execution history:', {
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
 * Get current row count using connector with error handling
 */
async function getCurrentRowCount(
  connector: Connector,
  tableName: string,
  debugConfig: DebugConfig,
  debugFactory: DebugErrorFactory
): Promise<number> {
  const startTime = performance.now();

  const queryContext: QueryContext = {
    sql: `connector.getRowCount('${tableName}')`,
    params: [],
    table: tableName,
    operation: 'volume_count'
  };

  try {
    // Log connector operation in debug mode
    if (debugConfig.enabled) {
      console.log(`[DEBUG] Executing volume count via connector:`, {
        table: tableName,
        operation: debugConfig.exposeQueries ? `getRowCount('${tableName}')` : '[Connector operation hidden]'
      });
    }

    const rowCount = await connector.getRowCount(tableName);
    queryContext.duration = performance.now() - startTime;

    if (isNaN(rowCount) || rowCount < 0) {
      throw debugFactory.createQueryError(
        'Invalid row count returned from connector',
        undefined,
        queryContext
      );
    }

    // Check for overflow protection (2^53 - 1 is safe integer limit)
    if (rowCount > Number.MAX_SAFE_INTEGER) {
      throw debugFactory.createQueryError(
        'Row count exceeds safe integer limit',
        undefined,
        queryContext
      );
    }

    return rowCount;
  } catch (error) {
    queryContext.duration = performance.now() - startTime;

    throw debugFactory.createQueryError(
      'Failed to get current row count via connector',
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
    ...data,
    status,
    executedAt: data.executedAt || new Date(),
    executionDurationMs: data.executionDurationMs
  };
}
