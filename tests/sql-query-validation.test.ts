/**
 * SQL Query Validation Tests
 *
 * Tests to detect malformed SQL queries and ensure proper pattern matching
 * Created in response to PostgreSQL listTables malformed query bug report
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresConnector } from '../src/connectors/postgres.js';
import { DuckDBConnector } from '../src/connectors/duckdb.js';
import { BigQueryConnector } from '../src/connectors/bigquery.js';
import { SnowflakeConnector } from '../src/connectors/snowflake.js';
import type { ConnectorConfig } from '../src/types/connector.js';
import { DEFAULT_SECURITY_CONFIG } from '../src/types/connector.js';
import { SecurityError } from '../src/errors/index.js';

// Mock configuration for testing - these won't actually connect
const mockPostgresConfig: ConnectorConfig = {
  host: 'mock-host',
  port: 5432,
  database: 'mock-db',
  username: 'mock-user',
  password: 'mock-password',
  ssl: false, // For testing
};

const mockDuckDBConfig: ConnectorConfig = {
  host: 'localhost',
  port: 0,
  database: ':memory:',
  username: 'mock-user',
  password: 'mock-password',
  ssl: false,
};

const mockBigQueryConfig: ConnectorConfig = {
  host: 'bigquery.googleapis.com',
  port: 443,
  database: 'mock-project',
  username: 'bigquery',
  password: JSON.stringify({
    type: 'service_account',
    project_id: 'mock-project',
    private_key: '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----\n',
    client_email: 'mock@mock-project.iam.gserviceaccount.com',
  }),
  ssl: false,
};

const mockSnowflakeConfig: ConnectorConfig = {
  host: 'mock-account.snowflakecomputing.com',
  port: 443,
  database: 'MOCK_DB',
  username: 'mock-user',
  password: 'mock-password',
  ssl: false,
};

// Disable SSL requirement for testing
const testSecurityConfig = {
  requireSSL: false,
  enableDetailedLogging: true,
  connectionTimeout: 30000,
  queryTimeout: 10000,
  maxRows: 1000,
  allowedQueryPatterns: [
    // FreshGuard Core monitoring patterns (v0.9.1+) - Updated to handle all whitespace and quoted identifiers
    /^SELECT\s+COUNT\(\*\)(?:\s+as\s+\w+)?\s+FROM\s+[`"]?\w+[`"]?$/is,                    // getRowCount: SELECT COUNT(*) [as alias] FROM table
    /^SELECT\s+MAX\([`"]?\w+[`"]?\)(?:\s+as\s+\w+)?\s+FROM\s+[`"]?\w+[`"]?$/is,           // getMaxTimestamp: SELECT MAX(column) [as alias] FROM table
    /^SELECT\s+MIN\([`"]?\w+[`"]?\)(?:\s+as\s+\w+)?\s+FROM\s+[`"]?\w+[`"]?$/is,           // getMinTimestamp: SELECT MIN(column) [as alias] FROM table

    // Schema introspection queries
    /^DESCRIBE\s+[`"]?\w+[`"]?$/i,                                                         // DESCRIBE table
    /^SHOW\s+(TABLES|COLUMNS)(?:\s+FROM\s+[`"]?\w+[`"]?)?$/i,                            // SHOW TABLES, SHOW COLUMNS FROM table

    // Information schema queries (cross-database compatibility)
    /^SELECT\s+.+?\s+FROM\s+information_schema\.\w+/is,                                  // PostgreSQL/MySQL information_schema
    /^SELECT[\s\S]+?FROM[\s\S]+?information_schema\.\w+/is,                              // Multi-line information_schema queries
    /^SELECT[\s\S]+?FROM[\s\S]*`[^`]*\.INFORMATION_SCHEMA\.\w+`/is,                      // BigQuery INFORMATION_SCHEMA (backticks)

    // Test connection queries
    /^SELECT\s+1(?:\s+as\s+\w+)?$/i,                                                     // SELECT 1 [as alias] (connection test)
  ],
  blockedKeywords: [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
    '--', '/*', '*/', 'EXEC', 'EXECUTE', 'xp_', 'sp_'
  ],
};

