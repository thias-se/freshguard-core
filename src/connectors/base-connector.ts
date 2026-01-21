/**
 * Base connector class with built-in security validation
 *
 * All database connectors must extend this class to ensure consistent
 * security measures including query validation, timeouts, and error sanitization.
 *
 * @license MIT
 */

import type {
  Connector,
  ConnectorConfig,
  TableSchema,
  SecurityConfig
} from '../types/connector.js';
import { DEFAULT_SECURITY_CONFIG } from '../types/connector.js';

import {
  SecurityError,
  TimeoutError,
  ConnectionError,
  ErrorHandler
} from '../errors/index.js';

/**
 * Abstract base connector with security built-in
 *
 * Provides:
 * - SQL injection prevention
 * - Query timeouts
 * - Connection validation
 * - Error sanitization
 * - Read-only query patterns
 */
export abstract class BaseConnector implements Connector {
  protected readonly connectionTimeout: number;
  protected readonly queryTimeout: number;
  protected readonly maxRows: number;
  protected readonly requireSSL: boolean;
  private readonly allowedPatterns: RegExp[];
  private readonly blockedKeywords: string[];

  constructor(
    protected config: ConnectorConfig,
    securityConfig?: Partial<SecurityConfig>
  ) {
    // Merge security configuration with defaults
    const security = { ...DEFAULT_SECURITY_CONFIG, ...securityConfig };

    this.connectionTimeout = config.timeout || security.connectionTimeout;
    this.queryTimeout = config.queryTimeout || security.queryTimeout;
    this.maxRows = config.maxRows || security.maxRows;
    this.requireSSL = security.requireSSL;
    this.allowedPatterns = security.allowedQueryPatterns;
    this.blockedKeywords = security.blockedKeywords;

    // Validate configuration
    this.validateConfig(config);
  }

  /**
   * Validate connector configuration for security
   */
  private validateConfig(config: ConnectorConfig): void {
    if (!config.host) {
      throw new Error('Host is required');
    }

    if (!config.database) {
      throw new Error('Database is required');
    }

    if (!config.username) {
      throw new Error('Username is required');
    }

    if (!config.password) {
      throw new Error('Password is required');
    }

    if (config.port && (config.port < 1 || config.port > 65535)) {
      throw new Error('Invalid port number');
    }

    if (this.requireSSL && config.ssl === false) {
      throw new SecurityError('SSL is required for secure connections');
    }
  }

  /**
   * Validate SQL query against security rules
   *
   * Only allows specific read-only patterns and blocks dangerous keywords
   */
  protected validateQuery(sql: string): void {
    const normalizedSql = sql.trim().toUpperCase();

    // Check for blocked keywords
    for (const keyword of this.blockedKeywords) {
      if (normalizedSql.includes(keyword.toUpperCase())) {
        throw new SecurityError(`Blocked keyword detected: ${keyword}`);
      }
    }

    // Check if query matches allowed patterns
    const isAllowed = this.allowedPatterns.some(pattern => pattern.test(sql));
    if (!isAllowed) {
      throw new SecurityError('Query pattern not allowed');
    }
  }

  /**
   * Escape SQL identifiers to prevent injection
   */
  protected escapeIdentifier(identifier: string): string {
    // Only allow alphanumeric, underscore, and dot (for schema.table)
    if (!/^[a-zA-Z0-9_\.]+$/.test(identifier)) {
      throw new SecurityError(`Invalid identifier: ${identifier}`);
    }

    // Additional length check
    if (identifier.length > 256) {
      throw new SecurityError('Identifier too long');
    }

    return identifier;
  }

