/**
 * Tests for debug-enhanced freshness monitoring
 *
 * Tests the enhanced checkFreshness function including:
 * - Debug mode configuration and environment detection
 * - Enhanced error handling with debug information
 * - Query context preservation and logging
 * - Raw error exposure in development mode
 * - Actionable error suggestions
 * - Security preservation in production mode
 */

import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { checkFreshness } from '../../src/monitor/freshness.js';
import { DebugErrorFactory, mergeDebugConfig } from '../../src/errors/debug-factory.js';
import type { MonitoringRule, FreshGuardConfig, DebugConfig } from '../../src/types.js';
import type { Database } from '../../src/db/index.js';
import type { MetadataStorage } from '../../src/metadata/interface.js';
import { QueryError, ConnectionError } from '../../src/errors/index.js';

// Mock console methods
const originalConsole = { ...console };
beforeEach(() => {
  console.log = vi.fn();
  console.error = vi.fn();
  console.warn = vi.fn();
});

afterEach(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
});

// Mock database
const mockDb = {
  execute: vi.fn(),
} as Database;

// Mock metadata storage
const mockMetadataStorage: MetadataStorage = {
  initialize: vi.fn(),
  saveExecution: vi.fn(),
  getHistoricalData: vi.fn(),
  saveRule: vi.fn(),
  getRule: vi.fn(),
  close: vi.fn(),
};

// Mock performance for testing
global.performance = {
  now: vi.fn(() => 100),
} as any;

// Mock validators
vi.mock('../../src/validators/index.js', () => ({
  validateTableName: vi.fn(),
  validateColumnName: vi.fn(),
}));

