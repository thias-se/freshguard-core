/**
 * Base connector class with built-in security validation and observability
 *
 * All database connectors must extend this class to ensure consistent
 * security measures including query validation, timeouts, error sanitization,
 * structured logging, and metrics collection.
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
  TimeoutError
} from '../errors/index.js';
import { DebugErrorFactory, mergeDebugConfig } from '../errors/debug-factory.js';
import type { DebugConfig } from '../types.js';

import type { StructuredLogger} from '../observability/logger.js';
import { createDatabaseLogger, logTimedOperation, type LogContext } from '../observability/logger.js';
import type { MetricsCollector} from '../observability/metrics.js';
import { createComponentMetrics, timeOperation } from '../observability/metrics.js';
import type { QueryComplexityAnalyzer} from '../security/query-analyzer.js';
import { createQueryAnalyzer, type QueryComplexity, type TableMetadata } from '../security/query-analyzer.js';
import type { SchemaCache} from '../security/schema-cache.js';
import { createSchemaCache, generateStructureHash, type CachedTableSchema } from '../security/schema-cache.js';

/**
 * Abstract base connector with security and observability built-in
 *
 * Provides:
 * - SQL injection prevention
 * - Query timeouts
 * - Connection validation
 * - Error sanitization
 * - Read-only query patterns
 * - Structured logging
 * - Metrics collection
 */
export abstract class BaseConnector implements Connector {
  protected readonly connectionTimeout: number;
  protected readonly queryTimeout: number;
  protected readonly maxRows: number;
  protected readonly requireSSL: boolean;
  protected readonly logger: StructuredLogger;
  protected readonly metrics: MetricsCollector;
  protected readonly queryAnalyzer: QueryComplexityAnalyzer;
  protected readonly schemaCache: SchemaCache;
  protected readonly enableDetailedLogging: boolean;
  protected readonly enableQueryAnalysis: boolean;
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

    // Initialize observability
    const databaseType = this.constructor.name.replace('Connector', '').toLowerCase();
    this.logger = createDatabaseLogger(databaseType, {
      baseContext: {
        host: config.host,
        database: config.database,
        connector: databaseType
      }
    });
    this.metrics = createComponentMetrics(`database_${databaseType}`);
    this.enableDetailedLogging = security.enableDetailedLogging !== false;

    // Initialize advanced security features
    this.enableQueryAnalysis = security.enableQueryAnalysis !== false;
    this.queryAnalyzer = createQueryAnalyzer({
      maxRiskScore: security.maxQueryRiskScore || 70,
      maxComplexityScore: security.maxQueryComplexityScore || 80,
      enableSecurityAnalysis: true,
      enablePerformanceAnalysis: true
    });
    this.schemaCache = createSchemaCache({
      logger: this.logger.child({ component: 'schema-cache' }),
      metrics: this.metrics
    });

    // Validate configuration
    this.validateConfig(config);

    // Log connector initialization
    this.logger.info('Database connector initialized', {
      database: config.database,
      host: config.host,
      port: config.port,
      ssl: config.ssl,
      connectionTimeout: this.connectionTimeout,
      queryTimeout: this.queryTimeout,
      maxRows: this.maxRows,
      enableQueryAnalysis: this.enableQueryAnalysis,
      maxQueryRiskScore: security.maxQueryRiskScore || 70,
      maxQueryComplexityScore: security.maxQueryComplexityScore || 80
    });
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
   * Validate SQL query against security rules with enhanced analysis
   *
   * Combines traditional pattern matching with advanced query complexity analysis
   */
  protected async validateQuery(sql: string, tableNames: string[] = []): Promise<void> {
    const normalizedSql = sql.trim().toUpperCase();

    // Traditional validation (backward compatibility)
    this.validateQueryTraditional(sql, normalizedSql);

    // Enhanced query analysis (if enabled)
    if (this.enableQueryAnalysis) {
      await this.validateQueryWithAnalyzer(sql, tableNames);
    }
  }

