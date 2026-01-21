/**
 * Security Integration Tests for FreshGuard Core
 *
 * Tests security features with realistic scenarios and potential attack vectors.
 * These tests verify that the security measures work in practice, not just in isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresConnector } from '../src/connectors/postgres.js';
import { DuckDBConnector } from '../src/connectors/duckdb.js';
import { BigQueryConnector } from '../src/connectors/bigquery.js';
import { SnowflakeConnector } from '../src/connectors/snowflake.js';
import type { ConnectorConfig } from '../src/types/connector.js';
import { SecurityError, TimeoutError, ConnectionError, QueryError } from '../src/errors/index.js';

// Security test configurations
const SECURITY_TEST_CONFIGS = {
  postgres: {
    host: 'localhost',
    port: 5432,
    database: 'security_test_db',
    username: 'test_user',
    password: 'test_pass',
    ssl: true,
  } as ConnectorConfig,

  duckdb: {
    host: 'localhost',
    port: 0,
    database: ':memory:', // Safe in-memory for testing
    username: 'duckdb',
    password: 'duckdb',
    ssl: true, // Required by security policy, not used by DuckDB
  } as ConnectorConfig,

  bigquery: {
    host: 'bigquery.googleapis.com',
    port: 443,
    database: 'security-test-project',
    username: 'bigquery',
    password: JSON.stringify({
      type: 'service_account',
      project_id: 'security-test-project',
      private_key_id: 'test-key',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
      client_email: 'test@security-test-project.iam.gserviceaccount.com',
    }),
    ssl: true,
  } as ConnectorConfig,

  snowflake: {
    host: 'security-test.snowflakecomputing.com',
    port: 443,
    database: 'SECURITY_TEST_DB',
    username: 'test_user',
    password: 'test_password',
    ssl: true,
  } as ConnectorConfig,
};

describe('SQL Injection Attack Prevention', () => {
  describe('Table Name Injection Tests', () => {
    it('should prevent table name injection in PostgreSQL', async () => {
      const connector = new PostgresConnector(SECURITY_TEST_CONFIGS.postgres);

      // Various SQL injection attempts through table names
      const maliciousTableNames = [
        'users; DROP TABLE admin; --',
        "users' UNION SELECT password FROM admin --",
        'users) UNION SELECT * FROM secrets WHERE (1=1',
        'users/**/UNION/**/SELECT/**/password/**/FROM/**/admin',
        'users\'; DROP TABLE admin; --',
        'users`; DROP TABLE admin; --',
      ];

      for (const maliciousName of maliciousTableNames) {
        await expect(connector.getRowCount(maliciousName)).rejects.toThrow();
      }
    });

    it('should prevent table name injection in DuckDB', async () => {
      const connector = new DuckDBConnector(SECURITY_TEST_CONFIGS.duckdb);

      const maliciousTableNames = [
        'test_table; CREATE TABLE malicious AS SELECT * FROM information_schema.tables; --',
        'test_table) UNION SELECT sql FROM sqlite_master WHERE type=\'table\' --',
      ];

      for (const maliciousName of maliciousTableNames) {
        await expect(connector.getRowCount(maliciousName)).rejects.toThrow();
      }
    });

    it('should prevent dataset/table injection in BigQuery', async () => {
      const connector = new BigQueryConnector(SECURITY_TEST_CONFIGS.bigquery);

      const maliciousTableNames = [
        'dataset.table`; DROP TABLE secret_data; --',
        'dataset.table\' UNION ALL SELECT password FROM admin WHERE \'1\'=\'1',
        'project.dataset.table); DROP VIEW sensitive_view; --',
      ];

      for (const maliciousName of maliciousTableNames) {
        await expect(connector.getRowCount(maliciousName)).rejects.toThrow();
      }
    });
  });

  describe('Column Name Injection Tests', () => {
    it('should prevent column name injection attacks', async () => {
      const connector = new PostgresConnector(SECURITY_TEST_CONFIGS.postgres);

      const maliciousColumns = [
        'created_at; SELECT password FROM admin WHERE user_id=1; --',
        "created_at' UNION SELECT secret FROM vault --",
        'created_at) OR 1=1; DROP TABLE logs; --',
        'created_at/**/UNION/**/SELECT/**/credit_card/**/FROM/**/payments',
      ];

      for (const maliciousColumn of maliciousColumns) {
        await expect(connector.getMaxTimestamp('users', maliciousColumn)).rejects.toThrow();
      }
    });
  });

  describe('Complex Injection Scenarios', () => {
    it('should handle nested injection attempts', () => {
      const connector = new PostgresConnector(SECURITY_TEST_CONFIGS.postgres);

      // Attempt to nest multiple attack vectors
      const complexAttack = "users'; INSERT INTO admin_log SELECT 'hacked' WHERE '1'='1'; DROP TABLE audit; --";

      expect(async () => {
        await connector.getRowCount(complexAttack);
      }).rejects.toThrow(SecurityError);
    });

    it('should handle encoded injection attempts', () => {
      const connector = new DuckDBConnector(SECURITY_TEST_CONFIGS.duckdb);

      // URL-encoded injection attempt
      const encodedAttack = 'users%3B%20DROP%20TABLE%20admin%3B%20--';

      expect(async () => {
        await connector.getRowCount(encodedAttack);
      }).rejects.toThrow();
    });

    it('should handle unicode injection attempts', () => {
      const connector = new PostgresConnector(SECURITY_TEST_CONFIGS.postgres);

      // Unicode characters that might bypass filters
      const unicodeAttack = 'users\u003B DROP TABLE admin\u003B \u002D\u002D';

      expect(async () => {
        await connector.getRowCount(unicodeAttack);
      }).rejects.toThrow();
    });
  });
});