// Base rule for testing
const baseRule: MonitoringRule = {
  id: 'test-freshness-rule',
  sourceId: 'test-source',
  name: 'Freshness Test Rule',
  tableName: 'orders',
  ruleType: 'freshness',
  checkIntervalMinutes: 60,
  timestampColumn: 'created_at',
  toleranceMinutes: 30,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('Debug-Enhanced Freshness Monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockDb.execute as MockedFunction<any>).mockReset();
    (mockMetadataStorage.saveExecution as MockedFunction<any>).mockResolvedValue(undefined);
  });

  describe('Debug Configuration', () => {
    it('should auto-detect development mode from NODE_ENV', () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const config = mergeDebugConfig();

      expect(config.enabled).toBe(true);
      expect(config.exposeQueries).toBe(true);
      expect(config.exposeRawErrors).toBe(true);

      process.env.NODE_ENV = oldEnv;
    });

    it('should auto-detect debug mode from FRESHGUARD_DEBUG', () => {
      const oldDebug = process.env.FRESHGUARD_DEBUG;
      process.env.FRESHGUARD_DEBUG = 'true';

      const config = mergeDebugConfig();

      expect(config.enabled).toBe(true);

      process.env.FRESHGUARD_DEBUG = oldDebug;
    });

    it('should use production defaults in production', () => {
      const oldEnv = process.env.NODE_ENV;
      const oldDebug = process.env.FRESHGUARD_DEBUG;
      process.env.NODE_ENV = 'production';
      delete process.env.FRESHGUARD_DEBUG;

      const config = mergeDebugConfig();

      expect(config.enabled).toBe(false);
      expect(config.exposeQueries).toBe(false);
      expect(config.exposeRawErrors).toBe(false);

      process.env.NODE_ENV = oldEnv;
      if (oldDebug !== undefined) {
        process.env.FRESHGUARD_DEBUG = oldDebug;
      }
    });

    it('should merge user config with defaults', () => {
      const userConfig: DebugConfig = {
        enabled: true,
        exposeQueries: false, // User wants debug but not query exposure
        logLevel: 'warn'
      };

      const config = mergeDebugConfig(userConfig);

      expect(config.enabled).toBe(true);
      expect(config.exposeQueries).toBe(false); // User preference
      expect(config.exposeRawErrors).toBe(true); // Should default to true when enabled is true
      expect(config.logLevel).toBe('warn'); // User preference
    });
  });

  describe('Debug Information in Results', () => {
    it('should include debug ID in failed results when debug enabled', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock database error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('relation "orders" does not exist')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.status).toBe('failed');
      expect(result.debugId).toBeDefined();
      expect(result.debugId).toMatch(/^fg-/);
    });

    it('should include query in debug info when exposeQueries is true', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock database error to trigger debug path
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('column "created_at" does not exist')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.query).toContain('SELECT');
      expect(result.debug?.query).toContain('COUNT(*)');
      expect(result.debug?.query).toContain('MAX(created_at)');
      expect(result.debug?.query).toContain('FROM orders');
    });

    it('should include raw error when exposeRawErrors is true', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock database error
      const originalError = new Error('column "created_at" does not exist');
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(originalError);

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.rawError).toBe('column "created_at" does not exist');
    });

    it('should hide sensitive info when exposeRawErrors is false', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: false }
      };

      // Mock database error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('password authentication failed for user "admin"')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.rawError).toBeUndefined();
    });

    it('should not include debug info when debug is disabled', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: false }
      };

      // Mock database error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('some database error')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug).toBeUndefined();
    });
  });

  describe('Error Suggestions', () => {
    it('should provide table existence suggestion', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock table not found error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('relation "orders" does not exist')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.suggestion).toContain("Table 'orders' does not exist");
      expect(result.debug?.suggestion).toContain('Verify table name and database schema');
    });

    it('should provide column existence suggestion', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock column not found error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('column "created_at" does not exist')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.suggestion).toContain("Column 'created_at' not found");
      expect(result.debug?.suggestion).toContain('DESCRIBE orders');
    });

    it('should provide permission suggestion', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock permission denied error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('permission denied for table orders')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.suggestion).toContain("Access denied to table 'orders'");
      expect(result.debug?.suggestion).toContain('GRANT SELECT ON orders');
    });

    it('should provide syntax error suggestion', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock syntax error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('syntax error at or near "SELECT"')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.suggestion).toContain('SQL syntax error');
      expect(result.debug?.suggestion).toContain('special characters');
    });
  });

  describe('Query Context Preservation', () => {
    it('should include query duration in debug info', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock performance.now to return different values
      (performance.now as any)
        .mockReturnValueOnce(100) // Start time
        .mockReturnValueOnce(150); // End time

      // Mock database error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('some error')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.duration).toBe(50); // 150 - 100
    });

    it('should include context information', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      // Mock database error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('some error')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      expect(result.debug?.context?.table).toBe('orders');
      expect(result.debug?.context?.column).toBe('created_at');
      expect(result.debug?.context?.operation).toBe('freshness_query');
    });
  });

  describe('Debug Logging', () => {
    it('should log query execution in debug mode', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true }
      };

      // Mock successful query
      (mockDb.execute as MockedFunction<any>).mockResolvedValue([
        { row_count: '100', last_update: new Date() }
      ]);

      await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      // Check that console.log was called with debug information
      const calls = (console.log as MockedFunction<any>).mock.calls;
      console.error('DEBUG: All console.log calls:', calls.map(c => c[0]));

      const debugCall = calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('[DEBUG-')
      );

      expect(debugCall).toBeDefined();
      if (debugCall) {
        console.error('DEBUG: Found debug call:', debugCall);
        expect(debugCall[1]).toMatchObject({
          table: 'orders',
          ruleId: 'test-freshness-rule'
        });
      }
    });

    it('should hide query in logs when exposeQueries is false', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: false }
      };

      // Mock database error to trigger logging
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('some error')
      );

      await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      // Should have debug logs but without actual SQL
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]'),
        expect.objectContaining({
          query: '[SQL hidden]'
        })
      );
    });

    it('should log detailed error information in debug mode', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeRawErrors: true }
      };

      // Mock database error
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('connection refused')
      );

      await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      // Check that console.error was called with debug information
      const calls = (console.error as MockedFunction<any>).mock.calls;
      console.warn('DEBUG: All console.error calls:', calls.map(c => c[0]));

      const debugCall = calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('[DEBUG-')
      );

      expect(debugCall).toBeDefined();
      if (debugCall) {
        console.warn('DEBUG: Found error debug call:', debugCall);
        expect(debugCall[1]).toMatchObject({
          table: 'orders',
          ruleId: 'test-freshness-rule'
        });
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should work without config parameter (production mode)', async () => {
      // Mock successful query
      (mockDb.execute as MockedFunction<any>).mockResolvedValue([
        { row_count: '100', last_update: new Date() }
      ]);

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage);

      expect(result.status).toBe('ok');
      expect(result.debug).toBeUndefined();
      expect(result.debugId).toBeUndefined();
    });

    it('should work with empty config object', async () => {
      // Mock successful query
      (mockDb.execute as MockedFunction<any>).mockResolvedValue([
        { row_count: '100', last_update: new Date() }
      ]);

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, {});

      expect(result.status).toBe('ok');
      expect(result.debug).toBeUndefined();
    });
  });

  describe('Security Preservation', () => {
    it('should still sanitize error messages in debug mode', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: false, exposeRawErrors: false }
      };

      // Mock database error with sensitive information
      (mockDb.execute as MockedFunction<any>).mockRejectedValue(
        new Error('password authentication failed for user "admin" database "secret_db"')
      );

      const result = await checkFreshness(mockDb, baseRule, mockMetadataStorage, config);

      // Main error should be sanitized
      expect(result.error).not.toContain('admin');
      expect(result.error).not.toContain('secret_db');

      // Raw error should not be exposed when disabled
      expect(result.debug?.rawError).toBeUndefined();
    });

    it('should maintain input validation in debug mode', async () => {
      const config: FreshGuardConfig = {
        debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
      };

      const invalidRule = {
        ...baseRule,
        toleranceMinutes: 999999 // Invalid value
      };

      // The validation error is caught and returned as a failed result
      const result = await checkFreshness(mockDb, invalidRule, mockMetadataStorage, config);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Tolerance minutes must be between 1 and 10080');
    });
  });
});

