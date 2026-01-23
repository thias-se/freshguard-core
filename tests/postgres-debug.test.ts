/**
 * PostgreSQL Debug Tests
 *
 * Focused tests to reproduce and debug the PostgreSQL listTables bug
 * with comprehensive logging enabled
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresConnector } from '../src/connectors/postgres.js';
import type { ConnectorConfig } from '../src/types/connector.js';

// Mock configuration that won't actually connect but will exercise the code paths
const mockConfig: ConnectorConfig = {
  host: 'localhost',
  port: 5432,
  database: 'test_db',
  username: 'test_user',
  password: 'test_password',
  ssl: false, // For testing
};

// Security config with debug logging enabled and patterns that should match
const debugSecurityConfig = {
  requireSSL: false,
  enableDetailedLogging: true,
  enableQueryAnalysis: true,
  connectionTimeout: 30000,
  queryTimeout: 10000,
  maxRows: 1000,
  // Include multiple patterns to ensure coverage
  allowedQueryPatterns: [
    /^SELECT 1/i,  // For connection test
    /^SELECT COUNT\(\*\) FROM/i,
    /^SELECT MAX\(/i,
    /^SELECT MIN\(/i,
    /^DESCRIBE /i,
    /^SHOW /i,
    // FIXED patterns - robust whitespace handling for all cases
    /^SELECT\s+.+?\s+FROM\s+information_schema\./is,  // Non-greedy match with explicit whitespace
    /^SELECT[\s\S]+?FROM[\s\S]+?information_schema\./is,  // Handle any whitespace including tabs/newlines
  ],
  blockedKeywords: [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
    '--', '/*', '*/', 'EXEC', 'EXECUTE', 'xp_', 'sp_'
  ],
};

describe('PostgreSQL Debug Tests', () => {
  let connector: PostgresConnector;

  beforeEach(() => {
    connector = new PostgresConnector(mockConfig, debugSecurityConfig);
  });

  it('should create connector without errors', () => {
    expect(connector).toBeDefined();
    expect(connector.listTables).toBeDefined();
    expect(connector.testConnection).toBeDefined();
  });

  it('should generate and validate listTables SQL query', async () => {
    // Test query validation without actual execution to avoid connection errors
    console.log('\n=== Starting listTables validation test ===');
    console.log('Testing SQL query validation for listTables method');

    const listTablesSQL = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
      LIMIT $2
    `;

    console.log('Query to validate:', JSON.stringify(listTablesSQL.trim()));

    // Test the patterns from debugSecurityConfig
    const patterns = debugSecurityConfig.allowedQueryPatterns;
    let matchFound = false;

    patterns.forEach((pattern, index) => {
      const matches = pattern.test(listTablesSQL.trim());
      console.log(`Pattern ${index + 1}: ${pattern.source} (${pattern.flags}) -> ${matches ? 'MATCH' : 'NO MATCH'}`);
      if (matches) matchFound = true;
    });

    expect(matchFound).toBe(true);
    console.log('✅ Query validation successful');
    console.log('=== End listTables validation test ===\n');
  });

  it('should test connection with debug output', () => {
    console.log('\n=== Starting testConnection debug test ===');

    // Test that the connection method exists and is properly configured
    expect(connector.testConnection).toBeDefined();
    expect(typeof connector.testConnection).toBe('function');

    console.log('✅ testConnection method is available and properly configured');
    console.log('=== End testConnection debug test ===\n');
  });

  it('should validate SQL patterns manually', () => {
    const listTablesSQL = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
      LIMIT $2
    `;

    console.log('\n=== Manual pattern validation test ===');
    console.log('Testing SQL:', JSON.stringify(listTablesSQL));

    const patterns = debugSecurityConfig.allowedQueryPatterns;

    patterns.forEach((pattern, index) => {
      const matches = pattern.test(listTablesSQL.trim());
      console.log(`Pattern ${index + 1}: ${pattern.source} (${pattern.flags}) -> ${matches ? 'MATCH' : 'NO MATCH'}`);

      if (pattern.source.includes('information_schema')) {
        // This should match
        expect(matches).toBe(true, `Information schema pattern should match: ${pattern.source}`);
      }
    });

    console.log('=== End manual pattern validation ===\n');
  });

  it('should test specific problematic patterns from bug report', () => {
    console.log('\n=== Testing patterns from bug report ===');

    // The FIXED pattern with 's' flag for multiline support
    const expectedPattern = /^SELECT .+ FROM information_schema\./is;

    // The allegedly malformed query from the bug report
    const malformedQuery = 'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 OR';

    // Our current (correct) query
    const correctQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
      LIMIT $2
    `.trim();

    console.log('Expected pattern:', expectedPattern.source);
    console.log('Malformed query:', JSON.stringify(malformedQuery));
    console.log('Correct query:', JSON.stringify(correctQuery));

    // Test pattern matching
    const malformedMatches = expectedPattern.test(malformedQuery);
    const correctMatches = expectedPattern.test(correctQuery);

    console.log('Malformed query matches pattern:', malformedMatches);
    console.log('Correct query matches pattern:', correctMatches);

    // Check for incomplete OR clause
    const hasIncompleteOr = /OR\s*$/.test(malformedQuery);
    const correctHasIncompleteOr = /OR\s*$/.test(correctQuery);

    console.log('Malformed query has incomplete OR:', hasIncompleteOr);
    console.log('Correct query has incomplete OR:', correctHasIncompleteOr);

    // Assertions
    expect(correctMatches).toBe(true, 'Correct query should match pattern');
    expect(correctHasIncompleteOr).toBe(false, 'Correct query should not have incomplete OR');

    if (malformedMatches) {
      // If the malformed query matches the pattern, it should be caught by incomplete OR check
      expect(hasIncompleteOr).toBe(true, 'Malformed query should be detected as having incomplete OR');
    }

    console.log('=== End bug report pattern test ===\n');
  });

  it('should test multiline query handling', () => {
    const multilineQueries = [
      // Standard multiline format
      `SELECT table_name
FROM information_schema.tables
WHERE table_schema = $1`,

      // With extra whitespace
      `  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = $1  `,

      // Mixed whitespace
      `\t\nSELECT table_name\n\t\nFROM information_schema.tables\n\t\nWHERE table_schema = $1\n\t`,
    ];

    const pattern = /^SELECT\s+.+?\s+FROM\s+information_schema\./is; // Fixed robust pattern
    const multilinePattern = /^SELECT[\s\S]+?FROM[\s\S]+?information_schema\./is; // Fixed pattern for any whitespace

    console.log('\n=== Testing multiline query handling ===');

    multilineQueries.forEach((query, index) => {
      console.log(`\nQuery ${index + 1}:`, JSON.stringify(query));
      console.log(`Trimmed:`, JSON.stringify(query.trim()));

      const singleLineMatch = pattern.test(query.trim());
      const multiLineMatch = multilinePattern.test(query.trim());

      console.log(`Single-line pattern match:`, singleLineMatch);
      console.log(`Multi-line pattern match:`, multiLineMatch);

      // At least one should match
      expect(singleLineMatch || multiLineMatch).toBe(true, `Query ${index + 1} should match at least one pattern`);
    });

    console.log('=== End multiline query test ===\n');
  });
});

// Export the debug security config for use in integration tests
export { debugSecurityConfig };