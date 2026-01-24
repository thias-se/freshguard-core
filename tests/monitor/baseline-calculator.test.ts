/**
 * Tests for baseline calculator
 *
 * Tests the BaselineCalculator class that provides:
 * - Multiple statistical calculation methods (mean, median, trimmed mean)
 * - Weekend exclusion logic
 * - Seasonal adjustment for day-of-week patterns
 * - Data filtering and validation
 */

import { describe, it, expect } from 'vitest';
import { BaselineCalculator } from '../../src/monitor/baseline-calculator.js';
import type { CheckExecution } from '../../src/metadata/types.js';
import type { ResolvedBaselineConfig } from '../../src/monitor/baseline-config.js';

// Default configuration for testing
const defaultConfig: ResolvedBaselineConfig = {
  windowDays: 30,
  minimumDataPoints: 3,
  timeoutSeconds: 30,
  excludeWeekends: false,
  calculationMethod: 'mean',
  trimmedMeanPercentile: 10,
  seasonalAdjustment: false,
  deviationThresholdPercent: 20,
  minimumRowCount: 0,
};

// Helper to create check execution data
function createExecution(rowCount: number, daysAgo: number): CheckExecution {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);

  return {
    ruleId: 'test-rule',
    status: 'ok' as const,
    rowCount,
    executedAt: date,
  };
}

// Helper to create executions for specific days of week
function createWeeklyPattern(weekCount: number = 2): CheckExecution[] {
  const executions: CheckExecution[] = [];
  const baseDate = new Date('2024-01-01'); // Monday

  for (let week = 0; week < weekCount; week++) {
    for (let day = 0; day < 7; day++) {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() + (week * 7) + day);

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
        ruleId: 'test-rule',
        status: 'ok' as const,
        rowCount,
        executedAt: date,
      });
    }
  }

  return executions;
}

