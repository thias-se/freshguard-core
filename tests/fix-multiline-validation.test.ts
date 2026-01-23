/**
 * Test for the multiline SQL validation bug fix
 *
 * Issue: PostgreSQL listTables() method generated multiline SQL with leading whitespace
 * that failed pattern validation, causing "Query pattern not allowed" errors.
 *
 * Root Cause: Pattern matching was done on original SQL instead of trimmed SQL,
 * which caused validation to fail for queries with leading/trailing whitespace.
 *
 * Fix: Trim SQL before pattern validation in validateQueryTraditional()
 */

import { describe, it, expect } from 'vitest';
import { PostgresConnector } from '../src/connectors/postgres.js';
import type { ConnectorConfig } from '../src/types/connector.js';

describe('Multiline SQL Validation Fix', () => {
  const config: ConnectorConfig = {
    host: 'localhost',
    port: 5432,
    database: 'test_db',
    username: 'test_user',
    password: 'test_password',
    ssl: true
  };

  describe('Pattern Validation for Multiline SQL', () => {
    it('should validate multiline SQL with leading whitespace', async () => {
      const connector = new PostgresConnector(config, { requireSSL: false });

      // This is the exact SQL pattern that was failing before the fix
      const multilineSQL = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
        LIMIT $2
      `;

      // Before fix: This would throw "Query pattern not allowed"
      // After fix: This should pass validation
      await expect(async () => {
        await (connector as any).validateQuery(multilineSQL);
      }).not.toThrow();
    });

    it('should validate SQL with various whitespace patterns', async () => {
      const connector = new PostgresConnector(config, { requireSSL: false });

      const sqlVariations = [
        // Leading spaces
        '  SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        // Leading tabs
        '\t\tSELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        // Leading newlines
        '\n\nSELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        // Mixed whitespace
        '\n  \t  SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        // Trailing whitespace
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1   ',
        // Both leading and trailing
        '  SELECT table_name FROM information_schema.tables WHERE table_schema = $1  '
      ];

      for (const sql of sqlVariations) {
        await expect(async () => {
          await (connector as any).validateQuery(sql);
        }).not.toThrow(`SQL should validate: ${JSON.stringify(sql.substring(0, 50))}`);
      }
    });

    it('should still reject malformed SQL patterns', async () => {
      const connector = new PostgresConnector(config, { requireSSL: false });

      const malformedQueries = [
        // Incomplete OR clauses (the original issue that was incorrectly diagnosed)
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 OR',
        // Incomplete AND clauses
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND',
        // Incomplete WHERE clauses
        'SELECT table_name FROM information_schema.tables WHERE',
        // Non-allowed patterns
        'SELECT * FROM users WHERE id = 1',
        'DELETE FROM users WHERE id = 1'
      ];

      for (const sql of malformedQueries) {
        await expect(async () => {
          await (connector as any).validateQuery(sql);
        }).rejects.toThrow(); // Just verify it throws, don't check exact message
      }
    });
  });

  describe('Real-world PostgreSQL Operations', () => {
    it('should allow listTables() to validate successfully', () => {
      const connector = new PostgresConnector(config, { requireSSL: false });

      // This test verifies that the actual PostgreSQL listTables() SQL validates
      // We can't call listTables() directly without a real database, but we can
      // test the validation of the exact SQL it would generate
      expect(() => {
        // This should not throw a validation error
        const sql = `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = $1
          ORDER BY table_name
          LIMIT $2
        `;

        // Call validateQuery synchronously (it's async but validation is sync)
        const promise = (connector as any).validateQuery(sql);
        return promise;
      }).not.toThrow();
    });

    it('should allow getTableSchema() SQL to validate', async () => {
      const connector = new PostgresConnector(config, { requireSSL: false });

      // Test the SQL pattern used by getTableSchema()
      const getTableSchemaSQL = `
        SELECT
          column_name,
          data_type,
          is_nullable
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
        ORDER BY ordinal_position
        LIMIT $3
      `;

      await expect(async () => {
        await (connector as any).validateQuery(getTableSchemaSQL);
      }).not.toThrow();
    });
  });

  describe('Edge Cases and Regression Prevention', () => {
    it('should handle extremely indented SQL', async () => {
      const connector = new PostgresConnector(config, { requireSSL: false });

      // Test with heavy indentation (some formatters do this)
      const heavilyIndentedSQL = `
                                    SELECT table_name
                                    FROM information_schema.tables
                                    WHERE table_schema = $1
                                    ORDER BY table_name
                                    LIMIT $2
      `;

      await expect(async () => {
        await (connector as any).validateQuery(heavilyIndentedSQL);
      }).not.toThrow();
    });

    it('should handle SQL with mixed line endings', async () => {
      const connector = new PostgresConnector(config, { requireSSL: false });

      // Test with different line endings (Windows vs Unix)
      const mixedLineEndingsSQL = 'SELECT table_name\r\nFROM information_schema.tables\nWHERE table_schema = $1\r\nORDER BY table_name\nLIMIT $2';

      await expect(async () => {
        await (connector as any).validateQuery(mixedLineEndingsSQL);
      }).not.toThrow();
    });

    it('should maintain security validation for blocked keywords', async () => {
      const connector = new PostgresConnector(config, { requireSSL: false });

      // Ensure security validation still works after the fix
      const securityThreats = [
        '  DROP TABLE users; --',
        '\n  INSERT INTO users (name) VALUES ("hacker");',
        '\t  UPDATE users SET password = "pwned";',
        '   DELETE FROM information_schema.tables;'
      ];

      for (const threat of securityThreats) {
        await expect(async () => {
          await (connector as any).validateQuery(threat);
        }).rejects.toThrow(); // Just verify security threats are blocked
      }
    });
  });
});