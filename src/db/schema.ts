/**
 * FreshGuard Database Schema (Drizzle ORM)
 *
 * Single-tenant schema for self-hosted installations.
 * This schema provides data pipeline freshness monitoring capabilities
 * for teams who want to host FreshGuard on their own infrastructure.
 *
 * Self-hosters can extend this schema for custom monitoring needs.
 *
 * @license MIT
 */

import { pgTable, uuid, varchar, text, timestamp, boolean, integer, bigint, jsonb, inet, numeric } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';


// ==============================================
// Data Sources (Customer Databases)
// ==============================================

export const dataSources = pgTable('data_sources', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Basic information
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),

  // Connection details
  host: varchar('host', { length: 255 }),
  port: integer('port'),
  databaseName: varchar('database_name', { length: 255 }),
  username: varchar('username', { length: 255 }),

  // Credentials (encrypted in production)
  password: varchar('password', { length: 255 }),
  encryptedCredentials: text('encrypted_credentials'),
  credentialsKeyId: varchar('credentials_key_id', { length: 255 }),

  // Additional connection options
  connectionOptions: jsonb('connection_options').default({}),

  // Status tracking
  isActive: boolean('is_active').default(true),
  lastTestedAt: timestamp('last_tested_at'),
  lastTestSuccess: boolean('last_test_success'),
  lastError: text('last_error'),

  // Metadata
  tableCount: integer('table_count'),
  estimatedSizeBytes: bigint('estimated_size_bytes', { mode: 'number' }),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ==============================================
// Monitoring Rules Configuration
// ==============================================

export const monitoringRules = pgTable('monitoring_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => dataSources.id, { onDelete: 'cascade' }).notNull(),

  // Rule identification
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  tableName: varchar('table_name', { length: 255 }).notNull(),

  // Rule type and configuration
  ruleType: varchar('rule_type', { length: 50 }).notNull(),

  // Freshness monitoring settings
  expectedFrequency: varchar('expected_frequency', { length: 50 }),
  toleranceMinutes: integer('tolerance_minutes'),
  timestampColumn: varchar('timestamp_column', { length: 255 }).default('updated_at'),

  // Volume anomaly settings
  baselineWindowDays: integer('baseline_window_days').default(30),
  deviationThresholdPercent: integer('deviation_threshold_percent').default(20),
  minimumRowCount: integer('minimum_row_count').default(0),

  // Schema change settings
  trackColumnChanges: boolean('track_column_changes').default(false),
  trackTableChanges: boolean('track_table_changes').default(false),

  // Custom SQL rule (future)
  customSql: text('custom_sql'),
  expectedResult: jsonb('expected_result'),

  // Scheduling
  checkIntervalMinutes: integer('check_interval_minutes').default(5),
  timezone: varchar('timezone', { length: 50 }).default('UTC'),

  // Status
  isActive: boolean('is_active').default(true),
  lastCheckAt: timestamp('last_check_at'),
  lastStatus: varchar('last_status', { length: 20 }).default('pending'),
  consecutiveFailures: integer('consecutive_failures').default(0),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ==============================================
// Alert Configuration
// ==============================================

export const alertDestinations = pgTable('alert_destinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id').references(() => monitoringRules.id, { onDelete: 'cascade' }).notNull(),

  // Destination configuration
  destinationType: varchar('destination_type', { length: 50 }).notNull(),
  destinationAddress: varchar('destination_address', { length: 500 }).notNull(),

  // Alert settings
  severityLevel: varchar('severity_level', { length: 20 }).default('medium'),
  alertOnRecovery: boolean('alert_on_recovery').default(true),
  cooldownMinutes: integer('cooldown_minutes').default(5),

  // Formatting options
  messageTemplate: text('message_template'),
  includeQueryResults: boolean('include_query_results').default(false),

  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ==============================================
// Execution History & Results
// ==============================================

export const checkExecutions = pgTable('check_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id').references(() => monitoringRules.id, { onDelete: 'cascade' }).notNull(),
  sourceId: uuid('source_id').references(() => dataSources.id, { onDelete: 'cascade' }).notNull(),

  // Execution metadata
  status: varchar('status', { length: 20 }).notNull(),
  errorMessage: text('error_message'),
  queryExecuted: text('query_executed'),
  executionDurationMs: integer('execution_duration_ms'),

  // Results (NEVER store actual customer data, only metadata)
  rowCount: bigint('row_count', { mode: 'number' }),
  lastUpdate: timestamp('last_update'),
  lagMinutes: integer('lag_minutes'),

  // Volume anomaly specific results
  baselineAverage: numeric('baseline_average', { precision: 15, scale: 2 }),
  currentDeviationPercent: numeric('current_deviation_percent', { precision: 5, scale: 2 }),

  // Schema change specific results
  schemaChanges: jsonb('schema_changes'),

  // Execution timing
  executedAt: timestamp('executed_at').defaultNow(),
  nextCheckAt: timestamp('next_check_at'),
});

