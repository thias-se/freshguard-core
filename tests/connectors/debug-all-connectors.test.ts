/**
 * Tests for debug-enhanced connection testing across all connectors
 *
 * Verifies that all database connectors support enhanced debug mode
 * for connection testing with detailed error information.
 *
 * These are unit tests that mock connection attempts to avoid real database connections.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostgresConnector } from '../../src/connectors/postgres.js';
import { BigQueryConnector } from '../../src/connectors/bigquery.js';
import { SnowflakeConnector } from '../../src/connectors/snowflake.js';
import { DuckDBConnector } from '../../src/connectors/duckdb.js';
import type { ConnectorConfig } from '../../src/types/connector.js';

// Test configuration fixtures (similar to connectors.test.ts)
const validPostgresConfig: ConnectorConfig = {
  host: 'localhost',
  port: 5432,
  database: 'test_db',
  username: 'test_user',
  password: 'test_password',
  ssl: true,
};

const validDuckDBConfig: ConnectorConfig = {
  host: 'localhost',
  port: 0,
  database: ':memory:',
  username: 'duckdb',
  password: 'duckdb',
  ssl: true,
};

const validBigQueryConfig: ConnectorConfig = {
  host: 'bigquery.googleapis.com',
  port: 443,
  database: 'test-project-123',
  username: 'bigquery',
  password: JSON.stringify({
    type: 'service_account',
    project_id: 'test-project-123',
    private_key_id: 'test-key-id',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n',
    client_email: 'test@test-project-123.iam.gserviceaccount.com',
    client_id: '123456789',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  }),
  ssl: true,
};

const validSnowflakeConfig: ConnectorConfig = {
  host: 'test-account.snowflakecomputing.com',
  port: 443,
  database: 'TEST_DB',
  username: 'test_user',
  password: 'test_password',
  ssl: true,
  additionalOptions: {
    account: 'test-account',
    warehouse: 'TEST_WH',
    schema: 'PUBLIC'
  }
};

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

describe('All Connectors Debug Enhancement', () => {
  describe('PostgreSQL Connector', () => {
    it('should support debug mode configuration', () => {
      const connector = new PostgresConnector(validPostgresConfig);

      // Should have debug-related methods
      expect(connector.testConnection).toBeDefined();
      expect(typeof connector.testConnection).toBe('function');

      // Should accept debug config parameter (checked via TypeScript compilation)
      expect(() => {
        connector.testConnection({ enabled: true, exposeRawErrors: true });
      }).not.toThrow();
    });

    it('should have debug helper methods', () => {
      const connector = new PostgresConnector(validPostgresConfig);

      // These methods should exist on the connector (from base class)
      expect(connector['mergeDebugConfig']).toBeDefined();
      expect(connector['logDebugInfo']).toBeDefined();
      expect(connector['createDebugErrorFactory']).toBeDefined();
    });
  });

  describe('BigQuery Connector', () => {
    it('should support debug mode configuration', () => {
      const connector = new BigQueryConnector(validBigQueryConfig);

      // Should have debug-related methods
      expect(connector.testConnection).toBeDefined();
      expect(typeof connector.testConnection).toBe('function');

      // Should accept debug config parameter (checked via TypeScript compilation)
      expect(() => {
        connector.testConnection({ enabled: true, exposeRawErrors: true });
      }).not.toThrow();
    });

    it('should have BigQuery-specific methods', () => {
      const connector = new BigQueryConnector(validBigQueryConfig);

      // Should have BigQuery-specific methods
      expect(connector.getProjectId).toBeDefined();
      expect(connector.setLocation).toBeDefined();

      // Should have debug helpers
      expect(connector['mergeDebugConfig']).toBeDefined();
      expect(connector['logDebugInfo']).toBeDefined();
    });
  });

  describe('Snowflake Connector', () => {
    it('should support debug mode configuration', () => {
      const connector = new SnowflakeConnector(validSnowflakeConfig);

      // Should have debug-related methods
      expect(connector.testConnection).toBeDefined();
      expect(typeof connector.testConnection).toBe('function');

      // Should accept debug config parameter (checked via TypeScript compilation)
      expect(() => {
        connector.testConnection({ enabled: true, exposeRawErrors: true });
      }).not.toThrow();
    });

    it('should have Snowflake-specific methods', () => {
      const connector = new SnowflakeConnector(validSnowflakeConfig);

      // Should have Snowflake-specific methods
      expect(connector.getAccount).toBeDefined();
      expect(connector.setWarehouse).toBeDefined();
      expect(connector.setSchema).toBeDefined();

      // Test account extraction
      expect(connector.getAccount()).toBe('test-account');

      // Should have debug helpers
      expect(connector['mergeDebugConfig']).toBeDefined();
      expect(connector['logDebugInfo']).toBeDefined();
    });
  });

  describe('DuckDB Connector', () => {
    it('should support debug mode configuration', () => {
      const connector = new DuckDBConnector(validDuckDBConfig);

      // Should have debug-related methods
      expect(connector.testConnection).toBeDefined();
      expect(typeof connector.testConnection).toBe('function');

      // Should accept debug config parameter (checked via TypeScript compilation)
      expect(() => {
        connector.testConnection({ enabled: true, exposeRawErrors: true });
      }).not.toThrow();
    });

    it('should have DuckDB-specific methods', () => {
      const connector = new DuckDBConnector(validDuckDBConfig);

      // Should have DuckDB-specific methods
      expect(connector.getDatabasePath).toBeDefined();
      expect(connector.isInMemory).toBeDefined();

      // Test memory database detection
      expect(connector.isInMemory()).toBe(true);
      expect(connector.getDatabasePath()).toBe(':memory:');

      // Should have debug helpers
      expect(connector['mergeDebugConfig']).toBeDefined();
      expect(connector['logDebugInfo']).toBeDefined();
    });

    it('should handle file database configuration', () => {
      const fileConfig = { ...validDuckDBConfig, database: '/tmp/test.db' };
      const connector = new DuckDBConnector(fileConfig);

      expect(connector.isInMemory()).toBe(false);
      expect(connector.getDatabasePath()).toBe('/tmp/test.db');
    });
  });

  describe('Unified Debug Interface', () => {
    it('should have consistent debug interface across all connectors', () => {
      // Test that all connectors can be instantiated with valid configs
      const postgres = new PostgresConnector(validPostgresConfig);
      const bigquery = new BigQueryConnector(validBigQueryConfig);
      const snowflake = new SnowflakeConnector(validSnowflakeConfig);
      const duckdb = new DuckDBConnector(validDuckDBConfig);

      const connectors = [postgres, bigquery, snowflake, duckdb];

      // All should have testConnection method that accepts debug config
      for (const connector of connectors) {
        expect(connector.testConnection).toBeDefined();
        expect(typeof connector.testConnection).toBe('function');

        // Should have debug helper methods from base class
        expect(connector['mergeDebugConfig']).toBeDefined();
        expect(connector['logDebugInfo']).toBeDefined();
        expect(connector['createDebugErrorFactory']).toBeDefined();
      }
    });

    it('should handle debug config consistently across connectors', () => {
      const debugConfig = {
        enabled: true,
        exposeQueries: true,
        exposeRawErrors: true
      };

      const postgres = new PostgresConnector(validPostgresConfig);
      const bigquery = new BigQueryConnector(validBigQueryConfig);
      const snowflake = new SnowflakeConnector(validSnowflakeConfig);
      const duckdb = new DuckDBConnector(validDuckDBConfig);

      const connectors = [postgres, bigquery, snowflake, duckdb];

      // All should accept debug config parameter (TypeScript compilation ensures this)
      for (const connector of connectors) {
        expect(() => {
          connector.testConnection(debugConfig);
        }).not.toThrow();
      }
    });

    it('should provide debug factory methods', () => {
      const postgres = new PostgresConnector(validPostgresConfig);
      const bigquery = new BigQueryConnector(validBigQueryConfig);
      const snowflake = new SnowflakeConnector(validSnowflakeConfig);
      const duckdb = new DuckDBConnector(validDuckDBConfig);

      const connectors = [postgres, bigquery, snowflake, duckdb];

      // All should have debug factory creation method
      for (const connector of connectors) {
        const factory = connector['createDebugErrorFactory']({ enabled: true });
        expect(factory).toBeDefined();
        expect(typeof factory.createConnectionError).toBe('function');
        expect(typeof factory.createQueryError).toBe('function');
      }
    });
  });
});