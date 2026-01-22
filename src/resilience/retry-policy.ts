/**
 * Retry Policy implementation for FreshGuard Core Phase 2
 *
 * Provides exponential backoff retry with jitter, configurable retry conditions,
 * and comprehensive error handling for resilient operations.
 * Includes integrated observability with structured logging and metrics.
 *
 * @license MIT
 */

import type { StructuredLogger} from '../observability/logger.js';
import { createComponentLogger, LogContext } from '../observability/logger.js';
import type { MetricsCollector} from '../observability/metrics.js';
import { createComponentMetrics } from '../observability/metrics.js';

// ==============================================
// Types and Interfaces
// ==============================================

/**
 * Retry policy configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay between retries (ms) */
  baseDelay: number;
  /** Maximum delay between retries (ms) */
  maxDelay: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Add random jitter to prevent thundering herd */
  enableJitter: boolean;
  /** Custom function to determine if error should be retried */
  retryCondition?: (error: Error, attempt: number) => boolean;
  /** Custom function to determine delay */
  delayFunction?: (attempt: number, baseDelay: number, maxDelay: number) => number;
  /** Timeout for individual attempts (ms) */
  attemptTimeout?: number;
  /** Policy name for logging */
  name?: string;
  /** Logger instance for observability */
  logger?: StructuredLogger;
  /** Metrics collector for observability */
  metrics?: MetricsCollector;
  /** Enable detailed logging */
  enableDetailedLogging?: boolean;
}

/**
 * Retry attempt information
 */
export interface RetryAttempt {
  attempt: number;
  startTime: Date;
  endTime: Date | null;
  duration: number;
  error: Error | null;
  delay: number;
  success: boolean;
}

/**
 * Retry execution result
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: RetryAttempt[];
  totalDuration: number;
  totalAttempts: number;
}

/**
 * Retry statistics
 */
export interface RetryStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalAttempts: number;
  averageAttempts: number;
  averageDuration: number;
  successRate: number;
  lastExecutionTime: Date | null;
}

// ==============================================
// Error Classes
// ==============================================

/**
 * Retry exhausted error
 */
export class RetryExhaustedError extends Error {
  public readonly attempts: RetryAttempt[];
  public readonly totalDuration: number;
  public readonly lastError: Error;

  constructor(attempts: RetryAttempt[], totalDuration: number, lastError: Error) {
    const message = `Retry exhausted after ${attempts.length} attempts (${totalDuration}ms). Last error: ${lastError.message}`;
    super(message);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.totalDuration = totalDuration;
    this.lastError = lastError;
  }
}

/**
 * Attempt timeout error
 */
export class AttemptTimeoutError extends Error {
  public readonly attemptNumber: number;
  public readonly timeout: number;

  constructor(attemptNumber: number, timeout: number) {
    super(`Attempt ${attemptNumber} timed out after ${timeout}ms`);
    this.name = 'AttemptTimeoutError';
    this.attemptNumber = attemptNumber;
    this.timeout = timeout;
  }
}

// ==============================================
// Default Configurations
// ==============================================

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG: Required<Omit<RetryConfig, 'retryCondition' | 'delayFunction' | 'attemptTimeout' | 'name'>> = {
  maxAttempts: 3,
  baseDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2,
  enableJitter: true
};

/**
 * Database retry configuration (more aggressive)
 */
export const DATABASE_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelay: 200,
  maxDelay: 10000,
  backoffMultiplier: 2,
  enableJitter: true,
  attemptTimeout: 30000, // 30 seconds per attempt
  retryCondition: (error: Error) => {
    // Retry on connection errors, timeouts, temporary failures
    const retryableErrors = [
      'connection',
      'timeout',
      'network',
      'econnreset',
      'enotfound',
      'temporarily unavailable',
      'service unavailable'
    ];

    const message = error.message.toLowerCase();
    return retryableErrors.some(pattern => message.includes(pattern));
  }
};

/**
 * API retry configuration (conservative)
 */
export const API_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 8000,
  backoffMultiplier: 2,
  enableJitter: true,
  attemptTimeout: 10000, // 10 seconds per attempt
  retryCondition: (error: Error, attempt: number) => {
    // Only retry on 5xx server errors, not 4xx client errors
    if (error.message.includes('status')) {
      const statusMatch = /status\s+(\d+)/i.exec(error.message);
      if (statusMatch) {
        const status = parseInt(statusMatch[1]);
        return status >= 500 && status < 600;
      }
    }

    // Retry on network errors for first 2 attempts only
    const networkErrors = ['timeout', 'network', 'connection'];
    const hasNetworkError = networkErrors.some(pattern =>
      error.message.toLowerCase().includes(pattern)
    );

    return hasNetworkError && attempt <= 2;
  }
};

