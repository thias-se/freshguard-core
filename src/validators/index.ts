/**
 * Input validation utilities for FreshGuard Core
 *
 * Provides centralized validation functions to prevent injection attacks
 * and ensure data integrity across the application.
 *
 * @license MIT
 */

import type { ConnectorConfig } from '../types/connector.js';

// ==============================================
// Identifier Validation
// ==============================================

/**
 * Validate table name for SQL injection prevention
 *
 * @param name - Table name to validate
 * @returns True if valid
 * @throws Error if invalid
 */
export function validateTableName(name: string): boolean {
  if (typeof name !== 'string') {
    throw new Error('Table name must be a string');
  }

  if (name.length === 0) {
    throw new Error('Table name cannot be empty');
  }

  if (name.length > 256) {
    throw new Error('Table name too long (max 256 characters)');
  }

  // Allow alphanumeric, underscore, and dot (for schema.table notation)
  if (!/^[a-zA-Z0-9_\.]+$/.test(name)) {
    throw new Error('Table name contains invalid characters (only alphanumeric, underscore, and dot allowed)');
  }

  // Ensure it doesn't start with a number
  if (/^[0-9]/.test(name)) {
    throw new Error('Table name cannot start with a number');
  }

  // Check for reserved SQL keywords (basic protection)
  const reservedKeywords = [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
    'TABLE', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE'
  ];

  if (reservedKeywords.includes(name.toUpperCase())) {
    throw new Error(`Table name "${name}" is a reserved SQL keyword`);
  }

  return true;
}

/**
 * Validate column name for SQL injection prevention
 *
 * @param name - Column name to validate
 * @returns True if valid
 * @throws Error if invalid
 */
export function validateColumnName(name: string): boolean {
  if (typeof name !== 'string') {
    throw new Error('Column name must be a string');
  }

  if (name.length === 0) {
    throw new Error('Column name cannot be empty');
  }

  if (name.length > 256) {
    throw new Error('Column name too long (max 256 characters)');
  }

  // Allow alphanumeric and underscore only (no dot for column names)
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error('Column name contains invalid characters (only alphanumeric and underscore allowed)');
  }

  // Ensure it doesn't start with a number
  if (/^[0-9]/.test(name)) {
    throw new Error('Column name cannot start with a number');
  }

  // Check for reserved SQL keywords
  const reservedKeywords = [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
    'TABLE', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE',
    'COUNT', 'MAX', 'MIN', 'SUM', 'AVG', 'DISTINCT', 'ORDER', 'GROUP', 'BY'
  ];

  if (reservedKeywords.includes(name.toUpperCase())) {
    throw new Error(`Column name "${name}" is a reserved SQL keyword`);
  }

  return true;
}

/**
 * Validate database identifier (table or column name)
 *
 * @param identifier - Identifier to validate
 * @param type - Type of identifier ('table' or 'column')
 * @returns True if valid
 */
export function validateDatabaseIdentifier(identifier: string, type: 'table' | 'column' = 'table'): boolean {
  if (type === 'table') {
    return validateTableName(identifier);
  } else {
    return validateColumnName(identifier);
  }
}

// ==============================================
// Configuration Validation
// ==============================================

