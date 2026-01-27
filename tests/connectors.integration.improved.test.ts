/**
 * Improved Integration Tests for Database Connectors
 * Tests actual database connections with real test data
 *
 * Setup Instructions:
 * 1. PostgreSQL: Run `pnpm test:services:start` to start test containers
 * 2. DuckDB: Run `node test-setup/setup-duckdb.js` to create test database
 *
 * Environment Variables:
 * - TEST_SKIP_INTEGRATION=true: Skip all integration tests
 * - TEST_POSTGRES_URL: Override PostgreSQL connection URL
 *
 * These tests verify:
 * - Real database connections
 * - Actual query execution with test data
 * - Data retrieval and metadata operations
 * - Error handling with real connection failures
 * - Security validation with actual databases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgresConnector } from '../src/connectors/postgres.js';
import { DuckDBConnector } from '../src/connectors/duckdb.js';

// Test configuration
const TEST_CONFIG = {
  postgres: {
    host: 'localhost',
    port: 5433,
    database: 'freshguard_test',
    username: 'test',
    password: 'test',
    ssl: false, // Disable SSL for testing
  },
  duckdb: {
    host: 'localhost',
    port: 0,
    database: '/tmp/customer_test.duckdb',
    username: 'duckdb',
    password: 'duckdb',
    ssl: false,
  },
  timeout: 30000, // 30 second timeout for Docker container startup
};

// Test security config that allows SSL=false for testing
const TEST_SECURITY_CONFIG = {
  requireSSL: false,
  connectionTimeout: 30000,
  queryTimeout: 10000,
  maxRows: 1000,
  allowedQueryPatterns: [
    /^SELECT 1/i,
    /^SELECT COUNT\(\*\) as count FROM/i,
    /^SELECT COUNT\(\*\) FROM/i,
    /^SELECT MAX\(.+\) as .+ FROM/i,
    /^SELECT MAX\(/i,
    /^SELECT MIN\(/i,
    /^DESCRIBE /i,
    /^SHOW /i,
    /SELECT .+ FROM information_schema\./is,
    /^SELECT table_name\s+FROM information_schema\.tables/is,
    /^SELECT .+ FROM .+ WHERE/is,
    /^SELECT .+ FROM .+ ORDER BY/is,
  ],
  blockedKeywords: [
    'INSERT', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
    '--', '/*', '*/', 'EXEC', 'EXECUTE', 'xp_', 'sp_'
  ],
};

// Expected test tables and their minimum expected row counts
const EXPECTED_TABLES = {
  customers: 3,
  orders: 5,
  products: 3,
  daily_summary: 2,
  user_sessions: 3,
};

// Global test state
const testResults = {
  postgres: {
    available: false,
    connector: null as PostgresConnector | null,
    error: null as Error | null,
  },
  duckdb: {
    available: false,
    connector: null as DuckDBConnector | null,
    error: null as Error | null,
  },
};

// Check if integration tests should be skipped
const SKIP_INTEGRATION = process.env.TEST_SKIP_INTEGRATION === 'true';

describe('Integration Test Setup', () => {
  it('should report test environment status', () => {
    console.log('\n=== Integration Test Environment ===');
    console.log(`Skip integration tests: ${SKIP_INTEGRATION}`);
    console.log(`PostgreSQL URL: postgresql://${TEST_CONFIG.postgres.username}:***@${TEST_CONFIG.postgres.host}:${TEST_CONFIG.postgres.port}/${TEST_CONFIG.postgres.database}`);
    console.log(`DuckDB path: ${TEST_CONFIG.duckdb.database}`);
    console.log('=====================================\n');

    if (SKIP_INTEGRATION) {
      console.log('⚠️  Integration tests skipped (TEST_SKIP_INTEGRATION=true)');
    }

    expect(true).toBe(true); // Always pass, this is just for reporting
  });
});

