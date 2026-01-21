/**
 * Secure DuckDB connector for FreshGuard Core
 * Extends BaseConnector with security built-in
 *
 * @module @thias-se/freshguard-core/connectors/duckdb
 */

import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { BaseConnector } from './base-connector.js';
import type { ConnectorConfig, TableSchema } from '../types/connector.js';
import type { SourceCredentials } from '../types.js';
import {
  ConnectionError,
  TimeoutError,
  QueryError,
  ConfigurationError,
  ErrorHandler
} from '../errors/index.js';
import { validateDatabaseIdentifier } from '../validators/index.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Secure DuckDB connector
 *
 * Features:
 * - SQL injection prevention
 * - File path validation
 * - Read-only query patterns
 * - Connection timeouts
 * - Secure error handling
 */
export class DuckDBConnector extends BaseConnector {
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private databasePath: string = '';
  private connected: boolean = false;

  constructor(config: ConnectorConfig) {
    // Validate DuckDB-specific configuration
    DuckDBConnector.validateDuckDBConfig(config);
    super(config);

    // For DuckDB, database field contains the file path
    this.databasePath = config.database === ':memory:' ? ':memory:' : resolve(config.database);
  }

  /**
   * Validate DuckDB-specific configuration
   */
  private static validateDuckDBConfig(config: ConnectorConfig): void {
    if (!config.database) {
      throw new ConfigurationError('Database path is required for DuckDB');
    }

    // DuckDB doesn't use traditional host/port/username/password for file-based databases
    // But we still require them for consistency with the interface
    if (config.database !== ':memory:') {
      // Validate file path security
      const resolvedPath = resolve(config.database);

      // Prevent directory traversal attacks
      if (config.database.includes('..')) {
        throw new ConfigurationError('Database path cannot contain directory traversal patterns');
      }

      // Ensure path doesn't access system directories
      const systemPaths = ['/etc', '/sys', '/proc', '/dev', '/root', '/var/log'];
      if (systemPaths.some(sysPath => resolvedPath.startsWith(sysPath))) {
        throw new ConfigurationError('Database path cannot access system directories');
      }

      // For production, we could add more restrictions like only allowing specific directories
      // This would be configurable based on deployment environment
    }
  }

