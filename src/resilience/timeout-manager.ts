/**
 * Timeout Manager implementation for FreshGuard Core Phase 2
 *
 * Provides proper timeout handling using AbortController to actually cancel
 * operations instead of just racing promises. Supports hierarchical timeouts,
 * timeout inheritance, and comprehensive timeout statistics.
 *
 * @license MIT
 */

// ==============================================
// Types and Interfaces
// ==============================================

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  /** Timeout duration in milliseconds */
  duration: number;
  /** Timeout name for logging/monitoring */
  name?: string;
  /** Parent timeout to inherit cancellation from */
  parent?: TimeoutManager;
  /** Custom error message on timeout */
  message?: string;
  /** Whether to propagate cancellation to children */
  propagateToChildren?: boolean;
}

/**
 * Timeout execution result
 */
export interface TimeoutResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  duration: number;
  timedOut: boolean;
  cancelled: boolean;
}

/**
 * Timeout statistics
 */
export interface TimeoutStats {
  totalExecutions: number;
  successfulExecutions: number;
  timeoutCount: number;
  cancelledCount: number;
  averageDuration: number;
  maxDuration: number;
  minDuration: number;
  timeoutRate: number;
  lastExecutionTime: Date | null;
}

/**
 * Active timeout information
 */
export interface ActiveTimeout {
  id: string;
  name: string;
  startTime: Date;
  duration: number;
  controller: AbortController;
  parent?: TimeoutManager;
  children: Set<TimeoutManager>;
}

// ==============================================
// Error Classes
// ==============================================

/**
 * Operation timeout error
 */
export class OperationTimeoutError extends Error {
  public readonly duration: number;
  public readonly operationName: string;
  public readonly timestamp: Date;

  constructor(duration: number, operationName: string, customMessage?: string) {
    const message = customMessage ||
      `Operation '${operationName}' timed out after ${duration}ms`;
    super(message);
    this.name = 'OperationTimeoutError';
    this.duration = duration;
    this.operationName = operationName;
    this.timestamp = new Date();
  }
}

/**
 * Operation cancelled error
 */
export class OperationCancelledError extends Error {
  public readonly operationName: string;
  public readonly timestamp: Date;
  public readonly reason: string;

  constructor(operationName: string, reason = 'Operation was cancelled') {
    super(`Operation '${operationName}' was cancelled: ${reason}`);
    this.name = 'OperationCancelledError';
    this.operationName = operationName;
    this.timestamp = new Date();
    this.reason = reason;
  }
}

// ==============================================
// Timeout Manager Implementation
// ==============================================

/**
 * Timeout Manager with AbortController-based cancellation
 */
export class TimeoutManager {
  private readonly controller: AbortController;
  private timeoutId: NodeJS.Timeout | null = null;
  private readonly config: Required<TimeoutConfig>;
  private startTime: Date | null = null;
  private endTime: Date | null = null;
  private readonly children = new Set<TimeoutManager>();
  private timeoutFired = false; // Track if timeout was the cause of abort
  private stats: TimeoutStats = {
    totalExecutions: 0,
    successfulExecutions: 0,
    timeoutCount: 0,
    cancelledCount: 0,
    averageDuration: 0,
    maxDuration: 0,
    minDuration: Infinity,
    timeoutRate: 0,
    lastExecutionTime: null
  };

  constructor(config: TimeoutConfig) {
    this.controller = new AbortController();
    this.config = {
      name: 'TimeoutManager',
      parent: undefined,
      message: undefined,
      propagateToChildren: true,
      ...config
    };

    // Validate configuration
    if (this.config.duration <= 0) {
      throw new Error('Timeout duration must be positive');
    }

    // Set up parent-child relationship
    if (this.config.parent) {
      this.config.parent.addChild(this);

      // Inherit parent's cancellation
      if (this.config.parent.isAborted()) {
        this.cancel('Parent timeout was already cancelled');
      } else {
        this.config.parent.controller.signal.addEventListener('abort', () => {
          this.cancel('Parent timeout was cancelled');
        });
      }
    }
  }

  /**
   * Execute a function with timeout protection
   */
  async execute<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const result = await this.executeWithResult(fn);

