/**
 * Circuit Breaker implementation for FreshGuard Core Phase 2
 *
 * Implements the Circuit Breaker pattern to provide resilience against
 * cascading failures and fast-fail behavior for unhealthy services.
 *
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN
 *
 * @license MIT
 */

// ==============================================
// Types and Interfaces
// ==============================================

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing fast
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Failure threshold to trip the circuit */
  failureThreshold: number;
  /** Success threshold to close circuit from half-open */
  successThreshold: number;
  /** Time to wait before attempting recovery (ms) */
  recoveryTimeout: number;
  /** Window size for tracking failures */
  windowSize: number;
  /** Custom error classifier */
  errorFilter?: (error: Error) => boolean;
  /** Circuit name for logging/monitoring */
  name?: string;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  rejectedCalls: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  nextAttemptTime: Date | null;
  failureRate: number;
  uptime: number; // percentage
}

/**
 * Circuit breaker execution result
 */
export type CircuitBreakerResult<T> = {
  success: true;
  data: T;
  executionTime: number;
} | {
  success: false;
  error: CircuitBreakerError;
  executionTime: number;
};

// ==============================================
// Error Classes
// ==============================================

/**
 * Base circuit breaker error
 */
export class CircuitBreakerError extends Error {
  public readonly circuitName: string;
  public readonly state: CircuitBreakerState;
  public readonly timestamp: Date;

  constructor(message: string, circuitName: string, state: CircuitBreakerState) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.circuitName = circuitName;
    this.state = state;
    this.timestamp = new Date();
  }
}

/**
 * Circuit open error (fast-fail)
 */
export class CircuitOpenError extends CircuitBreakerError {
  public readonly nextAttemptTime: Date;

  constructor(circuitName: string, nextAttemptTime: Date) {
    super(
      `Circuit breaker '${circuitName}' is OPEN - calls are being rejected`,
      circuitName,
      CircuitBreakerState.OPEN
    );
    this.name = 'CircuitOpenError';
    this.nextAttemptTime = nextAttemptTime;
  }
}

// ==============================================
// Circuit Breaker Implementation
// ==============================================

/**
 * Circuit Breaker with sliding window failure tracking
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureWindow: Date[] = [];
  private successCount = 0;
  private totalCalls = 0;
  private successfulCalls = 0;
  private failedCalls = 0;
  private rejectedCalls = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private nextAttemptTime: Date | null = null;
  private readonly config: Required<CircuitBreakerConfig>;
  private readonly startTime: Date;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 3,
      recoveryTimeout: 60000, // 1 minute
      windowSize: 100,
      errorFilter: () => true, // Count all errors by default
      name: 'Circuit',
      ...config
    };
    this.startTime = new Date();

    // Validate configuration
    if (this.config.failureThreshold <= 0) {
      throw new Error('Failure threshold must be positive');
    }
    if (this.config.successThreshold <= 0) {
      throw new Error('Success threshold must be positive');
    }
    if (this.config.recoveryTimeout < 0) {
      throw new Error('Recovery timeout cannot be negative');
    }
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();

    try {
      // Check if circuit is open
      if (this.state === CircuitBreakerState.OPEN) {
        if (Date.now() < (this.nextAttemptTime?.getTime() || 0)) {
          this.rejectedCalls++;
          throw new CircuitOpenError(this.config.name, this.nextAttemptTime!);
        } else {
          // Time to attempt recovery
          this.state = CircuitBreakerState.HALF_OPEN;
          this.successCount = 0;
        }
      }

      // Execute the function
      const result = await fn();
      const executionTime = Date.now() - startTime;

      this.onSuccess(executionTime);
      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.onFailure(error as Error, executionTime);
      throw error;
    }
  }

  /**
   * Execute with result wrapper (no throwing)
   */
  async executeWithResult<T>(fn: () => Promise<T>): Promise<CircuitBreakerResult<T>> {
    const startTime = Date.now();

    try {
      const result = await this.execute(fn);
      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: result,
        executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      return {
        success: false,
        error: error instanceof CircuitBreakerError
          ? error
          : new CircuitBreakerError(
              (error as Error).message,
              this.config.name,
              this.state
            ),
        executionTime
      };
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(executionTime: number): void {
    this.totalCalls++;
    this.successfulCalls++;
    this.lastSuccessTime = new Date();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        // Already closed, nothing to do
        this.resetFailureCount();
        break;

      case CircuitBreakerState.HALF_OPEN:
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.state = CircuitBreakerState.CLOSED;
          this.successCount = 0;
          this.nextAttemptTime = null;
          this.resetFailureCount();
        }
        break;

      case CircuitBreakerState.OPEN:
        // This shouldn't happen, but handle gracefully
        this.state = CircuitBreakerState.HALF_OPEN;
        this.successCount = 1;
        break;
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: Error, executionTime: number): void {
    this.totalCalls++;
    this.failedCalls++;
    this.lastFailureTime = new Date();

    // Check if this error should be counted
    if (!this.config.errorFilter(error)) {
      return;
    }

    // Add failure to sliding window
    const now = new Date();
    this.failureWindow.push(now);

    // Clean old failures outside window
    const cutoff = new Date(now.getTime() - (5 * 60 * 1000)); // 5 minute window
    this.failureWindow = this.failureWindow.filter(time => time > cutoff);

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        if (this.failureWindow.length >= this.config.failureThreshold) {
          this.tripCircuit();
        }
        break;

      case CircuitBreakerState.HALF_OPEN:
        // Any failure in half-open state trips the circuit
        this.tripCircuit();
        break;

      case CircuitBreakerState.OPEN:
        // Already open, extend the timeout
        this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeout);
        break;
    }
  }

  /**
   * Trip the circuit to OPEN state
   */
  private tripCircuit(): void {
    this.state = CircuitBreakerState.OPEN;
    this.successCount = 0;
    this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeout);
  }

  /**
   * Reset failure count (when circuit is healthy)
   */
  private resetFailureCount(): void {
    this.failureWindow = [];
    this.successCount = 0;
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    const now = Date.now();
    const totalTime = now - this.startTime.getTime();
    const failureRate = this.totalCalls > 0
      ? (this.failedCalls / this.totalCalls) * 100
      : 0;

    const uptime = this.totalCalls > 0
      ? ((this.successfulCalls / this.totalCalls) * 100)
      : 100;

    return {
      state: this.state,
      totalCalls: this.totalCalls,
      successfulCalls: this.successfulCalls,
      failedCalls: this.failedCalls,
      rejectedCalls: this.rejectedCalls,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
      failureRate: Math.round(failureRate * 100) / 100,
      uptime: Math.round(uptime * 100) / 100
    };
  }

  /**
   * Check if circuit is available for calls
   */
  isCallable(): boolean {
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;
      case CircuitBreakerState.HALF_OPEN:
        return true;
      case CircuitBreakerState.OPEN:
        return Date.now() >= (this.nextAttemptTime?.getTime() || 0);
    }
  }

  /**
   * Force circuit to CLOSED state (for testing/admin)
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.resetFailureCount();
    this.nextAttemptTime = null;
    this.totalCalls = 0;
    this.successfulCalls = 0;
    this.failedCalls = 0;
    this.rejectedCalls = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
  }

  /**
   * Force circuit to OPEN state (for testing/admin)
   */
  trip(): void {
    this.tripCircuit();
  }

  /**
   * Get circuit name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }
}

// ==============================================
// Factory Functions
// ==============================================

/**
 * Create a circuit breaker with default configuration for database operations
 */