  /**
   * Traditional query validation for backward compatibility
   */
  private validateQueryTraditional(sql: string, normalizedSql: string): void {
    // Check for blocked keywords
    for (const keyword of this.blockedKeywords) {
      if (normalizedSql.includes(keyword.toUpperCase())) {
        this.logger.warn('Blocked SQL keyword detected', {
          keyword,
          sqlPreview: sql.substring(0, 100)
        });
        throw new SecurityError(`Blocked keyword detected: ${keyword}`);
      }
    }

    // Check for incomplete SQL clauses that could indicate malformed queries
    const incompletePatterns = [
      /\bWHERE\s*$/i,
      /\bAND\s*$/i,
      /\bOR\s*$/i,
      /\bJOIN\s*$/i,
      /\bON\s*$/i,
      /\bSET\s*$/i,
      /\bVALUES\s*$/i
    ];

    for (const pattern of incompletePatterns) {
      if (pattern.test(sql.trim())) {
        const matchedKeyword = pattern.source.replace(/[\^$\\]/g, '').replace(/\s\*\$/g, '');
        this.logger.warn('Incomplete SQL clause detected', {
          keyword: matchedKeyword,
          sqlPreview: sql.substring(0, 100)
        });
        throw new SecurityError(`Incomplete SQL clause: query ends with ${matchedKeyword}`);
      }
    }

    // Check if query matches allowed patterns
    // Fix: Trim SQL to handle multiline queries with leading whitespace
    const trimmedSql = sql.trim();
    const isAllowed = this.allowedPatterns.some(pattern => pattern.test(trimmedSql));
    if (!isAllowed) {
      this.logger.warn('Query pattern not allowed', {
        sqlPreview: sql.substring(0, 100),
        trimmedSqlPreview: trimmedSql.substring(0, 100),
        allowedPatterns: this.allowedPatterns.map(p => p.source)
      });
      throw new SecurityError('Query pattern not allowed');
    }

    if (this.enableDetailedLogging) {
      this.logger.debug('Traditional query validation passed', {
        sqlPreview: sql.substring(0, 100)
      });
    }
  }

