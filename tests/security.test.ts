/**
 * Comprehensive Security Tests for FreshGuard Core
 *
 * Tests all security features implemented in the connectors and validation layers:
 * - SQL injection prevention
 * - Input validation
 * - Error sanitization
 * - Timeout protection
 * - Configuration validation
 * - Identifier validation
 */

import { describe, it, expect, vi } from 'vitest';
import { BaseConnector } from '../src/connectors/base-connector.js';
import { PostgresConnector } from '../src/connectors/postgres.js';
import { DuckDBConnector } from '../src/connectors/duckdb.js';
import { BigQueryConnector } from '../src/connectors/bigquery.js';
import { SnowflakeConnector } from '../src/connectors/snowflake.js';
import {
  SecurityError,
  TimeoutError,
  ConnectionError,
  QueryError,
  ConfigurationError,
  ErrorHandler
} from '../src/errors/index.js';
import {
  validateTableName,
  validateColumnName,
  validateConnectorConfig,
  sanitizeString,
  validateLimit,
  validateConnectionString
} from '../src/validators/index.js';
import type { ConnectorConfig } from '../src/types/connector.js';

// Mock connector for testing BaseConnector security features
class MockConnector extends BaseConnector {
  constructor(config: ConnectorConfig) {
    super(config);
  }

  protected async executeQuery(sql: string): Promise<any[]> {
    // Mock implementation for testing
    return [{ result: 'mock' }];
  }

  async testConnection(): Promise<boolean> {
    return true;
  }

  async listTables(): Promise<string[]> {
    return ['mock_table'];
  }

  async getTableSchema(table: string): Promise<any> {
    return { table, columns: [] };
  }

  async close(): Promise<void> {
    // Mock close
  }
}

describe('SQL Injection Prevention', () => {
  const mockConfig: ConnectorConfig = {
    host: 'localhost',
    port: 5432,
    database: 'test',
    username: 'user',
    password: 'pass',
    ssl: true
  };

  let connector: MockConnector;

  beforeEach(() => {
    connector = new MockConnector(mockConfig);
  });

  describe('Query Pattern Validation', () => {
    it('should allow safe SELECT COUNT queries', async () => {
      const sql = 'SELECT COUNT(*) FROM users';
      // This should not throw
      expect(async () => await connector.getRowCount('users')).not.toThrow();
    });

    it('should allow safe MAX/MIN queries', async () => {
      expect(async () => await connector.getMaxTimestamp('users', 'created_at')).not.toThrow();
      expect(async () => await connector.getMinTimestamp('users', 'created_at')).not.toThrow();
    });

    it('should block INSERT statements', () => {
      expect(() => {
        // Access the protected validateQuery method for testing
        (connector as any).validateQuery("INSERT INTO users VALUES ('hacker')");
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).validateQuery("INSERT INTO users VALUES ('hacker')");
      }).toThrow('Blocked keyword detected: INSERT');
    });

    it('should block UPDATE statements', () => {
      expect(() => {
        (connector as any).validateQuery("UPDATE users SET password = 'hacked'");
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).validateQuery("UPDATE users SET password = 'hacked'");
      }).toThrow('Blocked keyword detected: UPDATE');
    });

    it('should block DELETE statements', () => {
      expect(() => {
        (connector as any).validateQuery("DELETE FROM users");
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).validateQuery("DELETE FROM users");
      }).toThrow('Blocked keyword detected: DELETE');
    });

    it('should block DROP statements', () => {
      expect(() => {
        (connector as any).validateQuery("DROP TABLE users");
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).validateQuery("DROP TABLE users");
      }).toThrow('Blocked keyword detected: DROP');
    });

    it('should block ALTER statements', () => {
      expect(() => {
        (connector as any).validateQuery("ALTER TABLE users ADD COLUMN evil TEXT");
      }).toThrow(SecurityError);
    });

    it('should block SQL comments', () => {
      expect(() => {
        (connector as any).validateQuery("SELECT * FROM users -- comment");
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).validateQuery("SELECT * FROM users /* comment */");
      }).toThrow(SecurityError);
    });

    it('should block stored procedures', () => {
      expect(() => {
        (connector as any).validateQuery("EXEC xp_cmdshell 'dir'");
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).validateQuery("EXECUTE sp_configure 'show advanced options'");
      }).toThrow(SecurityError);
    });

    it('should reject unknown query patterns', () => {
      expect(() => {
        (connector as any).validateQuery("GRANT ALL PRIVILEGES ON *.* TO 'user'@'%'");
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).validateQuery("GRANT ALL PRIVILEGES ON *.* TO 'user'@'%'");
      }).toThrow('Query pattern not allowed');
    });
  });

  describe('Identifier Validation', () => {
    it('should allow valid table names', () => {
      expect(() => {
        (connector as any).escapeIdentifier('users');
      }).not.toThrow();

      expect(() => {
        (connector as any).escapeIdentifier('user_sessions');
      }).not.toThrow();

      expect(() => {
        (connector as any).escapeIdentifier('public.users');
      }).not.toThrow();
    });

    it('should reject malicious identifiers with SQL injection', () => {
      expect(() => {
        (connector as any).escapeIdentifier("users; DROP TABLE users; --");
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).escapeIdentifier("users; DROP TABLE users; --");
      }).toThrow('Invalid identifier');
    });

    it('should reject identifiers with quotes', () => {
      expect(() => {
        (connector as any).escapeIdentifier("users' OR '1'='1");
      }).toThrow(SecurityError);
    });

    it('should reject identifiers with parentheses', () => {
      expect(() => {
        (connector as any).escapeIdentifier("users()");
      }).toThrow(SecurityError);
    });

    it('should reject very long identifiers', () => {
      const longName = 'a'.repeat(300);
      expect(() => {
        (connector as any).escapeIdentifier(longName);
      }).toThrow(SecurityError);
      expect(() => {
        (connector as any).escapeIdentifier(longName);
      }).toThrow('Identifier too long');
    });
  });
});

