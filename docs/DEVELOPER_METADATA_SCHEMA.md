# Developer Guide: Metadata Schema Synchronization

This guide is for FreshGuard Core contributors who need to understand and maintain compatibility between DuckDB and PostgreSQL metadata storage schemas.

## Architecture Overview

FreshGuard Core supports two metadata storage backends:

1. **PostgreSQL Storage** - Uses Drizzle ORM with schema definitions in `src/db/schema.ts`
2. **DuckDB Storage** - Uses raw SQL with schema embedded in `src/metadata/duckdb-storage.ts`

**Critical Requirement**: Both storage types must be compatible and store the same data structures to ensure users can switch between them without data loss.

## Schema Compatibility Rules

### Core Principle
Both storage backends must support the same `CheckExecution` and `MonitoringRule` TypeScript interfaces defined in `src/metadata/types.ts`.

### Type Mapping Guidelines

| TypeScript Type | PostgreSQL (Drizzle) | DuckDB | Notes |
|------------------|----------------------|---------|-------|
| `string` | `text()` | `TEXT` | Direct mapping |
| `number` (int) | `integer()` | `INTEGER` | Direct mapping |
| `number` (float) | `real()` / `doublePrecision()` | `DOUBLE` | Use DOUBLE for consistency |
| `Date` | `timestamp()` | `TIMESTAMP` | ISO string storage |
| `boolean` | `boolean()` | `BOOLEAN` | Direct mapping |
| `string \| null` | `text()` (nullable) | `TEXT` | NULL handling |

### Required Tables

Both backends must implement these tables with compatible schemas:

#### 1. `check_executions` / `checkExecutions`

**Purpose**: Store execution history for monitoring rules

**Required Fields**:
```typescript
interface CheckExecution {
  ruleId: string;           // Rule identifier
  status: 'ok' | 'alert' | 'failed';  // Execution status
  rowCount?: number;        // Table row count (nullable)
  lagMinutes?: number;      // Data freshness lag (nullable)
  deviation?: number;       // Volume deviation percentage (nullable)
  baselineAverage?: number; // Historical baseline (nullable)
  executionDurationMs?: number; // Execution time (nullable)
  executedAt: Date;         // When check was performed
  error?: string;           // Error message if failed (nullable)
}
```

**PostgreSQL Schema** (`src/db/schema.ts`):
```typescript
export const checkExecutions = pgTable('checkExecutions', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleId: text('ruleId').notNull(),
  sourceId: text('sourceId').notNull(),
  status: text('status').notNull(),
  rowCount: integer('rowCount'),
  lagMinutes: doublePrecision('lagMinutes'),
  baselineAverage: text('baselineAverage'), // Stored as string
  currentDeviationPercent: text('currentDeviationPercent'), // Stored as string
  executionDurationMs: integer('executionDurationMs'),
  executedAt: timestamp('executedAt').notNull(),
  errorMessage: text('errorMessage'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});
```

**DuckDB Schema** (`src/metadata/duckdb-storage.ts`):
```sql
CREATE TABLE IF NOT EXISTS check_executions (
  rule_id TEXT NOT NULL,
  status TEXT NOT NULL,
  row_count INTEGER,
  lag_minutes DOUBLE,
  deviation DOUBLE,
  baseline_average DOUBLE,
  execution_duration_ms INTEGER,
  executed_at TIMESTAMP NOT NULL,
  error TEXT
);
```

**Mapping Logic**:
- PostgreSQL uses camelCase, DuckDB uses snake_case (handled in storage implementations)
- PostgreSQL stores numbers as strings in some fields (parsed in implementation)
- Both support nullable fields correctly

#### 2. `monitoring_rules` / `monitoringRules`

**Purpose**: Store monitoring rule definitions (for future rule management features)

**Required Fields**:
```typescript
interface MonitoringRule {
  id: string;              // Unique identifier
  name: string;            // Human-readable name
  type: 'freshness' | 'volume' | 'custom'; // Rule type
  config: object;          // Rule-specific configuration
  createdAt: Date;         // Creation timestamp
  updatedAt: Date;         // Last modification timestamp
}
```

**PostgreSQL Schema** (existing in `src/db/schema.ts`):
```typescript
export const monitoringRules = pgTable('monitoringRules', {
  id: text('id').primaryKey(),
  sourceId: text('sourceId').notNull(),
  name: text('name').notNull(),
  ruleType: text('ruleType').notNull(),
  tableName: text('tableName').notNull(),
  // ... other fields
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});
```

**DuckDB Schema** (`src/metadata/duckdb-storage.ts`):
```sql
CREATE TABLE IF NOT EXISTS monitoring_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL, -- JSON as text
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

## Implementation Guidelines

### 1. Adding New Fields

When adding new fields to metadata storage:

**Step 1**: Update TypeScript interface in `src/metadata/types.ts`:
```typescript
interface CheckExecution {
  // existing fields...
  newField?: string;  // Add new optional field
}
```

**Step 2**: Update PostgreSQL schema in `src/db/schema.ts`:
```typescript
export const checkExecutions = pgTable('checkExecutions', {
  // existing fields...
  newField: text('newField'),  // Add to Drizzle schema
});
```

**Step 3**: Create migration file in `src/db/migrations/`:
```sql
-- 001_add_new_field.sql
ALTER TABLE checkExecutions ADD COLUMN newField TEXT;
```

**Step 4**: Update DuckDB schema in `src/metadata/duckdb-storage.ts`:
```typescript
// Update table creation SQL
await this.connection.run(`
  CREATE TABLE IF NOT EXISTS check_executions (
    -- existing columns...
    new_field TEXT
  );
`);