  /**
   * Enhanced query validation using complexity analyzer
   */
  private async validateQueryWithAnalyzer(sql: string, tableNames: string[]): Promise<void> {
    try {
      // Get table metadata for analysis
      const tableMetadata = await this.getTableMetadataForAnalysis(tableNames);

      // Analyze query complexity
      const analysis = this.queryAnalyzer.analyzeQuery(sql, tableMetadata);

      // Log analysis results
      this.logQueryAnalysis(sql, analysis);

      // Check if query should be blocked
      if (!analysis.allowExecution) {
        const reason = this.getBlockingReason(analysis);
        throw new SecurityError(`Query blocked by security analysis: ${reason}`);
      }

      // Log warnings if present
      if (analysis.securityWarnings.length > 0 || analysis.performanceWarnings.length > 0) {
        this.logger.warn('Query analysis warnings', {
          sqlPreview: sql.substring(0, 100),
          riskScore: analysis.riskScore,
          complexityScore: analysis.complexityScore,
          securityWarnings: analysis.securityWarnings,
          performanceWarnings: analysis.performanceWarnings,
          recommendations: analysis.recommendations
        });
      }

    } catch (error) {
      // If analysis fails, fall back to traditional validation
      if (error instanceof SecurityError) {
        throw error; // Re-throw security errors
      }

      this.logger.warn('Query analysis failed, using traditional validation only', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sqlPreview: sql.substring(0, 100)
      });
    }
  }

  /**
   * Get table metadata for query analysis
   */
  private async getTableMetadataForAnalysis(tableNames: string[]): Promise<TableMetadata[]> {
    const metadata: TableMetadata[] = [];

    for (const tableName of tableNames) {
      try {
        // Try to get from cache first
        const cached = this.schemaCache.get(this.config.database, tableName);

        if (cached) {
          metadata.push(this.convertCachedToTableMetadata(cached));
        } else {
          // Get fresh metadata and cache it
          const fresh = await this.getTableMetadataFresh(tableName);
          if (fresh) {
            metadata.push(fresh);
            await this.cacheTableMetadata(fresh);
          }
        }
      } catch (error) {
        this.logger.debug('Failed to get table metadata for analysis', {
          tableName,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Continue without this table's metadata
      }
    }

    return metadata;
  }

  /**
   * Convert cached schema to table metadata format
   */
  private convertCachedToTableMetadata(cached: CachedTableSchema): TableMetadata {
    return {
      name: cached.tableName,
      estimatedRows: cached.estimatedRows,
      sizeBytes: cached.sizeBytes,
      indexes: cached.indexes.map(idx => ({
        name: idx.name,
        columns: idx.columns,
        unique: idx.unique,
        type: idx.type
      })),
      columns: cached.columns.map(col => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable,
        indexed: col.indexed,
        cardinality: col.estimatedCardinality
      })),
      lastUpdated: cached.cachedAt
    };
  }

  /**
   * Get fresh table metadata (to be overridden by specific connectors)
   */
  protected async getTableMetadataFresh(tableName: string): Promise<TableMetadata | null> {
    // Default implementation - subclasses should override
    try {
      // Use internal row count to avoid validation recursion
      const rowCount = await this.getRowCountInternal(tableName, false);
      return {
        name: tableName,
        estimatedRows: rowCount,
        indexes: [],
        columns: [],
        lastUpdated: new Date()
      };
    } catch {
      return null;
    }
  }

  /**
   * Cache table metadata
   */
  private async cacheTableMetadata(metadata: TableMetadata): Promise<void> {
    try {
      const cachedSchema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
        tableName: metadata.name,
        database: this.config.database,
        columns: metadata.columns.map(col => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          indexed: col.indexed || false,
          isPrimaryKey: false, // Would need specific detection
          estimatedCardinality: col.cardinality
        })),
        indexes: metadata.indexes.map(idx => ({
          name: idx.name,
          columns: idx.columns,
          unique: idx.unique,
          type: idx.type || 'btree',
          isPrimary: false, // Would need specific detection
          sizeBytes: undefined
        })),
        estimatedRows: metadata.estimatedRows,
        sizeBytes: metadata.sizeBytes,
        structureHash: generateStructureHash(
          metadata.columns.map(col => ({
            name: col.name,
            type: col.type,
            nullable: col.nullable,
            indexed: col.indexed || false,
            isPrimaryKey: false,
            estimatedCardinality: col.cardinality
          })),
          metadata.indexes.map(idx => ({
            name: idx.name,
            columns: idx.columns,
            unique: idx.unique,
            type: idx.type || 'btree',
            isPrimary: false
          }))
        )
      };

      this.schemaCache.set(cachedSchema);

      if (this.enableDetailedLogging) {
        this.logger.debug('Table metadata cached', {
          tableName: metadata.name,
          estimatedRows: metadata.estimatedRows,
          columns: metadata.columns.length,
          indexes: metadata.indexes.length
        });
      }
    } catch (error) {
      this.logger.warn('Failed to cache table metadata', {
        tableName: metadata.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Log query analysis results
   */
  private logQueryAnalysis(sql: string, analysis: QueryComplexity): void {
    const logData = {
      sqlPreview: sql.substring(0, 100),
      allowExecution: analysis.allowExecution,
      riskScore: analysis.riskScore,
      complexityScore: analysis.complexityScore,
      estimatedCost: analysis.estimatedCost,
      queryType: analysis.details.queryType,
      tableCount: analysis.details.tableCount,
      joinCount: analysis.details.joinCount,
      hasSubqueries: analysis.details.hasSubqueries,
      hasWildcards: analysis.details.hasWildcards,
      estimatedResultSize: analysis.details.estimatedResultSize
    };

    if (analysis.allowExecution) {
      if (analysis.riskScore > 50 || analysis.complexityScore > 50) {
        this.logger.warn('High-risk query approved for execution', logData);
      } else if (this.enableDetailedLogging) {
        this.logger.debug('Query analysis completed', logData);
      }
    } else {
      this.logger.error('Query blocked by analysis', {
        ...logData,
        securityWarnings: analysis.securityWarnings,
        performanceWarnings: analysis.performanceWarnings
      });
    }
  }

  /**
   * Get reason why query was blocked
   */
  private getBlockingReason(analysis: QueryComplexity): string {
    const reasons: string[] = [];

    if (analysis.riskScore > this.queryAnalyzer.getConfig().maxRiskScore) {
      reasons.push(`risk score ${analysis.riskScore} exceeds limit`);
    }

    if (analysis.complexityScore > this.queryAnalyzer.getConfig().maxComplexityScore) {
      reasons.push(`complexity score ${analysis.complexityScore} exceeds limit`);
    }

    if (analysis.estimatedCost > this.queryAnalyzer.getConfig().maxEstimatedCost) {
      reasons.push(`estimated cost ${analysis.estimatedCost} exceeds limit`);
    }

    if (analysis.details.estimatedResultSize > this.queryAnalyzer.getConfig().maxResultSetSize) {
      reasons.push(`result set size ${analysis.details.estimatedResultSize} exceeds limit`);
    }

    if (analysis.securityWarnings.some(w => w.includes('injection'))) {
      reasons.push('potential SQL injection detected');
    }

    return reasons.join(', ') || 'security policy violation';
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
    return this.getRowCountInternal(table, true);
  }

  /**
   * Internal row count method with optional validation
   */
  private async getRowCountInternal(table: string, validateQuery = true): Promise<number> {
    const escapedTable = this.escapeIdentifier(table);
    const sql = `SELECT COUNT(*) as count FROM ${escapedTable}`;

    // Only validate if not being called for internal metadata purposes
    if (validateQuery) {
      await this.validateQuery(sql, [table]);
    }

    return logTimedOperation(
      this.logger,
      'getRowCount',
      async () => {
        return timeOperation(
          this.metrics,
          'getRowCount',
          this.config.database,
          table,
          async () => {
            const result = await this.executeWithTimeout(
              () => this.executeQuery(sql),
              this.queryTimeout
            );

            if (!result || result.length === 0) {
              throw new Error('No result returned');
            }

            const count = parseInt(result[0].count || '0', 10);
            const finalCount = isNaN(count) ? 0 : count;

            if (this.enableDetailedLogging) {
              this.logger.debug('Retrieved row count', {
                table,
                count: finalCount,
                query: sql,
                internal: !validateQuery
              });
            }

            return finalCount;
          }
        );
      },
      { table, operation: 'getRowCount' }
    );
  }

  /**
   * Get maximum timestamp value from a column
   */
  async getMaxTimestamp(table: string, column: string): Promise<Date | null> {
    return this.getMaxTimestampInternal(table, column, true);
  }

  /**
   * Internal max timestamp method with optional validation
   */
  private async getMaxTimestampInternal(table: string, column: string, validateQuery = true): Promise<Date | null> {
    const escapedTable = this.escapeIdentifier(table);
    const escapedColumn = this.escapeIdentifier(column);
    const sql = `SELECT MAX(${escapedColumn}) as max_date FROM ${escapedTable}`;

    // Only validate if not being called for internal metadata purposes
    if (validateQuery) {
      await this.validateQuery(sql, [table]);
    }

    return logTimedOperation(
      this.logger,
      'getMaxTimestamp',
      async () => {
        return timeOperation(
          this.metrics,
          'getMaxTimestamp',
          this.config.database,
          table,
          async () => {
            const result = await this.executeWithTimeout(
              () => this.executeQuery(sql),
              this.queryTimeout
            );

            if (!result || result.length === 0 || !result[0].max_date) {
              if (this.enableDetailedLogging) {
                this.logger.debug('No timestamp found', {
                  table,
                  column,
                  query: sql,
                  internal: !validateQuery
                });
              }
              return null;
            }

            const dateValue = result[0].max_date;
            const finalDate = dateValue instanceof Date ? dateValue : new Date(dateValue);

            if (this.enableDetailedLogging) {
              this.logger.debug('Retrieved max timestamp', {
                table,
                column,
                maxTimestamp: finalDate.toISOString(),
                query: sql,
                internal: !validateQuery
              });
            }

            return finalDate;
          }
        );
      },
      { table, column, operation: 'getMaxTimestamp' }
    );
  }

  /**
   * Get minimum timestamp value from a column
   */
  async getMinTimestamp(table: string, column: string): Promise<Date | null> {
    return this.getMinTimestampInternal(table, column, true);
  }

  /**
   * Internal min timestamp method with optional validation
   */
  private async getMinTimestampInternal(table: string, column: string, validateQuery = true): Promise<Date | null> {
    const escapedTable = this.escapeIdentifier(table);
    const escapedColumn = this.escapeIdentifier(column);
    const sql = `SELECT MIN(${escapedColumn}) as min_date FROM ${escapedTable}`;

    // Only validate if not being called for internal metadata purposes
    if (validateQuery) {
      await this.validateQuery(sql, [table]);
    }

    try {
      const result = await this.executeWithTimeout(
        () => this.executeQuery(sql),
        this.queryTimeout
      );

      if (!result || result.length === 0 || !result[0].min_date) {
        if (this.enableDetailedLogging) {
          this.logger.debug('No minimum timestamp found', {
            table,
            column,
            query: sql,
            internal: !validateQuery
          });
        }
        return null;
      }

      const dateValue = result[0].min_date;
      const finalDate = dateValue instanceof Date ? dateValue : new Date(dateValue);

      if (this.enableDetailedLogging) {
        this.logger.debug('Retrieved min timestamp', {
          table,
          column,
          minTimestamp: finalDate.toISOString(),
          query: sql,
          internal: !validateQuery
        });
      }

      return finalDate;
    } catch (error) {
      throw new Error(this.sanitizeError(error));
    }
  }

  /**
   * Get last modified timestamp for a table
   * Implementation varies by database type
   */
  async getLastModified(_table: string): Promise<Date | null> {
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
      this.logger.error('Query returned too many rows', {
        resultCount: results.length,
        maxRows: this.maxRows
      });
      throw new SecurityError(`Query returned too many rows (max ${this.maxRows})`);
    }

    if (this.enableDetailedLogging && results.length > this.maxRows * 0.8) {
      this.logger.warn('Query returned close to max row limit', {
        resultCount: results.length,
        maxRows: this.maxRows,
        utilizationPercent: Math.round((results.length / this.maxRows) * 100)
      });
    }
  }

  /**
   * Helper method for specific connectors to log operations with consistent format
   */
  protected logOperation(operation: string, context: LogContext): void {
    this.logger.info(`Database operation: ${operation}`, {
      ...context,
      database: this.config.database,
      host: this.config.host
    });
  }

  /**
   * Helper method for specific connectors to log errors with consistent format
   */
  protected logError(operation: string, error: Error, context?: LogContext): void {
    this.logger.error(`Database operation failed: ${operation}`, error, {
      ...context,
      database: this.config.database,
      host: this.config.host
    });
  }

  /**
   * Get schema cache statistics
   */
  protected getSchemaCacheStats(): any {
    return this.schemaCache.getStats();
  }

  /**
   * Clear schema cache for testing or maintenance
   */
  protected clearSchemaCache(): void {
    this.schemaCache.clear();
  }

  /**
   * Get query analyzer configuration
   */
  protected getQueryAnalyzerConfig(): any {
    return this.queryAnalyzer.getConfig();
  }

  /**
   * Cleanup resources (should be called by subclasses in their close method)
   */
  protected cleanup(): void {
    this.schemaCache.stop();
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
   * Execute a parameterized SQL query (recommended for security)
   * Subclasses should override this to use proper prepared statements
   */
  protected async executeParameterizedQuery(sql: string, parameters: any[] = []): Promise<any[]> {
    // Default implementation falls back to executeQuery for backward compatibility
    // Subclasses should override this to use proper parameterized queries
    if (parameters.length > 0) {
      console.warn('Parameters provided but connector does not support parameterized queries. Consider upgrading connector implementation.');
    }
    return this.executeQuery(sql);
  }

  /**
   * Test database connection with optional debug configuration
   * Subclasses implement with database-specific connection test
   * @param debugConfig Optional debug configuration for enhanced error reporting
   */
  abstract testConnection(debugConfig?: DebugConfig): Promise<boolean>;

  /**
   * Helper method for subclasses to create debug-enabled error factory
   */
  protected createDebugErrorFactory(debugConfig?: DebugConfig): DebugErrorFactory {
    const mergedConfig = mergeDebugConfig(debugConfig);
    return new DebugErrorFactory(mergedConfig);
  }

  /**
   * Helper method for subclasses to log debug information
   */
  protected logDebugInfo(debugConfig: DebugConfig | undefined, debugId: string, operation: string, context: Record<string, unknown>): void {
    if (debugConfig?.enabled) {
      console.log(`[DEBUG-${debugId}] ${operation}:`, context);
    }
  }

  /**
   * Helper method for subclasses to log debug errors
   */
  protected logDebugError(debugConfig: DebugConfig | undefined, debugId: string, operation: string, context: Record<string, unknown>): void {
    if (debugConfig?.enabled) {
      console.error(`[DEBUG-${debugId}] ${operation} failed:`, context);
    }
  }

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