describe('Input Validation', () => {
  describe('Table Name Validation', () => {
    it('should validate correct table names', () => {
      expect(() => validateTableName('users')).not.toThrow();
      expect(() => validateTableName('user_sessions')).not.toThrow();
      expect(() => validateTableName('public.users')).not.toThrow();
      expect(validateTableName('valid_table123')).toBe(true);
    });

    it('should reject empty table names', () => {
      expect(() => validateTableName('')).toThrow('Table name cannot be empty');
    });

    it('should reject table names starting with numbers', () => {
      expect(() => validateTableName('123users')).toThrow('Table name cannot start with a number');
    });

    it('should reject table names with invalid characters', () => {
      expect(() => validateTableName('users-table')).toThrow('Table name contains invalid characters');
      expect(() => validateTableName('users@table')).toThrow('Table name contains invalid characters');
      expect(() => validateTableName('users#table')).toThrow('Table name contains invalid characters');
    });

    it('should reject reserved SQL keywords', () => {
      expect(() => validateTableName('SELECT')).toThrow('reserved SQL keyword');
      expect(() => validateTableName('DROP')).toThrow('reserved SQL keyword');
      expect(() => validateTableName('TABLE')).toThrow('reserved SQL keyword');
    });

    it('should reject very long table names', () => {
      const longName = 'a'.repeat(300);
      expect(() => validateTableName(longName)).toThrow('Table name too long');
    });

    it('should reject non-string input', () => {
      expect(() => validateTableName(null as any)).toThrow('Table name must be a string');
      expect(() => validateTableName(123 as any)).toThrow('Table name must be a string');
    });
  });

  describe('Column Name Validation', () => {
    it('should validate correct column names', () => {
      expect(() => validateColumnName('id')).not.toThrow();
      expect(() => validateColumnName('user_id')).not.toThrow();
      expect(() => validateColumnName('created_at')).not.toThrow();
      expect(validateColumnName('valid_column123')).toBe(true);
    });

    it('should reject column names with dots', () => {
      expect(() => validateColumnName('table.column')).toThrow('Column name contains invalid characters');
    });

    it('should reject column names starting with numbers', () => {
      expect(() => validateColumnName('123column')).toThrow('Column name cannot start with a number');
    });

    it('should reject reserved SQL keywords', () => {
      expect(() => validateColumnName('WHERE')).toThrow('reserved SQL keyword');
      expect(() => validateColumnName('ORDER')).toThrow('reserved SQL keyword');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate complete configuration', () => {
      const validConfig: ConnectorConfig = {
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        password: 'test_password',
        ssl: true
      };

      expect(() => validateConnectorConfig(validConfig)).not.toThrow();
    });

    it('should reject missing required fields', () => {
      expect(() => validateConnectorConfig({})).toThrow('Host is required');
      expect(() => validateConnectorConfig({ host: 'localhost' })).toThrow('Database name is required');
    });

    it('should reject invalid port numbers', () => {
      expect(() => validateConnectorConfig({
        host: 'localhost',
        port: 0,
        database: 'test',
        username: 'user',
        password: 'pass'
      })).toThrow('Port must be between 1 and 65535');

      expect(() => validateConnectorConfig({
        host: 'localhost',
        port: 99999,
        database: 'test',
        username: 'user',
        password: 'pass'
      })).toThrow('Port must be between 1 and 65535');
    });

    it('should reject invalid timeout values', () => {
      expect(() => validateConnectorConfig({
        host: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'pass',
        timeout: 500
      })).toThrow('Timeout must be at least 1000ms');
    });

    it('should reject usernames with injection characters', () => {
      expect(() => validateConnectorConfig({
        host: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user; DROP TABLE users; --',
        password: 'pass'
      })).toThrow('Username contains invalid characters');
    });
  });

  describe('String Sanitization', () => {
    it('should sanitize normal strings', () => {
      expect(sanitizeString('normal_string')).toBe('normal_string');
      expect(sanitizeString('  spaced string  ')).toBe('spaced string');
    });

    it('should remove dangerous characters', () => {
      expect(sanitizeString('string; DROP TABLE')).toBe('string DROP TABLE');
      expect(sanitizeString('string-- comment')).toBe('string comment');
      expect(sanitizeString('string/* comment */')).toBe('string comment ');
    });

    it('should enforce length limits', () => {
      const longString = 'a'.repeat(300);
      expect(() => sanitizeString(longString, 100)).toThrow('Input too long');
    });

    it('should reject empty results after sanitization', () => {
      expect(() => sanitizeString('--;')).toThrow('Input is empty after sanitization');
    });
  });

  describe('LIMIT Validation', () => {
    it('should validate numeric limits', () => {
      expect(validateLimit(100)).toBe(100);
      expect(validateLimit('50')).toBe(50);
    });

    it('should reject invalid limits', () => {
      expect(() => validateLimit(0)).toThrow('LIMIT must be at least 1');
      expect(() => validateLimit(-10)).toThrow('LIMIT must be at least 1');
      expect(() => validateLimit(20000)).toThrow('LIMIT cannot exceed 10000');
      expect(() => validateLimit('invalid')).toThrow('LIMIT must be a valid number');
    });
  });
});