  /**
   * Connect to DuckDB database with security validation
   */
  private async connect(): Promise<void> {
    if (this.connected && this.instance && this.connection) {
      return; // Already connected
    }

    try {
      // Validate file access before connecting
      if (this.databasePath !== ':memory:') {
        // For file-based databases, check if file exists and is accessible
        // Note: DuckDB will create the file if it doesn't exist, but we want to validate the directory
        const dirPath = this.databasePath.substring(0, this.databasePath.lastIndexOf('/'));
        if (dirPath && !existsSync(dirPath)) {
          throw new ConnectionError('Database directory does not exist');
        }
      }

      // Create DuckDB instance with timeout protection
      this.instance = await this.executeWithTimeout(
        () => this.databasePath === ':memory:'
          ? DuckDBInstance.create()
          : DuckDBInstance.create(this.databasePath),
        this.connectionTimeout
      );

      // Get a connection from the instance
      this.connection = await this.executeWithTimeout(
        () => this.instance!.connect(),
        this.connectionTimeout
      );

      this.connected = true;
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw error;
      }

      throw new ConnectionError(
        'Failed to connect to DuckDB',
        'localhost', // DuckDB is always local
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute a validated SQL query with security measures
   */
  protected async executeQuery(sql: string): Promise<any[]> {
    await this.connect();

    if (!this.connection) {
      throw new ConnectionError('DuckDB connection not available');
    }

    try {
      const reader = await this.executeWithTimeout(
        () => this.connection!.runAndReadAll(sql),
        this.queryTimeout
      );

      const rows = reader.getRowObjects();

      // Validate result size for security
      this.validateResultSize(rows);

      return rows;
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
  async testConnection(): Promise<boolean> {
    try {
      await this.connect();

      if (!this.connection) {
        return false;
      }

      // Test with a simple, safe query
      const sql = 'SELECT 1 as test';
      this.validateQuery(sql);

      await this.executeWithTimeout(
        () => this.connection!.run(sql),
        this.connectionTimeout
      );

      return true;
    } catch (error) {
      // Don't throw - this method should return boolean
      return false;
    }
  }

  /**
   * List all tables in the database (excluding system schemas)
   */
  async listTables(): Promise<string[]> {
    const sql = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY table_name
      LIMIT ${this.maxRows}
    `;

    this.validateQuery(sql);

    try {
      const result = await this.executeQuery(sql);
      return result.map((row: any) => row.table_name).filter(Boolean);
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
    const escapedTable = this.escapeIdentifier(table);

    const sql = `
      SELECT
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = '${escapedTable}'
        AND table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY ordinal_position
      LIMIT ${this.maxRows}
    `;

    this.validateQuery(sql);

    try {
      const result = await this.executeQuery(sql);

      if (result.length === 0) {
        throw QueryError.tableNotFound(table);
      }

      return {
        table,
        columns: result.map(row => ({
          name: row.column_name,
          type: this.mapDuckDBType(row.data_type),
          nullable: row.is_nullable === 'YES'
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
   * Get last modified timestamp for DuckDB
   * Since DuckDB doesn't have built-in table modification timestamps,
   * we'll look for common timestamp columns
   */
  async getLastModified(table: string): Promise<Date | null> {
    // Try common timestamp columns
    const timestampColumns = [
      'updated_at', 'modified_at', 'last_modified', 'timestamp',
      'created_at', 'date_modified', 'last_update'
    ];

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

    // No timestamp columns found
    return null;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    try {
      // Close connection first
      if (this.connection) {
        this.connection.closeSync();
        this.connection = null;
      }

      // Clean up instance reference
      if (this.instance) {
        this.instance = null;
      }

      this.connected = false;
    } catch (error) {
      // Log error but don't throw - closing should be safe
      console.warn('Warning: Error closing DuckDB connection:', ErrorHandler.getUserMessage(error));
    } finally {
      // Ensure cleanup even if error occurs
      this.connection = null;
      this.instance = null;
      this.connected = false;
    }
  }

  /**
   * Map DuckDB data types to standard types
   */
  private mapDuckDBType(duckdbType: string): string {
    const typeMap: Record<string, string> = {
      'BIGINT': 'bigint',
      'INTEGER': 'integer',
      'SMALLINT': 'integer',
      'TINYINT': 'integer',
      'UBIGINT': 'bigint',
      'UINTEGER': 'integer',
      'USMALLINT': 'integer',
      'UTINYINT': 'integer',
      'VARCHAR': 'text',
      'TEXT': 'text',
      'BLOB': 'binary',
      'DATE': 'date',
      'TIME': 'time',
      'TIMESTAMP': 'timestamp',
      'TIMESTAMP WITH TIME ZONE': 'timestamptz',
      'TIMESTAMPTZ': 'timestamptz',
      'BOOLEAN': 'boolean',
      'REAL': 'float',
      'DOUBLE': 'float',
      'DECIMAL': 'decimal',
      'NUMERIC': 'decimal',
      'JSON': 'json',
      'UUID': 'uuid',
      'INTERVAL': 'interval'
    };

    return typeMap[duckdbType.toUpperCase()] || 'unknown';
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
    const dbPath = credentials.connectionString || credentials.database || ':memory:';

    const config: ConnectorConfig = {
      host: 'localhost', // DuckDB is always local
      port: 0, // Not used for DuckDB
      database: dbPath,
      username: 'duckdb', // Default for compatibility
      password: 'duckdb', // Not used for file-based DuckDB
      ssl: false // Not applicable for DuckDB
    };

    // Validate and reconnect
    DuckDBConnector.validateDuckDBConfig(config);
    this.config = { ...this.config, ...config };
    this.databasePath = config.database === ':memory:' ? ':memory:' : resolve(config.database);
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
    timestampColumn: string = 'updated_at'
  ): Promise<{ rowCount: number; lastUpdate?: Date }> {
    console.warn('Warning: getTableMetadata is deprecated. Use getRowCount() and getMaxTimestamp() instead.');

    try {
      validateDatabaseIdentifier(tableName, 'table');
      validateDatabaseIdentifier(timestampColumn, 'column');

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
  async query<T = unknown>(sql: string): Promise<T[]> {
    throw new Error(
      'Direct SQL queries are not allowed for security reasons. Use specific methods like getRowCount(), getMaxTimestamp(), etc.'
    );
  }

  /**
   * Get database file path (DuckDB-specific utility)
   */
  getDatabasePath(): string {
    return this.databasePath;
  }

  /**
   * Check if database is in-memory
   */
  isInMemory(): boolean {
    return this.databasePath === ':memory:';
  }
}
