/**
 * Tests for secure database connectors
 * Tests the new secure API and validation features
 */

import { describe, it, expect } from 'vitest';
import { PostgresConnector } from '../src/connectors/postgres.js';
import { DuckDBConnector } from '../src/connectors/duckdb.js';
import { BigQueryConnector } from '../src/connectors/bigquery.js';
import { SnowflakeConnector } from '../src/connectors/snowflake.js';
import { MySQLConnector } from '../src/connectors/mysql.js';
import { RedshiftConnector } from '../src/connectors/redshift.js';
import type { ConnectorConfig } from '../src/types/connector.js';
import { SecurityError } from '../src/errors/index.js';

// Test configuration fixtures
const validPostgresConfig: ConnectorConfig = {
  host: 'localhost',
  port: 5432,
  database: 'test_db',
  username: 'test_user',
  password: 'test_password',
  ssl: true,
};

const validDuckDBConfig: ConnectorConfig = {
  host: 'localhost', // Not used but required by interface
  port: 0, // Not used but required by interface
  database: ':memory:',
  username: 'duckdb', // Not used but required by interface
  password: 'duckdb', // Not used but required by interface
  ssl: true, // Required by security policy, not used by DuckDB
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
};

const validMySQLConfig: ConnectorConfig = {
  host: 'localhost',
  port: 3306,
  database: 'test_db',
  username: 'test_user',
  password: 'test_password',
  ssl: true,
};

const validRedshiftConfig: ConnectorConfig = {
  host: 'test-cluster.redshift.amazonaws.com',
  port: 5439,
  database: 'test_db',
  username: 'test_user',
  password: 'test_password',
  ssl: true,
};

describe('PostgresConnector Security', () => {
  it('should instantiate with valid configuration', () => {
    expect(() => new PostgresConnector(validPostgresConfig)).not.toThrow();
  });

  it('should reject invalid configuration', () => {
    expect(() => new PostgresConnector({} as ConnectorConfig)).toThrow();
    expect(() => new PostgresConnector({
      host: '',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'pass',
    })).toThrow('Host is required');
  });

  it('should have secure connector interface methods', () => {
    const connector = new PostgresConnector(validPostgresConfig);

    // New secure methods
    expect(connector.testConnection).toBeDefined();
    expect(connector.listTables).toBeDefined();
    expect(connector.getTableSchema).toBeDefined();
    expect(connector.getRowCount).toBeDefined();
    expect(connector.getMaxTimestamp).toBeDefined();
    expect(connector.getMinTimestamp).toBeDefined();
    expect(connector.getLastModified).toBeDefined();
    expect(connector.close).toBeDefined();

    // Legacy methods (deprecated but present)
    expect(connector.connectLegacy).toBeDefined();
    expect(connector.testConnectionLegacy).toBeDefined();
    expect(connector.getTableMetadata).toBeDefined();
  });

  it('should block direct SQL queries for security', async () => {
    const connector = new PostgresConnector(validPostgresConfig);
    await expect(connector.query('SELECT * FROM users')).rejects.toThrow(
      'Direct SQL queries are not allowed for security reasons'
    );
  });

  it('should validate host parameter', () => {
    expect(() => new PostgresConnector({
      ...validPostgresConfig,
      host: '',
    })).toThrow('Host is required');
  });

  it('should validate port parameter', () => {
    expect(() => new PostgresConnector({
      ...validPostgresConfig,
      port: 99999,
    })).toThrow('Port must be between 1 and 65535');
  });

  it('should require SSL by default', () => {
    expect(() => new PostgresConnector({
      ...validPostgresConfig,
      ssl: false,
    })).toThrow(SecurityError);
  });
});