describe('BaselineCalculator', () => {
  describe('Basic Calculation Methods', () => {
    describe('Mean Calculation', () => {
      it('should calculate mean correctly', () => {
        const config: ResolvedBaselineConfig = {
          ...defaultConfig,
          calculationMethod: 'mean',
        };
        const calculator = new BaselineCalculator(config);

        const executions = [
          createExecution(100, 3),
          createExecution(200, 2),
          createExecution(300, 1),
        ];

        const result = calculator.calculateBaseline(executions, 250);

        expect(result.mean).toBe(200); // (100 + 200 + 300) / 3
        expect(result.calculationMethod).toBe('mean');
        expect(result.dataPointsUsed).toBe(3);
      });

      it('should calculate deviation percentage correctly', () => {
        const calculator = new BaselineCalculator(defaultConfig);

        const executions = [
          createExecution(100, 2),
          createExecution(100, 1),
        ];

        const result = calculator.calculateBaseline(executions, 150);

        expect(result.mean).toBe(100);
        expect(result.deviationPercent).toBe(50); // |150 - 100| / 100 * 100 = 50%
      });
    });

    describe('Median Calculation', () => {
      it('should calculate median for odd number of values', () => {
        const config: ResolvedBaselineConfig = {
          ...defaultConfig,
          calculationMethod: 'median',
        };
        const calculator = new BaselineCalculator(config);

        const executions = [
          createExecution(100, 4),
          createExecution(200, 3),
          createExecution(300, 2),
          createExecution(400, 1),
          createExecution(500, 0),
        ];

        const result = calculator.calculateBaseline(executions, 300);

        expect(result.mean).toBe(300); // Median of [100, 200, 300, 400, 500]
        expect(result.calculationMethod).toBe('median');
      });

      it('should calculate median for even number of values', () => {
        const config: ResolvedBaselineConfig = {
          ...defaultConfig,
          calculationMethod: 'median',
        };
        const calculator = new BaselineCalculator(config);

        const executions = [
          createExecution(100, 3),
          createExecution(200, 2),
          createExecution(300, 1),
          createExecution(400, 0),
        ];

        const result = calculator.calculateBaseline(executions, 250);

        expect(result.mean).toBe(250); // (200 + 300) / 2
      });
    });

    describe('Trimmed Mean Calculation', () => {
      it('should calculate trimmed mean excluding outliers', () => {
        const config: ResolvedBaselineConfig = {
          ...defaultConfig,
          calculationMethod: 'trimmed_mean',
          trimmedMeanPercentile: 20, // Trim 20% from each end
        };
        const calculator = new BaselineCalculator(config);

        // Values: [10, 100, 200, 300, 400, 500, 600, 700, 800, 9000]
        // After trimming 20% (2 values) from each end: [200, 300, 400, 500, 600, 700]
        const executions = [10, 100, 200, 300, 400, 500, 600, 700, 800, 9000]
          .map((count, i) => createExecution(count, i));

        const result = calculator.calculateBaseline(executions, 450);

        expect(result.mean).toBe(450); // Mean of [200, 300, 400, 500, 600, 700]
        expect(result.calculationMethod).toBe('trimmed_mean');
      });

      it('should fallback to mean for small datasets', () => {
        const config: ResolvedBaselineConfig = {
          ...defaultConfig,
          calculationMethod: 'trimmed_mean',
        };
        const calculator = new BaselineCalculator(config);

        const executions = [
          createExecution(100, 2),
          createExecution(200, 1),
          createExecution(300, 0),
        ];

        const result = calculator.calculateBaseline(executions, 200);

        expect(result.mean).toBe(200); // Falls back to mean
      });
    });
  });

  describe('Weekend Exclusion', () => {
    it('should exclude weekend data when configured', () => {
      const config: ResolvedBaselineConfig = {
        ...defaultConfig,
        excludeWeekends: true,
        minimumDataPoints: 2,
      };
      const calculator = new BaselineCalculator(config);

      const executions = createWeeklyPattern(1); // One week of data

      const result = calculator.calculateBaseline(executions, 900);

      // Should only use weekday data (Mon-Fri): [800, 1000, 1000, 1000, 1000]
      // Weekend data (200, 200) should be excluded
      expect(result.dataPointsUsed).toBe(5); // Only weekdays
      expect(result.mean).toBe(960); // (800 + 1000 + 1000 + 1000 + 1000) / 5
    });

    it('should include all data when weekend exclusion disabled', () => {
      const config: ResolvedBaselineConfig = {
        ...defaultConfig,
        excludeWeekends: false,
      };
      const calculator = new BaselineCalculator(config);

      const executions = createWeeklyPattern(1); // One week of data

      const result = calculator.calculateBaseline(executions, 700);

      // Should use all data including weekends
      expect(result.dataPointsUsed).toBe(7); // All days
      const expectedMean = (800 + 1000 + 1000 + 1000 + 1000 + 200 + 200) / 7;
      expect(result.mean).toBeCloseTo(expectedMean, 0);
    });
  });

  describe('Seasonal Adjustment', () => {
    it('should apply seasonal adjustment for day-of-week patterns', () => {
      const config: ResolvedBaselineConfig = {
        ...defaultConfig,
        seasonalAdjustment: true,
        minimumDataPoints: 5,
      };
      const calculator = new BaselineCalculator(config);

      const executions = createWeeklyPattern(3); // Three weeks of data

      const result = calculator.calculateBaseline(executions, 900);

      expect(result.seasonalAdjusted).toBe(true);
      expect(result.dataPointsUsed).toBeGreaterThan(14); // Should have enough data
    });

    it('should skip seasonal adjustment for insufficient data', () => {
      const config: ResolvedBaselineConfig = {
        ...defaultConfig,
        seasonalAdjustment: true,
        minimumDataPoints: 3,
      };
      const calculator = new BaselineCalculator(config);

      const executions = [
        createExecution(100, 2),
        createExecution(200, 1),
        createExecution(300, 0),
      ]; // Less than 14 days

      const result = calculator.calculateBaseline(executions, 200);

      expect(result.seasonalAdjusted).toBe(false);
      // Should still calculate baseline without seasonal adjustment
      expect(result.mean).toBe(200);
    });
  });

  describe('Insufficient Data Handling', () => {
    it('should return fallback when no historical data', () => {
      const calculator = new BaselineCalculator(defaultConfig);

      const result = calculator.calculateBaseline([], 500);

      expect(result.mean).toBe(500);
      expect(result.deviationPercent).toBe(0);
      expect(result.dataPointsUsed).toBe(0);
      expect(result.calculationMethod).toBe('mean');
    });

    it('should return fallback when below minimum data points', () => {
      const config: ResolvedBaselineConfig = {
        ...defaultConfig,
        minimumDataPoints: 5,
      };
      const calculator = new BaselineCalculator(config);

      const executions = [
        createExecution(100, 2),
        createExecution(200, 1),
      ]; // Only 2 data points, below minimum of 5

      const result = calculator.calculateBaseline(executions, 300);

      expect(result.mean).toBe(300);
      expect(result.deviationPercent).toBe(0);
      expect(result.dataPointsUsed).toBe(2);
    });

    it('should filter out invalid data points', () => {
      const calculator = new BaselineCalculator(defaultConfig);

      const executions = [
        createExecution(100, 3),
        { ...createExecution(200, 2), rowCount: undefined }, // Invalid
        createExecution(300, 1),
        { ...createExecution(400, 0), executedAt: undefined as any }, // Invalid
      ];

      const result = calculator.calculateBaseline(executions, 200);

      expect(result.dataPointsUsed).toBe(2); // Only valid data points
      expect(result.mean).toBe(200); // (100 + 300) / 2
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle zero baseline gracefully', () => {
      const calculator = new BaselineCalculator(defaultConfig);

      const executions = [
        createExecution(0, 2),
        createExecution(0, 1),
      ];

      const result = calculator.calculateBaseline(executions, 100);

      expect(result.mean).toBe(0);
      expect(result.deviationPercent).toBe(0); // Should not divide by zero
    });

    it('should round results appropriately', () => {
      const calculator = new BaselineCalculator(defaultConfig);

      const executions = [
        createExecution(101, 2),
        createExecution(102, 1),
        createExecution(103, 0),
      ];

      const result = calculator.calculateBaseline(executions, 150);

      expect(result.mean).toBe(102); // Rounded
      expect(Number.isInteger(result.mean)).toBe(true);
      expect(result.deviationPercent).toBeCloseTo(47.06, 2); // Rounded to 2 decimal places
    });

    it('should handle very large numbers safely', () => {
      const calculator = new BaselineCalculator(defaultConfig);

      const executions = [
        createExecution(1000000, 2),
        createExecution(2000000, 1),
        createExecution(3000000, 0),
      ];

      const result = calculator.calculateBaseline(executions, 2500000);

      expect(result.mean).toBe(2000000);
      expect(result.deviationPercent).toBe(25);
      expect(Number.isFinite(result.mean)).toBe(true);
      expect(Number.isFinite(result.deviationPercent)).toBe(true);
    });
  });
});