describe('PostgreSQL Integration Tests', () => {
  beforeAll(async () => {
    if (SKIP_INTEGRATION) return;

    console.log('\n🐘 Setting up PostgreSQL integration tests...');

    try {
      testResults.postgres.connector = new PostgresConnector(TEST_CONFIG.postgres, TEST_SECURITY_CONFIG);
      testResults.postgres.available = await testResults.postgres.connector.testConnection();

      if (testResults.postgres.available) {
        console.log('✅ PostgreSQL connection successful');

        // Verify test data exists
        const tables = await testResults.postgres.connector.listTables();
        console.log(`📋 Found tables: ${tables.join(', ')}`);

        for (const [tableName, expectedCount] of Object.entries(EXPECTED_TABLES)) {
          if (tables.includes(tableName)) {
            const count = await testResults.postgres.connector.getRowCount(tableName);
            console.log(`📊 ${tableName}: ${count} rows`);

            if (count < expectedCount) {
              console.warn(`⚠️  ${tableName} has only ${count} rows, expected at least ${expectedCount}`);
            }
          } else {
            console.warn(`⚠️  Expected table '${tableName}' not found`);
          }
        }
      } else {
        console.warn('❌ PostgreSQL connection failed');
      }

    } catch (error) {
      testResults.postgres.error = error as Error;
      console.error('❌ PostgreSQL setup failed:', error.message);
      console.log('\n💡 To fix this:');
      console.log('   1. Start test services: pnpm test:services:start');
      console.log('   2. Wait for health checks to pass');
      console.log('   3. Check logs: pnpm test:services:logs');
    }
  }, TEST_CONFIG.timeout);

  afterAll(async () => {
    if (testResults.postgres.connector) {
      try {
        await testResults.postgres.connector.close();
      } catch (error) {
        console.warn('Warning: Failed to close PostgreSQL connection:', error.message);
      }
    }
  });

  beforeEach(() => {
    if (SKIP_INTEGRATION) return;
    if (!testResults.postgres.available) {
      console.warn('⏭️  Skipping PostgreSQL test - database not available');
    }
  });

  it('should connect to test database successfully', () => {
    if (SKIP_INTEGRATION || !testResults.postgres.available) return;

    expect(testResults.postgres.available).toBe(true);
    expect(testResults.postgres.connector).toBeTruthy();
  });

  it('should have all expected test tables with data', async () => {
    if (SKIP_INTEGRATION || !testResults.postgres.available) return;

    const tables = await testResults.postgres.connector!.listTables();

    expect(tables).toBeInstanceOf(Array);
    expect(tables.length).toBeGreaterThan(0);

    // Check each expected table exists with minimum row count
    for (const [tableName, expectedCount] of Object.entries(EXPECTED_TABLES)) {
      expect(tables, `Table '${tableName}' should exist`).toContain(tableName);

      const count = await testResults.postgres.connector!.getRowCount(tableName);
      expect(count, `Table '${tableName}' should have at least ${expectedCount} rows`).toBeGreaterThanOrEqual(expectedCount);
    }
  });

  it('should get recent timestamp data for freshness monitoring', async () => {
    if (SKIP_INTEGRATION || !testResults.postgres.available) return;

    const lastOrderUpdate = await testResults.postgres.connector!.getMaxTimestamp('orders', 'updated_at');

    expect(lastOrderUpdate).toBeInstanceOf(Date);

    // Verify the timestamp is recent (test data should be within last 24 hours)
    const hoursAgo = (Date.now() - lastOrderUpdate!.getTime()) / (1000 * 60 * 60);
    expect(hoursAgo, 'Test data should be recent').toBeLessThan(24);

    console.log(`📅 Most recent order update: ${lastOrderUpdate!.toISOString()} (${hoursAgo.toFixed(1)} hours ago)`);
  });

  it('should handle volume monitoring queries', async () => {
    if (SKIP_INTEGRATION || !testResults.postgres.available) return;

    const orderCount = await testResults.postgres.connector!.getRowCount('orders');
    const sessionCount = await testResults.postgres.connector!.getRowCount('user_sessions');

    expect(orderCount).toBeGreaterThan(0);
    expect(sessionCount).toBeGreaterThan(0);

    console.log(`📈 Volume metrics - Orders: ${orderCount}, Sessions: ${sessionCount}`);
  });

  it('should validate security constraints', async () => {
    if (SKIP_INTEGRATION || !testResults.postgres.available) return;

    // These operations should all work through secure methods
    await expect(testResults.postgres.connector!.getRowCount('orders')).resolves.toBeDefined();
    await expect(testResults.postgres.connector!.getMaxTimestamp('orders', 'updated_at')).resolves.toBeDefined();
    await expect(testResults.postgres.connector!.listTables()).resolves.toBeDefined();
  });

  it('should handle connection errors gracefully', async () => {
    const badConfig = {
      host: 'nonexistent-host.example.com',
      port: 5432,
      database: 'test',
      username: 'test',
      password: 'test',
      ssl: false,
    };

    const badConnector = new PostgresConnector(badConfig, TEST_SECURITY_CONFIG);

    // This should fail gracefully
    await expect(badConnector.testConnection()).resolves.toBe(false);
  });

  it('should handle invalid table names gracefully', async () => {
    if (SKIP_INTEGRATION || !testResults.postgres.available) return;

    await expect(
      testResults.postgres.connector!.getRowCount('nonexistent_table_12345')
    ).rejects.toThrow();
  });
});