describe('DuckDBConnector Security', () => {
  it('should instantiate with valid configuration', () => {
    expect(() => new DuckDBConnector(validDuckDBConfig)).not.toThrow();
  });

  it('should reject invalid database paths', () => {
    expect(() => new DuckDBConnector({
      ...validDuckDBConfig,
      database: '../../../etc/passwd',
    })).toThrow('Database path cannot contain directory traversal patterns');
  });

  it('should reject system directory access', () => {
    expect(() => new DuckDBConnector({
      ...validDuckDBConfig,
      database: '/etc/shadow',
    })).toThrow('Database path cannot access system directories');
  });

  it('should have secure connector interface methods', () => {
    const connector = new DuckDBConnector(validDuckDBConfig);

    // Secure methods
    expect(connector.testConnection).toBeDefined();
    expect(connector.listTables).toBeDefined();
    expect(connector.getTableSchema).toBeDefined();
    expect(connector.getRowCount).toBeDefined();
    expect(connector.close).toBeDefined();

    // DuckDB-specific methods
    expect(connector.getDatabasePath).toBeDefined();
    expect(connector.isInMemory).toBeDefined();
  });

  it('should block direct SQL queries for security', async () => {
    const connector = new DuckDBConnector(validDuckDBConfig);
    await expect(connector.query('DROP TABLE users')).rejects.toThrow(
      'Direct SQL queries are not allowed for security reasons'
    );
  });

  it('should allow memory database', () => {
    const connector = new DuckDBConnector({
      ...validDuckDBConfig,
      database: ':memory:',
    });
    expect(connector.isInMemory()).toBe(true);
  });
});

describe('BigQueryConnector Security', () => {
  it('should instantiate with valid configuration', () => {
    expect(() => new BigQueryConnector(validBigQueryConfig)).not.toThrow();
  });

  it('should reject invalid project ID format', () => {
    expect(() => new BigQueryConnector({
      ...validBigQueryConfig,
      database: 'Invalid_Project-123!',
    })).toThrow('Invalid BigQuery project ID format');
  });

  it('should validate service account credentials', () => {
    expect(() => new BigQueryConnector({
      ...validBigQueryConfig,
      password: '{"type": "invalid_account"}',
    })).toThrow('Invalid service account credentials format');
  });

  it('should validate project ID match in service account', () => {
    expect(() => new BigQueryConnector({
      ...validBigQueryConfig,
      password: JSON.stringify({
        type: 'service_account',
        project_id: 'different-project',
      }),
    })).toThrow('Service account project ID does not match specified project');
  });

  it('should have secure connector interface methods', () => {
    const connector = new BigQueryConnector(validBigQueryConfig);

    expect(connector.testConnection).toBeDefined();
    expect(connector.listTables).toBeDefined();
    expect(connector.getTableSchema).toBeDefined();
    expect(connector.getProjectId).toBeDefined();
    expect(connector.setLocation).toBeDefined();
  });

  it('should block direct SQL queries for security', async () => {
    const connector = new BigQueryConnector(validBigQueryConfig);
    await expect(connector.query('DELETE FROM dataset.table')).rejects.toThrow(
      'Direct SQL queries are not allowed for security reasons'
    );
  });
});

describe('SnowflakeConnector Security', () => {
  it('should instantiate with valid configuration', () => {
    expect(() => new SnowflakeConnector(validSnowflakeConfig)).not.toThrow();
  });

  it('should reject invalid host format', () => {
    expect(() => new SnowflakeConnector({
      ...validSnowflakeConfig,
      host: 'invalid-host.com',
    })).toThrow('Invalid Snowflake host format');
  });

  it('should require credentials', () => {
    expect(() => new SnowflakeConnector({
      ...validSnowflakeConfig,
      username: '',
    })).toThrow('Username and password are required for Snowflake');
  });

  it('should extract account from host', () => {
    const connector = new SnowflakeConnector(validSnowflakeConfig);
    expect(connector.getAccount()).toBe('test-account');
  });

  it('should have secure connector interface methods', () => {
    const connector = new SnowflakeConnector(validSnowflakeConfig);

    expect(connector.testConnection).toBeDefined();
    expect(connector.listTables).toBeDefined();
    expect(connector.getTableSchema).toBeDefined();
    expect(connector.getAccount).toBeDefined();
    expect(connector.setWarehouse).toBeDefined();
    expect(connector.setSchema).toBeDefined();
  });

  it('should block direct SQL queries for security', async () => {
    const connector = new SnowflakeConnector(validSnowflakeConfig);
    await expect(connector.query('TRUNCATE TABLE users')).rejects.toThrow(
      'Direct SQL queries are not allowed for security reasons'
    );
  });
});

