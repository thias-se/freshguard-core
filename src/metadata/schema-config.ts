/**
 * Schema configuration resolver for PostgreSQL metadata storage
 *
 * Provides configuration resolution with sensible defaults,
 * table prefix application, and qualified table name generation.
 *
 * @license MIT
 */

import type { MetadataStorageConfig } from './types.js';
import { ConfigurationError } from '../errors/index.js';

/**
 * Resolved schema configuration with applied defaults
 */
export interface ResolvedSchemaConfig {
  schemaName: string;
  tablePrefix: string;
  tables: {
    checkExecutions: string;
    monitoringRules: string;
  };
  qualifiedNames: {
    checkExecutions: string;
    monitoringRules: string;
  };
}

/**
 * Schema configuration resolver
 *
 * Resolves metadata storage configuration with defaults and validates parameters.
 * Provides qualified table names for PostgreSQL operations.
 */
export class SchemaConfigResolver {
  private readonly config: ResolvedSchemaConfig;

  constructor(metadataConfig: MetadataStorageConfig) {
    this.config = this.resolveConfiguration(metadataConfig);
    this.validateConfiguration();
  }

  /**
   * Get resolved configuration
   */
  getConfig(): ResolvedSchemaConfig {
    return this.config;
  }

  /**
   * Get qualified table name (schema.prefix_tableName)
   */
  getQualifiedTableName(baseTableName: keyof ResolvedSchemaConfig['tables']): string {
    return this.config.qualifiedNames[baseTableName];
  }

  /**
   * Get schema name
   */
  getSchemaName(): string {
    return this.config.schemaName;
  }

  /**
   * Get table prefix
   */
  getTablePrefix(): string {
    return this.config.tablePrefix;
  }

  /**
   * Get table name with prefix applied
   */
  getTableName(baseTableName: keyof ResolvedSchemaConfig['tables']): string {
    return this.config.tables[baseTableName];
  }

  /**
   * Resolve configuration with defaults
   */
  private resolveConfiguration(metadataConfig: MetadataStorageConfig): ResolvedSchemaConfig {
    const schemaConfig = metadataConfig.schema || {};

    // Apply defaults
    const schemaName = schemaConfig.name || 'public';
    const tablePrefix = schemaConfig.tablePrefix || '';

    // Apply table prefix to base table names
    const tables = {
      checkExecutions: this.applyTablePrefix(
        schemaConfig.tables?.checkExecutions || 'checkExecutions',
        tablePrefix
      ),
      monitoringRules: this.applyTablePrefix(
        schemaConfig.tables?.monitoringRules || 'monitoringRules',
        tablePrefix
      ),
    };

    // Create qualified names (schema.tableName)
    const qualifiedNames = {
      checkExecutions: this.createQualifiedName(schemaName, tables.checkExecutions),
      monitoringRules: this.createQualifiedName(schemaName, tables.monitoringRules),
    };

    return {
      schemaName,
      tablePrefix,
      tables,
      qualifiedNames,
    };
  }

  /**
   * Apply table prefix to table name
   */
  private applyTablePrefix(tableName: string, prefix: string): string {
    if (!prefix) return tableName;

    // Only add prefix if not already present
    if (tableName.startsWith(prefix)) {
      return tableName;
    }

    return `${prefix}${tableName}`;
  }

  /**
   * Create qualified table name (schema.table)
   */
  private createQualifiedName(schemaName: string, tableName: string): string {
    // For public schema, we can omit it in many contexts, but always include for consistency
    return `${schemaName}.${tableName}`;
  }

  /**
   * Validate configuration parameters
   */
  private validateConfiguration(): void {
    // Validate schema name
    if (!this.isValidIdentifier(this.config.schemaName)) {
      throw ConfigurationError.invalidValue(
        'schema.name',
        this.config.schemaName,
        'valid PostgreSQL schema name'
      );
    }

    // Validate table prefix
    if (this.config.tablePrefix && !this.isValidTablePrefix(this.config.tablePrefix)) {
      throw ConfigurationError.invalidValue(
        'schema.tablePrefix',
        this.config.tablePrefix,
        'valid PostgreSQL table prefix'
      );
    }

    // Validate table names
    Object.entries(this.config.tables).forEach(([key, tableName]) => {
      if (!this.isValidIdentifier(tableName)) {
        throw ConfigurationError.invalidValue(
          `schema.tables.${key}`,
          tableName,
          'valid PostgreSQL table name'
        );
      }
    });
  }

  /**
   * Check if identifier is valid for PostgreSQL
   */
  private isValidIdentifier(identifier: string): boolean {
    if (!identifier || typeof identifier !== 'string') {
      return false;
    }

    // PostgreSQL identifier rules:
    // - Start with letter or underscore
    // - Contain only letters, digits, underscores
    // - Max 63 characters
    const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    return (
      identifier.length <= 63 &&
      identifierPattern.test(identifier) &&
      !this.isReservedKeyword(identifier.toLowerCase())
    );
  }

  /**
   * Check if table prefix is valid
   */
  private isValidTablePrefix(prefix: string): boolean {
    if (!prefix || typeof prefix !== 'string') {
      return false;
    }

    // Table prefix should be alphanumeric with underscores, max 20 chars
    const prefixPattern = /^[a-zA-Z0-9_]*$/;

    return (
      prefix.length <= 20 &&
      prefixPattern.test(prefix)
    );
  }

  /**
   * Check if identifier is a PostgreSQL reserved keyword
   */
  private isReservedKeyword(identifier: string): boolean {
    // Common PostgreSQL reserved keywords that would cause issues
    const reservedKeywords = new Set([
      'select', 'from', 'where', 'insert', 'update', 'delete', 'create', 'drop',
      'table', 'index', 'view', 'user', 'group', 'order', 'by', 'limit',
      'offset', 'join', 'inner', 'left', 'right', 'outer', 'on', 'as',
      'and', 'or', 'not', 'null', 'true', 'false', 'default', 'primary',
      'key', 'foreign', 'references', 'constraint', 'unique', 'check'
    ]);

    return reservedKeywords.has(identifier);
  }
}