    if (result.success && result.data !== undefined) {
      return result.data;
    } else {
      throw result.error || new Error('Timeout execution failed with unknown error');
    }
  }

  /**
   * Execute with detailed result (no throwing)
   */
  async executeWithResult<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<TimeoutResult<T>> {
    this.startTime = new Date();
    this.timeoutFired = false; // Reset timeout flag
    this.stats.totalExecutions++;
    this.stats.lastExecutionTime = this.startTime;

    // Set up timeout
    this.timeoutId = setTimeout(() => {
      this.timeout();
    }, this.config.duration);

    let result: T | undefined;
    let error: Error | undefined;
    let success = false;
    let timedOut = false;
    let cancelled = false;

    try {
      result = await fn(this.controller.signal);
      success = true;
    } catch (err) {
      error = err as Error;

      if (this.controller.signal.aborted) {
        if (this.timeoutFired) {
          timedOut = true;
        } else {
          cancelled = true;
        }
      }
    } finally {
      this.cleanup();
      this.endTime = new Date();
    }

    const duration = this.endTime.getTime() - this.startTime.getTime();
    this.updateStats(duration, success, timedOut, cancelled);

    return {
      success,
      data: result,
      error,
      duration,
      timedOut,
      cancelled
    };
  }

  /**
   * Execute with static timeout (convenience method)
   */
  static async executeWithTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    duration: number,
    name = 'StaticTimeout'
  ): Promise<T> {
    const manager = new TimeoutManager({ duration, name });
    return manager.execute(fn);
  }

  /**
   * Execute with static timeout and result (convenience method)
   */
  static async executeWithTimeoutResult<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    duration: number,
    name = 'StaticTimeout'
  ): Promise<TimeoutResult<T>> {
    const manager = new TimeoutManager({ duration, name });
    return manager.executeWithResult(fn);
  }

  /**
   * Create a child timeout manager
   */
  createChild(config: Omit<TimeoutConfig, 'parent'>): TimeoutManager {
    const childConfig: TimeoutConfig = {
      ...config,
      parent: this
    };
    return new TimeoutManager(childConfig);
  }

  /**
   * Add a child timeout manager
   */
  addChild(child: TimeoutManager): void {
    this.children.add(child);
  }

  /**
   * Remove a child timeout manager
   */
  removeChild(child: TimeoutManager): void {
    this.children.delete(child);
  }

  /**
   * Cancel the timeout (and optionally children)
   */
  cancel(reason = 'Operation cancelled'): void {
    if (!this.controller.signal.aborted) {
      // Create cancellation error
      const error = new OperationCancelledError(this.config.name, reason);

      // Cancel with reason
      this.controller.abort();

      // Propagate to children if configured
      if (this.config.propagateToChildren) {
        for (const child of this.children) {
          child.cancel(`Parent cancelled: ${reason}`);
        }
      }
    }

    this.cleanup();
  }

  /**
   * Handle timeout event
   */
  private timeout(): void {
    if (!this.controller.signal.aborted) {
      this.timeoutFired = true;
      const error = new OperationTimeoutError(
        this.config.duration,
        this.config.name,
        this.config.message
      );

      this.controller.abort();

      // Propagate to children
      if (this.config.propagateToChildren) {
        for (const child of this.children) {
          child.cancel(`Parent timed out after ${this.config.duration}ms`);
        }
      }
    }
  }

  /**
   * Clean up timeout and references
   */
  private cleanup(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Remove from parent's children
    if (this.config.parent) {
      this.config.parent.removeChild(this);
    }

    // Clean up children
    for (const child of this.children) {
      child.cancel('Parent cleanup');
    }
    this.children.clear();
  }

  /**
   * Update internal statistics
   */
  private updateStats(duration: number, success: boolean, timedOut: boolean, cancelled: boolean): void {
    if (success) {
      this.stats.successfulExecutions++;
    }

    if (timedOut) {
      this.stats.timeoutCount++;
    }

    if (cancelled) {
      this.stats.cancelledCount++;
    }

    // Update duration stats
    this.stats.averageDuration = (
      (this.stats.averageDuration * (this.stats.totalExecutions - 1) + duration) /
      this.stats.totalExecutions
    );

    this.stats.maxDuration = Math.max(this.stats.maxDuration, duration);
    this.stats.minDuration = Math.min(this.stats.minDuration, duration);

    // Update timeout rate
    this.stats.timeoutRate = (this.stats.timeoutCount / this.stats.totalExecutions) * 100;
  }

  /**
   * Check if timeout is aborted
   */
  isAborted(): boolean {
    return this.controller.signal.aborted;
  }

  /**
   * Get the AbortSignal
   */
  getSignal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Get timeout configuration
   */
  getConfig(): Required<TimeoutConfig> {
    return { ...this.config };
  }

  /**
   * Get timeout statistics
   */
  getStats(): TimeoutStats {
    return {
      ...this.stats,
      averageDuration: Math.round(this.stats.averageDuration * 100) / 100,
      timeoutRate: Math.round(this.stats.timeoutRate * 100) / 100,
      minDuration: this.stats.minDuration === Infinity ? 0 : this.stats.minDuration
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      timeoutCount: 0,
      cancelledCount: 0,
      averageDuration: 0,
      maxDuration: 0,
      minDuration: Infinity,
      timeoutRate: 0,
      lastExecutionTime: null
    };
  }

  /**
   * Get active timeout information
   */
  getActiveTimeout(): ActiveTimeout | null {
    if (!this.startTime || this.endTime) {
      return null;
    }

    return {
      id: `${this.config.name}-${this.startTime.getTime()}`,
      name: this.config.name,
      startTime: this.startTime,
      duration: this.config.duration,
      controller: this.controller,
      parent: this.config.parent,
      children: new Set(this.children)
    };
  }

  /**
   * Get remaining time (if active)
   */
  getRemainingTime(): number {
    if (!this.startTime || this.endTime || this.isAborted()) {
      return 0;
    }

    const elapsed = Date.now() - this.startTime.getTime();
    return Math.max(0, this.config.duration - elapsed);
  }

  /**
   * Get elapsed time (if active)
   */
  getElapsedTime(): number {
    if (!this.startTime) {
      return 0;
    }

    const endTime = this.endTime || new Date();
    return endTime.getTime() - this.startTime.getTime();
  }
}

