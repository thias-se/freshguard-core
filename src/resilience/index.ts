/**
 * FreshGuard Core Phase 2 Resilience Layer
 *
 * Production-ready resilience patterns including circuit breakers,
 * exponential backoff retry policies, and proper timeout management
 * with AbortController-based cancellation.
 *
 * @license MIT
 */

// Export circuit breaker components
export * from './circuit-breaker.js';

// Export retry policy components
export * from './retry-policy.js';

// Export timeout management components
export * from './timeout-manager.js';

// Re-export commonly used functions
export {
  createDatabaseCircuitBreaker,
  createApiCircuitBreaker,
  defaultCircuitBreakerRegistry
} from './circuit-breaker.js';

export {
  executeWithRetry,
  executeWithDatabaseRetry,
  executeWithApiRetry,
  defaultRetryPolicyRegistry,
  DATABASE_RETRY_CONFIG,
  API_RETRY_CONFIG
} from './retry-policy.js';

export {
  withTimeout,
  withTimeoutResult,
  createDatabaseTimeout,
  createApiTimeout,
  defaultTimeoutRegistry
} from './timeout-manager.js';