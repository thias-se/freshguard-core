/**
 * Structured logging system for FreshGuard Core Phase 2
 *
 * Provides JSON-based structured logging with context preservation,
 * sensitive data sanitization, and integration with resilience components.
 *
 * @license MIT
 */

import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';

// ==============================================
// Types and Interfaces
// ==============================================

/**
 * Log levels supported by the system
 */
export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

/**
 * Structured log context for operations
 */
export interface LogContext {
  /** Operation being performed */
  operation?: string;
  /** Table or resource being accessed */
  table?: string;
  /** Database or service being used */
  database?: string;
  /** Duration of operation in milliseconds */
  duration?: number;
  /** Component generating the log */
  component?: string;
  /** Workspace or tenant ID (will be sanitized) */
  workspaceId?: string;
  /** Connection identifier */
  connectionId?: string;
  /** Query complexity score */
  queryComplexity?: number;
  /** Retry attempt number */
  retryAttempt?: number;
  /** Circuit breaker state */
  circuitBreakerState?: string;
  /** Additional context data */
  [key: string]: any;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Log level (default: info) */
  level?: LogLevel;
  /** Enable pretty printing for development */
  prettyPrint?: boolean;
  /** Service name for logs */
  serviceName?: string;
  /** Environment (development, production, test) */
  environment?: string;
  /** Enable/disable sensitive data sanitization */
  sanitizeSensitiveData?: boolean;
  /** Additional base context to include in all logs */
  baseContext?: Record<string, any>;
  /** Custom Pino options */
  pinoOptions?: Partial<LoggerOptions>;
}

/**
 * Timing information for operations
 */
export interface TimingInfo {
  startTime: Date;
  endTime: Date | null;
  duration: number;
}

// ==============================================
// Sensitive Data Patterns
// ==============================================

/**
 * Patterns for detecting sensitive data that should be sanitized
 */
const SENSITIVE_PATTERNS = [
  // Passwords and secrets
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /credential/i,
  /auth/i,

  // Connection strings
  /connection.*string/i,
  /database.*url/i,

  // Personal data
  /email/i,
  /phone/i,
  /address/i,
  /ssn/i,
  /credit.*card/i,

  // API keys and tokens
  /api.*key/i,
  /access.*token/i,
  /refresh.*token/i,
  /bearer.*token/i,
];

/**
 * Fields that should always be sanitized
 */
const SENSITIVE_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apiKey',
  'accessToken',
  'refreshToken',
  'connectionString',
  'credentials',
  'authorization',
  'cookie',
  'session',
]);

// ==============================================
// Utility Functions
// ==============================================

/**
 * Sanitize sensitive data from an object
 */
function sanitizeObject(obj: any, depth = 0): any {
  if (depth > 10) {
    return '[Maximum depth reached]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: sanitizeString(obj.message),
      stack: process.env.NODE_ENV === 'development' ? obj.stack : undefined,
    };
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};

    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = key.toLowerCase();

      if (SENSITIVE_FIELDS.has(sanitizedKey) || SENSITIVE_PATTERNS.some(pattern => pattern.test(key))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeObject(value, depth + 1);
      }
    }

    return sanitized;
  }

  return obj;
}

/**
 * Sanitize sensitive data from strings
 */
function sanitizeString(str: string): string {
  // Redact potential connection strings
  return str
    .replace(/(?:password|pwd|secret|token|key)=[\w\-\.]+/gi, '$&=[REDACTED]')
    .replace(/(?:mongodb|postgres|mysql):\/\/[^:]+:[^@]+@/gi, (match) =>
      match.replace(/:[^:@]+@/, ':***@')
    );
}

/**
 * Create a timing tracker for operations
 */
function createTimingTracker(): {
  start(): void;
  end(): TimingInfo;
  getDuration(): number;
} {
  let startTime: Date | null = null;
  let endTime: Date | null = null;

  return {
    start() {
      startTime = new Date();
      endTime = null;
    },

    end(): TimingInfo {
      if (!startTime) {
        throw new Error('Timer not started. Call start() first.');
      }

      endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      return {
        startTime,
        endTime,
        duration,
      };
    },

    getDuration(): number {
      if (!startTime) {
        return 0;
      }

      const now = endTime || new Date();
      return now.getTime() - startTime.getTime();
    },
  };
}

// ==============================================
// Structured Logger Implementation
// ==============================================

/**
 * Structured logger with context preservation and sensitive data sanitization
 */
export class StructuredLogger {
  private readonly logger: PinoLogger;
  private readonly config: Required<LoggerConfig>;
  private readonly baseContext: Record<string, any>;

