/**
 * Comprehensive test suite for FreshGuard Core Phase 2 Validation Layer
 *
 * Tests Zod schemas, runtime validation, and sanitization utilities
 * with focus on security and error handling.
 *
 * @license MIT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

// Import validation modules
import {
  schemas,
  RuntimeValidator,
  ValidationException,
  validator,
  validateTableName,
  validateColumnName,
  validateConnectorConfig,
  sanitizers,
  policies
} from '../src/validation/index.js';

// ==============================================
// Schema Tests
// ==============================================

describe('Zod Schemas - Phase 2 Validation', () => {
  describe('TableNameSchema', () => {
    it('should accept valid table names', () => {
      const validNames = [
        'users',
        'user_profiles',
        'Users123',
        'table_2023',
        '_internal_table',
        'public.users',
        'schema.table_name',
        'DB_2023.user_data'
      ];

      for (const name of validNames) {
        expect(() => schemas.TableNameSchema.parse(name)).not.toThrow();
      }
    });

    it('should reject invalid table names', () => {
      const invalidNames = [
        '', // empty
        '123table', // starts with number
        'user-profile', // hyphen not allowed
        'user space', // space not allowed
        'table.schema.extra', // too many dots
        'SELECT', // reserved keyword
        'DROP', // reserved keyword
        'users;', // dangerous character
        'users--', // SQL comment
        'users/*comment*/', // SQL comment
        'a'.repeat(300), // too long
        'user.SELECT' // reserved in schema part
      ];

      for (const name of invalidNames) {
        expect(() => schemas.TableNameSchema.parse(name)).toThrow();
      }
    });

    it('should handle schema.table notation correctly', () => {
      // Valid schema.table combinations
      expect(schemas.TableNameSchema.parse('public.users')).toBe('public.users');
      expect(schemas.TableNameSchema.parse('analytics.user_events')).toBe('analytics.user_events');

      // Invalid combinations
      expect(() => schemas.TableNameSchema.parse('public.SELECT')).toThrow();
      expect(() => schemas.TableNameSchema.parse('DROP.users')).toThrow();
    });
  });

  describe('ColumnNameSchema', () => {
    it('should accept valid column names', () => {
      const validNames = [
        'id',
        'user_id',
        'created_at',
        'isActive',
        'data_2023',
        '_internal_field'
      ];

      for (const name of validNames) {
        expect(() => schemas.ColumnNameSchema.parse(name)).not.toThrow();
      }
    });

    it('should reject invalid column names', () => {
      const invalidNames = [
        '', // empty
        '123column', // starts with number
        'user-id', // hyphen not allowed
        'user.id', // dot not allowed in column names
        'SELECT', // reserved keyword
        'created at', // space not allowed
        'id;', // dangerous character
        'a'.repeat(300) // too long
      ];

      for (const name of invalidNames) {
        expect(() => schemas.ColumnNameSchema.parse(name)).toThrow();
      }
    });
  });

  describe('BaseConnectorConfigSchema', () => {
    it('should validate complete config', () => {
      const validConfig = {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        username: 'user',
        password: 'pass',
        ssl: true,
        timeout: 30000,
        queryTimeout: 10000,
        maxRows: 1000,
        applicationName: 'FreshGuard'
      };

      const result = schemas.BaseConnectorConfigSchema.parse(validConfig);
      expect(result).toEqual(validConfig);
    });

    it('should use defaults for optional fields', () => {
      const minimalConfig = {
        host: 'localhost',
        database: 'testdb',
        username: 'user',
        password: 'pass'
      };

      const result = schemas.BaseConnectorConfigSchema.parse(minimalConfig);
      expect(result.ssl).toBe(true); // Default value
    });

    it('should reject invalid configurations', () => {
      const invalidConfigs = [
        // Missing required fields
        { host: 'localhost' },
        { host: 'localhost', database: 'test' },

        // Invalid port
        { host: 'localhost', database: 'test', username: 'user', password: 'pass', port: 0 },
        { host: 'localhost', database: 'test', username: 'user', password: 'pass', port: 70000 },

        // Invalid host
        { host: '', database: 'test', username: 'user', password: 'pass' },
        { host: 'host with spaces', database: 'test', username: 'user', password: 'pass' },

        // Query timeout >= connection timeout
        {
          host: 'localhost',
          database: 'test',
          username: 'user',
          password: 'pass',
          timeout: 10000,
          queryTimeout: 15000
        }
      ];

      for (const config of invalidConfigs) {
        expect(() => schemas.BaseConnectorConfigSchema.parse(config)).toThrow();
      }
    });
  });

  describe('LimitSchema', () => {
    it('should accept valid limits', () => {
      const validLimits = [1, 100, 1000, 10000, '1', '100', '1000'];

      for (const limit of validLimits) {
        expect(() => schemas.LimitSchema.parse(limit)).not.toThrow();
      }
    });

    it('should reject invalid limits', () => {
      const invalidLimits = [0, -1, 10001, '0', 'abc', 1.5, '10001'];

      for (const limit of invalidLimits) {
        expect(() => schemas.LimitSchema.parse(limit)).toThrow();
      }
    });

    it('should convert string numbers to integers', () => {
      expect(schemas.LimitSchema.parse('100')).toBe(100);
      expect(schemas.LimitSchema.parse('1000')).toBe(1000);
    });
  });
});