describe('Error Sanitization', () => {
  describe('ErrorHandler', () => {
    it('should sanitize database errors', () => {
      const dbError = new Error('PostgreSQL 13.4 connection failed: permission denied for database "secret_db"');
      const sanitized = ErrorHandler.sanitize(dbError);

      expect(sanitized.message).not.toContain('PostgreSQL 13.4');
      expect(sanitized.message).not.toContain('secret_db');
      expect(sanitized.message).toContain('Connection failed');
    });

    it('should sanitize timeout errors', () => {
      const timeoutError = new Error('Query timeout after 30000ms on table internal_audit_log');
      const sanitized = ErrorHandler.sanitize(timeoutError);

      expect(sanitized.message).not.toContain('internal_audit_log');
      expect(sanitized.message).toContain('timeout');
    });

    it('should return user-safe messages', () => {
      const sensitiveError = new Error('Database "prod_customer_data" connection failed: user "admin" does not have permission');
      const userMessage = ErrorHandler.getUserMessage(sensitiveError);

      expect(userMessage).not.toContain('prod_customer_data');
      expect(userMessage).not.toContain('admin');
      expect(userMessage).toBe('Database connection failed - check configuration');
    });

    it('should handle non-Error objects', () => {
      const weirdError = "string error";
      const sanitized = ErrorHandler.sanitize(weirdError);

      expect(sanitized.message).toBe('Unknown error occurred');
      expect(sanitized.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('Specific Error Types', () => {
    it('should create SecurityError with sanitized details', () => {
      const error = SecurityError.invalidIdentifier('users; DROP TABLE admin');

      expect(error.message).toBe('Invalid identifier: contains unsafe characters');
      expect(error.attemptedAction).toBe('invalid_identifier:25'); // Length only, not content
    });

    it('should create TimeoutError without exposing query details', () => {
      const error = TimeoutError.queryTimeout(30000);

      expect(error.message).toBe('Query timeout after 30000ms - table may be too large or network issue');
      expect(error.operationType).toBe('query');
    });

    it('should create ConnectionError without exposing credentials', () => {
      const error = ConnectionError.authenticationFailed('prod.company.com');

      expect(error.message).toBe('Authentication failed - check credentials and permissions');
      expect(error.host).toBe('prod.company.com');
    });
  });
});

describe('Timeout Protection', () => {
  const mockConfig: ConnectorConfig = {
    host: 'localhost',
    port: 5432,
    database: 'test',
    username: 'user',
    password: 'pass',
    ssl: true,
    timeout: 1000, // Short timeout for testing
    queryTimeout: 500
  };

  it('should timeout long-running operations', async () => {
    const connector = new MockConnector(mockConfig);

    // Mock a slow operation
    const slowOperation = () => new Promise(resolve => setTimeout(resolve, 2000));

    await expect(
      (connector as any).executeWithTimeout(slowOperation, 500)
    ).rejects.toThrow(TimeoutError);
  });

  it('should allow fast operations to complete', async () => {
    const connector = new MockConnector(mockConfig);

    // Mock a fast operation
    const fastOperation = () => Promise.resolve('success');

    const result = await (connector as any).executeWithTimeout(fastOperation, 500);
    expect(result).toBe('success');
  });
});

describe('Database-Specific Security Features', () => {
  describe('DuckDB Path Validation', () => {
    it('should prevent directory traversal attacks', () => {
      expect(() => new DuckDBConnector({
        host: 'localhost',
        port: 0,
        database: '../../../etc/passwd',
        username: 'user',
        password: 'pass',
        ssl: false
      })).toThrow('Database path cannot contain directory traversal patterns');
    });

    it('should prevent access to system directories', () => {
      const systemPaths = ['/etc/shadow', '/var/log/secure', '/proc/meminfo'];

      for (const path of systemPaths) {
        expect(() => new DuckDBConnector({
          host: 'localhost',
          port: 0,
          database: path,
          username: 'user',
          password: 'pass',
          ssl: false
        })).toThrow('Database path cannot access system directories');
      }
    });

    it('should allow safe paths', () => {
      expect(() => new DuckDBConnector({
        host: 'localhost',
        port: 0,
        database: '/tmp/safe_database.duckdb',
        username: 'user',
        password: 'pass',
        ssl: false
      })).not.toThrow();
    });
  });

  describe('BigQuery Project ID Validation', () => {
    it('should validate project ID format', () => {
      expect(() => new BigQueryConnector({
        host: 'bigquery.googleapis.com',
        port: 443,
        database: 'Invalid_Project-123!',
        username: 'bigquery',
        password: '{"type": "service_account"}',
        ssl: true
      })).toThrow('Invalid BigQuery project ID format');
    });

    it('should validate service account format', () => {
      expect(() => new BigQueryConnector({
        host: 'bigquery.googleapis.com',
        port: 443,
        database: 'valid-project-123',
        username: 'bigquery',
        password: '{"type": "invalid_account"}',
        ssl: true
      })).toThrow('Invalid service account credentials format');
    });
  });

  describe('Snowflake Host Validation', () => {
    it('should require proper host format', () => {
      expect(() => new SnowflakeConnector({
        host: 'invalid-host.com',
        port: 443,
        database: 'TEST_DB',
        username: 'user',
        password: 'pass',
        ssl: true
      })).toThrow('Invalid Snowflake host format');
    });

    it('should extract account from host', () => {
      const connector = new SnowflakeConnector({
        host: 'mycompany.snowflakecomputing.com',
        port: 443,
        database: 'TEST_DB',
        username: 'user',
        password: 'pass',
        ssl: true
      });

      expect(connector.getAccount()).toBe('mycompany');
    });
  });
});

describe('Result Size Validation', () => {
  const mockConfig: ConnectorConfig = {
    host: 'localhost',
    port: 5432,
    database: 'test',
    username: 'user',
    password: 'pass',
    ssl: true,
    maxRows: 100
  };

  it('should validate result size limits', () => {
    const connector = new MockConnector(mockConfig);

    // Create a large result set
    const largeResults = new Array(150).fill({ id: 1, name: 'test' });

    expect(() => {
      (connector as any).validateResultSize(largeResults);
    }).toThrow('Query returned too many rows (max 100)');
  });

  it('should allow results within limits', () => {
    const connector = new MockConnector(mockConfig);

    // Create a small result set
    const smallResults = new Array(50).fill({ id: 1, name: 'test' });

    expect(() => {
      (connector as any).validateResultSize(smallResults);
    }).not.toThrow();
  });
});

describe('Legacy API Security', () => {
  it('should maintain security even with legacy methods', () => {
    const config: ConnectorConfig = {
      host: 'localhost',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'pass',
      ssl: true
    };

    const connector = new PostgresConnector(config);

    // Legacy query method should still block direct SQL
    expect(() => connector.query('DROP TABLE users')).toThrow(
      'Direct SQL queries are not allowed for security reasons'
    );
  });

  it('should show deprecation warnings for legacy methods', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config: ConnectorConfig = {
      host: 'localhost',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'pass',
      ssl: true
    };

    const connector = new PostgresConnector(config);

    // Using legacy method should show warning
    expect(async () => {
      await connector.connectLegacy({
        host: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'pass'
      });
    }).not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: connectLegacy is deprecated')
    );

    consoleSpy.mockRestore();
  });
});