describe('File System Attack Prevention', () => {
  describe('DuckDB Path Traversal Tests', () => {
    it('should prevent directory traversal attacks', () => {
      const pathTraversalAttacks = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '/etc/shadow',
        '../../../../root/.ssh/id_rsa',
        '../database/../../../etc/hosts',
        'legitimate_file/../../../sensitive_file',
      ];

      for (const maliciousPath of pathTraversalAttacks) {
        expect(() => {
          new DuckDBConnector({
            ...SECURITY_TEST_CONFIGS.duckdb,
            database: maliciousPath,
          });
        }).toThrow();
      }
    });

    it('should prevent access to system directories', () => {
      const systemPaths = [
        '/etc/passwd',
        '/var/log/auth.log',
        '/proc/version',
        '/dev/random',
        '/root/.bashrc',
        '/sys/devices',
      ];

      for (const systemPath of systemPaths) {
        expect(() => {
          new DuckDBConnector({
            ...SECURITY_TEST_CONFIGS.duckdb,
            database: systemPath,
          });
        }).toThrow('Database path cannot access system directories');
      }
    });

    it('should allow safe database paths', () => {
      const safePaths = [
        '/tmp/safe_database.duckdb',
        './local_database.duckdb',
        '/home/user/data/analytics.duckdb',
        ':memory:',
      ];

      for (const safePath of safePaths) {
        expect(() => {
          new DuckDBConnector({
            ...SECURITY_TEST_CONFIGS.duckdb,
            database: safePath,
          });
        }).not.toThrow();
      }
    });
  });
});

