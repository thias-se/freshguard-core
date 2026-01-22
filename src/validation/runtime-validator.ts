/**
 * Runtime validation utilities for FreshGuard Core Phase 2
 *
 * Provides structured error handling and runtime validation using Zod schemas
 * with enhanced error formatting and type safety.
 *
 * @license MIT
 */

import { z } from 'zod';
import { schemas } from './schemas.js';

// ==============================================
// Error Types
// ==============================================

/**
 * Structured validation error with detailed path information
 */
export interface ValidationError {
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

/**
 * Result type for validation operations
 */
export type ValidationResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  errors: ValidationError[];
};

/**
 * Enhanced error class for validation failures
 */
export class ValidationException extends Error {
  public readonly errors: ValidationError[];
  public readonly timestamp: Date;

  constructor(errors: ValidationError[], message?: string) {
    const defaultMessage = `Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}`;
    super(message || defaultMessage);
    this.name = 'ValidationException';
    this.errors = errors;
    this.timestamp = new Date();
  }

  /**
   * Get error messages as a formatted string
   */
  getFormattedErrors(): string {
    return this.errors
      .map(error => `${error.field}: ${error.message}`)
      .join(', ');
  }

  /**
   * Convert to JSON for logging/API responses
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      errors: this.errors,
      timestamp: this.timestamp
    };
  }
}

// ==============================================
// Error Formatting Utilities
// ==============================================

/**
 * Format Zod errors into structured validation errors
 */
function formatZodErrors(zodError: z.ZodError): ValidationError[] {
  return zodError.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    code: issue.code,
    message: issue.message,
    value: issue.path.length > 0 ? undefined : issue.received // Don't include sensitive values
  }));
}

/**
 * Sanitize error values to prevent information leakage
 */
function sanitizeErrorValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Don't leak password or credential values
    if (value.length > 50 || /password|credential|token|key/i.test(String(value))) {
      return '[REDACTED]';
    }
    return value;
  }
  return value;
}

// ==============================================
// Runtime Validator Class
// ==============================================

/**
 * Runtime validator with structured error handling and caching
 */
export class RuntimeValidator {
  private schemaCache = new Map<string, z.ZodSchema>();
  private validationStats = {
    total: 0,
    successes: 0,
    failures: 0
  };

  constructor() {
    // Pre-populate schema cache with commonly used schemas
    this.schemaCache.set('TableName', schemas.TableNameSchema);
    this.schemaCache.set('ColumnName', schemas.ColumnNameSchema);
    this.schemaCache.set('BaseConnectorConfig', schemas.BaseConnectorConfigSchema);
    this.schemaCache.set('PostgresConnectorConfig', schemas.PostgresConnectorConfigSchema);
    this.schemaCache.set('DuckDBConnectorConfig', schemas.DuckDBConnectorConfigSchema);
    this.schemaCache.set('BigQueryConnectorConfig', schemas.BigQueryConnectorConfigSchema);
    this.schemaCache.set('SnowflakeConnectorConfig', schemas.SnowflakeConnectorConfigSchema);
  }

  /**
   * Validate data against a Zod schema with structured error handling
   */
  validate<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> {
    this.validationStats.total++;

    try {
      const result = schema.parse(data);
      this.validationStats.successes++;
      return {
        success: true,
        data: result
      };
    } catch (error) {
      this.validationStats.failures++;

      if (error instanceof z.ZodError) {
        const validationErrors = formatZodErrors(error);
        return {
          success: false,
          errors: validationErrors
        };
      }

      // Handle non-Zod errors
      return {
        success: false,
        errors: [{
          field: 'unknown',
          code: 'unknown_error',
          message: error instanceof Error ? error.message : 'Unknown validation error'
        }]
      };
    }
  }