// ==============================================
// Alert Dispatch Log
// ==============================================

export const alertLog = pgTable('alert_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionId: uuid('execution_id').references(() => checkExecutions.id, { onDelete: 'cascade' }).notNull(),
  ruleId: uuid('rule_id').references(() => monitoringRules.id, { onDelete: 'cascade' }).notNull(),

  // Alert details
  alertType: varchar('alert_type', { length: 50 }).notNull(),
  destinationType: varchar('destination_type', { length: 50 }).notNull(),
  destinationAddress: varchar('destination_address', { length: 500 }).notNull(),

  // Message content
  subject: varchar('subject', { length: 255 }),
  messageContent: text('message_content'),
  alertSeverity: varchar('alert_severity', { length: 20 }).notNull(),

  // Delivery status
  status: varchar('status', { length: 20 }).default('pending'),
  deliveryAttempts: integer('delivery_attempts').default(0),
  lastAttemptAt: timestamp('last_attempt_at'),
  errorMessage: text('error_message'),
  externalId: varchar('external_id', { length: 255 }),

  // Timing
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ==============================================
// Audit & Compliance Logging
// ==============================================

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Action details
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 50 }),
  targetId: uuid('target_id'),

  // Change details
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),

  // Request context
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  apiEndpoint: varchar('api_endpoint', { length: 255 }),

  createdAt: timestamp('created_at').defaultNow(),
});

// ==============================================
// System Configuration
// ==============================================

export const systemConfig = pgTable('system_config', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  dataType: varchar('data_type', { length: 20 }).default('string'),
  isSecret: boolean('is_secret').default(false),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ==============================================
// Schema Change Monitoring
// ==============================================

export const schemaBaselines = pgTable('schema_baselines', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id').references(() => monitoringRules.id, { onDelete: 'cascade' }).notNull(),
  tableName: varchar('table_name', { length: 256 }).notNull(),
  schemaSnapshot: jsonb('schema_snapshot').notNull(),
  schemaHash: varchar('schema_hash', { length: 64 }).notNull(),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  adaptationReason: text('adaptation_reason'),
});

// ==============================================
// Schema Migrations
// ==============================================

export const schemaMigrations = pgTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  appliedAt: timestamp('applied_at').defaultNow(),
});

// ==============================================
// Relations (for Drizzle relational queries)
// ==============================================

export const dataSourcesRelations = relations(dataSources, ({ many }) => ({
  monitoringRules: many(monitoringRules),
  checkExecutions: many(checkExecutions),
}));

export const monitoringRulesRelations = relations(monitoringRules, ({ one, many }) => ({
  dataSource: one(dataSources, {
    fields: [monitoringRules.sourceId],
    references: [dataSources.id],
  }),
  alertDestinations: many(alertDestinations),
  checkExecutions: many(checkExecutions),
  alertLogs: many(alertLog),
  schemaBaselines: many(schemaBaselines),
}));

export const schemaBaselinesRelations = relations(schemaBaselines, ({ one }) => ({
  rule: one(monitoringRules, {
    fields: [schemaBaselines.ruleId],
    references: [monitoringRules.id],
  }),
}));

export const checkExecutionsRelations = relations(checkExecutions, ({ one, many }) => ({
  rule: one(monitoringRules, {
    fields: [checkExecutions.ruleId],
    references: [monitoringRules.id],
  }),
  dataSource: one(dataSources, {
    fields: [checkExecutions.sourceId],
    references: [dataSources.id],
  }),
  alertLogs: many(alertLog),
}));