// ==============================================
// Timeout Registry
// ==============================================

/**
 * Registry for managing multiple timeout managers
 */
export class TimeoutRegistry {
  private readonly timeouts = new Map<string, TimeoutManager>();
  private readonly activeTimeouts = new Map<string, ActiveTimeout>();

  /**
   * Create and register a timeout manager
   */
  create(name: string, config: Omit<TimeoutConfig, 'name'>): TimeoutManager {
    const fullConfig: TimeoutConfig = { ...config, name };
    const manager = new TimeoutManager(fullConfig);
    this.timeouts.set(name, manager);
    return manager;
  }

  /**
   * Get a timeout manager
   */
  get(name: string): TimeoutManager | undefined {
    return this.timeouts.get(name);
  }

  /**
   * Get or create a timeout manager
   */
  getOrCreate(name: string, config: Omit<TimeoutConfig, 'name'>): TimeoutManager {
    let manager = this.timeouts.get(name);

    if (!manager) {
      manager = this.create(name, config);
    }

    return manager;
  }

  /**
   * Remove a timeout manager
   */
  remove(name: string): boolean {
    const manager = this.timeouts.get(name);
    if (manager) {
      manager.cancel('Removed from registry');
      return this.timeouts.delete(name);
    }
    return false;
  }

  /**
   * Get all timeout managers
   */
  getAllTimeouts(): Map<string, TimeoutManager> {
    return new Map(this.timeouts);
  }

  /**
   * Get all active timeouts
   */
  getActiveTimeouts(): Map<string, ActiveTimeout> {
    const active = new Map<string, ActiveTimeout>();

    for (const [name, manager] of this.timeouts) {
      const activeTimeout = manager.getActiveTimeout();
      if (activeTimeout) {
        active.set(name, activeTimeout);
      }
    }

    return active;
  }

  /**
   * Get statistics for all timeout managers
   */
  getAllStats(): Record<string, TimeoutStats> {
    const stats: Record<string, TimeoutStats> = {};

    for (const [name, manager] of this.timeouts) {
      stats[name] = manager.getStats();
    }

    return stats;
  }

  /**
   * Cancel all timeouts
   */
  cancelAll(reason = 'Registry shutdown'): void {
    for (const manager of this.timeouts.values()) {
      manager.cancel(reason);
    }
  }

  /**
   * Reset all statistics
   */
  resetAllStats(): void {
    for (const manager of this.timeouts.values()) {
      manager.resetStats();
    }
  }

  /**
   * Clear all timeout managers
   */
  clear(): void {
    this.cancelAll('Registry cleared');
    this.timeouts.clear();
    this.activeTimeouts.clear();
  }
}

// ==============================================
// Convenience Functions
// ==============================================

/**
 * Execute function with timeout (throws on timeout/cancellation)
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  name = 'WithTimeout'
): Promise<T> {
  return TimeoutManager.executeWithTimeout(fn, timeoutMs, name);
}

/**
 * Execute function with timeout (returns result object)
 */
export async function withTimeoutResult<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  name = 'WithTimeoutResult'
): Promise<TimeoutResult<T>> {
  return TimeoutManager.executeWithTimeoutResult(fn, timeoutMs, name);
}

/**
 * Create a timeout manager with database-appropriate settings
 */
export function createDatabaseTimeout(operationName: string): TimeoutManager {
  return new TimeoutManager({
    duration: 30000, // 30 seconds
    name: `db-${operationName}`,
    message: `Database operation '${operationName}' timed out`,
    propagateToChildren: true
  });
}

/**
 * Create a timeout manager with API-appropriate settings
 */
export function createApiTimeout(operationName: string): TimeoutManager {
  return new TimeoutManager({
    duration: 10000, // 10 seconds
    name: `api-${operationName}`,
    message: `API operation '${operationName}' timed out`,
    propagateToChildren: true
  });
}

// ==============================================
// Default Registry
// ==============================================

// Global timeout registry
export const defaultTimeoutRegistry = new TimeoutRegistry();