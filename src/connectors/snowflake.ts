/**
 * Secure Snowflake connector for FreshGuard Core
 * Extends BaseConnector with security built-in
 *
 * @module @thias-se/freshguard-core/connectors/snowflake
 */

import * as snowflake from 'snowflake-sdk';
import { BaseConnector } from './base-connector.js';
import type { ConnectorConfig, TableSchema } from '../types/connector.js';
import type { SourceCredentials } from '../types.js';
import {
  ConnectionError,
  TimeoutError,
  QueryError,
  ConfigurationError,
  SecurityError,
  ErrorHandler
} from '../errors/index.js';
import { validateDatabaseIdentifier } from '../validators/index.js';

/**
 * Secure Snowflake connector
 *
 * Features:
 * - SQL injection prevention
 * - Credential validation
 * - Read-only query patterns
 * - Connection timeouts
 * - Secure error handling
 */
export class SnowflakeConnector extends BaseConnector {
  private connection: snowflake.Connection | null = null;
  private account: string = '';
  private warehouse: string = '';
  private database: string = '';
  private schema: string = 'PUBLIC';
  private connected: boolean = false;

  constructor(config: ConnectorConfig) {
    // Validate Snowflake-specific configuration
    SnowflakeConnector.validateSnowflakeConfig(config);
    super(config);

    // Extract account from host
    this.account = this.extractAccount(config.host);
    this.database = config.database;
  }

  /**
   * Validate Snowflake-specific configuration
   */
  private static validateSnowflakeConfig(config: ConnectorConfig): void {
    if (!config.host) {
      throw new ConfigurationError('Host is required for Snowflake (format: account.snowflakecomputing.com)');
    }

    if (!config.username || !config.password) {
      throw new ConfigurationError('Username and password are required for Snowflake');
    }

    if (!config.database) {
      throw new ConfigurationError('Database is required for Snowflake');
    }

    // Validate host format
    if (!config.host.includes('.snowflakecomputing.com')) {
      throw new ConfigurationError('Invalid Snowflake host format (expected: account.snowflakecomputing.com)');
    }
  }

  /**
   * Extract Snowflake account from host
   */
  private extractAccount(host: string): string {
    const hostMatch = host.match(/^([^.]+)\.snowflakecomputing\.com$/);
    if (hostMatch && hostMatch[1]) {
      return hostMatch[1];
    }
    throw new ConfigurationError('Could not extract Snowflake account from host');
  }

