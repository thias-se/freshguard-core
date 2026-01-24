/**
 * Tests for PostgreSQL metadata storage
 *
 * Tests the PostgreSQLMetadataStorage class including:
 * - Schema configuration and table name customization
 * - Error handling with MetadataStorageError
 * - Constructor behavior
 */

import { describe, it, expect } from 'vitest';
import { PostgreSQLMetadataStorage } from '../../src/metadata/postgresql-storage.js';
import type { MetadataStorageConfig } from '../../src/metadata/types.js';
import { ConfigurationError } from '../../src/errors/index.js';

describe('PostgreSQLMetadataStorage', () => {
  describe('Constructor and Schema Configuration', () => {
    it('should create instance with default schema configuration', () => {
      const storage = new PostgreSQLMetadataStorage('postgresql://localhost/test');

      expect(storage).toBeInstanceOf(PostgreSQLMetadataStorage);
    });

    it('should create instance with custom schema configuration', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: 'monitoring',
          tablePrefix: 'fg_',
        },
      };

      const storage = new PostgreSQLMetadataStorage('postgresql://localhost/test', config);

      expect(storage).toBeInstanceOf(PostgreSQLMetadataStorage);
    });

    it('should use custom schema configuration with all options', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: 'app_monitoring',
          tablePrefix: 'fg_',
          tables: {
            checkExecutions: 'executions',
            monitoringRules: 'rules',
          },
        },
      };

      const storage = new PostgreSQLMetadataStorage('postgresql://localhost/test', config);

      expect(storage).toBeInstanceOf(PostgreSQLMetadataStorage);
      // Schema configuration is used internally by SchemaConfigResolver
    });

    it('should handle empty schema configuration', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {},
      };

      const storage = new PostgreSQLMetadataStorage('postgresql://localhost/test', config);

      expect(storage).toBeInstanceOf(PostgreSQLMetadataStorage);
    });

    it('should handle undefined schema configuration', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        // schema is undefined
      };

      const storage = new PostgreSQLMetadataStorage('postgresql://localhost/test', config);

      expect(storage).toBeInstanceOf(PostgreSQLMetadataStorage);
    });

    it('should handle invalid schema configuration', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: '123invalid', // Invalid schema name
        },
      };

      expect(() => new PostgreSQLMetadataStorage('postgresql://localhost/test', config))
        .toThrow(ConfigurationError);
    });

    it('should handle invalid table prefix', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          tablePrefix: 'prefix-with-dashes', // Invalid prefix
        },
      };

      expect(() => new PostgreSQLMetadataStorage('postgresql://localhost/test', config))
        .toThrow(ConfigurationError);
    });

    it('should handle invalid table names', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          tables: {
            checkExecutions: 'table with spaces', // Invalid table name
            monitoringRules: 'valid_table',
          },
        },
      };

      expect(() => new PostgreSQLMetadataStorage('postgresql://localhost/test', config))
        .toThrow(ConfigurationError);
    });

    it('should handle reserved keywords', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: 'select', // Reserved keyword
        },
      };

      expect(() => new PostgreSQLMetadataStorage('postgresql://localhost/test', config))
        .toThrow(ConfigurationError);
    });

    it('should handle too long identifiers', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: 'a'.repeat(64), // Too long (max 63)
        },
      };

      expect(() => new PostgreSQLMetadataStorage('postgresql://localhost/test', config))
        .toThrow(ConfigurationError);
    });
  });

  describe('Connection String Handling', () => {
    it('should accept valid connection URLs', () => {
      const validUrls = [
        'postgresql://localhost/test',
        'postgresql://user:password@localhost:5432/test',
        'postgresql://user@localhost/test?ssl=true',
        'postgres://localhost/test',
      ];

      validUrls.forEach(url => {
        expect(() => new PostgreSQLMetadataStorage(url)).not.toThrow();
      });
    });
  });

  describe('Legacy Configuration Support', () => {
    it('should work without metadata config (backwards compatibility)', () => {
      const storage = new PostgreSQLMetadataStorage('postgresql://localhost/test');

      expect(storage).toBeInstanceOf(PostgreSQLMetadataStorage);
    });

    it('should work with null metadata config', () => {
      // @ts-ignore - Testing null case
      const storage = new PostgreSQLMetadataStorage('postgresql://localhost/test', null);

      expect(storage).toBeInstanceOf(PostgreSQLMetadataStorage);
    });
  });
});