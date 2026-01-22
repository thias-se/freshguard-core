/**
 * Secure error handling classes for FreshGuard Core
 *
 * Provides standardized error types that prevent information leakage
 * while maintaining useful debugging information.
 *
 * @license MIT
 */

// ==============================================
// Base Security Error Class
// ==============================================

/**
 * Base class for all FreshGuard security-related errors
 */
export abstract class FreshGuardError extends Error {
  public readonly code: string;
  public readonly timestamp: Date;
  public readonly sanitized: boolean;

  constructor(message: string, code: string, sanitized = true) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.timestamp = new Date();
    this.sanitized = sanitized;

    // Maintain proper stack trace (when available)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp.toISOString(),
      sanitized: this.sanitized,
    };
  }
}

// ==============================================
// Security-Specific Error Classes
// ==============================================

/**
 * Error for SQL injection attempts and other security violations
 */
export class SecurityError extends FreshGuardError {
  public readonly attemptedAction: string;

  constructor(message: string, attemptedAction = 'unknown') {
    super(message, 'SECURITY_VIOLATION', true);
    this.attemptedAction = attemptedAction;
  }

  static invalidIdentifier(identifier: string): SecurityError {
    return new SecurityError(
      `Invalid identifier: contains unsafe characters`,
      `invalid_identifier:${identifier.length}`
    );
  }

  static blockedQuery(keyword: string): SecurityError {
    return new SecurityError(
      `Query blocked: contains prohibited keyword`,
      `blocked_query:${keyword}`
    );
  }

  static queryPatternNotAllowed(): SecurityError {
    return new SecurityError(
      'Query pattern not allowed',
      'invalid_pattern'
    );
  }

  static sslRequired(): SecurityError {
    return new SecurityError(
      'SSL/TLS connection is required',
      'ssl_required'
    );
  }
}

/**
 * Error for database connection issues
 */
export class ConnectionError extends FreshGuardError {
  public readonly host?: string;
  public readonly port?: number;

  constructor(
    message: string,
    host?: string,
    port?: number,
    originalError?: Error
  ) {
    // Always use sanitized message for connection errors
    const sanitizedMessage = ConnectionError.sanitizeConnectionError(message, originalError);
    super(sanitizedMessage, 'CONNECTION_FAILED', true);

    // Store connection details without sensitive info
    this.host = host;
    this.port = port;
  }

  private static sanitizeConnectionError(message: string, _originalError?: Error): string {
    const lowerMessage = message.toLowerCase();

    // Map specific connection errors to safe messages
    if (lowerMessage.includes('connection refused')) {
      return 'Connection refused - check host and port';
    }

    if (lowerMessage.includes('connection timed out') || lowerMessage.includes('timeout')) {
      return 'Connection timeout - check network connectivity';
    }

    if (lowerMessage.includes('authentication failed') ||
        lowerMessage.includes('permission denied') ||
        lowerMessage.includes('access denied')) {
      return 'Authentication failed - check credentials and permissions';
    }

    if (lowerMessage.includes('database') && lowerMessage.includes('does not exist')) {
      return 'Database not found - check database name';
    }

    if (lowerMessage.includes('host') && lowerMessage.includes('not found')) {
      return 'Host not found - check hostname';
    }

    if (lowerMessage.includes('ssl') || lowerMessage.includes('tls')) {
      return 'SSL/TLS connection failed - check SSL configuration';
    }

    // Generic message for unknown connection errors
    return 'Database connection failed - check configuration';
  }

  static hostUnreachable(host: string, port?: number): ConnectionError {
    return new ConnectionError(
      'Host unreachable',
      host,
      port
    );
  }

  static authenticationFailed(host: string): ConnectionError {
    return new ConnectionError(
      'Authentication failed',
      host
    );
  }

  static databaseNotFound(_database: string, host: string): ConnectionError {
    return new ConnectionError(
      'Database not found',
      host
    );
  }
}

/**
 * Error for operation timeouts
 */