  /**
   * Validate and throw exception on failure (for convenience)
   */
  validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown, context?: string): T {
    const result = this.validate(schema, data);

    if (!result.success) {
      const message = context
        ? `Validation failed for ${context}`
        : 'Validation failed';
      throw new ValidationException(result.errors, message);
    }

    return result.data;
  }

  /**
   * Validate table name
   */
  validateTableName(name: unknown): ValidationResult<string> {
    return this.validate(schemas.TableNameSchema, name);
  }

  /**
   * Validate column name
   */
  validateColumnName(name: unknown): ValidationResult<string> {
    return this.validate(schemas.ColumnNameSchema, name);
  }

  /**
   * Validate database identifier (table or column)
   */
  validateDatabaseIdentifier(identifier: unknown, type: 'table' | 'column' = 'table'): ValidationResult<string> {
    const schema = type === 'table' ? schemas.TableNameSchema : schemas.ColumnNameSchema;
    return this.validate(schema, identifier);
  }

  /**
   * Validate connector configuration
   */
  validateConnectorConfig(config: unknown, type?: 'postgres' | 'duckdb' | 'bigquery' | 'snowflake'): ValidationResult<any> {
    let schema: z.ZodSchema;

    switch (type) {
      case 'postgres':
        schema = schemas.PostgresConnectorConfigSchema;
        break;
      case 'duckdb':
        schema = schemas.DuckDBConnectorConfigSchema;
        break;
      case 'bigquery':
        schema = schemas.BigQueryConnectorConfigSchema;
        break;
      case 'snowflake':
        schema = schemas.SnowflakeConnectorConfigSchema;
        break;
      default:
        schema = schemas.BaseConnectorConfigSchema;
    }

    return this.validate(schema, config);
  }

  /**
   * Validate and sanitize string input
   */
  validateSanitizedString(input: unknown): ValidationResult<string> {
    return this.validate(schemas.SanitizedStringSchema, input);
  }

  /**
   * Validate SQL LIMIT value
   */
  validateLimit(limit: unknown): ValidationResult<number> {
    return this.validate(schemas.LimitSchema, limit);
  }

  /**
   * Validate connection string
   */
  validateConnectionString(connectionString: unknown): ValidationResult<string> {
    return this.validate(schemas.ConnectionStringSchema, connectionString);
  }

  /**
   * Validate freshness monitoring rule
   */
  validateFreshnessRule(rule: unknown): ValidationResult<z.infer<typeof schemas.FreshnessRuleSchema>> {
    return this.validate(schemas.FreshnessRuleSchema, rule);
  }

  /**
   * Validate volume anomaly monitoring rule
   */
  validateVolumeRule(rule: unknown): ValidationResult<z.infer<typeof schemas.VolumeRuleSchema>> {
    return this.validate(schemas.VolumeRuleSchema, rule);
  }

  /**
   * Validate multiple values at once
   */
  validateBatch<T>(schema: z.ZodSchema<T>, items: unknown[]): {
    valid: T[],
    invalid: Array<{ index: number, errors: ValidationError[] }>
  } {
    const valid: T[] = [];
    const invalid: Array<{ index: number, errors: ValidationError[] }> = [];

    items.forEach((item, index) => {
      const result = this.validate(schema, item);
      if (result.success) {
        valid.push(result.data);
      } else {
        invalid.push({ index, errors: result.errors });
      }
    });

    return { valid, invalid };
  }

  /**
   * Get validation statistics
   */
  getStats() {
    return {
      ...this.validationStats,
      successRate: this.validationStats.total > 0
        ? (this.validationStats.successes / this.validationStats.total * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset validation statistics
   */
  resetStats() {
    this.validationStats = {
      total: 0,
      successes: 0,
      failures: 0
    };
  }

  /**
   * Clear schema cache
   */
  clearCache() {
    this.schemaCache.clear();
  }
}

// ==============================================
// Convenience Functions
// ==============================================

// Global validator instance (can be replaced with DI in production)
const globalValidator = new RuntimeValidator();

/**
 * Validate table name (convenience function)
 */
export function validateTableName(name: unknown): string {
  return globalValidator.validateOrThrow(schemas.TableNameSchema, name, 'table name');
}

/**
 * Validate column name (convenience function)
 */
export function validateColumnName(name: unknown): string {
  return globalValidator.validateOrThrow(schemas.ColumnNameSchema, name, 'column name');
}

/**
 * Validate database identifier (convenience function)
 */
export function validateDatabaseIdentifier(identifier: unknown, type: 'table' | 'column' = 'table'): string {
  const schema = type === 'table' ? schemas.TableNameSchema : schemas.ColumnNameSchema;
  return globalValidator.validateOrThrow(schema, identifier, `${type} identifier`);
}

/**
 * Validate connector configuration (convenience function)
 */
export function validateConnectorConfig(config: unknown, type?: 'postgres' | 'duckdb' | 'bigquery' | 'snowflake'): any {
  const result = globalValidator.validateConnectorConfig(config, type);

  if (!result.success) {
    throw new ValidationException(result.errors, `Invalid ${type || 'base'} connector configuration`);
  }

  return result.data;
}

/**
 * Sanitize string input (convenience function)
 */
export function sanitizeString(input: unknown): string {
  return globalValidator.validateOrThrow(schemas.SanitizedStringSchema, input, 'string input');
}

/**
 * Validate SQL LIMIT value (convenience function)
 */
export function validateLimit(limit: unknown): number {
  return globalValidator.validateOrThrow(schemas.LimitSchema, limit, 'LIMIT value');
}

/**
 * Validate connection string (convenience function)
 */
export function validateConnectionString(connectionString: unknown): string {
  return globalValidator.validateOrThrow(schemas.ConnectionStringSchema, connectionString, 'connection string');
}

// ==============================================
// Middleware Functions
// ==============================================

/**
 * Create validation middleware for automatic validation
 */
export function createValidationMiddleware<T>(schema: z.ZodSchema<T>) {
  return (data: unknown): T => {
    return globalValidator.validateOrThrow(schema, data);
  };
}

/**
 * Create async validation middleware
 */
export function createAsyncValidationMiddleware<T>(schema: z.ZodSchema<T>) {
  return async (data: unknown): Promise<T> => {
    return globalValidator.validateOrThrow(schema, data);
  };
}

// ==============================================
// Export everything
// ==============================================

export {
  globalValidator as validator,
  schemas
};

export type {
  ValidationError,
  ValidationResult
};