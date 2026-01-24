/**
 * Tests for baseline configuration resolver
 *
 * Tests the BaselineConfigResolver class that handles:
 * - Configuration resolution with backwards compatibility
 * - Parameter validation and range checks
 * - Default value application
 */

import { describe, it, expect } from 'vitest';
import { BaselineConfigResolver } from '../../src/monitor/baseline-config.js';
import type { MonitoringRule } from '../../src/types.js';
import { ConfigurationError } from '../../src/errors/index.js';

// Base monitoring rule template
const baseRule: MonitoringRule = {
  id: 'test-rule-123',
  sourceId: 'test-source',
  name: 'Test Rule',
  tableName: 'test_table',
  ruleType: 'volume_anomaly',
  checkIntervalMinutes: 60,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('BaselineConfigResolver', () => {
  describe('Default Configuration', () => {
    it('should apply default configuration when no baseline config provided', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        // No baseline config specified
      };
      const resolver = new BaselineConfigResolver(rule);
      const config = resolver.getConfig();

      expect(config).toEqual({
        windowDays: 30, // Default
        minimumDataPoints: 3, // Default
        timeoutSeconds: 30, // Default
        excludeWeekends: false, // Default
        calculationMethod: 'mean', // Default
        trimmedMeanPercentile: 10, // Default
        seasonalAdjustment: false, // Default
        deviationThresholdPercent: 20, // Default
        minimumRowCount: 0, // Default
      });
    });

    it('should use legacy fields when present', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineWindowDays: 45,
        deviationThresholdPercent: 25,
        minimumRowCount: 100,
      };
      const resolver = new BaselineConfigResolver(rule);
      const config = resolver.getConfig();

      expect(config.windowDays).toBe(45);
      expect(config.deviationThresholdPercent).toBe(25);
      expect(config.minimumRowCount).toBe(100);
    });

    it('should prioritize baseline config over legacy fields', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineWindowDays: 45, // Legacy field
        deviationThresholdPercent: 25,
        baselineConfig: {
          windowDays: 60, // Should take precedence
        },
      };
      const resolver = new BaselineConfigResolver(rule);
      const config = resolver.getConfig();

      expect(config.windowDays).toBe(60);
      expect(config.deviationThresholdPercent).toBe(25); // Legacy field still used
    });
  });

  describe('Enhanced Configuration Options', () => {
    it('should apply enhanced configuration options', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          windowDays: 14,
          minimumDataPoints: 5,
          timeoutSeconds: 60,
          excludeWeekends: true,
          calculationMethod: 'median',
          seasonalAdjustment: true,
        },
      };
      const resolver = new BaselineConfigResolver(rule);
      const config = resolver.getConfig();

      expect(config.windowDays).toBe(14);
      expect(config.minimumDataPoints).toBe(5);
      expect(config.timeoutSeconds).toBe(60);
      expect(config.excludeWeekends).toBe(true);
      expect(config.calculationMethod).toBe('median');
      expect(config.seasonalAdjustment).toBe(true);
    });

    it('should handle trimmed mean configuration', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          calculationMethod: 'trimmed_mean',
          trimmedMeanPercentile: 20,
        },
      };
      const resolver = new BaselineConfigResolver(rule);
      const config = resolver.getConfig();

      expect(config.calculationMethod).toBe('trimmed_mean');
      expect(config.trimmedMeanPercentile).toBe(20);
    });
  });

  describe('Getter Methods', () => {
    it('should provide correct getter methods', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          windowDays: 21,
          minimumDataPoints: 7,
          timeoutSeconds: 45,
          excludeWeekends: true,
          calculationMethod: 'median',
          trimmedMeanPercentile: 15,
          seasonalAdjustment: true,
        },
        deviationThresholdPercent: 30,
        minimumRowCount: 50,
      };
      const resolver = new BaselineConfigResolver(rule);

      expect(resolver.getWindowDays()).toBe(21);
      expect(resolver.getMinimumDataPoints()).toBe(7);
      expect(resolver.getTimeoutSeconds()).toBe(45);
      expect(resolver.shouldExcludeWeekends()).toBe(true);
      expect(resolver.getCalculationMethod()).toBe('median');
      expect(resolver.getTrimmedMeanPercentile()).toBe(15);
      expect(resolver.shouldApplySeasonalAdjustment()).toBe(true);
      expect(resolver.getDeviationThresholdPercent()).toBe(30);
      expect(resolver.getMinimumRowCount()).toBe(50);
    });
  });

  describe('Parameter Validation', () => {
    describe('Window Days', () => {
      it('should reject negative window days', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { windowDays: -1 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject zero window days', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { windowDays: 0 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject window days over 365', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { windowDays: 366 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject non-integer window days', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { windowDays: 30.5 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });
    });

    describe('Minimum Data Points', () => {
      it('should reject negative minimum data points', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { minimumDataPoints: -1 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject zero minimum data points', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { minimumDataPoints: 0 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject too many minimum data points', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { minimumDataPoints: 1001 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });
    });

    describe('Timeout Seconds', () => {
      it('should reject negative timeout seconds', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { timeoutSeconds: -1 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject zero timeout seconds', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { timeoutSeconds: 0 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject timeout seconds over 600', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { timeoutSeconds: 601 },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });
    });

    describe('Calculation Method', () => {
      it('should reject invalid calculation methods', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: { calculationMethod: 'invalid' as any },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should accept valid calculation methods', () => {
        const methods: Array<'mean' | 'median' | 'trimmed_mean'> = ['mean', 'median', 'trimmed_mean'];

        methods.forEach(method => {
          const rule: MonitoringRule = {
            ...baseRule,
            baselineConfig: { calculationMethod: method },
          };

          expect(() => new BaselineConfigResolver(rule)).not.toThrow();
        });
      });
    });

    describe('Trimmed Mean Percentile', () => {
      it('should reject negative trimmed mean percentile', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: {
            calculationMethod: 'trimmed_mean',
            trimmedMeanPercentile: -1,
          },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject trimmed mean percentile over 50', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: {
            calculationMethod: 'trimmed_mean',
            trimmedMeanPercentile: 51,
          },
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should not validate trimmed mean percentile for other methods', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          baselineConfig: {
            calculationMethod: 'mean',
            trimmedMeanPercentile: 60, // Invalid but method is not trimmed_mean
          },
        };

        expect(() => new BaselineConfigResolver(rule)).not.toThrow();
      });
    });

    describe('Deviation Threshold and Minimum Row Count', () => {
      it('should reject negative deviation threshold', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          deviationThresholdPercent: -1,
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject deviation threshold over 1000', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          deviationThresholdPercent: 1001,
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });

      it('should reject negative minimum row count', () => {
        const rule: MonitoringRule = {
          ...baseRule,
          minimumRowCount: -1,
        };

        expect(() => new BaselineConfigResolver(rule)).toThrow(ConfigurationError);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined baseline config', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: undefined,
      };

      expect(() => new BaselineConfigResolver(rule)).not.toThrow();
    });

    it('should handle empty baseline config', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {},
      };

      const resolver = new BaselineConfigResolver(rule);
      const config = resolver.getConfig();

      // Should use all defaults
      expect(config.windowDays).toBe(30);
      expect(config.calculationMethod).toBe('mean');
    });

    it('should handle partial baseline config', () => {
      const rule: MonitoringRule = {
        ...baseRule,
        baselineConfig: {
          windowDays: 14,
          // Other options omitted
        },
      };

      const resolver = new BaselineConfigResolver(rule);
      const config = resolver.getConfig();

      expect(config.windowDays).toBe(14);
      expect(config.minimumDataPoints).toBe(3); // Default
    });
  });
});