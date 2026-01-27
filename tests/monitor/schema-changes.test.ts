/**
 * Unit tests for schema change monitoring
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkSchemaChanges } from '../../src/monitor/schema-changes.js';
import { SchemaComparer } from '../../src/monitor/schema-baseline.js';
import type { MonitoringRule, FreshGuardConfig } from '../../src/types.js';
import type { Connector, TableSchema } from '../../src/types/connector.js';
import type { MetadataStorage } from '../../src/metadata/interface.js';

// Mock connector
const mockConnector: Connector = {
  testConnection: vi.fn(),
  listTables: vi.fn(),
  getTableSchema: vi.fn(),
  getRowCount: vi.fn(),
  getMaxTimestamp: vi.fn(),
  getMinTimestamp: vi.fn(),
  getLastModified: vi.fn(),
  close: vi.fn(),
};

// Mock metadata storage
const mockMetadataStorage: MetadataStorage = {
  saveExecution: vi.fn(),
  getHistoricalData: vi.fn(),
  saveRule: vi.fn(),
  getRule: vi.fn(),
  storeSchemaBaseline: vi.fn(),
  getSchemaBaseline: vi.fn(),
  initialize: vi.fn(),
  close: vi.fn(),
};

// Test table schema
const testTableSchema: TableSchema = {
  table: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false },
    { name: 'name', type: 'varchar(255)', nullable: false },
    { name: 'email', type: 'varchar(255)', nullable: true },
    { name: 'created_at', type: 'timestamp', nullable: false },
  ],
};

// Test monitoring rule
const testRule: MonitoringRule = {
  id: 'test-rule-1',
  sourceId: 'test-source-1',
  name: 'Test Schema Monitor',
  tableName: 'users',
  ruleType: 'schema_change',
  checkIntervalMinutes: 60,
  isActive: true,
  trackColumnChanges: true,
  trackTableChanges: true,
  schemaChangeConfig: {
    adaptationMode: 'manual',
    monitoringMode: 'full',
    trackedColumns: {
      trackTypes: true,
      trackNullability: false,
    },
  },
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const testConfig: FreshGuardConfig = {
  sources: {},
  rules: [],
  timeoutMs: 30000,
  debug: { enabled: true },
};

describe('Schema Change Monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkSchemaChanges', () => {
    it('should capture initial baseline on first run', async () => {
      // Setup
      vi.mocked(mockConnector.getTableSchema).mockResolvedValue(testTableSchema);
      vi.mocked(mockMetadataStorage.getSchemaBaseline).mockResolvedValue(null);

      // Execute
      const result = await checkSchemaChanges(
        mockConnector,
        testRule,
        mockMetadataStorage,
        testConfig
      );

      // Verify
      expect(result.status).toBe('ok');
      expect(result.schemaChanges?.hasChanges).toBe(false);
      expect(result.schemaChanges?.summary).toBe('Initial baseline captured');
      expect(mockMetadataStorage.storeSchemaBaseline).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: testRule.id,
          tableName: testRule.tableName,
          schema: testTableSchema,
        }),
        'Initial baseline capture'
      );
    });

    it('should detect no changes when schema is identical', async () => {
      // Setup
      const baseline = {
        ruleId: testRule.id,
        tableName: testRule.tableName,
        schema: testTableSchema,
        capturedAt: new Date('2024-01-01'),
        schemaHash: 'test-hash',
      };

      vi.mocked(mockConnector.getTableSchema).mockResolvedValue(testTableSchema);
      vi.mocked(mockMetadataStorage.getSchemaBaseline).mockResolvedValue(baseline);

      // Execute
      const result = await checkSchemaChanges(
        mockConnector,
        testRule,
        mockMetadataStorage,
        testConfig
      );

      // Verify
      expect(result.status).toBe('ok');
      expect(result.schemaChanges?.hasChanges).toBe(false);
      expect(result.schemaChanges?.changeCount).toBe(0);
    });

    it('should detect added column', async () => {
      // Setup
      const baseline = {
        ruleId: testRule.id,
        tableName: testRule.tableName,
        schema: testTableSchema,
        capturedAt: new Date('2024-01-01'),
        schemaHash: 'test-hash',
      };

      const modifiedSchema: TableSchema = {
        ...testTableSchema,
        columns: [
          ...testTableSchema.columns,
          { name: 'phone', type: 'varchar(20)', nullable: true },
        ],
      };

      vi.mocked(mockConnector.getTableSchema).mockResolvedValue(modifiedSchema);
      vi.mocked(mockMetadataStorage.getSchemaBaseline).mockResolvedValue(baseline);

      // Execute
      const result = await checkSchemaChanges(
        mockConnector,
        testRule,
        mockMetadataStorage,
        testConfig
      );

      // Verify
      expect(result.status).toBe('alert');
      expect(result.schemaChanges?.hasChanges).toBe(true);
      expect(result.schemaChanges?.addedColumns).toHaveLength(1);
      expect(result.schemaChanges?.addedColumns[0].columnName).toBe('phone');
      expect(result.schemaChanges?.changeCount).toBe(1);
    });

    it('should detect removed column', async () => {
      // Setup
      const baseline = {
        ruleId: testRule.id,
        tableName: testRule.tableName,
        schema: testTableSchema,
        capturedAt: new Date('2024-01-01'),
        schemaHash: 'test-hash',
      };

      const modifiedSchema: TableSchema = {
        ...testTableSchema,
        columns: testTableSchema.columns.filter((col) => col.name !== 'email'),
      };

      vi.mocked(mockConnector.getTableSchema).mockResolvedValue(modifiedSchema);
      vi.mocked(mockMetadataStorage.getSchemaBaseline).mockResolvedValue(baseline);

      // Execute
      const result = await checkSchemaChanges(
        mockConnector,
        testRule,
        mockMetadataStorage,
        testConfig
      );

      // Verify
      expect(result.status).toBe('alert');
      expect(result.schemaChanges?.hasChanges).toBe(true);
      expect(result.schemaChanges?.removedColumns).toHaveLength(1);
      expect(result.schemaChanges?.removedColumns[0].columnName).toBe('email');
      expect(result.schemaChanges?.removedColumns[0].impact).toBe('breaking');
    });

    it('should detect type change', async () => {
      // Setup
      const baseline = {
        ruleId: testRule.id,
        tableName: testRule.tableName,
        schema: testTableSchema,
        capturedAt: new Date('2024-01-01'),
        schemaHash: 'test-hash',
      };

      const modifiedSchema: TableSchema = {
        ...testTableSchema,
        columns: testTableSchema.columns.map((col) =>
          col.name === 'id' ? { ...col, type: 'bigint' } : col
        ),
      };

      vi.mocked(mockConnector.getTableSchema).mockResolvedValue(modifiedSchema);
      vi.mocked(mockMetadataStorage.getSchemaBaseline).mockResolvedValue(baseline);

      // Execute
      const result = await checkSchemaChanges(
        mockConnector,
        testRule,
        mockMetadataStorage,
        testConfig
      );

      // Verify
      expect(result.status).toBe('alert');
      expect(result.schemaChanges?.hasChanges).toBe(true);
      expect(result.schemaChanges?.modifiedColumns).toHaveLength(1);
      expect(result.schemaChanges?.modifiedColumns[0].columnName).toBe('id');
      expect(result.schemaChanges?.modifiedColumns[0].changeType).toBe('type_changed');
      expect(result.schemaChanges?.modifiedColumns[0].impact).toBe('safe');
    });

    it('should auto-adapt to safe changes in auto mode', async () => {
      // Setup
      const autoAdaptRule = {
        ...testRule,
        schemaChangeConfig: {
          ...testRule.schemaChangeConfig,
          adaptationMode: 'auto' as const,
        },
      };

      const baseline = {
        ruleId: testRule.id,
        tableName: testRule.tableName,
        schema: testTableSchema,
        capturedAt: new Date('2024-01-01'),
        schemaHash: 'test-hash',
      };

      const modifiedSchema: TableSchema = {
        ...testTableSchema,
        columns: [
          ...testTableSchema.columns,
          { name: 'phone', type: 'varchar(20)', nullable: true },
        ],
      };

      vi.mocked(mockConnector.getTableSchema).mockResolvedValue(modifiedSchema);
      vi.mocked(mockMetadataStorage.getSchemaBaseline).mockResolvedValue(baseline);

      // Execute
      const result = await checkSchemaChanges(
        mockConnector,
        autoAdaptRule,
        mockMetadataStorage,
        testConfig
      );

      // Verify
      expect(result.status).toBe('ok'); // No alert because auto-adapted
      expect(result.schemaChanges?.hasChanges).toBe(true);
      expect(mockMetadataStorage.storeSchemaBaseline).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: modifiedSchema,
        }),
        expect.stringContaining('Auto-adaptation')
      );
    });

    it('should handle connector errors gracefully', async () => {
      // Setup
      vi.mocked(mockConnector.getTableSchema).mockRejectedValue(
        new Error('Table does not exist')
      );

      // Execute
      const result = await checkSchemaChanges(
        mockConnector,
        testRule,
        mockMetadataStorage,
        testConfig
      );

      // Verify
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.executionDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should work without metadata storage', async () => {
      // Setup
      vi.mocked(mockConnector.getTableSchema).mockResolvedValue(testTableSchema);

      // Execute
      const result = await checkSchemaChanges(mockConnector, testRule, undefined, testConfig);

      // Verify
      expect(result.status).toBe('ok');
      expect(result.schemaChanges?.hasChanges).toBe(false);
      expect(result.schemaChanges?.summary).toBe('Initial baseline captured');
    });
  });

  describe('SchemaComparer', () => {
    let comparer: SchemaComparer;

    beforeEach(() => {
      comparer = new SchemaComparer();
    });

    it('should detect no changes for identical schemas', () => {
      const changes = comparer.compareSchemas(testTableSchema, testTableSchema);

      expect(changes.hasChanges).toBe(false);
      expect(changes.changeCount).toBe(0);
      expect(changes.severity).toBe('low');
    });

    it('should calculate correct severity levels', () => {
      // High severity for breaking changes
      const removedColumnSchema: TableSchema = {
        ...testTableSchema,
        columns: testTableSchema.columns.filter((col) => col.name !== 'email'),
      };

      const highSeverity = comparer.compareSchemas(testTableSchema, removedColumnSchema);
      expect(highSeverity.severity).toBe('high');

      // Low severity for safe additions
      const addedColumnSchema: TableSchema = {
        ...testTableSchema,
        columns: [
          ...testTableSchema.columns,
          { name: 'phone', type: 'varchar(20)', nullable: true },
        ],
      };

      const lowSeverity = comparer.compareSchemas(testTableSchema, addedColumnSchema);
      expect(lowSeverity.severity).toBe('low');
    });

    it('should support partial monitoring mode', () => {
      const modifiedSchema: TableSchema = {
        ...testTableSchema,
        columns: [
          ...testTableSchema.columns,
          { name: 'phone', type: 'varchar(20)', nullable: true },
          { name: 'address', type: 'text', nullable: true },
        ],
      };

      // Only monitor specific columns
      const changes = comparer.compareSchemas(testTableSchema, modifiedSchema, {
        monitoringMode: 'partial',
        trackedColumns: ['id', 'name'], // Only track these columns, ignore phone/address
      });

      expect(changes.hasChanges).toBe(false);
      expect(changes.addedColumns).toHaveLength(0);
    });

    it('should normalize data types correctly', () => {
      const baselineSchema: TableSchema = {
        table: 'test',
        columns: [{ name: 'id', type: 'varchar(100)', nullable: false }],
      };

      const currentSchema: TableSchema = {
        table: 'test',
        columns: [{ name: 'id', type: 'varchar(200)', nullable: false }],
      };

      const changes = comparer.compareSchemas(baselineSchema, currentSchema);

      // varchar(100) vs varchar(200) should normalize to same type
      expect(changes.hasChanges).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should reject invalid rule types', async () => {
      const invalidRule = { ...testRule, ruleType: 'freshness' as const };

      const result = await checkSchemaChanges(
        mockConnector,
        invalidRule,
        mockMetadataStorage,
        testConfig
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Rule type must be "schema_change"');
    });

    it('should validate table name', async () => {
      const invalidRule = { ...testRule, tableName: '' };

      const result = await checkSchemaChanges(
        mockConnector,
        invalidRule,
        mockMetadataStorage,
        testConfig
      );

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
    });

    it('should validate schema change configuration', async () => {
      const invalidRule = {
        ...testRule,
        schemaChangeConfig: {
          adaptationMode: 'invalid' as any,
        },
      };

      const result = await checkSchemaChanges(
        mockConnector,
        invalidRule,
        mockMetadataStorage,
        testConfig
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Invalid adaptation mode');
    });
  });
});