  /**
   * Connect to Snowflake with security validation
   */
  private async connect(): Promise<void> {
    if (this.connected && this.connection) {
      return; // Already connected
    }

    try {
      const connectionOptions: snowflake.ConnectionOptions = {
        account: this.account,
        username: this.config.username,
        password: this.config.password,
        database: this.database,
        schema: this.schema,
        warehouse: this.warehouse || undefined,
        authenticator: 'SNOWFLAKE', // Force standard auth for security
        timeout: this.connectionTimeout, // Connection timeout
        networkTimeout: this.connectionTimeout, // Network timeout
      };

      // Create connection
      this.connection = snowflake.createConnection(connectionOptions);

      // Connect with timeout protection
      await this.executeWithTimeout(
        () => new Promise<void>((resolve, reject) => {
          this.connection!.connect((err) => {
            if (err) {
              reject(new Error(`Snowflake connection failed: ${err.message}`));
            } else {
              resolve();
            }
          });
        }),
        this.connectionTimeout
      );

      this.connected = true;
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw error;
      }

      throw new ConnectionError(
        'Failed to connect to Snowflake',
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
    await this.connect();

    if (!this.connection) {
      throw new ConnectionError('Snowflake connection not available');
    }

    try {
      const result = await this.executeWithTimeout(
        () => new Promise<any[]>((resolve, reject) => {
          this.connection!.execute({
            sqlText: sql,
            complete: (err, _stmt, rows) => {
              if (err) {
                reject(new Error(`Query execution failed: ${err.message}`));
              } else {
                resolve(rows || []);
              }
            }
          });
        }),
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
  async testConnection(): Promise<boolean> {
    try {
      await this.connect();

      if (!this.connection) {
        return false;
      }

      // Test with a simple, safe query
      const sql = 'SELECT 1 as test';
      this.validateQuery(sql);

      await this.executeQuery(sql);

      return true;
    } catch (error) {
      // Don't throw - this method should return boolean
      return false;
    }
  }

  /**
   * List all tables in the database/schema
   */
  async listTables(): Promise<string[]> {
    const sql = `
      SELECT table_name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE table_schema = '${this.schema.toUpperCase()}'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
      LIMIT ${this.maxRows}
    `;

    this.validateQuery(sql);

    try {
      const result = await this.executeQuery(sql);
      return result.map((row: any) => row.TABLE_NAME).filter(Boolean);
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
    const parsedTable = this.parseTableName(table);
    const tableNameUpper = parsedTable.split('.').pop()?.toUpperCase();

    const sql = `
      SELECT
        column_name,
        data_type,
        is_nullable
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = '${tableNameUpper}'
        AND table_schema = '${this.schema.toUpperCase()}'
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
          name: row.COLUMN_NAME,
          type: this.mapSnowflakeType(row.DATA_TYPE),
          nullable: row.IS_NULLABLE === 'YES'
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
   * Get last modified timestamp for Snowflake tables
   */
  async getLastModified(table: string): Promise<Date | null> {
    // Try common timestamp columns (Snowflake uses uppercase by default)
    const timestampColumns = [
      'UPDATED_AT', 'MODIFIED_AT', 'LAST_MODIFIED', 'TIMESTAMP',
      'CREATED_AT', 'DATE_MODIFIED', 'LAST_UPDATE'
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

    // Snowflake doesn't have built-in table modification timestamps
    return null;
  }

  /**
   * Close the Snowflake connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      try {
        await new Promise<void>((resolve) => {
          this.connection!.destroy((err) => {
            if (err) {
              console.warn('Warning: Error closing Snowflake connection:', ErrorHandler.getUserMessage(err));
            }
            resolve();
          });
        });
      } catch (error) {
        console.warn('Warning: Error closing Snowflake connection:', ErrorHandler.getUserMessage(error));
      } finally {
        this.connection = null;
        this.connected = false;
      }
    }
  }

  /**
   * Map Snowflake data types to standard types
   */
  private mapSnowflakeType(snowflakeType: string): string {
    const typeMap: Record<string, string> = {
      'NUMBER': 'decimal',
      'DECIMAL': 'decimal',
      'NUMERIC': 'decimal',
      'INT': 'integer',
      'INTEGER': 'integer',
      'BIGINT': 'bigint',
      'SMALLINT': 'integer',
      'TINYINT': 'integer',
      'BYTEINT': 'integer',
      'FLOAT': 'float',
      'FLOAT4': 'float',
      'FLOAT8': 'float',
      'DOUBLE': 'float',
      'DOUBLE PRECISION': 'float',
      'REAL': 'float',
      'VARCHAR': 'text',
      'CHAR': 'text',
      'CHARACTER': 'text',
      'STRING': 'text',
      'TEXT': 'text',
      'BINARY': 'binary',
      'VARBINARY': 'binary',
      'BOOLEAN': 'boolean',
      'DATE': 'date',
      'DATETIME': 'timestamp',
      'TIME': 'time',
      'TIMESTAMP': 'timestamp',
      'TIMESTAMP_LTZ': 'timestamptz',
      'TIMESTAMP_NTZ': 'timestamp',
      'TIMESTAMP_TZ': 'timestamptz',
      'VARIANT': 'json',
      'OBJECT': 'json',
      'ARRAY': 'array',
      'GEOGRAPHY': 'geography',
      'GEOMETRY': 'geometry'
    };

    return typeMap[snowflakeType.toUpperCase()] || 'unknown';
  }

  /**
   * Parse and validate table name for Snowflake
   */
  private parseTableName(tableName: string): string {
    validateDatabaseIdentifier(tableName, 'table');

    const parts = tableName.split('.');

    if (parts.length === 3) {
      // database.schema.table format
      const [database, schema, table] = parts;

      // Validate database matches
      if (database.toUpperCase() !== this.database.toUpperCase()) {
        throw new SecurityError('Table database does not match configured database');
      }

      return tableName.toUpperCase();
    } else if (parts.length === 2) {
      // schema.table format
      return `${this.database}.${tableName}`.toUpperCase();
    } else if (parts.length === 1) {
      // Just table name
      return `${this.database}.${this.schema}.${tableName}`.toUpperCase();
    } else {
      throw new QueryError('Invalid table name format', 'invalid_table_name');
    }
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

    if (!credentials.host || !credentials.username || !credentials.password) {
      throw new ConfigurationError('Missing required Snowflake credentials');
    }

    const options = credentials.additionalOptions || {};

    const config: ConnectorConfig = {
      host: credentials.host,
      port: 443,
      database: credentials.database || (options.database as string) || '',
      username: credentials.username,
      password: credentials.password,
      ssl: true
    };

    // Set optional fields
    this.warehouse = (options.warehouse as string) || '';
    this.schema = (options.schema as string) || 'PUBLIC';

    // Validate and reconnect
    SnowflakeConnector.validateSnowflakeConfig(config);
    this.config = { ...this.config, ...config };
    this.account = this.extractAccount(config.host);
    this.database = config.database;
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
    timestampColumn: string = 'UPDATED_AT'
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
  async query<T = unknown>(sql: string): Promise<T[]> {
    throw new Error(
      'Direct SQL queries are not allowed for security reasons. Use specific methods like getRowCount(), getMaxTimestamp(), etc.'
    );
  }

  /**
   * Get Snowflake account name
   */
  getAccount(): string {
    return this.account;
  }

  /**
   * Set Snowflake warehouse
   */
  setWarehouse(warehouse: string): void {
    this.warehouse = warehouse;
  }

  /**
   * Get current warehouse
   */
  getWarehouse(): string {
    return this.warehouse;
  }

  /**
   * Set schema
   */
  setSchema(schema: string): void {
    this.schema = schema;
  }

  /**
   * Get current schema
   */
  getSchema(): string {
    return this.schema;
  }
}