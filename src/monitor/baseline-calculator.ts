/**
 * Enhanced baseline calculator for volume monitoring
 *
 * Provides advanced statistical methods for baseline calculation including
 * mean, median, trimmed mean, weekend exclusion, and seasonal adjustment.
 *
 * @license MIT
 */

import type { CheckExecution } from '../metadata/types.js';
import type { ResolvedBaselineConfig } from './baseline-config.js';
import { MonitoringError } from '../errors/index.js';

/**
 * Historical data point with timestamp information
 */
export interface HistoricalDataPoint {
  rowCount: number;
  executedAt: Date;
}

/**
 * Baseline calculation result
 */
export interface BaselineResult {
  mean: number;
  deviationPercent: number;
  dataPointsUsed: number;
  calculationMethod: string;
  seasonalAdjusted?: boolean;
}

/**
 * Day of week statistics for seasonal adjustment
 */
interface DayOfWeekStats {
  [dayOfWeek: number]: {
    mean: number;
    count: number;
  };
}

/**
 * Enhanced baseline calculator
 *
 * Calculates baselines using various statistical methods with support for
 * weekend exclusion and seasonal adjustment for day-of-week patterns.
 */
export class BaselineCalculator {
  constructor(private config: ResolvedBaselineConfig) {}

  /**
   * Calculate baseline from historical check execution data
   */
  calculateBaseline(
    historicalData: CheckExecution[],
    currentRowCount: number
  ): BaselineResult {
    // Convert to data points with timestamp information
    const dataPoints = this.convertToDataPoints(historicalData);

    // Filter data based on configuration
    const filteredData = this.filterData(dataPoints);

    // Check if we have enough data for reliable baseline calculation
    if (filteredData.length < this.config.minimumDataPoints) {
      return {
        mean: currentRowCount,
        deviationPercent: 0,
        dataPointsUsed: filteredData.length,
        calculationMethod: this.config.calculationMethod,
        seasonalAdjusted: false,
      };
    }

    try {
      // Apply seasonal adjustment if enabled and sufficient data
      const adjustedData = this.config.seasonalAdjustment
        ? this.applySeasonalAdjustment(filteredData)
        : filteredData;

      // Check if seasonal adjustment was actually applied
      const seasonalAdjustmentApplied = this.config.seasonalAdjustment && filteredData.length >= 14;

      // Calculate baseline using configured method
      const baseline = this.calculateStatistic(adjustedData);

      // Seasonally adjust current row count if seasonal adjustment was applied
      const adjustedCurrentRowCount = seasonalAdjustmentApplied
        ? this.adjustCurrentValueForSeason(filteredData, currentRowCount)
        : currentRowCount;

      // Calculate deviation percentage
      const deviationPercent = this.calculateDeviation(baseline, adjustedCurrentRowCount);

      return {
        mean: Math.round(baseline),
        deviationPercent: Math.round(deviationPercent * 100) / 100,
        dataPointsUsed: adjustedData.length,
        calculationMethod: this.config.calculationMethod,
        seasonalAdjusted: seasonalAdjustmentApplied,
      };
    } catch (error) {
      // If calculation fails, return safe defaults
      return {
        mean: currentRowCount,
        deviationPercent: 0,
        dataPointsUsed: filteredData.length,
        calculationMethod: 'fallback',
        seasonalAdjusted: false,
      };
    }
  }

  /**
   * Convert check executions to data points
   */
  private convertToDataPoints(executions: CheckExecution[]): HistoricalDataPoint[] {
    return executions
      .filter(e => e.rowCount !== undefined && e.executedAt)
      .map(e => ({
        rowCount: e.rowCount!,
        executedAt: e.executedAt,
      }));
  }

  /**
   * Filter data based on configuration
   */
  private filterData(dataPoints: HistoricalDataPoint[]): HistoricalDataPoint[] {
    if (!this.config.excludeWeekends) {
      return dataPoints;
    }

    // Filter out weekend data (Saturday = 6, Sunday = 0)
    return dataPoints.filter(point => {
      const dayOfWeek = point.executedAt.getDay();
      return dayOfWeek !== 0 && dayOfWeek !== 6;
    });
  }

  /**
   * Apply seasonal adjustment based on day-of-week patterns
   */
  private applySeasonalAdjustment(dataPoints: HistoricalDataPoint[]): HistoricalDataPoint[] {
    if (dataPoints.length < 14) {
      // Need at least 2 weeks of data for seasonal adjustment
      return dataPoints;
    }

    const dayOfWeekStats = this.calculateDayOfWeekStats(dataPoints);
    const overallMean = this.calculateMean(dataPoints.map(p => p.rowCount));



    // Adjust each data point based on day-of-week factor
    const adjustedPoints = dataPoints.map(point => {
      const dayOfWeek = point.executedAt.getDay();
      const dayStats = dayOfWeekStats[dayOfWeek];

      if (!dayStats || dayStats.count < 2) {
        // Not enough data for this day of week
        return point;
      }

      // Calculate adjustment factor
      const dayFactor = overallMean / dayStats.mean;
      const adjustedRowCount = point.rowCount * dayFactor;

      return {
        ...point,
        rowCount: adjustedRowCount,
      };
    });


    return adjustedPoints;
  }

