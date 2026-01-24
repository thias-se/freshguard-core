/**
 * Tests for enhanced volume monitoring
 *
 * Tests the checkVolumeAnomaly function including:
 * - Basic volume anomaly detection with backwards compatibility
 * - Enhanced baseline configuration options
 * - Integration with BaselineCalculator for advanced statistics
 * - Weekend exclusion and seasonal adjustment
 * - Error handling and security measures
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkVolumeAnomaly } from '../../src/monitor/volume.js';
import type { MonitoringRule } from '../../src/types.js';
import type { Database } from '../../src/db/index.js';
import type { MetadataStorage, CheckExecution } from '../../src/metadata/types.js';
import { ConfigurationError, QueryError, TimeoutError } from '../../src/errors/index.js';

// Mock database
const mockDb = {
  execute: vi.fn(),
} as Database;

// Mock metadata storage
const mockMetadataStorage: MetadataStorage = {
  initialize: vi.fn(),
  saveExecution: vi.fn(),
  getHistoricalData: vi.fn(),
  saveRule: vi.fn(),
  getRule: vi.fn(),
  close: vi.fn(),
};

// Mock table name validation
vi.mock('../../src/validators/index.js', () => ({
  validateTableName: vi.fn(),
}));

// Base rule for testing
const baseRule: MonitoringRule = {
  id: 'test-volume-rule',
  sourceId: 'test-source',
  name: 'Volume Test Rule',
  tableName: 'test_table',
  ruleType: 'volume_anomaly',
  checkIntervalMinutes: 60,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// Helper to create historical executions
function createHistoricalExecution(rowCount: number, daysAgo: number): CheckExecution {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(10, 0, 0, 0); // Consistent time

  return {
    ruleId: baseRule.id,
    status: 'ok' as const,
    rowCount,
    executedAt: date,
  };
}

// Helper to create weekly pattern data
function createWeeklyPatternData(weeks: number = 2): CheckExecution[] {
  const executions: CheckExecution[] = [];
  const baseDate = new Date('2024-01-01'); // Monday

  for (let week = 0; week < weeks; week++) {
    for (let day = 0; day < 7; day++) {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() + (week * 7) + day);
      date.setHours(10, 0, 0, 0);

      // Different patterns for different days
      let rowCount: number;
      switch (day) {
        case 1: case 2: case 3: case 4: // Tue-Fri: High activity
          rowCount = 1000;
          break;
        case 0: // Monday: Medium activity
          rowCount = 800;
          break;
        case 5: case 6: // Sat-Sun: Low activity
          rowCount = 200;
          break;
        default:
          rowCount = 500;
      }

      executions.push({
        ruleId: baseRule.id,
        status: 'ok' as const,
        rowCount,
        executedAt: date,
      });
    }
  }

  return executions;
}

describe('checkVolumeAnomaly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue([{ row_count: '1000' }]);
    mockMetadataStorage.getHistoricalData.mockResolvedValue([]);
    mockMetadataStorage.saveExecution.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Backwards Compatibility', () => {
    it('should work with legacy baseline configuration', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineWindowDays: 30,
        deviationThresholdPercent: 20,
        minimumRowCount: 0,
      };

      const historicalData = [
        createHistoricalExecution(900, 5),
        createHistoricalExecution(1000, 4),
        createHistoricalExecution(1100, 3),
      ];

      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok'); // 1000 is within 20% of ~1000
      expect(result.rowCount).toBe(1000);
      expect(result.baselineAverage).toBeCloseTo(1000, 0);
      expect(result.deviation).toBeCloseTo(0, 0);
    });

    it('should use default values when no configuration provided', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        // No baseline configuration
      };

      const historicalData = [
        createHistoricalExecution(900, 5),
        createHistoricalExecution(1000, 4),
        createHistoricalExecution(1100, 3),
      ];

      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok');
      expect(mockMetadataStorage.getHistoricalData).toHaveBeenCalledWith(rule.id, 30); // Default 30 days
    });
  });

  describe('Enhanced Baseline Configuration', () => {
    it('should use enhanced baseline configuration', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          windowDays: 14,
          minimumDataPoints: 5,
          timeoutSeconds: 60,
          calculationMethod: 'median',
          deviationThresholdPercent: 25,
        },
      };

      const historicalData = [
        createHistoricalExecution(800, 6),
        createHistoricalExecution(900, 5),
        createHistoricalExecution(1000, 4),
        createHistoricalExecution(1100, 3),
        createHistoricalExecution(1200, 2),
      ];

      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok'); // Should use median calculation
      expect(mockMetadataStorage.getHistoricalData).toHaveBeenCalledWith(rule.id, 14); // Custom window
    });

    it('should override legacy fields with baseline config', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineWindowDays: 30, // Legacy field
        deviationThresholdPercent: 20, // Legacy field
        baselineConfig: {
          windowDays: 7, // Should override legacy
          calculationMethod: 'trimmed_mean',
          trimmedMeanPercentile: 20,
        },
      };

      const historicalData = Array.from({ length: 10 }, (_, i) =>
        createHistoricalExecution(1000 + (i * 50), i + 1)
      );

      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(mockMetadataStorage.getHistoricalData).toHaveBeenCalledWith(rule.id, 7); // Uses baseline config
      expect(result.status).toBe('ok');
    });

    it('should handle weekend exclusion', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          excludeWeekends: true,
          minimumDataPoints: 3,
        },
      };

      const weeklyData = createWeeklyPatternData(2);
      mockMetadataStorage.getHistoricalData.mockResolvedValue(weeklyData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      // Should exclude weekend data and use only weekday patterns
      expect(result.status).toBe('ok');
      expect(result.baselineAverage).toBeGreaterThan(600); // Should reflect weekday average
    });

    it('should handle seasonal adjustment', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          seasonalAdjustment: true,
          minimumDataPoints: 5,
        },
      };

      const weeklyData = createWeeklyPatternData(3); // Three weeks for seasonal adjustment
      mockMetadataStorage.getHistoricalData.mockResolvedValue(weeklyData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok');
      // Seasonal adjustment should normalize day-of-week patterns
    });
  });

  describe('Minimum Data Points Handling', () => {
    it('should return ok status when insufficient data points', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          minimumDataPoints: 5,
        },
      };

      const insufficientData = [
        createHistoricalExecution(900, 2),
        createHistoricalExecution(1000, 1),
      ]; // Only 2 data points

      mockMetadataStorage.getHistoricalData.mockResolvedValue(insufficientData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok');
      expect(result.baselineAverage).toBe(1000); // Current row count
      expect(result.deviation).toBe(0);
    });

    it('should respect legacy minimum data points behavior', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        // No baseline config, should use legacy minimum of 3
      };

      const insufficientData = [
        createHistoricalExecution(900, 2),
        createHistoricalExecution(1000, 1),
      ]; // Only 2 data points

      mockMetadataStorage.getHistoricalData.mockResolvedValue(insufficientData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok');
      expect(result.baselineAverage).toBe(1000); // Falls back to current
    });
  });

  describe('Anomaly Detection', () => {
    it('should detect volume anomaly with significant deviation', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        deviationThresholdPercent: 20,
      };

      const historicalData = [
        createHistoricalExecution(1000, 5),
        createHistoricalExecution(1000, 4),
        createHistoricalExecution(1000, 3),
      ];

      mockDb.execute.mockResolvedValue([{ row_count: '1300' }]); // 30% increase
      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('alert');
      expect(result.rowCount).toBe(1300);
      expect(result.deviation).toBeCloseTo(30, 1);
      expect(result.baselineAverage).toBe(1000);
    });

    it('should not trigger anomaly within threshold', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        deviationThresholdPercent: 25,
      };

      const historicalData = [
        createHistoricalExecution(1000, 5),
        createHistoricalExecution(1000, 4),
        createHistoricalExecution(1000, 3),
      ];

      mockDb.execute.mockResolvedValue([{ row_count: '1200' }]); // 20% increase
      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok');
      expect(result.deviation).toBeCloseTo(20, 1);
    });
  });

  describe('Minimum Row Count Handling', () => {
    it('should skip check when below minimum row count', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        minimumRowCount: 100,
      };

      mockDb.execute.mockResolvedValue([{ row_count: '50' }]); // Below minimum

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok');
      expect(result.rowCount).toBe(50);
      expect(result.deviation).toBe(0);
      expect(mockMetadataStorage.getHistoricalData).not.toHaveBeenCalled();
    });

    it('should proceed with check when above minimum row count', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        minimumRowCount: 100,
      };

      const historicalData = [
        createHistoricalExecution(1000, 3),
        createHistoricalExecution(1100, 2),
        createHistoricalExecution(900, 1),
      ];

      mockDb.execute.mockResolvedValue([{ row_count: '1050' }]); // Above minimum
      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok');
      expect(result.rowCount).toBe(1050);
      expect(mockMetadataStorage.getHistoricalData).toHaveBeenCalled();
    });
  });

  describe('Timeout Handling', () => {
    it('should use custom timeout from baseline config', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          timeoutSeconds: 10, // Custom timeout
        },
      };

      // Mock a slow query that should timeout
      const slowPromise = new Promise(resolve => setTimeout(resolve, 15000));
      mockDb.execute.mockReturnValue(slowPromise);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('timeout');
    }, 12000); // Allow test to complete within timeout

    it('should handle timeout gracefully', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          timeoutSeconds: 1, // Very short timeout
        },
      };

      // Mock a query that takes longer than timeout
      mockDb.execute.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve([{ row_count: '1000' }]), 2000))
      );

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('timeout');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid rule configuration', async () => {
      const invalidRule = {
        ...baseRule,
        ruleType: 'freshness' as const, // Wrong type for volume check
      };

      const result = await checkVolumeAnomaly(mockDb, invalidRule, mockMetadataStorage);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('volume_anomaly');
    });

    it('should handle database connection errors', async () => {
      const rule = { ...baseRule };

      mockDb.execute.mockRejectedValue(new Error('Connection lost'));

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('failed');
      expect(result.error).not.toContain('Connection lost'); // Sanitized
    });

    it('should handle metadata storage failures gracefully', async () => {
      const rule = { ...baseRule };

      const historicalData = [
        createHistoricalExecution(1000, 3),
        createHistoricalExecution(1100, 2),
        createHistoricalExecution(900, 1),
      ];

      mockMetadataStorage.getHistoricalData.mockRejectedValue(new Error('Storage failure'));
      // Should continue without historical data

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok'); // Should still complete
    });

    it('should handle save execution failures gracefully', async () => {
      const rule = { ...baseRule };

      const historicalData = [
        createHistoricalExecution(1000, 3),
        createHistoricalExecution(1100, 2),
        createHistoricalExecution(900, 1),
      ];

      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);
      mockMetadataStorage.saveExecution.mockRejectedValue(new Error('Save failed'));

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.status).toBe('ok'); // Should still return result
      expect(result.rowCount).toBe(1000);
    });
  });

  describe('Execution Metadata Saving', () => {
    it('should save execution result with correct metadata', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        deviationThresholdPercent: 20,
      };

      const historicalData = [
        createHistoricalExecution(1000, 3),
        createHistoricalExecution(1100, 2),
        createHistoricalExecution(900, 1),
      ];

      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(mockMetadataStorage.saveExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: rule.id,
          status: 'ok',
          rowCount: 1000,
          deviation: expect.any(Number),
          baselineAverage: 1000,
          executionDurationMs: expect.any(Number),
          executedAt: expect.any(Date),
        })
      );
    });

    it('should save execution result for anomaly detection', async () => {
      const rule: MonitoringRule = {
        ...baseRule,
        deviationThresholdPercent: 15,
      };

      const historicalData = [
        createHistoricalExecution(1000, 3),
        createHistoricalExecution(1000, 2),
        createHistoricalExecution(1000, 1),
      ];

      mockDb.execute.mockResolvedValue([{ row_count: '1300' }]); // Significant increase
      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(mockMetadataStorage.saveExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'alert',
          rowCount: 1300,
          deviation: 30,
        })
      );
    });

    it('should save execution result for error cases', async () => {
      const rule = { ...baseRule };

      mockDb.execute.mockRejectedValue(new Error('Query failed'));

      await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(mockMetadataStorage.saveExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error: expect.any(String),
          executionDurationMs: expect.any(Number),
        })
      );
    });
  });

  describe('Performance and Execution Duration', () => {
    it('should track execution duration', async () => {
      const rule = { ...baseRule };

      const historicalData = [
        createHistoricalExecution(1000, 3),
        createHistoricalExecution(1100, 2),
        createHistoricalExecution(900, 1),
      ];

      mockMetadataStorage.getHistoricalData.mockResolvedValue(historicalData);

      const result = await checkVolumeAnomaly(mockDb, rule, mockMetadataStorage);

      expect(result.executionDurationMs).toBeGreaterThan(0);
      expect(typeof result.executionDurationMs).toBe('number');
    });

    it('should complete quickly for simple cases', async () => {
      const rule = { ...baseRule };
      const startTime = Date.now();

      await checkVolumeAnomaly(mockDb, rule);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});