describe('DebugErrorFactory', () => {
  describe('Error Creation', () => {
    it('should create query error with debug information', () => {
      const debugConfig = { enabled: true, exposeQueries: true, exposeRawErrors: true };
      const factory = new DebugErrorFactory(debugConfig);

      const error = factory.createQueryError(
        'Test query failed',
        new Error('column does not exist'),
        {
          sql: 'SELECT * FROM test',
          table: 'test',
          column: 'id',
          operation: 'test'
        }
      );

      expect(error).toBeInstanceOf(QueryError);
      expect(error.debug?.query).toBe('SELECT * FROM test');
      expect(error.debug?.rawError).toBe('column does not exist');
      expect(error.debug?.suggestion).toContain("Column 'id' not found");
    });

    it('should not include debug info when disabled', () => {
      const debugConfig = { enabled: false };
      const factory = new DebugErrorFactory(debugConfig);

      const error = factory.createQueryError(
        'Test query failed',
        new Error('some error'),
        { sql: 'SELECT * FROM test' }
      );

      expect(error.debug).toBeUndefined();
    });
  });

  describe('Connection Error Enhancement', () => {
    it('should create connection error with debug suggestions', () => {
      const debugConfig = { enabled: true, exposeRawErrors: true };
      const factory = new DebugErrorFactory(debugConfig);

      const error = factory.createConnectionError(
        'Connection failed',
        'localhost',
        5432,
        new Error('connection refused')
      );

      expect(error).toBeInstanceOf(ConnectionError);
      expect(error.debug?.suggestion).toContain('localhost:5432');
      expect(error.debug?.suggestion).toContain('not accepting connections');
    });
  });
});