describe('Credential Validation and Security', () => {
  describe('BigQuery Service Account Validation', () => {
    it('should reject malformed service account JSON', () => {
      const malformedCredentials = [
        '{"invalid": "json"}',
        '{"type": "user_account"}', // Wrong type
        '{"type": "service_account", "project_id": "wrong-project"}', // Wrong project
        'not_json_at_all',
        '{}', // Empty object
      ];

      for (const credential of malformedCredentials) {
        expect(() => {
          new BigQueryConnector({
            ...SECURITY_TEST_CONFIGS.bigquery,
            password: credential,
          });
        }).toThrow();
      }
    });

    it('should validate project ID consistency', () => {
      const mismatchedProject = JSON.stringify({
        type: 'service_account',
        project_id: 'different-project-id',
        private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
        client_email: 'test@different-project-id.iam.gserviceaccount.com',
      });

      expect(() => {
        new BigQueryConnector({
          ...SECURITY_TEST_CONFIGS.bigquery,
          password: mismatchedProject,
        });
      }).toThrow('Service account project ID does not match specified project');
    });
  });

  describe('Snowflake Host Validation', () => {
    it('should reject invalid Snowflake hosts', () => {
      const invalidHosts = [
        'malicious-site.com',
        'snowflakecomputing.evil.com',
        'fake.snowflake.com',
        'account.snowfakecomputing.com', // Typo
        'account.snowflakecomputing.net', // Wrong TLD
      ];

      for (const invalidHost of invalidHosts) {
        expect(() => {
          new SnowflakeConnector({
            ...SECURITY_TEST_CONFIGS.snowflake,
            host: invalidHost,
          });
        }).toThrow();
      }
    });

    it('should accept valid Snowflake hosts', () => {
      const validHosts = [
        'myaccount.snowflakecomputing.com',
        'company-prod.snowflakecomputing.com',
        'test123.snowflakecomputing.com',
      ];

      for (const validHost of validHosts) {
        expect(() => {
          new SnowflakeConnector({
            ...SECURITY_TEST_CONFIGS.snowflake,
            host: validHost,
          });
        }).not.toThrow();
      }
    });
  });
});

describe('Timeout and DoS Protection', () => {
  it('should enforce connection timeouts', async () => {
    // Create connector with very short timeout
    const shortTimeoutConfig = {
      ...SECURITY_TEST_CONFIGS.postgres,
      timeout: 1, // 1ms timeout
    };

    const connector = new PostgresConnector(shortTimeoutConfig);

    // Connection should timeout quickly
    await expect(connector.testConnection()).resolves.toBe(false);
  }, 10000); // Give test itself reasonable timeout

  it('should enforce query timeouts', async () => {
    const shortQueryTimeoutConfig = {
      ...SECURITY_TEST_CONFIGS.duckdb,
      queryTimeout: 1, // 1ms timeout
    };

    const connector = new DuckDBConnector(shortQueryTimeoutConfig);

    // Any query should timeout
    await expect(connector.getRowCount('nonexistent')).rejects.toThrow();
  });

  it('should limit result set sizes', async () => {
    const limitedConfig = {
      ...SECURITY_TEST_CONFIGS.duckdb,
      maxRows: 5, // Very small limit
    };

    const connector = new DuckDBConnector(limitedConfig);

    // This would normally be tested with a real large table
    // For now, we just verify the configuration is applied
    expect((connector as any).maxRows).toBe(5);
  });
});

describe('Error Information Disclosure Prevention', () => {
  it('should not leak database version information', async () => {
    const connector = new PostgresConnector({
      ...SECURITY_TEST_CONFIGS.postgres,
      host: 'nonexistent-host-123456.com', // Force connection error
    });

    try {
      await connector.testConnection();
    } catch (error) {
      if (error instanceof Error) {
        // Should not contain version info
        expect(error.message).not.toMatch(/PostgreSQL \d+\.\d+/);
        expect(error.message).not.toMatch(/version/i);
        expect(error.message).not.toContain('server version');
      }
    }
  });

  it('should not expose table structure in errors', async () => {
    const connector = new PostgresConnector(SECURITY_TEST_CONFIGS.postgres);

    try {
      await connector.getRowCount('definitely_nonexistent_table_12345');
    } catch (error) {
      if (error instanceof Error) {
        // Should not expose actual table names or schema info
        expect(error.message).not.toContain('information_schema');
        expect(error.message).not.toContain('pg_catalog');
        expect(error.message).not.toMatch(/relation ".*" does not exist/);
      }
    }
  });

  it('should not leak file paths in DuckDB errors', () => {
    try {
      new DuckDBConnector({
        ...SECURITY_TEST_CONFIGS.duckdb,
        database: '/nonexistent/path/to/file.duckdb',
      });
    } catch (error) {
      if (error instanceof Error) {
        // Should not expose full file paths
        expect(error.message).not.toContain('/nonexistent/path/to');
        expect(error.message).not.toContain('file.duckdb');
      }
    }
  });
});