// ==============================================
// Utility Functions
// ==============================================

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  multiplier: number,
  enableJitter: boolean
): number {
  // Calculate exponential delay
  const exponentialDelay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);

  // Add jitter to prevent thundering herd problem
  if (enableJitter) {
    const jitter = Math.random() * 0.1 * exponentialDelay; // ±10% jitter
    return Math.floor(exponentialDelay + (Math.random() > 0.5 ? jitter : -jitter));
  }

  return exponentialDelay;
}

/**
 * Default retry condition (retry most errors except validation)
 */
function defaultRetryCondition(error: Error, attempt: number): boolean {
  // Don't retry validation errors, authentication errors, or permission errors
  const nonRetryableErrors = [
    'validation',
    'authentication',
    'authorization',
    'permission',
    'forbidden',
    'not found',
    'bad request'
  ];

  const message = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();

  return !nonRetryableErrors.some(pattern =>
    message.includes(pattern) || errorName.includes(pattern)
  );
}

/**
 * Sleep for specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute with timeout using AbortController
 */
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  attemptNumber = 1
): Promise<T> {
  if (timeoutMs <= 0) {
    return fn();
  }

  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    // Try to pass AbortSignal if function accepts it
    let result: T;
    try {
      result = await (fn as any)(controller.signal);
    } catch (sigError) {
      // If function doesn't accept signal, try without it
      result = await fn();
    }

    return result;
  } catch (error) {
    if (timedOut || controller.signal.aborted) {
      throw new AttemptTimeoutError(attemptNumber, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ==============================================
// Retry Policy Implementation
// ==============================================

/**
 * Retry Policy with exponential backoff, comprehensive configuration, and integrated observability
 */
export class RetryPolicy {
  private readonly config: Required<Omit<RetryConfig, 'logger' | 'metrics'>>;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;
  private readonly enableDetailedLogging: boolean;
  private stats: RetryStats = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalAttempts: 0,
    averageAttempts: 0,
    averageDuration: 0,
    successRate: 0,
    lastExecutionTime: null
  };

  constructor(config: RetryConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      retryCondition: config.retryCondition || defaultRetryCondition,
      delayFunction: config.delayFunction || calculateDelay,
      attemptTimeout: config.attemptTimeout || 0, // No timeout by default
      name: config.name || 'RetryPolicy',
      maxAttempts: config.maxAttempts || DEFAULT_CONFIG.maxAttempts,
      baseDelay: config.baseDelay || DEFAULT_CONFIG.baseDelay,
      maxDelay: config.maxDelay || DEFAULT_CONFIG.maxDelay,
      backoffMultiplier: config.backoffMultiplier || DEFAULT_CONFIG.backoffMultiplier,
      enableJitter: config.enableJitter !== undefined ? config.enableJitter : DEFAULT_CONFIG.enableJitter
    };

    // Initialize observability
    this.logger = config.logger || createComponentLogger('retry-policy');
    this.metrics = config.metrics || createComponentMetrics('retry_policy');
    this.enableDetailedLogging = config.enableDetailedLogging !== false;

    // Validate configuration
    if (this.config.maxAttempts < 1) {
      throw new Error('maxAttempts must be at least 1');
    }
    if (this.config.baseDelay < 0) {
      throw new Error('baseDelay cannot be negative');
    }
    if (this.config.maxDelay < this.config.baseDelay) {
      throw new Error('maxDelay must be >= baseDelay');
    }

    // Log retry policy initialization
    this.logger.info('Retry policy initialized', {
      policyName: this.config.name,
      maxAttempts: this.config.maxAttempts,
      baseDelay: this.config.baseDelay,
      maxDelay: this.config.maxDelay,
      backoffMultiplier: this.config.backoffMultiplier,
      enableJitter: this.config.enableJitter
    });
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const result = await this.executeWithResult(fn);

    if (result.success && result.data !== undefined) {
      return result.data;
    } else {
      throw result.error || new Error('Retry failed with unknown error');
    }
  }

  /**
   * Execute with detailed result (no throwing)
   */
  async executeWithResult<T>(fn: () => Promise<T>): Promise<RetryResult<T>> {
    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();

    this.stats.totalExecutions++;
    this.stats.lastExecutionTime = new Date();

    // Log retry execution start
    if (this.enableDetailedLogging) {
      this.logger.debug('Starting retry execution', {
        policyName: this.config.name,
        maxAttempts: this.config.maxAttempts
      });
    }

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      const attemptStartTime = new Date();
      let attemptEndTime: Date | null = null;
      let error: Error | null = null;
      let success = false;
      let result: T | undefined;

      try {
        // Execute with optional timeout
        if (this.config.attemptTimeout && this.config.attemptTimeout > 0) {
          result = await executeWithTimeout(fn, this.config.attemptTimeout, attempt);
        } else {
          result = await fn();
        }

        attemptEndTime = new Date();
        success = true;

        // Record successful attempt
        const attemptInfo: RetryAttempt = {
          attempt,
          startTime: attemptStartTime,
          endTime: attemptEndTime,
          duration: attemptEndTime.getTime() - attemptStartTime.getTime(),
          error: null,
          delay: 0,
          success: true
        };
        attempts.push(attemptInfo);

        const totalDuration = Date.now() - startTime;

        // Log successful execution
        this.logger.info('Retry execution succeeded', {
          policyName: this.config.name,
          attempt,
          duration: attemptInfo.duration,
          totalDuration,
          success: true
        });

        // Record metrics
        this.metrics.recordRetryAttempt(
          this.config.name,
          attempt,
          attemptInfo.duration,
          true,
          true // final attempt
        );

        // Update statistics
        this.updateStats(attempts, totalDuration, true);

        return {
          success: true,
          data: result,
          attempts,
          totalDuration,
          totalAttempts: attempt
        };

      } catch (err) {
        error = err as Error;
        attemptEndTime = new Date();

        // Record failed attempt
        const attemptInfo: RetryAttempt = {
          attempt,
          startTime: attemptStartTime,
          endTime: attemptEndTime,
          duration: attemptEndTime.getTime() - attemptStartTime.getTime(),
          error,
          delay: 0,
          success: false
        };

        // Check if we should retry
        const willRetry = attempt < this.config.maxAttempts && this.config.retryCondition(error, attempt);
        const finalAttempt = !willRetry;

        if (willRetry) {
          // Calculate delay for next attempt
          const delay = this.config.delayFunction(
            attempt,
            this.config.baseDelay,
            this.config.maxDelay,
            this.config.backoffMultiplier,
            this.config.enableJitter
          );

          attemptInfo.delay = delay;
          attempts.push(attemptInfo);

          // Log retry attempt
          this.logger.warn('Retry attempt failed, will retry', {
            policyName: this.config.name,
            attempt,
            duration: attemptInfo.duration,
            errorType: error.constructor.name,
            errorMessage: error.message,
            delay,
            nextAttempt: attempt + 1,
            maxAttempts: this.config.maxAttempts
          });

          // Record metrics
          this.metrics.recordRetryAttempt(
            this.config.name,
            attempt,
            attemptInfo.duration,
            false,
            false // not final attempt
          );

          // Wait before next attempt
          await sleep(delay);
        } else {
          // No more retries
          attempts.push(attemptInfo);

          // Log final failure or no-retry decision
          if (attempt >= this.config.maxAttempts) {
            this.logger.error('Retry attempts exhausted', {
              policyName: this.config.name,
              attempt,
              duration: attemptInfo.duration,
              errorType: error.constructor.name,
              errorMessage: error.message,
              totalAttempts: this.config.maxAttempts
            });
          } else {
            this.logger.info('Retry not attempted due to retry condition', {
              policyName: this.config.name,
              attempt,
              errorType: error.constructor.name,
              errorMessage: error.message
            });
          }

          // Record metrics for final failed attempt
          this.metrics.recordRetryAttempt(
            this.config.name,
            attempt,
            attemptInfo.duration,
            false,
            true // final attempt
          );

          break;
        }
      }
    }

    // All attempts failed
    const totalDuration = Date.now() - startTime;
    this.updateStats(attempts, totalDuration, false);

    const lastError = attempts[attempts.length - 1]?.error || new Error('Unknown error');
    const retryExhaustedError = new RetryExhaustedError(attempts, totalDuration, lastError);

    // Log final failure
    this.logger.error('Retry execution failed after all attempts', {
      policyName: this.config.name,
      totalAttempts: attempts.length,
      totalDuration,
      lastErrorType: lastError.constructor.name,
      lastErrorMessage: lastError.message,
      success: false
    });

    return {
      success: false,
      error: retryExhaustedError,
      attempts,
      totalDuration,
      totalAttempts: attempts.length
    };
  }

  /**
   * Update internal statistics
   */
  private updateStats(attempts: RetryAttempt[], totalDuration: number, success: boolean): void {
    this.stats.totalAttempts += attempts.length;

    if (success) {
      this.stats.successfulExecutions++;
    } else {
      this.stats.failedExecutions++;
    }

    // Update averages
    this.stats.averageAttempts = this.stats.totalAttempts / this.stats.totalExecutions;
    this.stats.averageDuration = (
      (this.stats.averageDuration * (this.stats.totalExecutions - 1) + totalDuration) /
      this.stats.totalExecutions
    );

    this.stats.successRate = (this.stats.successfulExecutions / this.stats.totalExecutions) * 100;
  }

  /**
   * Get retry statistics
   */
  getStats(): RetryStats {
    return {
      ...this.stats,
      averageAttempts: Math.round(this.stats.averageAttempts * 100) / 100,
      averageDuration: Math.round(this.stats.averageDuration * 100) / 100,
      successRate: Math.round(this.stats.successRate * 100) / 100
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalAttempts: 0,
      averageAttempts: 0,
      averageDuration: 0,
      successRate: 0,
      lastExecutionTime: null
    };
  }

  /**
   * Get configuration
   */
  getConfig(): Required<RetryConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration (creates new policy instance)
   */
  withConfig(config: Partial<RetryConfig>): RetryPolicy {
    return new RetryPolicy({ ...this.config, ...config });
  }
}