export class TimeoutError extends FreshGuardError {
  public readonly operationType: string;
  public readonly timeoutMs: number;

  constructor(
    message: string,
    operationType = 'unknown',
    timeoutMs = 0
  ) {
    const sanitizedMessage = TimeoutError.sanitizeTimeoutError(message);
    super(sanitizedMessage, 'OPERATION_TIMEOUT', true);
    this.operationType = operationType;
    this.timeoutMs = timeoutMs;
  }

  private static sanitizeTimeoutError(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('query timeout')) {
      return 'Query timeout - operation took too long';
    }

    if (lowerMessage.includes('connection timeout')) {
      return 'Connection timeout - check network connectivity';
    }

    // Generic timeout message
    return 'Operation timeout - request took too long';
  }

  static queryTimeout(timeoutMs: number): TimeoutError {
    return new TimeoutError(
      `Query timeout after ${timeoutMs}ms - table may be too large`,
      'query',
      timeoutMs
    );
  }

  static connectionTimeout(timeoutMs: number): TimeoutError {
    return new TimeoutError(
      `Connection timeout after ${timeoutMs}ms`,
      'connection',
      timeoutMs
    );
  }
}

/**
 * Error for query validation and execution issues
 */
export class QueryError extends FreshGuardError {
  public readonly queryType: string;
  public readonly table?: string;

  constructor(
    message: string,
    queryType = 'unknown',
    table?: string,
    originalError?: Error
  ) {
    const sanitizedMessage = QueryError.sanitizeQueryError(message, originalError);
    super(sanitizedMessage, 'QUERY_FAILED', true);
    this.queryType = queryType;
    this.table = table;
  }

  private static sanitizeQueryError(message: string, _originalError?: Error): string {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('syntax error')) {
      return 'Invalid query syntax';
    }

    if (lowerMessage.includes('table') && lowerMessage.includes('not exist')) {
      return 'Table does not exist';
    }

    if (lowerMessage.includes('column') && lowerMessage.includes('not exist')) {
      return 'Column does not exist';
    }

    if (lowerMessage.includes('permission denied') || lowerMessage.includes('access denied')) {
      return 'Insufficient permissions for query execution';
    }

    if (lowerMessage.includes('too many rows') || lowerMessage.includes('result too large')) {
      return 'Query result too large - consider adding filters';
    }

    // Generic message for other query errors
    return 'Query execution failed';
  }

  static tableNotFound(table: string): QueryError {
    return new QueryError(
      'Table does not exist',
      'table_access',
      table
    );
  }

  static columnNotFound(_column: string, table: string): QueryError {
    return new QueryError(
      'Column does not exist',
      'column_access',
      table
    );
  }

  static resultTooLarge(maxRows: number, table?: string): QueryError {
    return new QueryError(
      `Query returned too many rows (max ${maxRows})`,
      'result_size',
      table
    );
  }
}

/**
 * Error for configuration and validation issues
 */
export class ConfigurationError extends FreshGuardError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, 'CONFIGURATION_ERROR', true);
    this.field = field;
  }

  static missingRequired(field: string): ConfigurationError {
    return new ConfigurationError(
      `Required configuration field missing: ${field}`,
      field
    );
  }

  static invalidValue(field: string, _value: string, expected: string): ConfigurationError {
    return new ConfigurationError(
      `Invalid value for ${field}: expected ${expected}`,
      field
    );
  }

  static invalidFormat(field: string, format: string): ConfigurationError {
    return new ConfigurationError(
      `Invalid format for ${field}: expected ${format}`,
      field
    );
  }
}

/**
 * Error for monitoring and check failures
 */
export class MonitoringError extends FreshGuardError {
  public readonly ruleId?: string;
  public readonly table?: string;
  public readonly checkType?: string;

  constructor(
    message: string,
    checkType?: string,
    ruleId?: string,
    table?: string
  ) {
    super(message, 'MONITORING_FAILED', true);
    this.checkType = checkType;
    this.ruleId = ruleId;
    this.table = table;
  }