  /**
   * Execute function with timeout protection
   */
  protected async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  }

  /**
   * Sanitize error messages to prevent information leakage
   */
  protected sanitizeError(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'Unknown error occurred';
    }

    const message = error.message.toLowerCase();

    // Map specific error types to safe messages
    if (message.includes('connection refused')) {
      return 'Connection failed - check host and port';
    }

    if (message.includes('authentication failed') || message.includes('permission denied')) {
      return 'Authentication failed - check credentials and permissions';
    }

    if (message.includes('does not exist')) {
      return 'Table or column does not exist';
    }

    if (message.includes('timeout')) {
      return 'Operation timed out';
    }

    if (message.includes('syntax error')) {
      return 'Invalid query syntax';
    }

    // Generic message for unknown errors (don't leak database details)
    return 'Database operation failed';
  }

  // ==============================================
  // Secure Implementation of Connector Interface
  // ==============================================

  /**
   * Get row count for a table using parameterized query
   */
  async getRowCount(table: string): Promise<number> {
    const escapedTable = this.escapeIdentifier(table);
    const sql = `SELECT COUNT(*) as count FROM ${escapedTable}`;

    this.validateQuery(sql);

    try {
      const result = await this.executeWithTimeout(
        () => this.executeQuery(sql),
        this.queryTimeout
      );

      if (!result || result.length === 0) {
        throw new Error('No result returned');
      }

      const count = parseInt(result[0].count || '0', 10);
      return isNaN(count) ? 0 : count;
    } catch (error) {
      throw new Error(this.sanitizeError(error));
    }
  }

  /**
   * Get maximum timestamp value from a column
   */
  async getMaxTimestamp(table: string, column: string): Promise<Date | null> {
    const escapedTable = this.escapeIdentifier(table);
    const escapedColumn = this.escapeIdentifier(column);
    const sql = `SELECT MAX(${escapedColumn}) as max_date FROM ${escapedTable}`;

    this.validateQuery(sql);

    try {
      const result = await this.executeWithTimeout(
        () => this.executeQuery(sql),
        this.queryTimeout
      );

      if (!result || result.length === 0 || !result[0].max_date) {
        return null;
      }

      const dateValue = result[0].max_date;
      return dateValue instanceof Date ? dateValue : new Date(dateValue);
    } catch (error) {
      throw new Error(this.sanitizeError(error));
    }
  }

  /**
   * Get minimum timestamp value from a column
   */
  async getMinTimestamp(table: string, column: string): Promise<Date | null> {
    const escapedTable = this.escapeIdentifier(table);
    const escapedColumn = this.escapeIdentifier(column);
    const sql = `SELECT MIN(${escapedColumn}) as min_date FROM ${escapedTable}`;

    this.validateQuery(sql);

    try {
      const result = await this.executeWithTimeout(
        () => this.executeQuery(sql),
        this.queryTimeout
      );

      if (!result || result.length === 0 || !result[0].min_date) {
        return null;
      }

      const dateValue = result[0].min_date;
      return dateValue instanceof Date ? dateValue : new Date(dateValue);
    } catch (error) {
      throw new Error(this.sanitizeError(error));
    }
  }

  /**
   * Get last modified timestamp for a table
   * Implementation varies by database type
   */
  async getLastModified(table: string): Promise<Date | null> {
    // Default implementation - subclasses can override for database-specific methods
    // For most databases, this would be the same as getting max of a timestamp column
    // but specific implementations should override this
    throw new Error('getLastModified must be implemented by subclass');
  }

  /**
   * Validate that query results don't exceed max rows limit
   */
  protected validateResultSize(results: any[]): void {
    if (results.length > this.maxRows) {
      throw new SecurityError(`Query returned too many rows (max ${this.maxRows})`);
    }
  }

  // ==============================================
  // Abstract methods that subclasses must implement
  // ==============================================

  /**
   * Execute a validated SQL query
   * Subclasses implement this with their specific database driver
   */
  protected abstract executeQuery(sql: string): Promise<any[]>;

  /**
   * Test database connection
   * Subclasses implement with database-specific connection test
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * List all tables in the database
   * Subclasses implement with database-specific table listing
   */
  abstract listTables(): Promise<string[]>;

  /**
   * Get table schema information
   * Subclasses implement with database-specific schema queries
   */
  abstract getTableSchema(table: string): Promise<TableSchema>;

  /**
   * Close the database connection
   * Subclasses implement with database-specific cleanup
   */
  abstract close(): Promise<void>;
}

// Error classes are now imported from ../errors/index.js