  constructor(config: LoggerConfig = {}) {
    this.config = {
      level: config.level || LogLevel.INFO,
      prettyPrint: config.prettyPrint || process.env.NODE_ENV === 'development',
      serviceName: config.serviceName || 'freshguard-core',
      environment: config.environment || process.env.NODE_ENV || 'development',
      sanitizeSensitiveData: config.sanitizeSensitiveData !== false,
      baseContext: config.baseContext || {},
      pinoOptions: config.pinoOptions || {},
    };

    // Create base context
    this.baseContext = {
      service: this.config.serviceName,
      environment: this.config.environment,
      pid: process.pid,
      hostname: process.env.HOSTNAME || 'unknown',
      version: process.env.npm_package_version || '0.0.0',
      ...this.config.baseContext,
    };

    // Configure Pino logger
    const pinoConfig: LoggerOptions = {
      level: this.config.level,
      base: this.baseContext,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        error: (error) => ({
          error: this.config.sanitizeSensitiveData ? sanitizeObject(error) : error
        }),
      },
      ...this.config.pinoOptions,
    };

    // Enable pretty printing for development
    if (this.config.prettyPrint) {
      try {
        pinoConfig.transport = {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'HH:MM:ss.l',
          },
        };
      } catch {
        // Fallback if pino-pretty is not available
        console.warn('pino-pretty not available, using default formatting');
      }
    }

    this.logger = pino(pinoConfig);
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): StructuredLogger {
    const sanitizedContext = this.config.sanitizeSensitiveData
      ? sanitizeObject(context)
      : context;

    const childLogger = new StructuredLogger({
      ...this.config,
      pinoOptions: {
        ...this.config.pinoOptions,
        base: {
          ...this.baseContext,
          ...sanitizedContext,
        },
      },
    });

    return childLogger;
  }

  /**
   * Create a timing tracker for operations
   */
  createTimer(): {
    start(): void;
    end(message?: string, context?: LogContext): TimingInfo;
    getDuration(): number;
  } {
    const tracker = createTimingTracker();

    return {
      start: tracker.start.bind(tracker),
      getDuration: tracker.getDuration.bind(tracker),
      end: (message?: string, context?: LogContext) => {
        const timing = tracker.end();

        if (message) {
          this.info(message, {
            ...context,
            duration: timing.duration,
            startTime: timing.startTime.toISOString(),
            endTime: timing.endTime?.toISOString(),
          });
        }

        return timing;
      },
    };
  }

  /**
   * Log at TRACE level
   */
  trace(message: string, context?: LogContext): void {
    this.log(LogLevel.TRACE, message, context);
  }

  /**
   * Log at DEBUG level
   */
  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log at INFO level
   */
  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log at WARN level
   */
  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log at ERROR level
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = error ? { error } : {};
    this.log(LogLevel.ERROR, message, { ...errorContext, ...context });
  }

  /**
   * Log at FATAL level
   */
  fatal(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = error ? { error } : {};
    this.log(LogLevel.FATAL, message, { ...errorContext, ...context });
  }

  /**
   * Generic log method
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    const sanitizedContext = context && this.config.sanitizeSensitiveData
      ? sanitizeObject(context)
      : context;

    this.logger[level](sanitizedContext || {}, message);
  }

  /**
   * Get the underlying Pino logger
   */
  getPinoLogger(): PinoLogger {
    return this.logger;
  }

  /**
   * Check if a log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    return this.logger.isLevelEnabled(level);
  }

  /**
   * Get current logger configuration
   */
  getConfig(): Required<LoggerConfig> {
    return { ...this.config };
  }

  /**
   * Flush any pending logs (useful for testing)
   */
  flush(): void {
    this.logger.flush();
  }
}

// ==============================================
// Default Logger Instance
// ==============================================

/**
 * Default logger instance for convenience
 */
export const defaultLogger = new StructuredLogger();

// ==============================================
// Convenience Functions
// ==============================================

/**
 * Create a logger for a specific component
 */
export function createComponentLogger(component: string, config?: LoggerConfig): StructuredLogger {
  return new StructuredLogger({
    ...config,
    baseContext: {
      component,
      ...(config?.baseContext || {}),
    },
  });
}

/**
 * Create a logger for database operations
 */
export function createDatabaseLogger(database: string, config?: LoggerConfig): StructuredLogger {
  return createComponentLogger('database', {
    ...config,
    baseContext: {
      database,
      ...(config?.baseContext || {}),
    },
  });
}

/**
 * Log a timed operation
 */
export async function logTimedOperation<T>(
  logger: StructuredLogger,
  operation: string,
  fn: () => Promise<T>,
  context?: LogContext
): Promise<T> {
  const timer = logger.createTimer();
  timer.start();

  try {
    logger.debug(`Starting ${operation}`, context);
    const result = await fn();
    timer.end(`Completed ${operation}`, { ...context, success: true });
    return result;
  } catch (error) {
    timer.end(`Failed ${operation}`, { ...context, success: false });
    logger.error(`Operation failed: ${operation}`, error, context);
    throw error;
  }
}