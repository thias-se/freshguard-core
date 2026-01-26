/**
 * Secure PostgreSQL connector for FreshGuard Core
 * Extends BaseConnector with security built-in
 *
 * @module @thias-se/freshguard-core/connectors/postgres
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
 * Secure PostgreSQL connector
 *
 * Features:
 * - SQL injection prevention
 * - Connection timeouts
 * - SSL enforcement
 * - Read-only query patterns
 * - Secure error handling
 */
export class PostgresConnector extends BaseConnector {
  private client: ReturnType<typeof postgres> | null = null;
  private connected = false;

  constructor(config: ConnectorConfig, securityConfig?: Partial<SecurityConfig>) {
    // Validate configuration before proceeding
    validateConnectorConfig(config);
    super(config, securityConfig);
  }

  /**
   * Connect to PostgreSQL database with security validation
   */
  private async connect(): Promise<void> {
    if (this.connected && this.client) {
      return; // Already connected
    }

    try {
      // Enforce SSL by default for security
      const sslConfig = this.requireSSL ? { rejectUnauthorized: true } : false;

      this.client = postgres({
        host: this.config.host,
        port: this.config.port || 5432,
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
        max_lifetime: 60 * 60 // 1 hour
      });

      this.connected = true;
    } catch (error) {
      throw new ConnectionError(
        'Failed to connect to PostgreSQL',
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
    const debugId = `pg-test-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
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

    if (message.includes('connection refused')) {
      return `PostgreSQL server at ${this.config.host}:${this.config.port} is not accepting connections. Verify the server is running and accessible.`;
    }

    if (message.includes('timeout')) {
      return `Connection timeout to ${this.config.host}:${this.config.port}. Check network connectivity and server responsiveness.`;
    }

    if (message.includes('authentication failed')) {
      return `Authentication failed for database '${this.config.database}'. Verify username, password, and database name.`;
    }

    if (message.includes('database') && message.includes('does not exist')) {
      return `Database '${this.config.database}' not found on server. Check database name and create if necessary.`;
    }

    if (message.includes('ssl') || message.includes('tls')) {
      return `SSL/TLS connection issue. Check SSL configuration and server certificate settings.`;
    }

    return `Connection failed to ${this.config.host}:${this.config.port}. Check host, port, credentials, and network connectivity.`;
  }

  /**
   * List all tables in the public schema
   */
  async listTables(): Promise<string[]> {
    const sql = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
      LIMIT $2
    `;

    this.validateQuery(sql);

    try {
      const result = await this.executeParameterizedQuery(sql, ['public', this.maxRows]);
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
          type: this.mapPostgresType(row.data_type),
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
   * Get last modified timestamp using PostgreSQL-specific methods
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

    // Fallback: use PostgreSQL system catalog to get table modification time
    try {
      const sql = `
        SELECT GREATEST(
          pg_stat_get_last_analyze_time(c.oid),
          pg_stat_get_last_autoanalyze_time(c.oid)
        ) as last_modified
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
      `;

      this.validateQuery(sql);
      const result = await this.executeParameterizedQuery(sql, ['public', table]);

      if (result.length > 0 && result[0].last_modified) {
        return new Date(result[0].last_modified);
      }
    } catch {
      // System catalog query failed, return null
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
        console.warn('Warning: Error closing PostgreSQL connection:', ErrorHandler.getUserMessage(error));
      } finally {
        this.client = null;
        this.connected = false;
      }
    }
  }

  /**
   * Map PostgreSQL data types to standard types
   */
  private mapPostgresType(pgType: string): string {
    const typeMap: Record<string, string> = {
      'bigint': 'bigint',
      'bigserial': 'bigint',
      'integer': 'integer',
      'smallint': 'integer',
      'serial': 'integer',
      'text': 'text',
      'varchar': 'text',
      'character varying': 'text',
      'char': 'text',
      'character': 'text',
      'date': 'date',
      'timestamp': 'timestamp',
      'timestamp without time zone': 'timestamp',
      'timestamp with time zone': 'timestamptz',
      'timestamptz': 'timestamptz',
      'time': 'time',
      'time without time zone': 'time',
      'time with time zone': 'timetz',
      'boolean': 'boolean',
      'numeric': 'decimal',
      'decimal': 'decimal',
      'real': 'float',
      'double precision': 'float',
      'json': 'json',
      'jsonb': 'json',
      'uuid': 'uuid'
    };

    return typeMap[pgType.toLowerCase()] || 'unknown';
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
      port: credentials.port || 5432,
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
