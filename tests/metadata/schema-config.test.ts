/**
 * Tests for schema configuration resolver
 *
 * Tests the SchemaConfigResolver class that handles:
 * - Configuration resolution with defaults
 * - Table prefix application
 * - Qualified table name generation
 * - Parameter validation
 */

import { describe, it, expect } from 'vitest';
import { SchemaConfigResolver } from '../../src/metadata/schema-config.js';
import type { MetadataStorageConfig } from '../../src/metadata/types.js';
import { ConfigurationError } from '../../src/errors/index.js';

describe('SchemaConfigResolver', () => {
  describe('Configuration Resolution', () => {
    it('should apply default configuration when no schema config provided', () => {
      const config: MetadataStorageConfig = { type: 'postgresql' };
      const resolver = new SchemaConfigResolver(config);
      const resolved = resolver.getConfig();

      expect(resolved).toEqual({
        schemaName: 'public',
        tablePrefix: '',
        tables: {
          checkExecutions: 'checkExecutions',
          monitoringRules: 'monitoringRules',
        },
        qualifiedNames: {
          checkExecutions: 'public.checkExecutions',
          monitoringRules: 'public.monitoringRules',
        },
      });
    });

    it('should apply custom schema name', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: { name: 'freshguard' },
      };
      const resolver = new SchemaConfigResolver(config);

      expect(resolver.getSchemaName()).toBe('freshguard');
      expect(resolver.getQualifiedTableName('checkExecutions')).toBe('freshguard.checkExecutions');
    });

    it('should apply table prefix', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: { tablePrefix: 'fg_' },
      };
      const resolver = new SchemaConfigResolver(config);

      expect(resolver.getTablePrefix()).toBe('fg_');
      expect(resolver.getTableName('checkExecutions')).toBe('fg_checkExecutions');
      expect(resolver.getQualifiedTableName('checkExecutions')).toBe('public.fg_checkExecutions');
    });

    it('should use custom table names', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          tables: {
            checkExecutions: 'custom_executions',
            monitoringRules: 'custom_rules',
          },
        },
      };
      const resolver = new SchemaConfigResolver(config);
      const resolved = resolver.getConfig();

      expect(resolved.tables.checkExecutions).toBe('custom_executions');
      expect(resolved.tables.monitoringRules).toBe('custom_rules');
    });

    it('should combine schema name, prefix, and custom table names', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: 'app_data',
          tablePrefix: 'mon_',
          tables: {
            checkExecutions: 'check_runs',
            monitoringRules: 'rules',
          },
        },
      };
      const resolver = new SchemaConfigResolver(config);
      const resolved = resolver.getConfig();

      expect(resolved.schemaName).toBe('app_data');
      expect(resolved.tablePrefix).toBe('mon_');
      expect(resolved.tables.checkExecutions).toBe('mon_check_runs');
      expect(resolved.tables.monitoringRules).toBe('mon_rules');
      expect(resolved.qualifiedNames.checkExecutions).toBe('app_data.mon_check_runs');
      expect(resolved.qualifiedNames.monitoringRules).toBe('app_data.mon_rules');
    });

    it('should not duplicate prefix if already present', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          tablePrefix: 'fg_',
          tables: {
            checkExecutions: 'fg_executions',
            monitoringRules: 'fg_rules',
          },
        },
      };
      const resolver = new SchemaConfigResolver(config);
      const resolved = resolver.getConfig();

      expect(resolved.tables.checkExecutions).toBe('fg_executions');
      expect(resolved.tables.monitoringRules).toBe('fg_rules');
    });
  });

  describe('Validation', () => {
    it('should reject invalid schema names', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: { name: '123invalid' }, // Cannot start with number
      };

      expect(() => new SchemaConfigResolver(config)).toThrow(ConfigurationError);
    });

    it('should reject reserved keyword as schema name', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: { name: 'select' }, // Reserved keyword
      };

      expect(() => new SchemaConfigResolver(config)).toThrow(ConfigurationError);
    });

    it('should reject invalid table prefixes', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: { tablePrefix: 'prefix-with-dashes' }, // Dashes not allowed
      };

      expect(() => new SchemaConfigResolver(config)).toThrow(ConfigurationError);
    });

    it('should reject too long identifiers', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: 'a'.repeat(64), // Too long (max 63)
        },
      };

      expect(() => new SchemaConfigResolver(config)).toThrow(ConfigurationError);
    });

    it('should reject invalid table names', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          tables: {
            checkExecutions: 'table with spaces', // Spaces not allowed
            monitoringRules: 'valid_name',
          },
        },
      };

      expect(() => new SchemaConfigResolver(config)).toThrow(ConfigurationError);
    });

    it('should accept valid configurations', () => {
      const validConfigs = [
        { name: 'public' },
        { name: 'app_schema_123' },
        { tablePrefix: 'app_' },
        { tablePrefix: 'v1' },
        {
          name: 'monitoring',
          tablePrefix: 'fg_',
          tables: {
            checkExecutions: 'executions',
            monitoringRules: 'rules',
          },
        },
      ];

      validConfigs.forEach(schema => {
        const config: MetadataStorageConfig = { type: 'postgresql', schema };
        expect(() => new SchemaConfigResolver(config)).not.toThrow();
      });
    });
  });

  describe('Getter Methods', () => {
    it('should provide correct getter methods', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: 'test_schema',
          tablePrefix: 'test_',
        },
      };
      const resolver = new SchemaConfigResolver(config);

      expect(resolver.getSchemaName()).toBe('test_schema');
      expect(resolver.getTablePrefix()).toBe('test_');
      expect(resolver.getTableName('checkExecutions')).toBe('test_checkExecutions');
      expect(resolver.getQualifiedTableName('checkExecutions')).toBe('test_schema.test_checkExecutions');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty schema configuration', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {},
      };
      const resolver = new SchemaConfigResolver(config);

      expect(resolver.getSchemaName()).toBe('public');
      expect(resolver.getTablePrefix()).toBe('');
    });

    it('should handle partial table configuration', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          tables: {
            checkExecutions: 'custom_executions',
            // monitoringRules not specified
          },
        },
      };
      const resolver = new SchemaConfigResolver(config);
      const resolved = resolver.getConfig();

      expect(resolved.tables.checkExecutions).toBe('custom_executions');
      expect(resolved.tables.monitoringRules).toBe('monitoringRules');
    });

    it('should handle null and undefined values gracefully', () => {
      const config: MetadataStorageConfig = {
        type: 'postgresql',
        schema: {
          name: undefined,
          tablePrefix: undefined,
          tables: undefined,
        },
      };
      const resolver = new SchemaConfigResolver(config);

      expect(resolver.getSchemaName()).toBe('public');
      expect(resolver.getTablePrefix()).toBe('');
    });
  });
});