// ==============================================
// Convenience Functions
// ==============================================

/**
 * Execute with default retry policy
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config?: RetryConfig
): Promise<T> {
  const policy = new RetryPolicy(config);
  return policy.execute(fn);
}

/**
 * Execute with database retry policy
 */
export async function executeWithDatabaseRetry<T>(
  fn: () => Promise<T>
): Promise<T> {
  const policy = new RetryPolicy(DATABASE_RETRY_CONFIG);
  return policy.execute(fn);
}

/**
 * Execute with API retry policy
 */
export async function executeWithApiRetry<T>(
  fn: () => Promise<T>
): Promise<T> {
  const policy = new RetryPolicy(API_RETRY_CONFIG);
  return policy.execute(fn);
}

// ==============================================
// Retry Policy Registry
// ==============================================

/**
 * Registry for managing multiple retry policies
 */
export class RetryPolicyRegistry {
  private readonly policies = new Map<string, RetryPolicy>();

  /**
   * Register a retry policy
   */
  register(name: string, config: RetryConfig): RetryPolicy {
    const policy = new RetryPolicy({ ...config, name });
    this.policies.set(name, policy);
    return policy;
  }

  /**
   * Get a retry policy
   */
  get(name: string): RetryPolicy | undefined {
    return this.policies.get(name);
  }

