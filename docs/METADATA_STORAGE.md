# Metadata Storage Configuration

FreshGuard Core uses metadata storage to track execution history, which enables volume anomaly detection and monitoring analytics. You can choose between **DuckDB** (embedded, zero-setup) or **PostgreSQL** (production-ready) storage.

## Quick Start (Zero Setup)

By default, FreshGuard uses DuckDB for metadata storage with no configuration required:

```typescript
import { createMetadataStorage, checkVolumeAnomaly } from '@thias-se/freshguard-core';

// Automatic setup - creates ./freshguard-metadata.db
const metadataStorage = await createMetadataStorage();

// Use with monitoring functions
const result = await checkVolumeAnomaly(database, rule, metadataStorage);

// Clean up
await metadataStorage.close();
```

This creates a local `freshguard-metadata.db` file in your project directory.

## Storage Options

### 1. DuckDB Storage (Recommended for Self-Hosting)

**Best for**: Development, single-server deployments, self-hosting

**Benefits**:
- ✅ Zero database server setup
- ✅ Single file storage
- ✅ Fast embedded queries
- ✅ Perfect for Docker containers

**Configuration**:

```typescript
// Default (auto-detected)
const storage = await createMetadataStorage();

// Explicit configuration
const storage = await createMetadataStorage({
  type: 'duckdb',
  path: './my-freshguard-data.db'  // Custom path
});

// In-memory (for testing)
const storage = await createMetadataStorage({
  type: 'duckdb',
  path: ':memory:'
});
```

**File Location**:
- Default: `./freshguard-metadata.db` in your working directory
- Custom: Specify any path (relative or absolute)
- Memory: Use `:memory:` for temporary storage

### 2. PostgreSQL Storage (Recommended for Production)

**Best for**: Production deployments, multi-server environments, existing PostgreSQL infrastructure

**Benefits**:
- ✅ Full ACID compliance
- ✅ Concurrent access support
- ✅ Backup/restore capabilities
- ✅ Monitoring and alerting

**Setup Requirements**:

1. **Create metadata database** (separate from your application data):
```sql
CREATE DATABASE freshguard_metadata;
CREATE USER freshguard_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE freshguard_metadata TO freshguard_user;
```

2. **Run migrations**:
```bash
# Using the FreshGuard schema
npx drizzle-kit push:pg --config=drizzle.config.ts
```

3. **Configure connection**:
```typescript
const storage = await createMetadataStorage({
  type: 'postgresql',
  url: 'postgresql://freshguard_user:secure_password@localhost:5432/freshguard_metadata'
});
```

**Connection Options**:
```typescript
// Connection string
const storage = await createMetadataStorage({
  type: 'postgresql',
  url: 'postgresql://user:pass@host:5432/db'
});

// Connection object (for more control)
const storage = await createMetadataStorage({
  type: 'postgresql',
  connection: {
    host: 'localhost',
    port: 5432,
    database: 'freshguard_metadata',
    username: 'freshguard_user',
    password: process.env.DB_PASSWORD,
    ssl: true
  }
});
```

## Configuration Examples

### Development Setup
```typescript
// Simple local development
const storage = await createMetadataStorage(); // Uses DuckDB by default
```

### Docker Deployment
```dockerfile
# Dockerfile
COPY freshguard-metadata.db /app/data/
WORKDIR /app
# DuckDB file is automatically available
```

```typescript
// In your app
const storage = await createMetadataStorage({
  type: 'duckdb',
  path: '/app/data/freshguard-metadata.db'
});
```

### Production Deployment
```typescript
// Environment-based configuration
const storage = await createMetadataStorage({
  type: process.env.METADATA_STORAGE_TYPE || 'postgresql',
  url: process.env.METADATA_DATABASE_URL
});
```

### Kubernetes/Cloud
```yaml
# ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: freshguard-config
data:
  metadata-storage-type: "postgresql"
  metadata-database-url: "postgresql://user:pass@postgres-service:5432/freshguard"
```

```typescript
// In your application
const storage = await createMetadataStorage({
  type: process.env.METADATA_STORAGE_TYPE as 'postgresql',
  url: process.env.METADATA_DATABASE_URL
});
```

## Monitoring Usage