/**
 * Validate connector configuration for security and completeness
 *
 * @param config - Connector configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateConnectorConfig(config: Partial<ConnectorConfig>): void {
  if (!config) {
    throw new Error('Configuration object is required');
  }

  // Required fields validation
  if (!config.host || typeof config.host !== 'string') {
    throw new Error('Host is required and must be a string');
  }

  if (!config.database || typeof config.database !== 'string') {
    throw new Error('Database name is required and must be a string');
  }

  if (!config.username || typeof config.username !== 'string') {
    throw new Error('Username is required and must be a string');
  }

  if (!config.password || typeof config.password !== 'string') {
    throw new Error('Password is required and must be a string');
  }

  // Host validation
  if (config.host.length > 255) {
    throw new Error('Host name too long (max 255 characters)');
  }

  // Basic hostname format validation
  if (!/^[a-zA-Z0-9\-\.]+$/.test(config.host)) {
    throw new Error('Invalid host name format');
  }

  // Port validation
  if (config.port !== undefined) {
    if (typeof config.port !== 'number' || !Number.isInteger(config.port)) {
      throw new Error('Port must be an integer');
    }

    if (config.port < 1 || config.port > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }
  }

  // Timeout validation
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || !Number.isInteger(config.timeout)) {
      throw new Error('Timeout must be an integer');
    }

    if (config.timeout < 1000) {
      throw new Error('Timeout must be at least 1000ms');
    }

    if (config.timeout > 300000) { // 5 minutes max
      throw new Error('Timeout cannot exceed 300000ms (5 minutes)');
    }
  }

  // Query timeout validation
  if (config.queryTimeout !== undefined) {
    if (typeof config.queryTimeout !== 'number' || !Number.isInteger(config.queryTimeout)) {
      throw new Error('Query timeout must be an integer');
    }

    if (config.queryTimeout < 1000) {
      throw new Error('Query timeout must be at least 1000ms');
    }

    if (config.queryTimeout > 60000) { // 1 minute max for queries
      throw new Error('Query timeout cannot exceed 60000ms (1 minute)');
    }
  }

  // Max rows validation
  if (config.maxRows !== undefined) {
    if (typeof config.maxRows !== 'number' || !Number.isInteger(config.maxRows)) {
      throw new Error('Max rows must be an integer');
    }

    if (config.maxRows < 1) {
      throw new Error('Max rows must be at least 1');
    }

    if (config.maxRows > 10000) {
      throw new Error('Max rows cannot exceed 10000');
    }
  }

  // Username validation (prevent obvious injection attempts)
  if (config.username.includes(';') || config.username.includes('--') || config.username.includes('/*')) {
    throw new Error('Username contains invalid characters');
  }

  // Database name validation
  if (config.database.length > 64) {
    throw new Error('Database name too long (max 64 characters)');
  }

  if (!/^[a-zA-Z0-9_\-]+$/.test(config.database)) {
    throw new Error('Database name contains invalid characters');
  }
}

// ==============================================
// Input Sanitization
// ==============================================

/**
 * Sanitize string input to prevent injection attacks
 *
 * @param input - Input string to sanitize
 * @param maxLength - Maximum allowed length
 * @returns Sanitized string
 */
export function sanitizeString(input: string, maxLength: number = 256): string {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }

  // Trim whitespace
  let sanitized = input.trim();

  // Check length
  if (sanitized.length > maxLength) {
    throw new Error(`Input too long (max ${maxLength} characters)`);
  }

  // Remove dangerous characters
  sanitized = sanitized.replace(/[;\/\*\x00-\x1F\x7F]|--/g, '');

  // Ensure not empty after sanitization
  if (sanitized.length === 0) {
    throw new Error('Input is empty after sanitization');
  }

  return sanitized;
}

/**
 * Validate and sanitize SQL LIMIT value
 *
 * @param limit - LIMIT value to validate
 * @returns Validated limit as number
 */
export function validateLimit(limit: number | string): number {
  let numLimit: number;

  if (typeof limit === 'string') {
    numLimit = parseInt(limit, 10);
    if (isNaN(numLimit)) {
      throw new Error('LIMIT must be a valid number');
    }
  } else if (typeof limit === 'number') {
    if (!Number.isInteger(limit)) {
      throw new Error('LIMIT must be an integer');
    }
    numLimit = limit;
  } else {
    throw new Error('LIMIT must be a number or string');
  }

  if (numLimit < 1) {
    throw new Error('LIMIT must be at least 1');
  }

  if (numLimit > 10000) {
    throw new Error('LIMIT cannot exceed 10000');
  }

  return numLimit;
}

// ==============================================
// URL and Connection String Validation
// ==============================================

/**
 * Validate connection string format (basic validation)
 *
 * @param connectionString - Database connection string
 * @returns True if format appears valid
 */
export function validateConnectionString(connectionString: string): boolean {
  if (typeof connectionString !== 'string') {
    throw new Error('Connection string must be a string');
  }

  if (connectionString.length === 0) {
    throw new Error('Connection string cannot be empty');
  }

  if (connectionString.length > 2048) {
    throw new Error('Connection string too long (max 2048 characters)');
  }

  // Basic format check - should contain host or server
  if (!/(?:host|server|hostname)=/i.test(connectionString)) {
    throw new Error('Connection string must contain host/server specification');
  }

  // Should not contain obvious SQL injection patterns
  const dangerousPatterns = [
    /drop\s+table/i,
    /delete\s+from/i,
    /insert\s+into/i,
    /update\s+set/i,
    /;\s*drop/i,
    /;\s*delete/i
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(connectionString)) {
      throw new Error('Connection string contains dangerous SQL patterns');
    }
  }

  return true;
}

// ==============================================
// Export all validators
// ==============================================

export const validators = {
  validateTableName,
  validateColumnName,
  validateDatabaseIdentifier,
  validateConnectorConfig,
  sanitizeString,
  validateLimit,
  validateConnectionString,
} as const;