/**
 * Tests for metadata storage error handling
 *
 * Tests the MetadataStorageError class that provides:
 * - Structured error handling for metadata operations
 * - Error message sanitization for security
 * - Operation context for debugging
 * - Static factory methods for common scenarios
 */

import { describe, it, expect } from 'vitest';
import { MetadataStorageError, ErrorHandler } from '../../src/errors/index.js';

describe('MetadataStorageError', () => {
  describe('Constructor and Basic Properties', () => {
    it('should create error with basic properties', () => {
      const error = new MetadataStorageError(
        'Test error message',
        'testOperation',
        { key: 'value' }
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MetadataStorageError);
      expect(error.name).toBe('MetadataStorageError');
      expect(error.code).toBe('METADATA_STORAGE_FAILED');
      expect(error.operation).toBe('testOperation');
      expect(error.sanitized).toBe(true);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should sanitize error messages', () => {
      const error = new MetadataStorageError(
        'Connection failed to postgres://user:secret@host:5432/db'
      );

      // Should not contain the original message with credentials
      expect(error.message).not.toContain('secret');
      expect(error.message).not.toContain('user:secret');
      expect(error.message).toBe('Metadata storage connection failed');
    });

    it('should sanitize context to remove sensitive information', () => {
      const sensitiveContext = {
        operation: 'connect',
        ruleId: 'rule-123',
        connectionString: 'postgres://user:secret@host/db',
        credentials: { username: 'user', password: 'secret' },
        duration: 1500,
      };

      const error = new MetadataStorageError(
        'Test error',
        'connect',
        sensitiveContext
      );

      // Should only include safe context keys
      expect(error.context).toEqual({
        operation: 'connect',
        ruleId: 'rule-123',
        duration: 1500,
      });
      expect(error.context).not.toHaveProperty('connectionString');
      expect(error.context).not.toHaveProperty('credentials');
    });
  });

  describe('Error Message Sanitization', () => {
    it('should sanitize connection errors', () => {
      const connectionErrors = [
        'Connection failed to database',
        'Could not connect to server',
        'Database connection timeout',
      ];

      connectionErrors.forEach(message => {
        const error = new MetadataStorageError(message);
        expect(error.message).toBe('Metadata storage connection failed');
      });
    });

    it('should sanitize permission errors', () => {
      const permissionErrors = [
        'Permission denied for table users',
        'Access denied to database freshguard',
        'Insufficient privileges',
      ];

      permissionErrors.forEach(message => {
        const error = new MetadataStorageError(message);
        expect(error.message).toBe('Insufficient permissions for metadata storage operation');
      });
    });

    it('should sanitize table existence errors', () => {
      const tableErrors = [
        'Table "checkExecutions" does not exist',
        'Relation "monitoring_rules" not found',
      ];

      tableErrors.forEach(message => {
        const error = new MetadataStorageError(message);
        expect(error.message).toBe('Metadata storage not properly initialized');
      });
    });

    it('should sanitize timeout errors', () => {
      const timeoutErrors = [
        'Query timeout after 30 seconds',
        'Connection timeout',
        'Operation timed out',
      ];

      timeoutErrors.forEach(message => {
        const error = new MetadataStorageError(message);
        expect(error.message).toBe('Metadata storage operation timeout');
      });
    });

    it('should sanitize disk space errors', () => {
      const diskErrors = [
        'No space left on device',
        'Disk full error',
        'Out of disk space',
      ];

      diskErrors.forEach(message => {
        const error = new MetadataStorageError(message);
        expect(error.message).toBe('Metadata storage disk space issue');
      });
    });

    it('should sanitize lock errors', () => {
      const lockErrors = [
        'Lock timeout exceeded',
        'Deadlock detected',
        'Could not acquire lock',
      ];

      lockErrors.forEach(message => {
        const error = new MetadataStorageError(message);
        expect(error.message).toBe('Metadata storage lock contention');
      });
    });

    it('should provide generic message for unknown errors', () => {
      const unknownErrors = [
        'Unexpected internal error',
        'Something went wrong',
        '',
      ];

      unknownErrors.forEach(message => {
        const error = new MetadataStorageError(message);
        expect(error.message).toBe('Metadata storage operation failed');
      });
    });
  });

  describe('Static Factory Methods', () => {
    it('should create initialization failed errors', () => {
      const error = MetadataStorageError.initializationFailed('Database schema missing');

      expect(error.operation).toBe('initialize');
      expect(error.context).toEqual({ phase: 'initialization' });
      expect(error.message).toContain('failed');
    });

    it('should create initialization failed errors without reason', () => {
      const error = MetadataStorageError.initializationFailed();

      expect(error.operation).toBe('initialize');
      expect(error.message).toBe('Metadata storage initialization failed');
    });

    it('should create save execution failed errors', () => {
      const error = MetadataStorageError.saveExecutionFailed('rule-123');

      expect(error.operation).toBe('saveExecution');
      expect(error.context).toEqual({ ruleId: 'rule-123' });
      expect(error.message).toBe('Failed to save check execution result');
    });

    it('should create get historical data failed errors', () => {
      const originalError = new Error('Database connection lost');
      const error = MetadataStorageError.getHistoricalDataFailed('rule-456', 30, originalError);

      expect(error.operation).toBe('getHistoricalData');
      expect(error.context).toEqual({ ruleId: 'rule-456', windowDays: 30 });
      expect(error.message).toBe('Failed to retrieve historical execution data');
    });

    it('should create save rule failed errors', () => {
      const error = MetadataStorageError.saveRuleFailed('rule-789');

      expect(error.operation).toBe('saveRule');
      expect(error.context).toEqual({ ruleId: 'rule-789' });
      expect(error.message).toBe('Failed to save monitoring rule');
    });

    it('should create get rule failed errors', () => {
      const error = MetadataStorageError.getRuleFailed('rule-999');

      expect(error.operation).toBe('getRule');
      expect(error.context).toEqual({ ruleId: 'rule-999' });
      expect(error.message).toBe('Failed to retrieve monitoring rule');
    });

    it('should create connection failed errors', () => {
      const originalError = new Error('ECONNREFUSED');
      const error = MetadataStorageError.connectionFailed(originalError);

      expect(error.operation).toBe('connect');
      expect(error.message).toBe('Metadata storage connection failed');
    });

    it('should create migration failed errors', () => {
      const error = MetadataStorageError.migrationFailed('v2.1.0');

      expect(error.operation).toBe('migrate');
      expect(error.context).toEqual({ version: 'v2.1.0' });
      expect(error.message).toBe('Database migration failed');
    });

    it('should create migration failed errors without version', () => {
      const error = MetadataStorageError.migrationFailed();

      expect(error.operation).toBe('migrate');
      expect(error.context).toEqual({ version: undefined });
    });
  });

  describe('Context Sanitization', () => {
    it('should include safe context keys', () => {
      const safeContext = {
        operation: 'test',
        ruleId: 'rule-123',
        table: 'users',
        recordCount: 1000,
        duration: 500,
      };

      const error = new MetadataStorageError('Test', 'test', safeContext);

      expect(error.context).toEqual(safeContext);
    });

    it('should exclude sensitive context keys', () => {
      const mixedContext = {
        operation: 'connect',
        ruleId: 'rule-123',
        connectionString: 'postgres://user:pass@host/db',
        password: 'secret',
        credentials: { user: 'admin' },
        url: 'https://db.example.com',
        token: 'abc123',
        duration: 1000,
      };

      const error = new MetadataStorageError('Test', 'connect', mixedContext);

      expect(error.context).toEqual({
        operation: 'connect',
        ruleId: 'rule-123',
        duration: 1000,
      });
    });

    it('should return undefined for context with no safe keys', () => {
      const unsafeContext = {
        password: 'secret',
        connectionString: 'postgres://user:pass@host/db',
        credentials: { user: 'admin' },
      };

      const error = new MetadataStorageError('Test', 'test', unsafeContext);

      expect(error.context).toBeUndefined();
    });

    it('should handle null and undefined context', () => {
      const errorWithUndefined = new MetadataStorageError('Test', 'test', undefined);
      const errorWithNull = new MetadataStorageError('Test', 'test', null as any);

      expect(errorWithUndefined.context).toBeUndefined();
      expect(errorWithNull.context).toBeUndefined();
    });
  });

  describe('JSON Serialization', () => {
    it('should serialize to JSON correctly', () => {
      const error = new MetadataStorageError(
        'Test error',
        'testOperation',
        { ruleId: 'rule-123' }
      );

      const json = error.toJSON();

      expect(json).toEqual({
        name: 'MetadataStorageError',
        message: error.message,
        code: 'METADATA_STORAGE_FAILED',
        timestamp: error.timestamp.toISOString(),
        sanitized: true,
      });
    });
  });

  describe('Integration with ErrorHandler', () => {
    it('should be properly handled by ErrorHandler.sanitize', () => {
      const originalError = new MetadataStorageError('Test error', 'test');
      const sanitized = ErrorHandler.sanitize(originalError);

      expect(sanitized).toBe(originalError); // Should return same instance
      expect(sanitized).toBeInstanceOf(MetadataStorageError);
    });

    it('should provide correct user message through ErrorHandler', () => {
      const error = new MetadataStorageError('Internal error details', 'test');
      const userMessage = ErrorHandler.getUserMessage(error);

      expect(userMessage).toBe(error.message);
      expect(userMessage).not.toContain('Internal error details');
    });

    it('should provide correct error code through ErrorHandler', () => {
      const error = new MetadataStorageError('Test error', 'test');
      const errorCode = ErrorHandler.getErrorCode(error);

      expect(errorCode).toBe('METADATA_STORAGE_FAILED');
    });
  });

  describe('Error Factory Functions', () => {
    it('should be available through createError factory', async () => {
      const { createError } = await import('../../src/errors/index.js');

      expect(typeof createError.metadata.initializationFailed).toBe('function');
      expect(typeof createError.metadata.saveExecutionFailed).toBe('function');
      expect(typeof createError.metadata.getHistoricalDataFailed).toBe('function');
      expect(typeof createError.metadata.saveRuleFailed).toBe('function');
      expect(typeof createError.metadata.getRuleFailed).toBe('function');
      expect(typeof createError.metadata.connectionFailed).toBe('function');
      expect(typeof createError.metadata.migrationFailed).toBe('function');
    });

    it('should create correct errors through factory', async () => {
      const { createError } = await import('../../src/errors/index.js');

      const initError = createError.metadata.initializationFailed('Schema missing');
      expect(initError).toBeInstanceOf(MetadataStorageError);
      expect(initError.operation).toBe('initialize');

      const saveError = createError.metadata.saveExecutionFailed('rule-123');
      expect(saveError).toBeInstanceOf(MetadataStorageError);
      expect(saveError.operation).toBe('saveExecution');
    });
  });
});