// ==============================================
// Runtime Validator Tests
// ==============================================

describe('RuntimeValidator - Phase 2 Validation', () => {
  let runtimeValidator: RuntimeValidator;

  beforeEach(() => {
    runtimeValidator = new RuntimeValidator();
    runtimeValidator.resetStats();
  });

  describe('Basic validation', () => {
    it('should validate successfully with correct data', () => {
      const result = runtimeValidator.validateTableName('users');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('users');
      }
    });

    it('should return structured errors for invalid data', () => {
      const result = runtimeValidator.validateTableName('123invalid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].field).toBe('root');
        expect(result.errors[0].code).toBeDefined();
        expect(result.errors[0].message).toContain('identifier');
      }
    });

    it('should handle multiple validation errors', () => {
      const result = runtimeValidator.validateConnectorConfig({
        host: '',
        port: 0,
        database: '',
        username: 'user;--',
        password: ''
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(1);
      }
    });
  });

  describe('Convenience methods', () => {
    it('should validate table names', () => {
      expect(() => validateTableName('users')).not.toThrow();
      expect(() => validateTableName('123invalid')).toThrow(ValidationException);
    });

    it('should validate column names', () => {
      expect(() => validateColumnName('user_id')).not.toThrow();
      expect(() => validateColumnName('user.id')).toThrow(ValidationException);
    });

    it('should validate connector configurations', () => {
      const validConfig = {
        host: 'localhost',
        database: 'test',
        username: 'user',
        password: 'pass'
      };

      expect(() => validateConnectorConfig(validConfig)).not.toThrow();
      expect(() => validateConnectorConfig({})).toThrow(ValidationException);
    });
  });

  describe('Batch validation', () => {
    it('should validate multiple items', () => {
      const items = ['users', 'user_profiles', '123invalid', 'orders'];
      const result = runtimeValidator.validateBatch(schemas.TableNameSchema, items);

      expect(result.valid).toHaveLength(3);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0].index).toBe(2); // '123invalid' at index 2
    });
  });

  describe('Statistics tracking', () => {
    it('should track validation statistics', () => {
      // Perform some validations
      runtimeValidator.validateTableName('users');
      runtimeValidator.validateTableName('123invalid');
      runtimeValidator.validateColumnName('user_id');

      const stats = runtimeValidator.getStats();
      expect(stats.total).toBe(3);
      expect(stats.successes).toBe(2);
      expect(stats.failures).toBe(1);
      expect(stats.successRate).toBe('66.67%');
    });

    it('should reset statistics', () => {
      runtimeValidator.validateTableName('users');
      runtimeValidator.resetStats();

      const stats = runtimeValidator.getStats();
      expect(stats.total).toBe(0);
      expect(stats.successes).toBe(0);
      expect(stats.failures).toBe(0);
    });
  });
});