  static freshnessCheckFailed(table: string, reason: string): MonitoringError {
    return new MonitoringError(
      `Freshness check failed for table ${table}: ${reason}`,
      'freshness',
      undefined,
      table
    );
  }

  static volumeCheckFailed(table: string, reason: string): MonitoringError {
    return new MonitoringError(
      `Volume check failed for table ${table}: ${reason}`,
      'volume',
      undefined,
      table
    );
  }
}

// ==============================================
// Error Utilities
// ==============================================

/**
 * Utility class for error handling and sanitization
 */
export class ErrorHandler {
  /**
   * Sanitize any error to prevent information leakage
   */
  static sanitize(error: unknown): FreshGuardError {
    if (error instanceof FreshGuardError) {
      return error;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Map to appropriate FreshGuard error types
      if (message.includes('connection')) {
        return new ConnectionError(error.message);
      }

      if (message.includes('timeout')) {
        return new TimeoutError(error.message);
      }

      if (message.includes('syntax') || message.includes('query')) {
        return new QueryError(error.message);
      }

      if (message.includes('security') || message.includes('invalid')) {
        return new SecurityError('Security validation failed');
      }

      // Generic error fallback
      return new QueryError('Operation failed', 'unknown_operation');
    }

    // Handle non-Error objects
    return new QueryError('Unknown error occurred', 'unknown_operation');
  }

  /**
   * Check if error should be logged with full details (for debugging)
   */
  static shouldLogDetails(error: FreshGuardError): boolean {
    // Only log details for non-security errors in development
    return !error.sanitized || (
      process.env.NODE_ENV === 'development' &&
      !(error instanceof SecurityError)
    );
  }

  /**
   * Get user-safe error message
   */
  static getUserMessage(error: unknown): string {
    const sanitizedError = this.sanitize(error);
    return sanitizedError.message;
  }

  /**
   * Get error code for API responses
   */
  static getErrorCode(error: unknown): string {
    const sanitizedError = this.sanitize(error);
    return sanitizedError.code;
  }
}

// ==============================================
// Error Factory Functions
// ==============================================

/**
 * Create standardized error instances
 */
export const createError = {
  security: {
    invalidIdentifier: (name: string) => SecurityError.invalidIdentifier(name),
    blockedQuery: (keyword: string) => SecurityError.blockedQuery(keyword),
    queryNotAllowed: () => SecurityError.queryPatternNotAllowed(),
    sslRequired: () => SecurityError.sslRequired(),
  },

  connection: {
    hostUnreachable: (host: string, port?: number) => ConnectionError.hostUnreachable(host, port),
    authFailed: (host: string) => ConnectionError.authenticationFailed(host),
    databaseNotFound: (database: string, host: string) => ConnectionError.databaseNotFound(database, host),
  },

  timeout: {
    query: (timeoutMs: number) => TimeoutError.queryTimeout(timeoutMs),
    connection: (timeoutMs: number) => TimeoutError.connectionTimeout(timeoutMs),
  },

  query: {
    tableNotFound: (table: string) => QueryError.tableNotFound(table),
    columnNotFound: (column: string, table: string) => QueryError.columnNotFound(column, table),
    resultTooLarge: (maxRows: number, table?: string) => QueryError.resultTooLarge(maxRows, table),
  },

  config: {
    missingRequired: (field: string) => ConfigurationError.missingRequired(field),
    invalidValue: (field: string, value: string, expected: string) =>
      ConfigurationError.invalidValue(field, value, expected),
    invalidFormat: (field: string, format: string) => ConfigurationError.invalidFormat(field, format),
  },

  monitoring: {
    freshnessCheckFailed: (table: string, reason: string) =>
      MonitoringError.freshnessCheckFailed(table, reason),
    volumeCheckFailed: (table: string, reason: string) =>
      MonitoringError.volumeCheckFailed(table, reason),
  },
};

// Error types are exported individually above