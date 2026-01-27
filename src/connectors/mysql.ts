/**
 * Secure MySQL connector for FreshGuard Core
 * Extends BaseConnector with security built-in
 *
 * @module @thias-se/freshguard-core/connectors/mysql
 */

import mysql from 'mysql2/promise';
import { BaseConnector } from './base-connector.js';
import type { ConnectorConfig, TableSchema, SecurityConfig } from '../types/connector.js';
import type { SourceCredentials } from '../types.js';
import {
  ConnectionError,
  TimeoutError,
  QueryError,
  ErrorHandler
} from '../errors/index.js';
import { validateConnectorConfig } from '../validators/index.js';

/**
 * Secure MySQL connector
 *
 * Features:
 * - SQL injection prevention
 * - Connection timeouts
 * - SSL enforcement
 * - Read-only query patterns
 * - Secure error handling
 */
export class MySQLConnector extends BaseConnector {
  private connection: mysql.Connection | null = null;
  private connected = false;

  constructor(config: ConnectorConfig, securityConfig?: Partial<SecurityConfig>) {
    // Validate configuration before proceeding
    validateConnectorConfig(config);
    super(config, securityConfig);
  }

  /**
   * Connect to MySQL database with security validation
   */
  private async connect(): Promise<void> {
    if (this.connected && this.connection) {
      return; // Already connected
    }

    try {
      // Enforce SSL by default for security
      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port || 3306,
        database: this.config.database,
        user: this.config.username,
        password: this.config.password,
        // Security timeouts (mysql2 uses milliseconds)
        connectTimeout: this.connectionTimeout,
        timeout: this.queryTimeout,
        // MySQL-specific settings
        charset: 'utf8mb4',
        timezone: 'Z', // Use UTC
        dateStrings: false, // Return Date objects
        supportBigNumbers: true,
        bigNumberStrings: false
      };

      // Add SSL configuration if enabled
      if (this.requireSSL && this.config.ssl !== false) {
        connectionConfig.ssl = { rejectUnauthorized: true };
      }

      this.connection = await mysql.createConnection(connectionConfig);

      this.connected = true;
    } catch (error) {
      throw new ConnectionError(
        'Failed to connect to MySQL',
        this.config.host,
        this.config.port,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute a validated SQL query with security measures
   */
  protected async executeQuery(sql: string): Promise<any[]> {
    return this.executeParameterizedQuery(sql, []);
  }

  /**
   * Execute a parameterized SQL query using prepared statements
   */
  protected async executeParameterizedQuery(sql: string, parameters: any[] = []): Promise<any[]> {
    await this.connect();

    if (!this.connection) {
      throw new ConnectionError('Database connection not available');
    }

    try {
      const result = await this.executeWithTimeout(
        async () => {
          // Use execute for parameterized queries
          const [rows] = await this.connection!.execute(sql, parameters);
          return Array.isArray(rows) ? rows : [rows];
        },
        this.queryTimeout
      );

      // Validate result size for security
      this.validateResultSize(result);

      return result;
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw error;
      }

      // Sanitize and re-throw as QueryError
      throw new QueryError(
        ErrorHandler.getUserMessage(error),
        'query_execution',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Test database connection with security validation
   */
  async testConnection(debugConfig?: import('../types.js').DebugConfig): Promise<boolean> {
    const mergedDebugConfig = this.mergeDebugConfig(debugConfig);
    const debugId = `mysql-test-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
    const startTime = performance.now();

    try {
      this.logDebugInfo(mergedDebugConfig, debugId, 'Starting connection test', {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        ssl: this.config.ssl
      });

      await this.connect();

      if (!this.connection) {
        this.logDebugError(mergedDebugConfig, debugId, 'Connection test', {
          error: 'Connection not available after connect',
          duration: performance.now() - startTime
        });
        return false;
      }

      // Test with a simple, safe query (skip validation for connection test)
      const sql = 'SELECT 1 as test';

      await this.executeWithTimeout(
        async () => {
          const [rows] = await this.connection!.execute(sql);
          return rows;
        },
        this.connectionTimeout
      );

      const duration = performance.now() - startTime;

      if (mergedDebugConfig?.enabled) {
        console.log(`[DEBUG-${debugId}] Connection test completed:`, {
          success: true,
          duration,
          host: this.config.host,
          database: this.config.database
        });
      }

      return true;
    } catch (error) {
      const duration = performance.now() - startTime;

      this.logDebugError(mergedDebugConfig, debugId, 'Connection test', {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        error: mergedDebugConfig?.exposeRawErrors && error instanceof Error ? error.message : 'Connection failed',
        duration,
        suggestion: this.generateConnectionSuggestion(error)
      });

      // Don't throw - this method should return boolean
      return false;
    }
  }

  /**
   * Helper method to merge debug configuration
   */
  private mergeDebugConfig(debugConfig?: import('../types.js').DebugConfig) {
    return {
      enabled: debugConfig?.enabled ?? (process.env.NODE_ENV === 'development'),
      exposeQueries: debugConfig?.exposeQueries ?? true,
      exposeRawErrors: debugConfig?.exposeRawErrors ?? true,
      logLevel: debugConfig?.logLevel ?? 'debug'
    };
  }

  /**
   * Generate connection suggestions based on error
   */
  private generateConnectionSuggestion(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'Check database connection configuration';
    }

    const message = error.message.toLowerCase();

    if (message.includes('connect econnrefused') || message.includes('connection refused')) {
      return `MySQL server at ${this.config.host}:${this.config.port} is not accepting connections. Verify the server is running and accessible.`;
    }

    if (message.includes('timeout')) {
      return `Connection timeout to ${this.config.host}:${this.config.port}. Check network connectivity and server responsiveness.`;
    }

    if (message.includes('access denied') || message.includes('authentication failed')) {
      return `Authentication failed for database '${this.config.database}'. Verify username, password, and database name.`;
    }

    if (message.includes('unknown database')) {
      return `Database '${this.config.database}' not found on server. Check database name and create if necessary.`;
    }

    if (message.includes('ssl') || message.includes('tls')) {
      return `SSL/TLS connection issue. Check SSL configuration and server certificate settings.`;
    }

    return `Connection failed to ${this.config.host}:${this.config.port}. Check host, port, credentials, and network connectivity.`;
  }

  /**
   * List all tables in the database
   */
  async listTables(): Promise<string[]> {
    const sql = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ?
      ORDER BY table_name
      LIMIT ?
    `;

    this.validateQuery(sql);

    try {
      const result = await this.executeParameterizedQuery(sql, [this.config.database, this.maxRows]);
      return result.map((row: any) => row.table_name || row.TABLE_NAME).filter(Boolean);
    } catch (error) {
      throw new QueryError(
        'Failed to list tables',
        'table_listing',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get table schema information securely
   */
  async getTableSchema(table: string): Promise<TableSchema> {
    // Validate table name (identifiers cannot be parameterized)
    this.escapeIdentifier(table);

    const sql = `
      SELECT
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?
      ORDER BY ordinal_position
      LIMIT ?
    `;

    this.validateQuery(sql);

    try {
      const result = await this.executeParameterizedQuery(sql, [this.config.database, table, this.maxRows]);

      if (result.length === 0) {
        throw QueryError.tableNotFound(table);
      }

      return {
        table,
        columns: result.map(row => ({
          name: row.column_name || row.COLUMN_NAME,
          type: this.mapMySQLType(row.data_type || row.DATA_TYPE),
          nullable: (row.is_nullable || row.IS_NULLABLE) === 'YES'
        }))
      };
    } catch (error) {
      if (error instanceof QueryError) {
        throw error;
      }

      throw new QueryError(
        'Failed to get table schema',
        'schema_query',
        table,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get last modified timestamp using MySQL-specific methods
   */
  async getLastModified(table: string): Promise<Date | null> {
    // Try common timestamp columns
    const timestampColumns = ['updated_at', 'modified_at', 'last_modified', 'timestamp'];

    for (const column of timestampColumns) {
      try {
        const result = await this.getMaxTimestamp(table, column);
        if (result) {
          return result;
        }
      } catch {
        // Column doesn't exist, try next one
        continue;
      }
    }

    // Fallback: use MySQL information schema to get table modification time
    try {
      const sql = `
        SELECT update_time as last_modified
        FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
      `;

      this.validateQuery(sql);
      const result = await this.executeParameterizedQuery(sql, [this.config.database, table]);

      if (result.length > 0 && result[0].last_modified) {
        return new Date(result[0].last_modified);
      }
    } catch {
      // Information schema query failed, return null
    }

    return null;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.end();
      } catch (error) {
        // Log error but don't throw - closing should be safe
        console.warn('Warning: Error closing MySQL connection:', ErrorHandler.getUserMessage(error));
      } finally {
        this.connection = null;
        this.connected = false;
      }
    }
  }

  /**
   * Map MySQL data types to standard types
   */
  private mapMySQLType(mysqlType: string): string {
    const typeMap: Record<string, string> = {
      // Numeric types
      'tinyint': 'integer',
      'smallint': 'integer',
      'mediumint': 'integer',
      'int': 'integer',
      'integer': 'integer',
      'bigint': 'bigint',
      'decimal': 'decimal',
      'numeric': 'decimal',
      'float': 'float',
      'double': 'float',
      'real': 'float',
      'bit': 'integer',

      // String types
      'char': 'text',
      'varchar': 'text',
      'binary': 'text',
      'varbinary': 'text',
      'tinyblob': 'text',
      'tinytext': 'text',
      'text': 'text',
      'blob': 'text',
      'mediumtext': 'text',
      'mediumblob': 'text',
      'longtext': 'text',
      'longblob': 'text',
      'enum': 'text',
      'set': 'text',

      // Date/time types
      'date': 'date',
      'time': 'time',
      'datetime': 'timestamp',
      'timestamp': 'timestamp',
      'year': 'integer',

      // JSON and special types
      'json': 'json',
      'geometry': 'text',
      'point': 'text',
      'linestring': 'text',
      'polygon': 'text',
      'multipoint': 'text',
      'multilinestring': 'text',
      'multipolygon': 'text',
      'geometrycollection': 'text'
    };

    return typeMap[mysqlType.toLowerCase()] || 'unknown';
  }

  /**
   * Override escapeIdentifier for MySQL backtick syntax
   */
  protected escapeIdentifier(identifier: string): string {
    // Only allow alphanumeric, underscore, and dot (for database.table)
    if (!/^[a-zA-Z0-9_\.]+$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`);
    }

    // Additional length check
    if (identifier.length > 256) {
      throw new Error('Identifier too long');
    }

    // Return with backticks for MySQL
    return `\`${identifier}\``;
  }

  // ==============================================
  // Legacy API compatibility methods
  // ==============================================

  /**
   * Legacy connect method for backward compatibility
   * @deprecated Use constructor with ConnectorConfig instead
   */
  async connectLegacy(credentials: SourceCredentials): Promise<void> {
    console.warn('Warning: connectLegacy is deprecated. Use constructor with ConnectorConfig instead.');

    // Convert legacy credentials to new format
    const config: ConnectorConfig = {
      host: credentials.host || '',
      port: credentials.port || 3306,
      database: credentials.database || '',
      username: credentials.username || '',
      password: credentials.password || '',
      ssl: credentials.sslMode !== 'disable'
    };

    // Validate and reconnect
    validateConnectorConfig(config);
    this.config = { ...this.config, ...config };
    await this.connect();
  }

  /**
   * Legacy test connection method for backward compatibility
   * @deprecated Use testConnection() instead
   */
  async testConnectionLegacy(): Promise<{ success: boolean; tableCount?: number; error?: string }> {
    console.warn('Warning: testConnectionLegacy is deprecated. Use testConnection() instead.');

    try {
      const success = await this.testConnection();

      if (success) {
        // Get table count for legacy compatibility
        const tables = await this.listTables();
        return {
          success: true,
          tableCount: tables.length
        };
      } else {
        return {
          success: false,
          error: 'Connection test failed'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: ErrorHandler.getUserMessage(error)
      };
    }
  }

  /**
   * Legacy get table metadata method for backward compatibility
   * @deprecated Use getRowCount() and getMaxTimestamp() instead
   */
  async getTableMetadata(
    tableName: string,
    timestampColumn = 'updated_at'
  ): Promise<{ rowCount: number; lastUpdate?: Date }> {
    console.warn('Warning: getTableMetadata is deprecated. Use getRowCount() and getMaxTimestamp() instead.');

    try {
      const rowCount = await this.getRowCount(tableName);
      const lastUpdate = await this.getMaxTimestamp(tableName, timestampColumn);

      return {
        rowCount,
        lastUpdate: lastUpdate || undefined
      };
    } catch (error) {
      throw new QueryError(
        'Failed to get table metadata',
        'metadata_query',
        tableName,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Legacy query method for backward compatibility
   * @deprecated Direct SQL queries are not allowed for security reasons
   */
  async query<T = unknown>(_sql: string): Promise<T[]> {
    throw new Error(
      'Direct SQL queries are not allowed for security reasons. Use specific methods like getRowCount(), getMaxTimestamp(), etc.'
    );
  }
}