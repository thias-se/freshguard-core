/**
 * Debug error factory for enhanced error handling during development
 *
 * Provides debug-aware error creation that includes additional context
 * when debug mode is enabled while maintaining security in production.
 *
 * @license MIT
 */

import type { DebugInfo, DebugConfig } from '../types.js';
import { QueryError, ConnectionError, TimeoutError } from './index.js';

/**
 * Query context for debug information
 */
export interface QueryContext {
  sql: string;
  params?: unknown[];
  table?: string;
  column?: string;
  duration?: number;
  operation?: string;
}

/**
 * Enhanced error factory with debug capabilities
 */
export class DebugErrorFactory {
  constructor(private debugConfig?: DebugConfig) {}

  /**
   * Create a query error with debug information
   */
  createQueryError(
    message: string,
    rawError?: Error,
    queryContext?: QueryContext
  ): QueryError {
    let debug: DebugInfo | undefined;

    if (this.debugConfig?.enabled) {
      debug = {
        query: this.debugConfig.exposeQueries ? queryContext?.sql : undefined,
        params: this.debugConfig.exposeQueries ? queryContext?.params : undefined,
        rawError: this.debugConfig.exposeRawErrors ? rawError?.message : undefined,
        suggestion: this.generateSuggestion(rawError, queryContext),
        duration: queryContext?.duration,
        context: queryContext ? {
          table: queryContext.table,
          column: queryContext.column,
          operation: queryContext.operation
        } : undefined
      };
    }

    return new QueryError(
      message,
      queryContext?.operation || 'query',
      queryContext?.table,
      rawError,
      debug
    );
  }

  /**
   * Create a connection error with debug information
   */
  createConnectionError(
    message: string,
    host?: string,
    port?: number,
    rawError?: Error
  ): ConnectionError {
    let debug: DebugInfo | undefined;

    if (this.debugConfig?.enabled) {
      debug = {
        rawError: this.debugConfig.exposeRawErrors ? rawError?.message : undefined,
        suggestion: this.generateConnectionSuggestion(rawError, host, port),
        context: { host, port }
      };
    }

    const error = new ConnectionError(message, host, port, rawError);
    error.debug = debug;
    return error;
  }

  /**
   * Create a timeout error with debug information
   */
  createTimeoutError(
    message: string,
    operationType: string,
    timeoutMs: number,
    queryContext?: QueryContext
  ): TimeoutError {
    let debug: DebugInfo | undefined;

    if (this.debugConfig?.enabled) {
      debug = {
        query: this.debugConfig.exposeQueries ? queryContext?.sql : undefined,
        suggestion: this.generateTimeoutSuggestion(operationType, timeoutMs, queryContext),
        duration: timeoutMs,
        context: {
          operation: operationType,
          timeout: timeoutMs,
          table: queryContext?.table
        }
      };
    }

    const error = new TimeoutError(message, operationType, timeoutMs);
    error.debug = debug;
    return error;
  }

  /**
   * Generate actionable suggestions for query errors
   */
  private generateSuggestion(error?: Error, context?: QueryContext): string | undefined {
    if (!error) return undefined;

    const message = error.message.toLowerCase();

    // Table existence errors
    if (message.includes('relation') && message.includes('does not exist')) {
      return `Table '${context?.table}' does not exist. Verify table name and database schema access.`;
    }

    if (message.includes('table') && message.includes('does not exist')) {
      return `Table '${context?.table}' not found. Check spelling and database permissions.`;
    }

    // Column existence errors
    if (message.includes('column') && message.includes('does not exist')) {
      const table = context?.table;
      const column = context?.column;
      return table
        ? `Column '${column}' not found in table '${table}'. Use DESCRIBE ${table} to check available columns.`
        : 'Column not found. Check column name and table schema.';
    }

    // Permission errors
    if (message.includes('permission denied') || message.includes('access denied')) {
      const table = context?.table;
      return table
        ? `Access denied to table '${table}'. Grant SELECT permission: GRANT SELECT ON ${table} TO your_user;`
        : 'Database access denied. Check user permissions and credentials.';
    }

    // Syntax errors
    if (message.includes('syntax error')) {
      return 'SQL syntax error detected. Check for special characters in table/column names that may need quoting.';
    }

    // Data type errors
    if (message.includes('invalid input') || message.includes('type')) {
      const column = context?.column;
      return column
        ? `Data type mismatch for column '${column}'. Check that the column contains valid timestamp data.`
        : 'Data type mismatch. Verify column contains expected data type.';
    }

    return 'Check database connection, table existence, and access permissions.';
  }

  /**
   * Generate suggestions for connection errors
   */
  private generateConnectionSuggestion(error?: Error, host?: string, port?: number): string | undefined {
    if (!error) return undefined;

    const message = error.message.toLowerCase();

    if (message.includes('connection refused')) {
      return `Database server at ${host}:${port} is not accepting connections. Check if server is running and port is correct.`;
    }

    if (message.includes('timeout') || message.includes('timed out')) {
      return `Connection to ${host}:${port} timed out. Check network connectivity and firewall settings.`;
    }

    if (message.includes('authentication failed') || message.includes('password')) {
      return `Authentication failed for ${host}. Verify username, password, and database name are correct.`;
    }

    if (message.includes('database') && message.includes('does not exist')) {
      return `Database not found on server ${host}. Check database name and server configuration.`;
    }

    if (message.includes('ssl') || message.includes('tls')) {
      return `SSL/TLS connection failed to ${host}. Check SSL configuration and certificate validity.`;
    }

    return `Database connection failed. Check host (${host}), port (${port}), and network connectivity.`;
  }

  /**
   * Generate suggestions for timeout errors
   */
  private generateTimeoutSuggestion(operationType: string, timeoutMs: number, context?: QueryContext): string | undefined {
    const table = context?.table;

    switch (operationType) {
      case 'freshness_check':
      case 'volume_check':
        return table
          ? `Query timeout after ${timeoutMs}ms on table '${table}'. Table may be very large - consider adding indexes on timestamp columns or increasing timeout.`
          : `Query timeout after ${timeoutMs}ms. Consider optimizing query or increasing timeout value.`;

      case 'connection':
        return `Connection timeout after ${timeoutMs}ms. Check network connectivity and server responsiveness.`;

      default:
        return `Operation '${operationType}' timeout after ${timeoutMs}ms. Consider increasing timeout or optimizing the operation.`;
    }
  }
}

/**
 * Auto-detect debug configuration based on environment
 */
export function getDefaultDebugConfig(): DebugConfig {
  const isDevelopment = process.env.NODE_ENV === 'development' ||
                       process.env.FRESHGUARD_DEBUG === 'true';

  return {
    enabled: isDevelopment,
    exposeQueries: isDevelopment,
    exposeRawErrors: isDevelopment,
    logLevel: isDevelopment ? 'debug' : 'error'
  };
}

/**
 * Merge user debug config with defaults
 */
export function mergeDebugConfig(userConfig?: DebugConfig): DebugConfig {
  const defaultConfig = getDefaultDebugConfig();

  if (!userConfig) return defaultConfig;

  const enabled = userConfig.enabled ?? defaultConfig.enabled;

  return {
    enabled,
    exposeQueries: userConfig.exposeQueries ?? (enabled ? true : false),
    exposeRawErrors: userConfig.exposeRawErrors ?? (enabled ? true : false),
    logLevel: userConfig.logLevel ?? defaultConfig.logLevel,
    correlationId: userConfig.correlationId
  };
}