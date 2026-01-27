/**
 * Secure Redshift connector for FreshGuard Core
 * Extends BaseConnector with security built-in
 * Uses PostgreSQL wire protocol for compatibility
 *
 * @module @thias-se/freshguard-core/connectors/redshift
 */

import postgres from 'postgres';
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
 * Secure Redshift connector
 *
 * Features:
 * - SQL injection prevention
 * - Connection timeouts
 * - SSL enforcement
 * - Read-only query patterns
 * - Secure error handling
 * - PostgreSQL wire protocol compatibility
 */
export class RedshiftConnector extends BaseConnector {
  private client: ReturnType<typeof postgres> | null = null;
  private connected = false;

  constructor(config: ConnectorConfig, securityConfig?: Partial<SecurityConfig>) {
    // Validate configuration before proceeding
    validateConnectorConfig(config);
    super(config, securityConfig);
  }

  /**
   * Connect to Redshift database with security validation
   */
  private async connect(): Promise<void> {
    if (this.connected && this.client) {
      return; // Already connected
    }

    try {
      // Enforce SSL by default for security (required for Redshift)
      const sslConfig = this.requireSSL ? { rejectUnauthorized: true } : false;

      this.client = postgres({
        host: this.config.host,
        port: this.config.port || 5439, // Default Redshift port
        database: this.config.database,
        username: this.config.username,
        password: this.config.password,
        ssl: this.config.ssl !== false ? sslConfig : false,
        connection: {
          application_name: this.config.applicationName || 'freshguard-core'
        },
        transform: {
          undefined: null
        },
        // Security timeouts
        connect_timeout: this.connectionTimeout / 1000, // postgres library uses seconds
        // Connection pool limits for security
        max: 1, // Single connection for monitoring
        idle_timeout: 30,
        max_lifetime: 60 * 60, // 1 hour
        // Redshift-specific settings
        prepare: false // Redshift doesn't support prepared statements well
      });

      this.connected = true;
    } catch (error) {
      throw new ConnectionError(
        'Failed to connect to Redshift',
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
   * Execute a parameterized SQL query using postgres client
   */
  protected async executeParameterizedQuery(sql: string, parameters: any[] = []): Promise<any[]> {
    await this.connect();

    if (!this.client) {
      throw new ConnectionError('Database connection not available');
    }

    try {
      const result = await this.executeWithTimeout(
        async () => parameters.length > 0
          ? await this.client!.unsafe(sql, parameters)  // Use parameterized query with unsafe
          : await this.client!.unsafe(sql),              // Fallback to unsafe for non-parameterized
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
    const debugId = `rs-test-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
    const startTime = performance.now();

    try {
      this.logDebugInfo(mergedDebugConfig, debugId, 'Starting connection test', {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        ssl: this.config.ssl
      });

      await this.connect();

      if (!this.client) {
        this.logDebugError(mergedDebugConfig, debugId, 'Connection test', {
          error: 'Client not available after connect',
          duration: performance.now() - startTime
        });
        return false;
      }

      // Test with a simple, safe query (skip validation for connection test)
      const sql = 'SELECT 1 as test';

      await this.executeWithTimeout(
        () => this.client!.unsafe(sql),
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

    if (message.includes('connection refused') || message.includes('could not connect')) {
      return `Redshift cluster at ${this.config.host}:${this.config.port} is not accepting connections. Verify the cluster is running and accessible.`;
    }

    if (message.includes('timeout')) {
      return `Connection timeout to ${this.config.host}:${this.config.port}. Check network connectivity and cluster responsiveness.`;
    }

    if (message.includes('authentication failed') || message.includes('password authentication failed')) {
      return `Authentication failed for database '${this.config.database}'. Verify username, password, and database name.`;
    }

    if (message.includes('database') && message.includes('does not exist')) {
      return `Database '${this.config.database}' not found on cluster. Check database name and create if necessary.`;
    }

    if (message.includes('ssl') || message.includes('tls')) {
      return `SSL/TLS connection issue. Redshift requires SSL - check SSL configuration and cluster settings.`;
    }

    if (message.includes('cluster') && message.includes('paused')) {
      return `Redshift cluster appears to be paused. Resume the cluster and try again.`;
    }

    return `Connection failed to ${this.config.host}:${this.config.port}. Check host, port, credentials, and network connectivity.`;
  }

  /**
   * List all tables in the public schema using pg_tables (Redshift system view)
   */
  async listTables(): Promise<string[]> {
    const sql = `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = $1
      ORDER BY tablename
      LIMIT $2
    `;

    this.validateQuery(sql);

    try {
      const result = await this.executeParameterizedQuery(sql, ['public', this.maxRows]);
      return result.map((row: any) => row.tablename).filter(Boolean);
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
   * Get table schema information securely using information_schema
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
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position
      LIMIT $3
    `;

    this.validateQuery(sql);

    try {
      const result = await this.executeParameterizedQuery(sql, ['public', table, this.maxRows]);

      if (result.length === 0) {
        throw QueryError.tableNotFound(table);
      }

      return {
        table,
        columns: result.map(row => ({
          name: row.column_name,
          type: this.mapRedshiftType(row.data_type),
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
   * Get last modified timestamp using Redshift-specific methods
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

    // Fallback: use Redshift system views to get table information
    try {
      // Try SVV_TABLE_INFO for table statistics
      const sql = `
        SELECT MAX(last_modified_time) as last_modified
        FROM svv_table_info
        WHERE database = $1 AND schema = $2 AND table = $3
      `;

      this.validateQuery(sql);
      const result = await this.executeParameterizedQuery(sql, [this.config.database, 'public', table]);

      if (result.length > 0 && result[0].last_modified) {
        return new Date(result[0].last_modified);
      }
    } catch {
      // SVV_TABLE_INFO query failed, try pg_stat_user_tables fallback
      try {
        const sql = `
          SELECT GREATEST(
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze
          ) as last_modified
          FROM pg_stat_user_tables
          WHERE schemaname = $1 AND relname = $2
        `;

        this.validateQuery(sql);
        const result = await this.executeParameterizedQuery(sql, ['public', table]);

        if (result.length > 0 && result[0].last_modified) {
          return new Date(result[0].last_modified);
        }
      } catch {
        // All system queries failed, return null
      }
    }

    return null;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.end();
      } catch (error) {
        // Log error but don't throw - closing should be safe
        console.warn('Warning: Error closing Redshift connection:', ErrorHandler.getUserMessage(error));
      } finally {
        this.client = null;
        this.connected = false;
      }
    }
  }

  /**
   * Map Redshift data types to standard types
   * Redshift is based on PostgreSQL 8.0.2 with some differences
   */
  private mapRedshiftType(redshiftType: string): string {
    const typeMap: Record<string, string> = {
      // Numeric types
      'smallint': 'integer',
      'integer': 'integer',
      'int': 'integer',
      'int2': 'integer',
      'int4': 'integer',
      'bigint': 'bigint',
      'int8': 'bigint',
      'decimal': 'decimal',
      'numeric': 'decimal',
      'real': 'float',
      'float4': 'float',
      'double precision': 'float',
      'float8': 'float',
      'float': 'float',

      // String types
      'char': 'text',
      'character': 'text',
      'nchar': 'text',
      'varchar': 'text',
      'character varying': 'text',
      'nvarchar': 'text',
      'text': 'text',
      'bpchar': 'text',

      // Date/time types
      'date': 'date',
      'timestamp': 'timestamp',
      'timestamp without time zone': 'timestamp',
      'timestamp with time zone': 'timestamptz',
      'timestamptz': 'timestamptz',
      'time': 'time',
      'time without time zone': 'time',
      'time with time zone': 'timetz',
      'timetz': 'timetz',

      // Boolean
      'boolean': 'boolean',
      'bool': 'boolean',

      // Special types
      'super': 'json', // Redshift SUPER type for semi-structured data
      'json': 'json',
      'geometry': 'text',
      'geography': 'text',

      // Binary
      'varbyte': 'text'
    };

    return typeMap[redshiftType.toLowerCase()] || 'unknown';
  }

  /**
   * Override escapeIdentifier for Redshift double-quote syntax
   */
  protected escapeIdentifier(identifier: string): string {
    // Only allow alphanumeric, underscore, and dot (for schema.table)
    if (!/^[a-zA-Z0-9_\.]+$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`);
    }

    // Additional length check
    if (identifier.length > 256) {
      throw new Error('Identifier too long');
    }

    // Return with double quotes for Redshift/PostgreSQL
    return `"${identifier}"`;
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
      port: credentials.port || 5439,
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