// Update insert/select queries to handle new field
```

**Step 5**: Update storage implementation mapping:
```typescript
// PostgreSQL storage - add mapping
async saveExecution(execution: CheckExecution): Promise<void> {
  await this.db.insert(checkExecutions).values({
    // existing mappings...
    newField: execution.newField,
  });
}

// DuckDB storage - add to SQL
async saveExecution(execution: CheckExecution): Promise<void> {
  await this.connection.run(`
    INSERT INTO check_executions (
      rule_id, status, /* existing */, new_field
    ) VALUES (
      '${execution.ruleId}', '${execution.status}', /* existing */,
      ${execution.newField ? `'${execution.newField}'` : 'NULL'}
    )
  `);
}
```

### 2. Type Compatibility Testing

Always test both storage types with the same data:

```typescript
// test/metadata-compatibility.test.ts
describe('Metadata Storage Compatibility', () => {
  it('should store and retrieve same data in both backends', async () => {
    const execution: CheckExecution = {
      ruleId: 'test-rule',
      status: 'ok',
      rowCount: 1000,
      lagMinutes: 5.5,
      deviation: 2.3,
      baselineAverage: 950.5,
      executionDurationMs: 150,
      executedAt: new Date(),
      error: undefined
    };

    // Test PostgreSQL storage
    const pgStorage = new PostgreSQLMetadataStorage(pgUrl);
    await pgStorage.initialize();
    await pgStorage.saveExecution(execution);
    const pgResult = await pgStorage.getHistoricalData('test-rule', 1);

    // Test DuckDB storage
    const duckStorage = new DuckDBMetadataStorage();
    await duckStorage.initialize();
    await duckStorage.saveExecution(execution);
    const duckResult = await duckStorage.getHistoricalData('test-rule', 1);

    // Compare results
    expect(pgResult[0]).toMatchObject(duckResult[0]);
  });
});
```

### 3. Migration Considerations

When schema changes are needed:

**For PostgreSQL**:
- Create standard Drizzle migration files
- Use `drizzle-kit` commands for schema updates
- Follow existing migration patterns in `src/db/migrations/`

**For DuckDB**:
- Implement schema versioning in storage constructor
- Handle schema upgrades gracefully
- Consider backward compatibility for existing `.db` files

**Example DuckDB Schema Versioning**:
```typescript
export class DuckDBMetadataStorage implements MetadataStorage {
  private async ensureSchema(): Promise<void> {
    // Check if schema needs updates
    const tables = await this.connection.runAndReadAll("SHOW TABLES");

    // Handle version upgrades
    if (!tables.some(t => t.name === 'schema_version')) {
      await this.createInitialSchema();
    } else {
      await this.upgradeSchemaIfNeeded();
    }
  }

  private async upgradeSchemaIfNeeded(): Promise<void> {
    const version = await this.getSchemaVersion();
    if (version < CURRENT_SCHEMA_VERSION) {
      await this.runSchemaUpgrades(version);
    }
  }
}
```

## Common Pitfalls

### 1. Case Sensitivity
- PostgreSQL: camelCase field names (via Drizzle)
- DuckDB: snake_case field names (raw SQL)
- **Solution**: Handle mapping in storage implementations

### 2. Number Precision
- PostgreSQL: Some fields stored as text, others as numeric
- DuckDB: Native numeric types
- **Solution**: Consistent parsing/serialization in implementation

### 3. Date Handling
- PostgreSQL: Native timestamp support
- DuckDB: ISO string timestamps
- **Solution**: Always use `new Date()` constructor and `.toISOString()`

### 4. NULL vs Undefined
- TypeScript: `field?: type` means optional
- SQL: NULL values
- **Solution**: Explicit NULL checks and default values

## Testing Schema Changes

### Unit Tests
Test each storage implementation independently:

```bash
pnpm test src/metadata/duckdb-storage.test.ts
pnpm test src/metadata/postgresql-storage.test.ts
```

### Integration Tests
Test with real monitoring functions:

```bash
pnpm test src/monitor/volume.test.ts
pnpm test src/monitor/freshness.test.ts
```

### Compatibility Tests
Verify cross-storage compatibility:

```bash
pnpm test test/metadata-compatibility.test.ts
```

## Documentation Updates

When making schema changes, update:

1. **`docs/METADATA_STORAGE.md`** - User-facing storage documentation
2. **This file** - Developer schema documentation
3. **Type definitions** - `src/metadata/types.ts`
4. **Migration notes** - Version upgrade instructions

## Schema Review Checklist

Before merging schema changes:

- [ ] TypeScript interfaces updated in `src/metadata/types.ts`
- [ ] PostgreSQL schema updated in `src/db/schema.ts`
- [ ] PostgreSQL migration created in `src/db/migrations/`
- [ ] DuckDB schema updated in `src/metadata/duckdb-storage.ts`
- [ ] Both storage implementations handle new fields
- [ ] Unit tests pass for both storage types
- [ ] Integration tests pass with both backends
- [ ] Documentation updated
- [ ] Compatibility verified with existing data

This ensures that users can seamlessly switch between storage types and that the metadata layer remains consistent across all deployments.