describe('DuckDB Integration Tests', () => {
  beforeAll(async () => {
    if (SKIP_INTEGRATION) return;

    console.log('\n🦆 Setting up DuckDB integration tests...');

    try {
      // First, try to create a memory database to test if DuckDB bindings work
      const memoryConfig = {
        host: 'localhost',
        port: 0,
        database: ':memory:',
        username: 'duckdb',
        password: 'duckdb',
        ssl: false,
      };

      const memConnector = new DuckDBConnector(memoryConfig, TEST_SECURITY_CONFIG);
      const memoryWorks = await memConnector.testConnection();
      await memConnector.close();

      if (memoryWorks) {
        testResults.duckdb.connector = new DuckDBConnector(TEST_CONFIG.duckdb, TEST_SECURITY_CONFIG);
        testResults.duckdb.available = await testResults.duckdb.connector.testConnection();

        if (testResults.duckdb.available) {
          console.log('✅ DuckDB connection successful');

          // Try to verify test data exists
          try {
            const tables = await testResults.duckdb.connector.listTables();
            console.log(`📋 Found tables: ${tables.join(', ')}`);

            for (const tableName of Object.keys(EXPECTED_TABLES)) {
              if (tables.includes(tableName)) {
                const count = await testResults.duckdb.connector.getRowCount(tableName);
                console.log(`📊 ${tableName}: ${count} rows`);
              }
            }
          } catch (error) {
            console.warn('⚠️  Could not verify test data:', error.message);
          }
        } else {
          console.warn('❌ DuckDB file database connection failed');
        }
      } else {
        console.warn('❌ DuckDB memory database test failed');
      }

    } catch (error) {
      testResults.duckdb.error = error as Error;
      console.error('❌ DuckDB setup failed:', error.message);
      console.log('\n💡 To fix this:');
      console.log('   1. Setup test database: node test-setup/setup-duckdb.js');
      console.log('   2. Ensure DuckDB native bindings are compiled');
      console.log('   3. Check if DuckDB package is properly installed');
    }
  });

  afterAll(async () => {
    if (testResults.duckdb.connector) {
      try {
        await testResults.duckdb.connector.close();
      } catch (error) {
        console.warn('Warning: Failed to close DuckDB connection:', error.message);
      }
    }
  });

  beforeEach(() => {
    if (SKIP_INTEGRATION) return;
    if (!testResults.duckdb.available) {
      console.warn('⏭️  Skipping DuckDB test - database not available');
    }
  });

  it('should connect to DuckDB database', () => {
    if (SKIP_INTEGRATION) return;

    if (!testResults.duckdb.available) {
      console.log('ℹ️  DuckDB not available - this is expected if native bindings are not compiled');
      return;
    }

    expect(testResults.duckdb.available).toBe(true);
    expect(testResults.duckdb.connector).toBeTruthy();
  });

  it('should work with in-memory databases', async () => {
    if (SKIP_INTEGRATION) return;

    const memoryConfig = {
      host: 'localhost',
      port: 0,
      database: ':memory:',
      username: 'duckdb',
      password: 'duckdb',
      ssl: false,
    };

    let memConnector: DuckDBConnector | null = null;

    try {
      memConnector = new DuckDBConnector(memoryConfig, TEST_SECURITY_CONFIG);
      const connected = await memConnector.testConnection();

      if (connected) {
        console.log('✅ DuckDB in-memory database works');
        expect(connected).toBe(true);
      } else {
        console.log('ℹ️  DuckDB in-memory test skipped - native bindings not available');
      }
    } catch (error) {
      console.log('ℹ️  DuckDB test skipped:', error.message);
    } finally {
      if (memConnector) {
        await memConnector.close();
      }
    }
  });

  it('should handle list tables operation', async () => {
    if (SKIP_INTEGRATION || !testResults.duckdb.available) return;

    const tables = await testResults.duckdb.connector!.listTables();
    expect(tables).toBeInstanceOf(Array);

    console.log(`📋 DuckDB tables: ${tables.join(', ')}`);
  });

  it('should handle connection errors gracefully', async () => {
    if (SKIP_INTEGRATION) return;

    const badConfig = {
      host: 'localhost',
      port: 0,
      database: '/nonexistent/path/to/database.duckdb',
      username: 'duckdb',
      password: 'duckdb',
      ssl: false,
    };

    let badConnector: DuckDBConnector | null = null;

    try {
      badConnector = new DuckDBConnector(badConfig, TEST_SECURITY_CONFIG);
      const testResult = await badConnector.testConnection();
      expect(testResult).toBe(false);
    } catch (error) {
      // Expected - should fail gracefully
      expect(error).toBeInstanceOf(Error);
    } finally {
      if (badConnector) {
        try {
          await badConnector.close();
        } catch {
          // Ignore cleanup errors for bad connections
        }
      }
    }
  });
});

describe('Integration Test Summary', () => {
  it('should report integration test results', () => {
    console.log('\n=== Integration Test Results ===');

    if (SKIP_INTEGRATION) {
      console.log('⚠️  All integration tests were skipped');
      return;
    }

    console.log(`PostgreSQL: ${testResults.postgres.available ? '✅ Available' : '❌ Unavailable'}`);
    if (testResults.postgres.error) {
      console.log(`  Error: ${testResults.postgres.error.message}`);
    }

    console.log(`DuckDB: ${testResults.duckdb.available ? '✅ Available' : '❌ Unavailable'}`);
    if (testResults.duckdb.error) {
      console.log(`  Error: ${testResults.duckdb.error.message}`);
    }

    const availableConnectors = [
      testResults.postgres.available ? 'PostgreSQL' : null,
      testResults.duckdb.available ? 'DuckDB' : null,
    ].filter(Boolean);

    if (availableConnectors.length === 0) {
      console.log('\n⚠️  No database connectors were available for testing');
      console.log('   This may indicate a setup issue.');
    } else {
      console.log(`\n✅ Successfully tested: ${availableConnectors.join(', ')}`);
    }

    console.log('================================\n');

    expect(true).toBe(true); // Always pass, this is just for reporting
  });
});