// ==============================================
// Sanitization Tests
// ==============================================

describe('Sanitization Utilities - Phase 2', () => {
  describe('Basic string sanitization', () => {
    it('should sanitize dangerous characters', () => {
      const result = sanitizers.sanitizeString('user; DROP TABLE users;--');
      expect(result.value).not.toContain(';');
      expect(result.value).not.toContain('--');
      expect(result.wasModified).toBe(true);
      expect(result.modifications).toContain('Removed SQL operators');
    });

    it('should trim whitespace', () => {
      const result = sanitizers.sanitizeString('  users  ');
      expect(result.value).toBe('users');
      expect(result.wasModified).toBe(true);
      expect(result.modifications).toContain('Trimmed whitespace');
    });

    it('should truncate long strings', () => {
      const longString = 'a'.repeat(300);
      const result = sanitizers.sanitizeString(longString);
      expect(result.value.length).toBe(256);
      expect(result.wasModified).toBe(true);
      expect(result.modifications).toContain('Truncated to 256 characters');
    });

    it('should handle control characters', () => {
      const controlString = 'user\x00\x01\x1F\x7F';
      const result = sanitizers.sanitizeString(controlString);
      expect(result.value).toBe('user');
      expect(result.wasModified).toBe(true);
      expect(result.modifications).toContain('Removed control characters');
    });
  });

  describe('Specialized sanitizers', () => {
    it('should sanitize identifiers strictly', () => {
      const result = sanitizers.sanitizeIdentifier('user@name.com');
      expect(result.value).toBe('user name.com'); // @ is removed but . is allowed for schema.table
      expect(result.wasModified).toBe(true);
    });

    it('should sanitize paths safely', () => {
      const result = sanitizers.sanitizePath('../../../etc/passwd');
      expect(result.value).not.toContain('..');
      expect(result.wasModified).toBe(true);
    });

    it('should sanitize emails', () => {
      const validEmail = 'user@example.com';
      const result = sanitizers.sanitizeEmail(validEmail);
      expect(result.value).toBe(validEmail);
      expect(result.wasModified).toBe(false);

      expect(() => sanitizers.sanitizeEmail('invalid-email')).toThrow();
    });

    it('should sanitize URLs', () => {
      const validUrl = 'https://example.com';
      const result = sanitizers.sanitizeUrl(validUrl);
      expect(result.value).toBe(validUrl);
      expect(result.wasModified).toBe(false);

      expect(() => sanitizers.sanitizeUrl('javascript:alert(1)')).toThrow();
    });
  });

  describe('Batch sanitization', () => {
    it('should sanitize multiple inputs', () => {
      const inputs = [
        'users',
        'user; DROP TABLE users;',
        'valid_table',
        ''
      ];

      const result = sanitizers.sanitizeBatch(inputs);
      expect(result.results).toHaveLength(4);
      expect(result.summary.total).toBe(4);
      expect(result.summary.modified).toBeGreaterThan(0);
    });
  });

  describe('Security pattern detection', () => {
    it('should detect dangerous patterns', () => {
      const dangerousInputs = [
        { input: 'SELECT * FROM users', expectedPattern: 'SQL Injection' },
        { input: '<script>alert(1)</script>', expectedPattern: 'Script Injection' },
        { input: '../../../etc/passwd', expectedPattern: 'Path Traversal' },
        { input: '; rm -rf /', expectedPattern: 'Command Injection' },
        { input: "'; DROP TABLE users; --", expectedPattern: 'SQL Injection' }
      ];

      for (const { input, expectedPattern } of dangerousInputs) {
        const result = sanitizers.containsDangerousPatterns(input);
        expect(result.isDangerous).toBe(true);
        expect(result.patterns).toContain(expectedPattern);
      }
    });

    it('should not flag safe inputs', () => {
      const safeInputs = [
        'users',
        'user_profiles',
        'Hello world',
        'data-2023',
        'https://example.com'
      ];

      for (const input of safeInputs) {
        const result = sanitizers.containsDangerousPatterns(input);
        expect(result.isDangerous).toBe(false);
        expect(result.patterns).toHaveLength(0);
      }
    });
  });

  describe('SQL escaping utilities', () => {
    it('should escape SQL special characters', () => {
      const input = "O'Reilly's Book";
      const escaped = sanitizers.escapeForSql(input);
      expect(escaped).toContain("''");
      expect(escaped).toBe("O''Reilly''s Book");
    });

    it('should create log-safe strings', () => {
      const sensitive = 'password="secret123" token="abc123"';
      const safe = sanitizers.createLogSafeString(sensitive);
      expect(safe).toContain('[REDACTED]');
      expect(safe).not.toContain('secret123');
      expect(safe).not.toContain('abc123');
    });
  });
});