describe('MySQLConnector Security', () => {
  it('should instantiate with valid configuration', () => {
    expect(() => new MySQLConnector(validMySQLConfig)).not.toThrow();
  });

  it('should reject invalid configuration', () => {
    expect(() => new MySQLConnector({} as ConnectorConfig)).toThrow();
    expect(() => new MySQLConnector({
      host: '',
      port: 3306,
      database: 'test',
      username: 'user',
      password: 'pass',
    })).toThrow('Host is required');
  });

  it('should have secure connector interface methods', () => {
    const connector = new MySQLConnector(validMySQLConfig);

    // New secure methods
    expect(connector.testConnection).toBeDefined();
    expect(connector.listTables).toBeDefined();
    expect(connector.getTableSchema).toBeDefined();
    expect(connector.getRowCount).toBeDefined();
    expect(connector.getMaxTimestamp).toBeDefined();
    expect(connector.getMinTimestamp).toBeDefined();
    expect(connector.getLastModified).toBeDefined();
    expect(connector.close).toBeDefined();

    // Legacy methods (deprecated but present)
    expect(connector.connectLegacy).toBeDefined();
    expect(connector.testConnectionLegacy).toBeDefined();
    expect(connector.getTableMetadata).toBeDefined();
  });

  it('should block direct SQL queries for security', async () => {
    const connector = new MySQLConnector(validMySQLConfig);
    await expect(connector.query('SELECT * FROM users')).rejects.toThrow(
      'Direct SQL queries are not allowed for security reasons'
    );
  });

  it('should validate host parameter', () => {
    expect(() => new MySQLConnector({
      ...validMySQLConfig,
      host: '',
    })).toThrow('Host is required');
  });

  it('should validate port parameter', () => {
    expect(() => new MySQLConnector({
      ...validMySQLConfig,
      port: 99999,
    })).toThrow('Port must be between 1 and 65535');
  });

  it('should require SSL by default', () => {
    expect(() => new MySQLConnector({
      ...validMySQLConfig,
      ssl: false,
    })).toThrow(SecurityError);
  });

  it('should use MySQL default port when not specified', () => {
    const config = { ...validMySQLConfig };
    delete config.port;
    expect(() => new MySQLConnector(config)).not.toThrow();
  });
});