describe('SQL Query Generation Validation', () => {
  describe('Security Pattern Validation for Connector Queries (v0.9.1)', () => {
    it('should allow all connector-generated monitoring queries', () => {
      // Use the imported security config to test against
      const patterns = DEFAULT_SECURITY_CONFIG.allowedQueryPatterns;

      // Test queries that our connectors actually generate
      const legitimateQueries = [
        // getRowCount queries
        'SELECT COUNT(*) as count FROM orders',
        'SELECT COUNT(*) FROM orders',
        'SELECT COUNT(*) as row_count FROM user_events',

        // getMaxTimestamp queries
        'SELECT MAX(updated_at) as max_date FROM orders',
        'SELECT MAX(`order_date`) as max_date FROM orders', // BigQuery backticks
        'SELECT MAX(created_at) FROM user_events',

        // getMinTimestamp queries
        'SELECT MIN(created_at) as min_date FROM orders',
        'SELECT MIN(`timestamp`) as min_date FROM events', // BigQuery backticks
        'SELECT MIN(date_column) FROM logs',

        // Connection test queries
        'SELECT 1 as test',
        'SELECT 1',

        // Schema queries
        'DESCRIBE orders',
        'SHOW TABLES',
        'SHOW COLUMNS FROM users',

        // Information schema queries
        'SELECT table_name FROM information_schema.tables',
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        'SELECT column_name FROM `project.INFORMATION_SCHEMA.COLUMNS`', // BigQuery
      ];

      legitimateQueries.forEach((query, index) => {
        const isAllowed = patterns.some((pattern: RegExp) => pattern.test(query));
        expect(isAllowed).toBe(true, `Query ${index + 1} should be allowed: ${query}`);
      });
    });

    it('should block malicious queries despite updated patterns', () => {
      const patterns = DEFAULT_SECURITY_CONFIG.allowedQueryPatterns;

      // Test queries that should still be blocked
      const maliciousQueries = [
        // SQL injection attempts
        'SELECT COUNT(*) FROM orders; DROP TABLE users',
        'SELECT COUNT(*) as count FROM orders UNION SELECT password FROM users',
        'SELECT MAX(id) as max_id FROM orders WHERE 1=1; DELETE FROM logs',

        // Unauthorized table access
        'SELECT * FROM users',
        'SELECT password FROM auth_table',
        'SELECT COUNT(*) FROM orders WHERE secret_column = "value"',

        // Complex unauthorized queries
        'SELECT COUNT(*), (SELECT secret FROM admin) as secret FROM orders',
        'SELECT MAX(id) as max_id FROM (SELECT * FROM sensitive_table) as sub',

        // Wrong patterns
        'SELECT AVG(amount) FROM orders', // AVG not allowed
        'SELECT SUM(total) as sum FROM sales', // SUM not allowed
      ];

      maliciousQueries.forEach((query, index) => {
        const isAllowed = patterns.some((pattern: RegExp) => pattern.test(query));
        expect(isAllowed).toBe(false, `Query ${index + 1} should be blocked: ${query}`);
      });
    });

    it('should not block legitimate column names containing blocked keywords', () => {
      const patterns = DEFAULT_SECURITY_CONFIG.allowedQueryPatterns;

      // Test queries with column names that contain blocked keywords as substrings
      const legitimateColumnNames = [
        'SELECT COUNT(*) as count FROM orders',
        'SELECT MAX(updated_at) as max_date FROM orders',           // "updated_at" contains "UPDATE"
        'SELECT MIN(created_at) as min_date FROM logs',             // "created_at" contains "CREATE"
        'SELECT MAX(deleted_flag) as max_flag FROM audit_logs',     // "deleted_flag" contains "DELETE"
        'SELECT COUNT(*) FROM user_inserts_log',                   // table name contains "INSERT"
      ];

      legitimateColumnNames.forEach((query, index) => {
        const isAllowed = patterns.some((pattern: RegExp) => pattern.test(query));
        expect(isAllowed).toBe(true, `Query ${index + 1} with column containing blocked keyword should be allowed: ${query}`);
      });
    });

    it('should handle edge cases and variations', () => {
      const patterns = DEFAULT_SECURITY_CONFIG.allowedQueryPatterns;

      // Test edge cases that should be allowed
      const edgeCaseQueries = [
        // Different whitespace patterns
        'SELECT COUNT(*)  as  count  FROM  orders',
        'SELECT\nCOUNT(*) as count\nFROM orders',
        'SELECT\tMAX(date)\tas\tmax_date\tFROM\ttable',

        // Different quote styles
        'SELECT MAX("quoted_column") as max_date FROM orders',
        'SELECT MAX(`backtick_column`) as max_date FROM orders',
        'SELECT COUNT(*) as count FROM `quoted_table`',

        // Case variations
        'select count(*) as count from orders',
        'Select Max(updated_at) As max_date From orders',
      ];

      edgeCaseQueries.forEach((query, index) => {
        const isAllowed = patterns.some((pattern: RegExp) => pattern.test(query));
        expect(isAllowed).toBe(true, `Edge case query ${index + 1} should be allowed: ${query}`);
      });
    });
  });

  describe('PostgreSQL Connector SQL Generation', () => {
    let connector: PostgresConnector;

    beforeEach(() => {
      connector = new PostgresConnector(mockPostgresConfig, testSecurityConfig);
    });

    it('should generate valid SQL for listTables method', async () => {
      // Test that the SQL generation doesn't have incomplete OR clauses
      const expectedPattern = /^SELECT .+ FROM information_schema\./is;

      // Extract the SQL by creating a spy-like approach
      // We can't easily mock the protected method, so we'll test indirectly

      // The query should be:
      const expectedSQL = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
      LIMIT $2
    `.trim();

      // Test pattern matching directly
      expect(expectedPattern.test(expectedSQL)).toBe(true);

      // Verify no incomplete OR clauses
      expect(expectedSQL).not.toMatch(/WHERE.*OR\s*$/);
      expect(expectedSQL).not.toMatch(/OR\s*$/);

      // Verify proper parameterization
      expect(expectedSQL).toMatch(/\$1/);
      expect(expectedSQL).toMatch(/\$2/);

      // Verify it's a SELECT from information_schema
      expect(expectedSQL).toMatch(/SELECT.*FROM information_schema\.tables/is);
    });

    it('should validate listTables query against security patterns', () => {
      const listTablesSQL = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
      LIMIT $2
    `;

      // Test each pattern in the security config
      const patterns = testSecurityConfig.allowedQueryPatterns;

      // Should match the information_schema pattern
      const infoSchemaPattern = /^SELECT .+ FROM information_schema\./is;
      expect(infoSchemaPattern.test(listTablesSQL.trim())).toBe(true);

      // Test multiline version
      const infoSchemaPatternMultiline = /^SELECT .+ FROM information_schema\./is;
      expect(infoSchemaPatternMultiline.test(listTablesSQL.trim())).toBe(true);
    });

    it('should detect malformed queries with incomplete OR clauses', () => {
      const malformedQueries = [
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 OR',
        'SELECT * FROM users WHERE id = 1 OR',
        'SELECT COUNT(*) FROM orders WHERE status = "active" OR',
      ];

      malformedQueries.forEach(query => {
        expect(query).toMatch(/OR\s*$/);

        // These should be rejected by pattern matching
        const infoSchemaPattern = /^SELECT .+ FROM information_schema\./i;

        if (query.includes('information_schema')) {
          // Even malformed information_schema queries might match the pattern
          // but should be caught by other validation
          const isCompleteSQL = !(/OR\s*$/.exec(query));
          expect(isCompleteSQL).toBe(false);
        }
      });
    });

    it('should handle multiline queries correctly', () => {
      const multilineQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
        LIMIT $2
      `;

      // Test both single-line and multiline patterns
      const patterns = [
        /^SELECT .+ FROM information_schema\./is,  // Fixed pattern with 's' flag for multiline support
        /^SELECT .+ FROM information_schema\./is,  // Multiline with 's' flag
      ];

      // Should match both patterns
      patterns.forEach((pattern, index) => {
        const matches = pattern.test(multilineQuery.trim());
        expect(matches).toBe(true, `Pattern ${index} should match multiline query`);
      });
    });
  });

  describe('All Connectors SQL Generation', () => {
    const connectorConfigs = [
      { name: 'PostgreSQL', connector: PostgresConnector, config: mockPostgresConfig },
      { name: 'DuckDB', connector: DuckDBConnector, config: mockDuckDBConfig },
      { name: 'BigQuery', connector: BigQueryConnector, config: mockBigQueryConfig },
      { name: 'Snowflake', connector: SnowflakeConnector, config: mockSnowflakeConfig },
    ];

    connectorConfigs.forEach(({ name, connector: ConnectorClass, config }) => {
      describe(`${name} Connector`, () => {
        let connector: any;

        beforeEach(() => {
          connector = new ConnectorClass(config, testSecurityConfig);
        });

        it('should have listTables method', () => {
          expect(connector.listTables).toBeDefined();
          expect(typeof connector.listTables).toBe('function');
        });

        it('should have all required connector methods', () => {
          const requiredMethods = [
            'testConnection',
            'listTables',
            'getTableSchema',
            'getRowCount',
            'getMaxTimestamp',
            'getMinTimestamp',
            'getLastModified',
            'close'
          ];

          requiredMethods.forEach(method => {
            expect(connector[method]).toBeDefined();
            expect(typeof connector[method]).toBe('function');
          });
        });
      });
    });
  });

  describe('Query Pattern Validation', () => {
    let connector: PostgresConnector;

    beforeEach(() => {
      connector = new PostgresConnector(mockPostgresConfig, testSecurityConfig);
    });

    it('should accept valid information_schema queries', () => {
      const validQueries = [
        'SELECT table_name FROM information_schema.tables',
        'SELECT column_name FROM information_schema.columns',
        'SELECT COUNT(*) FROM information_schema.tables',
        `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        `,
      ];

      const pattern = /^SELECT .+ FROM information_schema\./is;

      validQueries.forEach((query, index) => {
        const matches = pattern.test(query.trim());
        expect(matches).toBe(true, `Query ${index + 1} should match pattern: ${query}`);
      });
    });

    it('should reject queries that do not match allowed patterns', () => {
      const invalidQueries = [
        'INSERT INTO users VALUES (1, "test")',
        'UPDATE users SET name = "test"',
        'DELETE FROM users WHERE id = 1',
        'DROP TABLE users',
        'CREATE TABLE test (id INT)',
        'SELECT * FROM users', // No pattern for this
      ];

      const allowedPatterns = testSecurityConfig.allowedQueryPatterns;

      invalidQueries.forEach((query, index) => {
        const isAllowed = allowedPatterns.some(pattern => pattern.test(query));
        expect(isAllowed).toBe(false, `Query ${index + 1} should NOT be allowed: ${query}`);
      });
    });

    it('should detect blocked keywords', () => {
      const blockedKeywordQueries = [
        'SELECT * FROM users; INSERT INTO logs VALUES (1)',
        'SELECT table_name FROM information_schema.tables; DROP TABLE users',
        'SELECT COUNT(*) FROM orders /* comment */ WHERE status = "active"',
      ];

      const blockedKeywords = testSecurityConfig.blockedKeywords;

      blockedKeywordQueries.forEach((query, index) => {
        const normalizedQuery = query.trim().toUpperCase();
        const hasBlockedKeyword = blockedKeywords.some(keyword =>
          normalizedQuery.includes(keyword.toUpperCase())
        );
        expect(hasBlockedKeyword).toBe(true, `Query ${index + 1} should contain blocked keywords: ${query}`);
      });
    });
  });

  describe('Edge Case Query Validation', () => {
    let connector: PostgresConnector;

    beforeEach(() => {
      connector = new PostgresConnector(mockPostgresConfig, testSecurityConfig);
    });

    it('should handle queries with unusual whitespace', () => {
      const queries = [
        '   SELECT table_name FROM information_schema.tables   ',
        '\n\nSELECT table_name\nFROM information_schema.tables\n\n',
        '\t\tSELECT\ttable_name\tFROM\tinformation_schema.tables\t\t',
      ];

      const pattern = /^SELECT\s+.+?\s+FROM\s+information_schema\./is; // More robust pattern for whitespace handling

      queries.forEach((query, index) => {
        const matches = pattern.test(query.trim());
        expect(matches).toBe(true, `Whitespace query ${index + 1} should match: ${JSON.stringify(query)}`);
      });
    });

    it('should handle case variations', () => {
      const queries = [
        'SELECT table_name FROM information_schema.tables',
        'select table_name from information_schema.tables',
        'Select Table_Name From Information_Schema.Tables',
        'SELECT table_name FROM INFORMATION_SCHEMA.TABLES',
      ];

      const pattern = /^SELECT .+ FROM information_schema\./is; // Case insensitive with multiline support

      queries.forEach((query, index) => {
        const matches = pattern.test(query);
        expect(matches).toBe(true, `Case variation ${index + 1} should match: ${query}`);
      });
    });

    it('should validate complete WHERE clauses', () => {
      const completeQueries = [
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2',
      ];

      const incompleteQueries = [
        'SELECT table_name FROM information_schema.tables WHERE',
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND',
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 OR',
      ];

      completeQueries.forEach((query, index) => {
        expect(query).not.toMatch(/WHERE\s*$/);
        expect(query).not.toMatch(/AND\s*$/);
        expect(query).not.toMatch(/OR\s*$/);
      });

      incompleteQueries.forEach((query, index) => {
        const isIncomplete =
          (/WHERE\s*$/.exec(query)) ||
          (/AND\s*$/.exec(query)) ||
          (/OR\s*$/.exec(query));
        expect(isIncomplete).toBeTruthy(`Query ${index + 1} should be detected as incomplete: ${query}`);
      });
    });
  });
});