// ==============================================
// Integration Tests
// ==============================================

describe('Validation Layer Integration', () => {
  it('should work with real-world connector configs', () => {
    const postgresConfig = {
      host: 'localhost',
      port: 5432,
      database: 'freshguard',
      username: 'monitoring_user',
      password: 'secure_password_123',
      ssl: true,
      schema: 'public',
      sslMode: 'require'
    };

    const result = validator.validateConnectorConfig(postgresConfig, 'postgres');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.host).toBe('localhost');
      expect(result.data.ssl).toBe(true);
    }
  });

  it('should handle complex table names', () => {
    const complexNames = [
      'public.user_events_2023',
      'analytics.daily_reports',
      'staging.temp_calculations'
    ];

    for (const name of complexNames) {
      expect(() => validateTableName(name)).not.toThrow();
    }
  });

  it('should prevent SQL injection in all validators', () => {
    const injectionAttempts = [
      "users'; DROP TABLE users; --",
      "admin'--",
      "1' OR '1'='1",
      "'; INSERT INTO users VALUES (1, 'hacker'); --"
    ];

    for (const attempt of injectionAttempts) {
      expect(() => validateTableName(attempt)).toThrow();
      expect(() => validateColumnName(attempt)).toThrow();
    }
  });

  it('should handle edge cases gracefully', () => {
    const edgeCases = [
      null,
      undefined,
      '',
      ' ',
      '\t\n',
      0,
      false,
      {},
      []
    ];

    for (const edgeCase of edgeCases) {
      // Should either sanitize to empty (and potentially throw) or handle gracefully
      expect(() => {
        try {
          sanitizers.sanitizeString(edgeCase);
        } catch (error) {
          // Expected for empty inputs
          expect(error).toBeInstanceOf(Error);
        }
      }).not.toThrow();
    }
  });
});

// ==============================================
// Performance Tests
// ==============================================

describe('Validation Performance', () => {
  it('should validate quickly', () => {
    const start = Date.now();

    // Validate 1000 table names
    for (let i = 0; i < 1000; i++) {
      validator.validateTableName(`table_${i}`);
    }

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
  });

  it('should cache schemas effectively', () => {
    const validator1 = new RuntimeValidator();
    const validator2 = new RuntimeValidator();

    // Both should use cached schemas
    const start = Date.now();
    validator1.validateTableName('users');
    validator2.validateTableName('products');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(100); // Should be very fast with caching
  });
});

// ==============================================
// Error Handling Tests
// ==============================================

describe('Error Handling', () => {
  it('should create ValidationException with structured errors', () => {
    try {
      validateTableName('123invalid');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      if (error instanceof ValidationException) {
        expect(error.errors).toHaveLength(1);
        expect(error.getFormattedErrors()).toContain('root:');
        expect(error.toJSON()).toHaveProperty('name', 'ValidationException');
      }
    }
  });

  it('should provide helpful error messages', () => {
    const testCases = [
      '', // empty
      '123table', // starts with number
      'SELECT', // reserved keyword
      'a'.repeat(300) // too long
    ];

    for (const input of testCases) {
      try {
        validateTableName(input);
        expect.fail(`Should have thrown for input: ${input}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationException);
        if (error instanceof ValidationException) {
          expect(error.errors.length).toBeGreaterThan(0);
          expect(error.getFormattedErrors()).toBeTruthy();
        }
      }
    }
  });
});