  /**
   * Adjust current value for seasonal patterns
   */
  private adjustCurrentValueForSeason(
    dataPoints: HistoricalDataPoint[],
    currentRowCount: number
  ): number {
    if (dataPoints.length < 14) {
      return currentRowCount;
    }

    const dayOfWeekStats = this.calculateDayOfWeekStats(dataPoints);
    const overallMean = this.calculateMean(dataPoints.map(p => p.rowCount));
    const currentDayOfWeek = new Date().getDay();

    const currentDayStats = dayOfWeekStats[currentDayOfWeek];

    if (!currentDayStats || currentDayStats.count < 2) {
      // Not enough data for today's day of week, no adjustment
      return currentRowCount;
    }

    // Apply the same adjustment factor used for historical data
    const dayFactor = overallMean / currentDayStats.mean;
    const adjustedCurrentRowCount = currentRowCount * dayFactor;


    return adjustedCurrentRowCount;
  }

  /**
   * Calculate day-of-week statistics
   */
  private calculateDayOfWeekStats(dataPoints: HistoricalDataPoint[]): DayOfWeekStats {
    const stats: DayOfWeekStats = {};

    // Group by day of week
    dataPoints.forEach(point => {
      const dayOfWeek = point.executedAt.getDay();
      if (!stats[dayOfWeek]) {
        stats[dayOfWeek] = { mean: 0, count: 0 };
      }

      stats[dayOfWeek].mean += point.rowCount;
      stats[dayOfWeek].count += 1;
    });

    // Calculate means
    Object.values(stats).forEach(stat => {
      if (stat.count > 0) {
        stat.mean = stat.mean / stat.count;
      }
    });

    return stats;
  }

  /**
   * Calculate statistic based on configured method
   */
  private calculateStatistic(dataPoints: HistoricalDataPoint[]): number {
    const values = dataPoints.map(p => p.rowCount);
    this.validateValues(values);

    switch (this.config.calculationMethod) {
      case 'mean':
        return this.calculateMean(values);
      case 'median':
        return this.calculateMedian(values);
      case 'trimmed_mean':
        return this.calculateTrimmedMean(values, this.config.trimmedMeanPercentile);
      default:
        throw new MonitoringError(
          `Unknown calculation method: ${this.config.calculationMethod}`,
          'volume',
          undefined,
          undefined
        );
    }
  }

  /**
   * Validate row count values
   */
  private validateValues(values: number[]): void {
    if (values.length === 0) {
      throw new MonitoringError('No valid data points for baseline calculation', 'volume');
    }

    if (values.some(value => isNaN(value) || value < 0)) {
      throw new MonitoringError('Invalid row count values detected', 'volume');
    }
  }

  /**
   * Calculate arithmetic mean
   */
  private calculateMean(values: number[]): number {
    const sum = values.reduce((a, b) => {
      const result = a + b;
      if (result > Number.MAX_SAFE_INTEGER) {
        throw new MonitoringError('Statistical calculation overflow', 'volume');
      }
      return result;
    }, 0);

    return sum / values.length;
  }

  /**
   * Calculate median
   */
  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      const left = sorted[mid - 1];
      const right = sorted[mid];
      if (left === undefined || right === undefined) {
        throw new MonitoringError('Invalid data for median calculation', 'volume');
      }
      return (left + right) / 2;
    } else {
      const middle = sorted[mid];
      if (middle === undefined) {
        throw new MonitoringError('Invalid data for median calculation', 'volume');
      }
      return middle;
    }
  }

  /**
   * Calculate trimmed mean (excluding outliers from both ends)
   */
  private calculateTrimmedMean(values: number[], trimPercentile: number): number {
    if (values.length < 4) {
      // Need at least 4 values for meaningful trimming
      return this.calculateMean(values);
    }

    const sorted = [...values].sort((a, b) => a - b);
    const trimCount = Math.floor((sorted.length * trimPercentile) / 100);

    // Remove outliers from both ends
    const trimmedValues = sorted.slice(trimCount, sorted.length - trimCount);

    if (trimmedValues.length === 0) {
      // Fallback to mean if too much trimming
      return this.calculateMean(values);
    }

    return this.calculateMean(trimmedValues);
  }

  /**
   * Calculate deviation percentage safely
   */
  private calculateDeviation(baseline: number, currentValue: number): number {
    if (baseline <= 0) {
      return 0;
    }

    const deviation = Math.abs(currentValue - baseline);
    const deviationPercent = (deviation / baseline) * 100;

    // Validate result is reasonable
    if (isNaN(deviationPercent) || deviationPercent === Infinity) {
      return 0;
    }

    return deviationPercent;
  }
}