/**
 * Comprehensive test suite for FreshGuard Core Phase 2 Resilience Layer
 *
 * Tests circuit breakers, retry policies, and timeout management
 * with focus on state transitions and error handling.
 *
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import resilience modules
import {
  CircuitBreaker,
  CircuitBreakerState,
  CircuitOpenError,
  CircuitBreakerRegistry,
  createDatabaseCircuitBreaker,
  createApiCircuitBreaker,
  RetryPolicy,
  RetryExhaustedError,
  AttemptTimeoutError,
  executeWithRetry,
  executeWithDatabaseRetry,
  DATABASE_RETRY_CONFIG,
  API_RETRY_CONFIG,
  TimeoutManager,
  OperationTimeoutError,
  OperationCancelledError,
  withTimeout,
  createDatabaseTimeout
} from '../src/resilience/index.js';

// ==============================================
// Test Utilities
// ==============================================

/**
 * Create a function that succeeds after N attempts
 */
function createEventuallySuccessfulFunction<T>(
  failureCount: number,
  successValue: T,
  errorMessage = 'Simulated failure'
): () => Promise<T> {
  let attempts = 0;

  return async (): Promise<T> => {
    attempts++;
    if (attempts <= failureCount) {
      throw new Error(`${errorMessage} (attempt ${attempts})`);
    }
    return successValue;
  };
}

/**
 * Create a function that always fails
 */
function createAlwaysFailingFunction(errorMessage = 'Always fails'): () => Promise<never> {
  return async (): Promise<never> => {
    throw new Error(errorMessage);
  };
}

/**
 * Create a function that takes a specified time to complete
 */
function createTimedFunction<T>(
  duration: number,
  value: T,
  signal?: AbortSignal
): () => Promise<T> {
  return async (): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve(value);
      }, duration);

      if (signal) {
        const abortHandler = () => {
          clearTimeout(timeout);
          reject(new Error('Operation was aborted'));
        };

        if (signal.aborted) {
          clearTimeout(timeout);
          reject(new Error('Operation was aborted'));
          return;
        }

        signal.addEventListener('abort', abortHandler);
      }
    });
  };
}

