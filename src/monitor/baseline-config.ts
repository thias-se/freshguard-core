/**
 * Baseline configuration resolver for enhanced volume monitoring
 *
 * Provides configuration resolution with backwards compatibility,
 * parameter validation, and default value management.
 *
 * @license MIT
 */

import type { MonitoringRule } from '../types.js';
import { ConfigurationError } from '../errors/index.js';

/**
 * Resolved baseline configuration with applied defaults
 */
export interface ResolvedBaselineConfig {
  windowDays: number;
  minimumDataPoints: number;
  timeoutSeconds: number;
  excludeWeekends: boolean;
  calculationMethod: 'mean' | 'median' | 'trimmed_mean';
  trimmedMeanPercentile: number;
  seasonalAdjustment: boolean;
  deviationThresholdPercent: number;
  minimumRowCount: number;
}

/**
 * Baseline configuration resolver
 *
 * Resolves monitoring rule baseline configuration with defaults and validates parameters.
 * Maintains backwards compatibility with existing rule configurations.
 */
export class BaselineConfigResolver {
  private readonly config: ResolvedBaselineConfig;

  constructor(rule: MonitoringRule) {
    this.config = this.resolveConfiguration(rule);
    this.validateConfiguration();
  }

  /**
   * Get resolved configuration
   */
  getConfig(): ResolvedBaselineConfig {
    return this.config;
  }

  /**
   * Get window days for historical data retrieval
   */
  getWindowDays(): number {
    return this.config.windowDays;
  }

  /**
   * Get minimum required data points
   */
  getMinimumDataPoints(): number {
    return this.config.minimumDataPoints;
  }

  /**
   * Get timeout for baseline calculation queries
   */
  getTimeoutSeconds(): number {
    return this.config.timeoutSeconds;
  }

  /**
   * Check if weekends should be excluded from baseline
   */
  shouldExcludeWeekends(): boolean {
    return this.config.excludeWeekends;
  }

  /**
   * Get statistical calculation method
   */
  getCalculationMethod(): 'mean' | 'median' | 'trimmed_mean' {
    return this.config.calculationMethod;
  }

  /**
   * Get trimmed mean percentile (for trimmed_mean method)
   */
  getTrimmedMeanPercentile(): number {
    return this.config.trimmedMeanPercentile;
  }

  /**
   * Check if seasonal adjustment should be applied
   */
  shouldApplySeasonalAdjustment(): boolean {
    return this.config.seasonalAdjustment;
  }

  /**
   * Get deviation threshold percentage
   */
  getDeviationThresholdPercent(): number {
    return this.config.deviationThresholdPercent;
  }

  /**
   * Get minimum row count threshold
   */
  getMinimumRowCount(): number {
    return this.config.minimumRowCount;
  }

  /**
   * Resolve configuration with backwards compatibility
   */
  private resolveConfiguration(rule: MonitoringRule): ResolvedBaselineConfig {
    const baselineConfig = rule.baselineConfig || {};

    // Apply backwards compatibility with existing fields
    const windowDays = this.resolveWindowDays(rule, baselineConfig);
    const deviationThresholdPercent = rule.deviationThresholdPercent || 20;
    const minimumRowCount = rule.minimumRowCount || 0;

    // Apply defaults for new configuration options
    const minimumDataPoints = baselineConfig.minimumDataPoints || 3;
    const timeoutSeconds = baselineConfig.timeoutSeconds || 30;
    const excludeWeekends = baselineConfig.excludeWeekends || false;
    const calculationMethod = baselineConfig.calculationMethod || 'mean';
    const trimmedMeanPercentile = baselineConfig.trimmedMeanPercentile || 10;
    const seasonalAdjustment = baselineConfig.seasonalAdjustment || false;

    return {
      windowDays,
      minimumDataPoints,
      timeoutSeconds,
      excludeWeekends,
      calculationMethod,
      trimmedMeanPercentile,
      seasonalAdjustment,
      deviationThresholdPercent,
      minimumRowCount,
    };
  }

  /**
   * Resolve window days with backwards compatibility
   */
  private resolveWindowDays(rule: MonitoringRule, baselineConfig: NonNullable<MonitoringRule['baselineConfig']>): number {
    // Priority: baselineConfig.windowDays > rule.baselineWindowDays > default (30)
    if (baselineConfig.windowDays !== undefined) {
      return baselineConfig.windowDays;
    }

    if (rule.baselineWindowDays !== undefined) {
      return rule.baselineWindowDays;
    }

    return 30; // Default value
  }