export function createDatabaseCircuitBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker({
    name: `db-${name}`,
    failureThreshold: 5,
    successThreshold: 3,
    recoveryTimeout: 60000, // 1 minute
    windowSize: 100,
    errorFilter: (error) => {
      // Don't count validation errors or authentication errors
      return !(error.name === 'ValidationError' ||
               error.name === 'AuthenticationError' ||
               error.message.includes('authentication') ||
               error.message.includes('authorization'));
    }
  });
}

/**
 * Create a circuit breaker with default configuration for external API calls
 */
export function createApiCircuitBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker({
    name: `api-${name}`,
    failureThreshold: 3,
    successThreshold: 2,
    recoveryTimeout: 30000, // 30 seconds
    windowSize: 50,
    errorFilter: (error) => {
      // Count 5xx errors but not 4xx client errors
      if (error.message.includes('status')) {
        const statusMatch = error.message.match(/status\s+(\d+)/i);
        if (statusMatch) {
          const status = parseInt(statusMatch[1]);
          return status >= 500;
        }
      }
      return true;
    }
  });
}

/**
 * Create a circuit breaker registry for managing multiple circuits
 */
export class CircuitBreakerRegistry {
  private circuits = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker
   */
  getOrCreate(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    let circuit = this.circuits.get(name);

    if (!circuit) {
      const finalConfig = config ? { ...config, name } : {
        name,
        failureThreshold: 5,
        successThreshold: 3,
        recoveryTimeout: 60000
      };
      circuit = new CircuitBreaker(finalConfig);
      this.circuits.set(name, circuit);
    }

    return circuit;
  }

  /**
   * Get all circuit breakers
   */
  getAllCircuits(): Map<string, CircuitBreaker> {
    return new Map(this.circuits);
  }

  /**
   * Get statistics for all circuits
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};

    for (const [name, circuit] of this.circuits) {
      stats[name] = circuit.getStats();
    }

    return stats;
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    for (const circuit of this.circuits.values()) {
      circuit.reset();
    }
  }

  /**
   * Remove a circuit breaker
   */
  remove(name: string): boolean {
    return this.circuits.delete(name);
  }

  /**
   * Clear all circuit breakers
   */
  clear(): void {
    this.circuits.clear();
  }
}

// ==============================================
// Default Registry
// ==============================================

// Global circuit breaker registry (can be replaced with DI in production)
export const defaultCircuitBreakerRegistry = new CircuitBreakerRegistry();