### Basic Monitoring
```typescript
import {
  createDatabase,
  createMetadataStorage,
  checkFreshness,
  checkVolumeAnomaly
} from '@thias-se/freshguard-core';

// Setup
const database = createDatabase('postgresql://...');
const metadataStorage = await createMetadataStorage();

const rule = {
  id: 'orders-freshness',
  sourceId: 'main-db',
  name: 'Orders Freshness Check',
  tableName: 'orders',
  ruleType: 'freshness' as const,
  toleranceMinutes: 60,
  timestampColumn: 'updated_at',
  checkIntervalMinutes: 5,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

// Run checks (metadata is automatically tracked)
const freshnessResult = await checkFreshness(database, rule, metadataStorage);
const volumeResult = await checkVolumeAnomaly(database, rule, metadataStorage);

// Clean up
await metadataStorage.close();
```

### Production Monitoring Loop
```typescript
import cron from 'node-cron';

let metadataStorage: MetadataStorage;

async function initializeMonitoring() {
  metadataStorage = await createMetadataStorage({
    type: 'postgresql',
    url: process.env.METADATA_DATABASE_URL
  });
}

async function runMonitoringCheck(rule: MonitoringRule) {
  try {
    if (rule.ruleType === 'freshness') {
      return await checkFreshness(database, rule, metadataStorage);
    } else if (rule.ruleType === 'volume_anomaly') {
      return await checkVolumeAnomaly(database, rule, metadataStorage);
    }
  } catch (error) {
    console.error(`Monitoring failed for rule ${rule.id}:`, error);
    throw error;
  }
}

// Run every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  for (const rule of monitoringRules) {
    await runMonitoringCheck(rule);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (metadataStorage) {
    await metadataStorage.close();
  }
  process.exit(0);
});

initializeMonitoring();
```

## Data Storage Details

### DuckDB Schema
The DuckDB storage automatically creates these tables:

```sql
CREATE TABLE check_executions (
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

CREATE TABLE monitoring_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL, -- JSON as text
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_executions_rule_time
ON check_executions(rule_id, executed_at);
```

### PostgreSQL Schema
Uses the existing FreshGuard Drizzle schema with tables:
- `checkExecutions` - Execution history
- `monitoringRules` - Rule definitions

## Troubleshooting

### DuckDB Issues

**File permissions**:
```bash
# Ensure write permissions
chmod 666 freshguard-metadata.db
```

**File location**:
```typescript
// Use absolute path if relative path issues
const storage = await createMetadataStorage({
  type: 'duckdb',
  path: path.resolve('./freshguard-metadata.db')
});
```

**Lock errors**:
```typescript
// Ensure proper cleanup
process.on('SIGINT', async () => {
  await metadataStorage.close();
  process.exit(0);
});
```

### PostgreSQL Issues

**Connection errors**:
```typescript
// Add connection timeout
const storage = await createMetadataStorage({
  type: 'postgresql',
  url: 'postgresql://user:pass@host:5432/db?connect_timeout=10'
});
```

**Migration issues**:
```bash
# Verify schema exists
npx drizzle-kit introspect:pg --config=drizzle.config.ts

# Apply missing migrations
npx drizzle-kit push:pg --config=drizzle.config.ts
```

**Permission issues**:
```sql
-- Grant required permissions
GRANT SELECT, INSERT, UPDATE ON check_executions TO freshguard_user;
GRANT SELECT, INSERT, UPDATE ON monitoring_rules TO freshguard_user;
```

## Best Practices

### Development
- Use DuckDB for local development and testing
- Keep metadata database files in `.gitignore`
- Use `:memory:` storage for unit tests

### Production
- Use PostgreSQL for production deployments
- Separate metadata database from application data
- Set up regular backups of metadata storage
- Monitor metadata storage disk usage
- Use connection pooling for high-traffic scenarios

### Performance
- Volume anomaly detection requires 3+ historical data points
- Execution history is automatically pruned (last 1000 executions per rule)
- Consider archiving old execution data for long-running deployments

### Security
- Use dedicated database user with minimal permissions
- Enable SSL connections for PostgreSQL
- Keep metadata database credentials secure
- Consider encrypting DuckDB files in sensitive environments