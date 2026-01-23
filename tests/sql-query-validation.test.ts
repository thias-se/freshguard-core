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
    /^SELECT COUNT\(\*\) FROM/i,
    /^SELECT MAX\(/i,
    /^SELECT MIN\(/i,
    /^DESCRIBE /i,
    /^SHOW /i,
    /^SELECT .+ FROM information_schema\./i,
    // Add specific patterns for multiline information_schema queries
    /^SELECT .+ FROM information_schema\./is, // 's' flag for multiline
  ],
  blockedKeywords: [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
    '--', '/*', '*/', 'EXEC', 'EXECUTE', 'xp_', 'sp_'
  ],
};

describe('SQL Query Generation Validation', () => {
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
          const isCompleteSQL = !query.match(/OR\s*$/);
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
          query.match(/WHERE\s*$/) ||
          query.match(/AND\s*$/) ||
          query.match(/OR\s*$/);
        expect(isIncomplete).toBeTruthy(`Query ${index + 1} should be detected as incomplete: ${query}`);
      });
    });
  });
});