  /**
   * Validate all configuration parameters
   */
  private validateConfiguration(): void {
    this.validateWindowDays();
    this.validateMinimumDataPoints();
    this.validateTimeoutSeconds();
    this.validateCalculationMethod();
    this.validateTrimmedMeanPercentile();
    this.validateDeviationThresholdPercent();
    this.validateMinimumRowCount();
  }

  /**
   * Validate window days parameter
   */
  private validateWindowDays(): void {
    const { windowDays } = this.config;

    if (typeof windowDays !== 'number' || !Number.isInteger(windowDays)) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.windowDays',
        windowDays.toString(),
        'integer'
      );
    }

    if (windowDays < 1) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.windowDays',
        windowDays.toString(),
        'positive integer (minimum 1)'
      );
    }

    if (windowDays > 365) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.windowDays',
        windowDays.toString(),
        'integer between 1 and 365'
      );
    }
  }

  /**
   * Validate minimum data points parameter
   */
  private validateMinimumDataPoints(): void {
    const { minimumDataPoints } = this.config;

    if (typeof minimumDataPoints !== 'number' || !Number.isInteger(minimumDataPoints)) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.minimumDataPoints',
        minimumDataPoints.toString(),
        'integer'
      );
    }

    if (minimumDataPoints < 1) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.minimumDataPoints',
        minimumDataPoints.toString(),
        'positive integer (minimum 1)'
      );
    }

    if (minimumDataPoints > 1000) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.minimumDataPoints',
        minimumDataPoints.toString(),
        'integer between 1 and 1000'
      );
    }
  }

  /**
   * Validate timeout seconds parameter
   */
  private validateTimeoutSeconds(): void {
    const { timeoutSeconds } = this.config;

    if (typeof timeoutSeconds !== 'number' || !Number.isInteger(timeoutSeconds)) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.timeoutSeconds',
        timeoutSeconds.toString(),
        'integer'
      );
    }

    if (timeoutSeconds < 1) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.timeoutSeconds',
        timeoutSeconds.toString(),
        'positive integer (minimum 1)'
      );
    }

    if (timeoutSeconds > 600) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.timeoutSeconds',
        timeoutSeconds.toString(),
        'integer between 1 and 600'
      );
    }
  }

  /**
   * Validate calculation method parameter
   */
  private validateCalculationMethod(): void {
    const { calculationMethod } = this.config;
    const validMethods = ['mean', 'median', 'trimmed_mean'] as const;

    if (!validMethods.includes(calculationMethod)) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.calculationMethod',
        calculationMethod,
        'mean, median, or trimmed_mean'
      );
    }
  }

  /**
   * Validate trimmed mean percentile parameter
   */
  private validateTrimmedMeanPercentile(): void {
    const { trimmedMeanPercentile, calculationMethod } = this.config;

    // Only validate if using trimmed_mean method
    if (calculationMethod !== 'trimmed_mean') {
      return;
    }

    if (typeof trimmedMeanPercentile !== 'number') {
      throw ConfigurationError.invalidValue(
        'baselineConfig.trimmedMeanPercentile',
        String(trimmedMeanPercentile),
        'number'
      );
    }

    if (trimmedMeanPercentile < 0 || trimmedMeanPercentile > 50) {
      throw ConfigurationError.invalidValue(
        'baselineConfig.trimmedMeanPercentile',
        String(trimmedMeanPercentile),
        'number between 0 and 50'
      );
    }
  }

  /**
   * Validate deviation threshold percentage parameter
   */
  private validateDeviationThresholdPercent(): void {
    const { deviationThresholdPercent } = this.config;

    if (typeof deviationThresholdPercent !== 'number') {
      throw ConfigurationError.invalidValue(
        'deviationThresholdPercent',
        String(deviationThresholdPercent),
        'number'
      );
    }

    if (deviationThresholdPercent < 0) {
      throw ConfigurationError.invalidValue(
        'deviationThresholdPercent',
        String(deviationThresholdPercent),
        'non-negative number'
      );
    }

    if (deviationThresholdPercent > 1000) {
      throw ConfigurationError.invalidValue(
        'deviationThresholdPercent',
        String(deviationThresholdPercent),
        'number between 0 and 1000'
      );
    }
  }

  /**
   * Validate minimum row count parameter
   */
  private validateMinimumRowCount(): void {
    const { minimumRowCount } = this.config;

    if (typeof minimumRowCount !== 'number' || !Number.isInteger(minimumRowCount)) {
      throw ConfigurationError.invalidValue(
        'minimumRowCount',
        String(minimumRowCount),
        'integer'
      );
    }

    if (minimumRowCount < 0) {
      throw ConfigurationError.invalidValue(
        'minimumRowCount',
        String(minimumRowCount),
        'non-negative integer'
      );
    }
  }
}