describe('RedshiftConnector Security', () => {
  it('should instantiate with valid configuration', () => {
    expect(() => new RedshiftConnector(validRedshiftConfig)).not.toThrow();
  });

  it('should reject invalid configuration', () => {
    expect(() => new RedshiftConnector({} as ConnectorConfig)).toThrow();
    expect(() => new RedshiftConnector({
      host: '',
      port: 5439,
      database: 'test',
      username: 'user',
      password: 'pass',
    })).toThrow('Host is required');
  });

  it('should have secure connector interface methods', () => {
    const connector = new RedshiftConnector(validRedshiftConfig);

    // New secure methods
    expect(connector.testConnection).toBeDefined();
    expect(connector.listTables).toBeDefined();
    expect(connector.getTableSchema).toBeDefined();
    expect(connector.getRowCount).toBeDefined();
    expect(connector.getMaxTimestamp).toBeDefined();
    expect(connector.getMinTimestamp).toBeDefined();
    expect(connector.getLastModified).toBeDefined();
    expect(connector.close).toBeDefined();

    // Legacy methods (deprecated but present)
    expect(connector.connectLegacy).toBeDefined();
    expect(connector.testConnectionLegacy).toBeDefined();
    expect(connector.getTableMetadata).toBeDefined();
  });

  it('should block direct SQL queries for security', async () => {
    const connector = new RedshiftConnector(validRedshiftConfig);
    await expect(connector.query('SELECT * FROM users')).rejects.toThrow(
      'Direct SQL queries are not allowed for security reasons'
    );
  });

  it('should validate host parameter', () => {
    expect(() => new RedshiftConnector({
      ...validRedshiftConfig,
      host: '',
    })).toThrow('Host is required');
  });

  it('should validate port parameter', () => {
    expect(() => new RedshiftConnector({
      ...validRedshiftConfig,
      port: 99999,
    })).toThrow('Port must be between 1 and 65535');
  });

  it('should require SSL by default', () => {
    expect(() => new RedshiftConnector({
      ...validRedshiftConfig,
      ssl: false,
    })).toThrow(SecurityError);
  });

  it('should use Redshift default port when not specified', () => {
    const config = { ...validRedshiftConfig };
    delete config.port;
    expect(() => new RedshiftConnector(config)).not.toThrow();
  });
});

describe('Connector Security Consistency', () => {
  it('should all extend BaseConnector with security features', () => {
    const postgres = new PostgresConnector(validPostgresConfig);
    const duckdb = new DuckDBConnector(validDuckDBConfig);
    const bigquery = new BigQueryConnector(validBigQueryConfig);
    const snowflake = new SnowflakeConnector(validSnowflakeConfig);
    const mysql = new MySQLConnector(validMySQLConfig);
    const redshift = new RedshiftConnector(validRedshiftConfig);

    const connectors = [postgres, duckdb, bigquery, snowflake, mysql, redshift];

    // All should have core security methods
    for (const connector of connectors) {
      expect(connector.testConnection).toBeDefined();
      expect(connector.listTables).toBeDefined();
      expect(connector.getRowCount).toBeDefined();
      expect(connector.getMaxTimestamp).toBeDefined();
      expect(connector.getMinTimestamp).toBeDefined();
      expect(connector.getLastModified).toBeDefined();
      expect(connector.close).toBeDefined();
    }
  });

  it('should all block direct SQL execution', async () => {
    const postgres = new PostgresConnector(validPostgresConfig);
    const duckdb = new DuckDBConnector(validDuckDBConfig);
    const bigquery = new BigQueryConnector(validBigQueryConfig);
    const snowflake = new SnowflakeConnector(validSnowflakeConfig);
    const mysql = new MySQLConnector(validMySQLConfig);
    const redshift = new RedshiftConnector(validRedshiftConfig);

    const connectors = [postgres, duckdb, bigquery, snowflake, mysql, redshift];

    for (const connector of connectors) {
      await expect(connector.query('SELECT 1')).rejects.toThrow(
        'Direct SQL queries are not allowed for security reasons'
      );
    }
  });

  it('should all provide legacy compatibility with deprecation warnings', () => {
    const postgres = new PostgresConnector(validPostgresConfig);
    const duckdb = new DuckDBConnector(validDuckDBConfig);
    const bigquery = new BigQueryConnector(validBigQueryConfig);
    const snowflake = new SnowflakeConnector(validSnowflakeConfig);
    const mysql = new MySQLConnector(validMySQLConfig);
    const redshift = new RedshiftConnector(validRedshiftConfig);

    const connectors = [postgres, duckdb, bigquery, snowflake, mysql, redshift];

    // All should have deprecated legacy methods
    for (const connector of connectors) {
      expect(connector.connectLegacy).toBeDefined();
      expect(connector.testConnectionLegacy).toBeDefined();
      expect(connector.getTableMetadata).toBeDefined();
    }
  });
});
