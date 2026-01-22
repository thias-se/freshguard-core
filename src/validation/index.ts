/**
 * FreshGuard Core Phase 2 Validation Layer
 *
 * Modern validation system using Zod schemas with enhanced error handling,
 * type safety, and comprehensive input sanitization.
 *
 * @license MIT
 */

// Export all schemas
export * from './schemas.js';

// Export runtime validation
export * from './runtime-validator.js';

// Export sanitization utilities
export * from './sanitizers.js';

// Re-export commonly used functions for backward compatibility
export {
  validateTableName,
  validateColumnName,
  validateDatabaseIdentifier,
  validateConnectorConfig,
  sanitizeString,
  validateLimit,
  validateConnectionString
} from './runtime-validator.js';

// Export validation result types
export type {
  ValidationError,
  ValidationResult
} from './runtime-validator.js';

// Export sanitization types
export type {
  SanitizationPolicy,
  SanitizationResult
} from './sanitizers.js';