  /**
   * Get or create a retry policy with default configuration
   */
  getOrCreate(name: string, config?: RetryConfig): RetryPolicy {
    let policy = this.policies.get(name);

    if (!policy) {
      policy = new RetryPolicy({ ...config, name });
      this.policies.set(name, policy);
    }

    return policy;
  }

  /**
   * Get all policies
   */
  getAllPolicies(): Map<string, RetryPolicy> {
    return new Map(this.policies);
  }

  /**
   * Get statistics for all policies
   */
  getAllStats(): Record<string, RetryStats> {
    const stats: Record<string, RetryStats> = {};

    for (const [name, policy] of this.policies) {
      stats[name] = policy.getStats();
    }

    return stats;
  }

  /**
   * Reset all policy statistics
   */
  resetAllStats(): void {
    for (const policy of this.policies.values()) {
      policy.resetStats();
    }
  }

  /**
   * Remove a policy
   */
  remove(name: string): boolean {
    return this.policies.delete(name);
  }

  /**
   * Clear all policies
   */
  clear(): void {
    this.policies.clear();
  }
}

// ==============================================
// Default Registry
// ==============================================

// Global retry policy registry
export const defaultRetryPolicyRegistry = new RetryPolicyRegistry();

// Register default policies
defaultRetryPolicyRegistry.register('database', DATABASE_RETRY_CONFIG);
defaultRetryPolicyRegistry.register('api', API_RETRY_CONFIG);
defaultRetryPolicyRegistry.register('default', {});