/**
 * Sleep for specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==============================================
// Circuit Breaker Tests
// ==============================================

describe('Circuit Breaker - Phase 2 Resilience', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      recoveryTimeout: 100, // 100ms for fast tests
      windowSize: 10,
      name: 'TestCircuit'
    });
  });

  describe('State transitions', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.isCallable()).toBe(true);
    });

    it('should trip to OPEN state after failure threshold', async () => {
      const failingFn = createAlwaysFailingFunction();

      // Execute enough failures to trip the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (error) {
          // Expected failures
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(circuitBreaker.isCallable()).toBe(false);

      // Next call should be rejected immediately
      await expect(circuitBreaker.execute(failingFn)).rejects.toThrow(CircuitOpenError);

      const stats = circuitBreaker.getStats();
      expect(stats.rejectedCalls).toBe(1);
    });

    it('should transition to HALF_OPEN after recovery timeout', async () => {
      // Trip the circuit
      const failingFn = createAlwaysFailingFunction();
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (error) {
          // Expected failures
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      // Wait for recovery timeout
      await sleep(150);

      // Next call should put circuit in HALF_OPEN state
      const successFn = async () => 'success';
      const result = await circuitBreaker.execute(successFn);

      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should close circuit after success threshold in HALF_OPEN', async () => {
      // Trip the circuit first
      const failingFn = createAlwaysFailingFunction();
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (error) {
          // Expected failures
        }
      }

      // Wait for recovery
      await sleep(150);

      // Execute successful calls to close circuit
      const successFn = async () => 'success';
      await circuitBreaker.execute(successFn); // Circuit becomes HALF_OPEN
      await circuitBreaker.execute(successFn); // Should close circuit

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.isCallable()).toBe(true);
    });

    it('should trip back to OPEN on failure in HALF_OPEN state', async () => {
      // Trip the circuit
      const failingFn = createAlwaysFailingFunction();
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (error) {
          // Expected failures
        }
      }

      // Wait for recovery
      await sleep(150);

      // First call puts circuit in HALF_OPEN, second call fails and trips it
      const successFn = async () => 'success';
      await circuitBreaker.execute(successFn);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      try {
        await circuitBreaker.execute(failingFn);
      } catch (error) {
        // Expected failure
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Statistics tracking', () => {
    it('should track execution statistics correctly', async () => {
      const successFn = async () => 'success';
      const failingFn = createAlwaysFailingFunction();

      // Execute some successful calls
      await circuitBreaker.execute(successFn);
      await circuitBreaker.execute(successFn);

      // Execute some failing calls
      try {
        await circuitBreaker.execute(failingFn);
      } catch (error) {
        // Expected failure
      }

      const stats = circuitBreaker.getStats();
      expect(stats.totalCalls).toBe(3);
      expect(stats.successfulCalls).toBe(2);
      expect(stats.failedCalls).toBe(1);
      expect(stats.uptime).toBeCloseTo(66.67, 1);
    });

    it('should track rejection statistics when circuit is open', async () => {
      const failingFn = createAlwaysFailingFunction();

      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (error) {
          // Expected failures
        }
      }

      // Try to execute while circuit is open
      try {
        await circuitBreaker.execute(failingFn);
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError);
      }

      const stats = circuitBreaker.getStats();
      expect(stats.rejectedCalls).toBe(1);
    });
  });

  describe('Error filtering', () => {
    it('should respect custom error filter', async () => {
      const filteredCircuit = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        recoveryTimeout: 100,
        name: 'FilteredCircuit',
        errorFilter: (error) => {
          // Don't count validation errors
          return !error.message.includes('validation');
        }
      });

      const validationError = async () => {
        throw new Error('validation failed');
      };
      const networkError = async () => {
        throw new Error('network error');
      };

      // Validation errors shouldn't trip the circuit
      try {
        await filteredCircuit.execute(validationError);
      } catch (error) {
        // Expected
      }
      try {
        await filteredCircuit.execute(validationError);
      } catch (error) {
        // Expected
      }

      expect(filteredCircuit.getState()).toBe(CircuitBreakerState.CLOSED);

      // But network errors should trip it
      try {
        await filteredCircuit.execute(networkError);
      } catch (error) {
        // Expected
      }
      try {
        await filteredCircuit.execute(networkError);
      } catch (error) {
        // Expected
      }

      expect(filteredCircuit.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Factory functions', () => {
    it('should create database circuit breaker with appropriate settings', () => {
      const dbCircuit = createDatabaseCircuitBreaker('test-db');
      const config = dbCircuit.getName();
      expect(config).toBe('db-test-db');

      const stats = dbCircuit.getStats();
      expect(stats.state).toBe(CircuitBreakerState.CLOSED);
    });

    it('should create API circuit breaker with appropriate settings', () => {
      const apiCircuit = createApiCircuitBreaker('test-api');
      const config = apiCircuit.getName();
      expect(config).toBe('api-test-api');

      const stats = apiCircuit.getStats();
      expect(stats.state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('Circuit Breaker Registry', () => {
    let registry: CircuitBreakerRegistry;

    beforeEach(() => {
      registry = new CircuitBreakerRegistry();
    });

    afterEach(() => {
      registry.clear();
    });

    it('should manage multiple circuit breakers', () => {
      const config = { failureThreshold: 3, successThreshold: 2, recoveryTimeout: 1000 };

      const circuit1 = registry.getOrCreate('circuit1', config);
      const circuit2 = registry.getOrCreate('circuit2', config);

      expect(circuit1.getName()).toBe('circuit1');
      expect(circuit2.getName()).toBe('circuit2');

      const allCircuits = registry.getAllCircuits();
      expect(allCircuits.size).toBe(2);
    });

    it('should get statistics for all circuits', async () => {
      const circuit1 = registry.getOrCreate('circuit1', { failureThreshold: 3, successThreshold: 2, recoveryTimeout: 1000 });
      const circuit2 = registry.getOrCreate('circuit2', { failureThreshold: 3, successThreshold: 2, recoveryTimeout: 1000 });

      // Execute some operations
      await circuit1.execute(async () => 'success1');
      await circuit2.execute(async () => 'success2');

      const allStats = registry.getAllStats();
      expect(allStats.circuit1.totalCalls).toBe(1);
      expect(allStats.circuit2.totalCalls).toBe(1);
    });
  });
});

// ==============================================
// Retry Policy Tests
// ==============================================

describe('Retry Policy - Phase 2 Resilience', () => {
  let retryPolicy: RetryPolicy;

  beforeEach(() => {
    retryPolicy = new RetryPolicy({
      maxAttempts: 3,
      baseDelay: 10, // Short delays for tests
      maxDelay: 100,
      backoffMultiplier: 2,
      enableJitter: false, // Disable for predictable tests
      name: 'TestRetry'
    });
  });

  describe('Basic retry behavior', () => {
    it('should succeed without retry if function succeeds first time', async () => {
      const successFn = async () => 'success';
      const result = await retryPolicy.execute(successFn);

      expect(result).toBe('success');

      const stats = retryPolicy.getStats();
      expect(stats.totalExecutions).toBe(1);
      expect(stats.averageAttempts).toBe(1);
    });

    it('should retry failing function up to max attempts', async () => {
      const eventuallySuccessful = createEventuallySuccessfulFunction(2, 'success');

      const result = await retryPolicy.execute(eventuallySuccessful);
      expect(result).toBe('success');

      const stats = retryPolicy.getStats();
      expect(stats.successfulExecutions).toBe(1);
      expect(stats.totalAttempts).toBe(3); // 2 failures + 1 success
    });

    it('should throw RetryExhaustedError after max attempts', async () => {
      const alwaysFails = createAlwaysFailingFunction('Test failure');

      await expect(retryPolicy.execute(alwaysFails)).rejects.toThrow(RetryExhaustedError);

      const stats = retryPolicy.getStats();
      expect(stats.failedExecutions).toBe(1);
      expect(stats.totalAttempts).toBe(3);
    });

    it('should calculate exponential backoff delays correctly', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 4,
        baseDelay: 100,
        maxDelay: 1000,
        backoffMultiplier: 2,
        enableJitter: false
      });

      const alwaysFails = createAlwaysFailingFunction();

      const startTime = Date.now();
      try {
        await policy.execute(alwaysFails);
      } catch (error) {
        // Expected
      }
      const endTime = Date.now();

      // Total delay should be approximately 100 + 200 + 400 = 700ms
      // With some tolerance for execution time
      expect(endTime - startTime).toBeGreaterThanOrEqual(600);
      expect(endTime - startTime).toBeLessThan(900);
    });
  });

  describe('Retry conditions', () => {
    it('should respect custom retry condition', async () => {
      const selectiveRetry = new RetryPolicy({
        maxAttempts: 3,
        baseDelay: 10,
        retryCondition: (error) => {
          return !error.message.includes('permanent');
        }
      });

      let attempts = 0;
      const permanentFailure = async () => {
        attempts++;
        throw new Error('permanent failure');
      };

      try {
        await selectiveRetry.execute(permanentFailure);
      } catch (error) {
        // Should fail immediately without retry
        expect(attempts).toBe(1);
      }
    });

    it('should use database retry configuration correctly', async () => {
      const databaseError = async () => {
        throw new Error('connection timeout');
      };

      // This should retry because it's a connection error
      try {
        await executeWithDatabaseRetry(databaseError);
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        const retryError = error as RetryExhaustedError;
        expect(retryError.attempts.length).toBe(DATABASE_RETRY_CONFIG.maxAttempts);
      }
    });

    it('should handle API retry configuration correctly', async () => {
      const apiError = async () => {
        throw new Error('server error status 500');
      };

      const apiConfig = new RetryPolicy(API_RETRY_CONFIG);

      try {
        await apiConfig.execute(apiError);
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        const retryError = error as RetryExhaustedError;
        expect(retryError.attempts.length).toBe(API_RETRY_CONFIG.maxAttempts);
      }
    });
  });

  describe('Result tracking', () => {
    it('should provide detailed execution results', async () => {
      const eventuallySuccessful = createEventuallySuccessfulFunction(1, 'success');

      const result = await retryPolicy.executeWithResult(eventuallySuccessful);

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.totalAttempts).toBe(2);
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].success).toBe(false);
      expect(result.attempts[1].success).toBe(true);
    });

    it('should track attempt timing information', async () => {
      const slowFunction = async () => {
        await sleep(50);
        return 'success';
      };

      const result = await retryPolicy.executeWithResult(slowFunction);

      expect(result.success).toBe(true);
      expect(result.attempts[0].duration).toBeGreaterThanOrEqual(45);
      expect(result.totalDuration).toBeGreaterThanOrEqual(45);
    });
  });

  describe('Statistics', () => {
    it('should track comprehensive statistics', async () => {
      const successFn = async () => 'success';
      const eventualSuccess = createEventuallySuccessfulFunction(1, 'success');
      const alwaysFails = createAlwaysFailingFunction();

      // Execute various scenarios
      await retryPolicy.execute(successFn);
      await retryPolicy.execute(eventualSuccess);

      try {
        await retryPolicy.execute(alwaysFails);
      } catch (error) {
        // Expected
      }

      const stats = retryPolicy.getStats();
      expect(stats.totalExecutions).toBe(3);
      expect(stats.successfulExecutions).toBe(2);
      expect(stats.failedExecutions).toBe(1);
      expect(stats.successRate).toBeCloseTo(66.67, 1);
      expect(stats.averageAttempts).toBeCloseTo(2, 1); // (1 + 2 + 3) / 3
    });
  });
});

// ==============================================
// Timeout Manager Tests
// ==============================================

describe('Timeout Manager - Phase 2 Resilience', () => {
  describe('Basic timeout behavior', () => {
    it('should complete successfully within timeout', async () => {
      const manager = new TimeoutManager({ duration: 100, name: 'TestTimeout' });

      const quickFunction = async (signal: AbortSignal) => {
        return 'success';
      };

      const result = await manager.execute(quickFunction);
      expect(result).toBe('success');

      const stats = manager.getStats();
      expect(stats.successfulExecutions).toBe(1);
      expect(stats.timeoutCount).toBe(0);
    });

    it('should timeout long-running operations', async () => {
      const manager = new TimeoutManager({ duration: 50, name: 'TestTimeout' });

      const slowFunction = async (signal: AbortSignal) => {
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve('success');
          }, 100);

          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation timed out'));
          });

          if (signal.aborted) {
            clearTimeout(timer);
            reject(new Error('Operation already aborted'));
          }
        });
      };

      await expect(manager.execute(slowFunction)).rejects.toThrow();

      const stats = manager.getStats();
      expect(stats.timeoutCount).toBe(1);
      expect(stats.timeoutRate).toBeGreaterThan(0);
    });

    it('should properly cancel operations with AbortSignal', async () => {
      const manager = new TimeoutManager({ duration: 50, name: 'TestTimeout' });

      let operationCancelled = false;

      const cancellableFunction = async (signal: AbortSignal) => {
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve('success');
          }, 100);

          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            operationCancelled = true;
            reject(new Error('Operation aborted'));
          });
        });
      };

      try {
        await manager.execute(cancellableFunction);
      } catch (error) {
        expect(operationCancelled).toBe(true);
      }
    });

    it('should handle manual cancellation', async () => {
      const manager = new TimeoutManager({ duration: 1000, name: 'TestTimeout' });

      const longFunction = async (signal: AbortSignal) => {
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => resolve('success'), 500);

          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation cancelled'));
          });
        });
      };

      // Start the operation and cancel it
      const promise = manager.execute(longFunction);
      setTimeout(() => manager.cancel('Manual cancellation'), 25);

      await expect(promise).rejects.toThrow('Operation cancelled');

      const stats = manager.getStats();
      expect(stats.cancelledCount).toBe(1);
    });
  });

  describe('Static convenience methods', () => {
    it('should execute with static timeout', async () => {
      const quickFunction = async (signal: AbortSignal) => 'success';

      const result = await withTimeout(quickFunction, 100, 'StaticTest');
      expect(result).toBe('success');
    });

    it('should timeout with static method', async () => {
      const slowFunction = async (signal: AbortSignal) => {
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve('success');
          }, 100);

          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation timed out'));
          });

          if (signal.aborted) {
            clearTimeout(timer);
            reject(new Error('Operation already aborted'));
          }
        });
      };

      await expect(withTimeout(slowFunction, 50, 'StaticTest'))
        .rejects.toThrow();
    });
  });

  describe('Hierarchical timeouts', () => {
    it('should create child timeouts', async () => {
      const parent = new TimeoutManager({ duration: 200, name: 'ParentTimeout' });
      const child = parent.createChild({ duration: 100, name: 'ChildTimeout' });

      const quickFunction = async (signal: AbortSignal) => 'success';

      const result = await child.execute(quickFunction);
      expect(result).toBe('success');
    });

    it('should propagate parent cancellation to children', async () => {
      const parent = new TimeoutManager({
        duration: 1000,
        name: 'ParentTimeout',
        propagateToChildren: true
      });

      const child = parent.createChild({ duration: 2000, name: 'ChildTimeout' });

      const longFunction = async (signal: AbortSignal) => {
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => resolve('success'), 500);

          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Child cancelled due to parent'));
          });
        });
      };

      const childPromise = child.execute(longFunction);

      // Cancel parent after a short delay
      setTimeout(() => parent.cancel('Parent cancelled'), 50);

      await expect(childPromise).rejects.toThrow();
    });
  });

  describe('Factory functions', () => {
    it('should create database timeout with appropriate settings', async () => {
      const dbTimeout = createDatabaseTimeout('query');

      expect(dbTimeout.getConfig().duration).toBe(30000);
      expect(dbTimeout.getConfig().name).toBe('db-query');
    });

    it('should work with database operations', async () => {
      const dbTimeout = createDatabaseTimeout('connection');

      const dbOperation = async (signal: AbortSignal) => {
        // Simulate database operation
        await sleep(10);
        return { rows: [{ id: 1, name: 'test' }] };
      };

      const result = await dbTimeout.execute(dbOperation);
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('Statistics and monitoring', () => {
    it('should track detailed execution statistics', async () => {
      const manager = new TimeoutManager({ duration: 100, name: 'StatsTest' });

      const quickFunction = async (signal: AbortSignal) => {
        await sleep(25);
        return 'success';
      };

      const slowFunction = async (signal: AbortSignal) => {
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve('timeout');
          }, 150);

          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation timed out'));
          });

          if (signal.aborted) {
            clearTimeout(timer);
            reject(new Error('Operation already aborted'));
          }
        });
      };

      // Execute successful operation
      await manager.execute(quickFunction);

      // Execute timeout operation
      try {
        await manager.execute(slowFunction);
      } catch (error) {
        // Expected timeout
      }

      const stats = manager.getStats();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.successfulExecutions).toBe(1);
      expect(stats.timeoutCount).toBe(1);
      expect(stats.timeoutRate).toBe(50);
      expect(stats.averageDuration).toBeGreaterThan(0);
      expect(stats.maxDuration).toBeGreaterThanOrEqual(stats.minDuration);
    });

    it('should provide active timeout information', async () => {
      const manager = new TimeoutManager({ duration: 200, name: 'ActiveTest' });

      const longFunction = async (signal: AbortSignal) => {
        const activeTimeout = manager.getActiveTimeout();
        expect(activeTimeout).toBeTruthy();
        expect(activeTimeout!.name).toBe('ActiveTest');
        expect(manager.getRemainingTime()).toBeLessThanOrEqual(200);
        expect(manager.getElapsedTime()).toBeGreaterThanOrEqual(0);

        await sleep(50);
        return 'success';
      };

      await manager.execute(longFunction);

      // After completion, no active timeout
      expect(manager.getActiveTimeout()).toBeNull();
    });
  });
});

// ==============================================
// Integration Tests
// ==============================================

describe('Resilience Layer Integration', () => {
  it('should combine circuit breaker with retry policy', async () => {
    const circuit = new CircuitBreaker({
      failureThreshold: 5, // Higher threshold so circuit doesn't trip during retry
      successThreshold: 1,
      recoveryTimeout: 100,
      name: 'IntegrationCircuit'
    });

    const retry = new RetryPolicy({
      maxAttempts: 5,
      baseDelay: 10,
      enableJitter: false
    });

    let attempts = 0;
    const eventuallySuccessful = async () => {
      attempts++;
      if (attempts <= 3) {
        throw new Error(`Failure ${attempts}`);
      }
      return 'success';
    };

    // Wrap with circuit breaker inside retry (so retry can recover from circuit issues)
    const resilientOperation = async () => {
      return retry.execute(() => circuit.execute(eventuallySuccessful));
    };

    const result = await resilientOperation();
    expect(result).toBe('success');
    expect(attempts).toBe(4); // 3 failures + 1 success
  });

  it.skip('should integrate timeout with retry policy', async () => {
    const retry = new RetryPolicy({
      maxAttempts: 3,
      baseDelay: 10,
      attemptTimeout: 50, // Each attempt times out after 50ms
      enableJitter: false
    });

    const slowFunction = async () => {
      // Always take longer than the 50ms timeout
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('success');
        }, 200); // Much longer than attempt timeout
      });
    };

    const result = await retry.executeWithResult(slowFunction);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(RetryExhaustedError);

    if (result.error instanceof RetryExhaustedError) {
      expect(result.attempts.length).toBe(3);

      // Each attempt should have timed out
      for (const attempt of result.attempts) {
        expect(attempt.error?.name).toBe('AttemptTimeoutError');
      }
    }
  });

  it('should work with all resilience patterns together', async () => {
    const timeout = new TimeoutManager({
      duration: 500,
      name: 'ComboTimeout'
    });

    const circuit = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      recoveryTimeout: 50,
      name: 'ComboCircuit'
    });

    const retry = new RetryPolicy({
      maxAttempts: 2,
      baseDelay: 10,
      enableJitter: false
    });

    let attempts = 0;
    const complexOperation = async (signal: AbortSignal) => {
      attempts++;
      if (attempts === 1) {
        throw new Error('First failure');
      }
      return 'success';
    };

    // Combine all patterns
    const resilientComplexOperation = async () => {
      return timeout.execute(async (signal) => {
        return retry.execute(() => {
          return circuit.execute(() => complexOperation(signal));
        });
      });
    };

    const result = await resilientComplexOperation();
    expect(result).toBe('success');
    expect(attempts).toBe(2);

    // Check all components worked
    expect(timeout.getStats().successfulExecutions).toBe(1);
    expect(circuit.getStats().successfulCalls).toBe(1);
    expect(retry.getStats().successfulExecutions).toBe(1);
  });
});