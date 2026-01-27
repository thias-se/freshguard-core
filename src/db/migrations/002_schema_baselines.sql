-- Migration: Add schema change monitoring support
-- Version: 002
-- Description: Create schema_baselines table for tracking database schema changes

-- Add schema_baselines table
CREATE TABLE IF NOT EXISTS schema_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES monitoring_rules(id) ON DELETE CASCADE,
  table_name VARCHAR(256) NOT NULL,
  schema_snapshot JSONB NOT NULL,
  schema_hash VARCHAR(64) NOT NULL,
  captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  adaptation_reason TEXT,
  UNIQUE(rule_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_schema_baselines_rule_id ON schema_baselines(rule_id);
CREATE INDEX IF NOT EXISTS idx_schema_baselines_table_name ON schema_baselines(table_name);
CREATE INDEX IF NOT EXISTS idx_schema_baselines_schema_hash ON schema_baselines(schema_hash);

-- Update schema_migrations table
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (2, 'add_schema_baselines_table', NOW())
ON CONFLICT (version) DO NOTHING;