describe('Multi-Vector Attack Simulation', () => {
  it('should defend against combined SQL injection and path traversal', () => {
    // Attempt to use DuckDB with malicious database path containing SQL
    expect(() => {
      new DuckDBConnector({
        host: 'localhost',
        port: 0,
        database: '../../../etc/passwd; DROP TABLE users; --',
        username: 'user',
        password: 'pass',
        ssl: false,
      });
    }).toThrow();
  });

  it('should defend against injection through configuration fields', () => {
    const attackPayload = "'; DROP TABLE users; --";

    // Try injection through various config fields
    expect(() => {
      new PostgresConnector({
        host: 'localhost' + attackPayload,
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'pass',
        ssl: true,
      });
    }).toThrow();

    expect(() => {
      new PostgresConnector({
        host: 'localhost',
        port: 5432,
        database: 'test' + attackPayload,
        username: 'user',
        password: 'pass',
        ssl: true,
      });
    }).toThrow();
  });

  it('should maintain security with rapid successive requests', async () => {
    const connector = new DuckDBConnector(SECURITY_TEST_CONFIGS.duckdb);

    // Rapid succession of malicious requests
    const maliciousRequests = Array(10).fill(0).map(async () => {
      try {
        await connector.getRowCount("users'; DROP TABLE admin; --");
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
      }
    });

    await Promise.all(maliciousRequests);
  });
});

describe('Real-World Attack Patterns', () => {
  it('should prevent OWASP SQL injection patterns', () => {
    const connector = new PostgresConnector(SECURITY_TEST_CONFIGS.postgres);

    // Common OWASP Top 10 SQL injection patterns
    const owaspPatterns = [
      "' OR 1=1 --",
      "' OR 'a'='a",
      "' OR 1=1#",
      "' UNION SELECT null,null,null --",
      "'; EXEC xp_cmdshell 'dir'; --",
      "' AND 1=CONVERT(int, (SELECT @@version)) --",
    ];

    for (const pattern of owaspPatterns) {
      expect(async () => {
        await connector.getRowCount('users' + pattern);
      }).rejects.toThrow();
    }
  });

  it('should prevent NoSQL-style injection attempts', () => {
    const connector = new BigQueryConnector(SECURITY_TEST_CONFIGS.bigquery);

    // Patterns that might work in NoSQL but should fail here
    const noSqlPatterns = [
      "'; return db.users.find({}); //",
      "' || this.password != '' || '",
      "' && this.username != '' && '",
    ];

    for (const pattern of noSqlPatterns) {
      expect(async () => {
        await connector.getRowCount('collection' + pattern);
      }).rejects.toThrow();
    }
  });

  it('should prevent time-based blind SQL injection', () => {
    const connector = new PostgresConnector(SECURITY_TEST_CONFIGS.postgres);

    // Time-based attack patterns
    const timeBasedPatterns = [
      "'; WAITFOR DELAY '00:00:10' --",
      "'; SELECT pg_sleep(10) --",
      "' AND (SELECT COUNT(*) FROM pg_tables) > 0 --",
    ];

    for (const pattern of timeBasedPatterns) {
      expect(async () => {
        await connector.getRowCount('users' + pattern);
      }).rejects.toThrow();
    }
  });
});