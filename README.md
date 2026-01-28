# FreshGuard Core

**Security-hardened, open source data pipeline freshness monitoring engine.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pnpm version](https://img.shields.io/npm/v/@thias-se/freshguard-core.svg)](https://www.npmjs.com/package/@thias-se/freshguard-core)
[![Security: Hardened](https://img.shields.io/badge/Security-Hardened-green.svg)](docs/SECURITY_FOR_SELF_HOSTERS.md)
[![Package: Signed](https://img.shields.io/badge/Package-Signed-blue.svg)](https://github.com/sigstore/cosign)

## What is FreshGuard Core?

Monitor when your data pipelines go stale. Get alerts when:
- **Data hasn't updated in X minutes** (freshness checks)
- **Row counts deviate unexpectedly** (volume anomaly detection)
- **Database schemas change unexpectedly** (schema change monitoring)

Supports PostgreSQL, DuckDB, BigQuery, and Snowflake. Self-hosted. Free forever.

## 🔒 Security Features (Phase 2 Complete)

FreshGuard Core implements advanced threat detection:

**🛡️ Query Security & Analysis**
- ✅ **Advanced SQL Injection Protection** - 0-100 risk scoring with pattern analysis
- ✅ **Query Complexity Analysis** - Automatic blocking of expensive/dangerous queries
- ✅ **Real-time Threat Detection** - Sophisticated attack pattern recognition
- ✅ **Schema-aware Validation** - Table metadata integration for enhanced security

**🔄 Production Resilience**
- ✅ **Circuit Breaker Protection** - Automatic failure detection and recovery
- ✅ **Exponential Backoff Retry** - Intelligent retry logic with jitter
- ✅ **Connection Pooling** - Resource management and leak prevention
- ✅ **Timeout Protection** - DoS attack mitigation with AbortController

**📊 Complete Observability**
- ✅ **Structured Logging** - Pino-based JSON logging with sensitive data sanitization
- ✅ **Performance Metrics** - Query performance tracking with percentiles
- ✅ **Security Audit Trail** - Comprehensive logging of security events
- ✅ **Prometheus Integration** - Export metrics for monitoring systems

**🔐 Infrastructure Security**
- ✅ **SSL/TLS Enforcement** - Encrypted connections required by default
- ✅ **Credential Security** - Environment-based secrets, never hardcoded
- ✅ **Error Sanitization** - No sensitive information leaked in logs
- ✅ **Package Signing** - Cosign-signed releases with SBOM transparency

**📋 [Complete Security Guide →](docs/SECURITY_FOR_SELF_HOSTERS.md)** | **🚀 [Integration Guide →](docs/INTEGRATION_GUIDE.md)**

## Quick Start

### 1. Install

```bash
pnpm install @thias-se/freshguard-core
```

### 2. Check Freshness (Secure)

```typescript
import { checkFreshness, PostgresConnector } from '@thias-se/freshguard-core';
import type { MonitoringRule } from '@thias-se/freshguard-core';

// Secure connection with environment variables
const connector = new PostgresConnector({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'mydb',
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true, // SSL enforced by default
});

const rule: MonitoringRule = {
  id: 'orders-freshness',
  sourceId: 'prod_db',
  name: 'Orders Freshness',
  tableName: 'orders',
  ruleType: 'freshness',
  toleranceMinutes: 60,
  timestampColumn: 'updated_at',
  checkIntervalMinutes: 5,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const result = await checkFreshness(connector, rule);

if (result.status === 'alert') {
  console.log(`⚠️ Data is ${result.lagMinutes}m stale!`);
} else {
  console.log(`✅ Data is fresh (lag: ${result.lagMinutes}m)`);
}
```

### 3. Check Volume Anomalies (Secure)

```typescript
import { checkVolumeAnomaly, PostgresConnector } from '@thias-se/freshguard-core';

const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true, // Required for production
});

const result = await checkVolumeAnomaly(connector, rule);

if (result.status === 'alert') {
  console.log(`⚠️ Volume anomaly detected: ${result.deviation}% deviation from baseline`);
}
```

### 4. Monitor Schema Changes (Secure)

```typescript
import { checkSchemaChanges, PostgresConnector } from '@thias-se/freshguard-core';

const schemaRule: MonitoringRule = {
  id: 'users-schema',
  sourceId: 'prod_db',
  name: 'Users Table Schema Monitor',
  tableName: 'users',
  ruleType: 'schema_change',
  checkIntervalMinutes: 60,
  isActive: true,
  trackColumnChanges: true,
  trackTableChanges: true,
  schemaChangeConfig: {
    adaptationMode: 'manual',        // 'auto' | 'manual' | 'alert_only'
    monitoringMode: 'full',          // 'full' | 'partial'
    trackedColumns: {
      alertLevel: 'medium',          // 'low' | 'medium' | 'high'
      trackTypes: true,              // Monitor data type changes
      trackNullability: false        // Don't track nullability changes
    },
    baselineRefreshDays: 30          // Auto-refresh baseline monthly
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const result = await checkSchemaChanges(connector, schemaRule, metadataStorage);

if (result.status === 'alert') {
  console.log(`⚠️ Schema changes detected: ${result.schemaChanges?.summary}`);

  // Check specific changes
  if (result.schemaChanges?.addedColumns?.length > 0) {
    console.log('New columns:', result.schemaChanges.addedColumns.map(c => c.columnName));
  }

  if (result.schemaChanges?.removedColumns?.length > 0) {
    console.log('Removed columns:', result.schemaChanges.removedColumns.map(c => c.columnName));
  }

  if (result.schemaChanges?.modifiedColumns?.length > 0) {
    console.log('Modified columns:', result.schemaChanges.modifiedColumns.map(c =>
      `${c.columnName} (${c.changeType}): ${c.oldValue} → ${c.newValue}`
    ));
  }
} else {
  console.log(`✅ Schema is stable (${result.schemaChanges?.changeCount || 0} changes)`);
}
```

**Schema Change Adaptation Modes:**
- **`auto`** - Automatically adapt to safe changes (column additions, safe type changes)
- **`manual`** - Require manual approval for all changes (default)
- **`alert_only`** - Always alert, never update baseline automatically

**Monitoring Modes:**
- **`full`** - Monitor all columns in the table (default)
- **`partial`** - Monitor only specified columns in `trackedColumns.columns` array

## 📊 Metadata Storage

FreshGuard tracks execution history for volume anomaly detection and monitoring analytics. Choose between **DuckDB** (embedded, zero-setup) or **PostgreSQL** (production-ready) storage.

### Quick Setup (Zero Configuration)

```typescript
import { createMetadataStorage, checkVolumeAnomaly, PostgresConnector } from '@thias-se/freshguard-core';

// Create secure connector
const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
});

// Automatic setup - creates ./freshguard-metadata.db
const metadataStorage = await createMetadataStorage();

// Use with monitoring functions
const result = await checkVolumeAnomaly(connector, rule, metadataStorage);

// Clean up
await metadataStorage.close();
```

### Storage Options

**DuckDB (Recommended for Self-Hosting)**
- ✅ Zero database server setup
- ✅ Single file storage (`./freshguard-metadata.db`)
- ✅ Perfect for Docker containers

```typescript
// Custom path
const storage = await createMetadataStorage({
  type: 'duckdb',
  path: './my-freshguard-data.db'
});
```

**PostgreSQL (Recommended for Production)**
- ✅ Full ACID compliance
- ✅ Concurrent access support
- ✅ Backup/restore capabilities

```typescript
// Production setup
const storage = await createMetadataStorage({
  type: 'postgresql',
  url: 'postgresql://user:pass@host:5432/freshguard_metadata'
});
```

**📋 [Complete Metadata Storage Guide →](docs/METADATA_STORAGE.md)**

### 🚨 Error Handling

FreshGuard Core exports comprehensive error classes for proper error handling:

```typescript
import {
  checkFreshness,
  PostgresConnector,
  SecurityError,
  ConnectionError,
  TimeoutError,
  QueryError,
  ConfigurationError,
  MonitoringError
} from '@thias-se/freshguard-core';

try {
  const result = await checkFreshness(connector, rule);
  console.log(`✅ Check completed: ${result.status}`);
} catch (error) {
  // Handle specific error types
  if (error instanceof SecurityError) {
    console.error('🔒 Security violation:', error.message);
    // Log security incident, block request source
  } else if (error instanceof ConnectionError) {
    console.error('🔌 Database connection failed:', error.message);
    // Retry with backoff, check network connectivity
  } else if (error instanceof TimeoutError) {
    console.error('⏱️ Query timeout:', error.message);
    // Check query complexity, database performance
  } else if (error instanceof QueryError) {
    console.error('📊 Query execution failed:', error.message);
    // Check table exists, column names, permissions
  } else if (error instanceof ConfigurationError) {
    console.error('⚙️ Configuration error:', error.message);
    // Check environment variables, config file
  } else if (error instanceof MonitoringError) {
    console.error('📈 Monitoring check failed:', error.message);
    // Check rule configuration, data availability
  } else {
    console.error('❌ Unknown error:', error.message);
  }
}
```

**Error Properties:**
- `error.code` - Machine-readable error code (e.g., "SECURITY_VIOLATION")
- `error.timestamp` - When the error occurred
- `error.sanitized` - Whether error message is safe for user display

## Features

### 📊 Monitoring
✅ **Freshness Monitoring** - Detect stale data based on last update time
✅ **Volume Anomaly Detection** - Identify unexpected row count changes
✅ **Schema Change Monitoring** - Track database schema evolution with configurable adaptation modes

### 🗄️ Database Support
✅ **PostgreSQL** - Production-ready with SSL/TLS support
✅ **DuckDB** - Analytics and local development
✅ **BigQuery** - Google Cloud data warehouses
✅ **Snowflake** - Enterprise data platforms

### 🔒 Security
✅ **Security-Hardened** - Enterprise-grade security built-in
✅ **Signed Packages** - Cryptographically signed releases
✅ **Supply Chain Security** - SBOM and vulnerability scanning

### 🛠️ Developer Experience
✅ **Type-Safe** - Written in TypeScript with full type definitions
✅ **CLI Tool** - Secure command-line interface for self-hosters
✅ **Self-Hosted** - Run on your own infrastructure
✅ **MIT Licensed** - Free to use, modify, and distribute

## 🖥️ Secure CLI Usage

FreshGuard Core includes a **security-hardened CLI** for self-hosters:

```bash
# Set up secure environment variables
export FRESHGUARD_DATABASE_URL="postgresql://user:password@localhost:5432/db?sslmode=require"

# Initialize monitoring configuration
pnpm exec freshguard init

# Test connection
pnpm exec freshguard test

# Run monitoring scheduler
pnpm exec freshguard run
```

**Security Features:**
- 🔐 **Environment-based credentials** - Never expose secrets in command line
- 🛡️ **Path traversal protection** - Configuration files validated for safety
- 🔒 **SSL enforcement** - Secure connections required by default
- 📝 **Audit logging** - All operations logged for security monitoring

**📋 [CLI Security Guide →](docs/SECURITY_FOR_SELF_HOSTERS.md#cli-security)**

## 🚀 Self-Hosting

### Security-First Deployment

**📋 [Complete Security Guide →](docs/SECURITY_FOR_SELF_HOSTERS.md)**

Essential security documentation for production deployments:
- **🔒 Pre-deployment security checklist**
- **🗄️ Database security hardening** (PostgreSQL, BigQuery, Snowflake)
- **🌐 Network security configuration**
- **🔑 Credential management best practices**
- **📊 Security monitoring and incident response**

### Deployment Guides

See the [Self-Hosting Guide](docs/SELF_HOSTING.md) for:
- Docker deployment with security hardening
- Kubernetes setup with secrets management
- Environment configuration examples
- Custom alerting integration

## What's Not Included

This is the **open source core**. It does not include:
- Managed hosting (you manage uptime)
- Multi-user dashboard and config UI (use config files instead)

Want these features? Check out **[FreshGuard Cloud](https://freshguard.dev)** - our managed SaaS.

## Architecture

FreshGuard uses an **Open Core** model:

- **`@thias-se/freshguard-core`** (this package) - MIT licensed, open source monitoring engine
- **`freshguard`** - Proprietary multi-tenant SaaS (optional)

You can self-host the core or use our managed cloud service.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Examples

### 🔒 Secure Database Connections

```typescript
import { PostgresConnector, BigQueryConnector } from '@thias-se/freshguard-core';

// PostgreSQL with SSL enforcement
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true, // Required by default for security
};
const postgres = new PostgresConnector(pgConfig);

// BigQuery with service account
const bqConfig = {
  host: 'bigquery.googleapis.com',
  database: 'my-project',
  password: process.env.BIGQUERY_SERVICE_ACCOUNT_JSON!,
  ssl: true,
};
const bigquery = new BigQueryConnector(bqConfig);
```

### 🔔 Custom Alerting

```typescript
import { checkFreshness } from '@thias-se/freshguard-core';
import { PostgresConnector } from '@thias-se/freshguard-core';
import { sendSlackAlert } from './alerts.js';

// Secure connection using environment variables
const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true, // SSL required for production
});

const result = await checkFreshness(connector, rule);

if (result.status === 'alert') {
  await sendSlackAlert({
    channel: '#data-alerts',
    message: `⚠️ ${rule.name} is stale (${result.lagMinutes}m lag)`,
  });
}
```

### 📅 Scheduled Monitoring

```typescript
import { checkFreshness, checkVolumeAnomaly, checkSchemaChanges } from '@thias-se/freshguard-core';
import { PostgresConnector } from '@thias-se/freshguard-core';
import cron from 'node-cron';

const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true,
});

// Run every 5 minutes with comprehensive error handling
cron.schedule('*/5 * * * *', async () => {
  try {
    const result = await checkFreshness(connector, rule);
    console.log(`✅ Check result: ${result.status}`);
  } catch (error) {
    // Import error classes for specific handling
    const { SecurityError, ConnectionError, TimeoutError } = require('@thias-se/freshguard-core');

    if (error instanceof ConnectionError) {
      console.error(`🔌 Database connection failed: ${error.message}`);
      // Implement reconnection logic
    } else if (error instanceof TimeoutError) {
      console.error(`⏱️ Query timeout: ${error.message}`);
      // Alert ops team about performance issues
    } else if (error instanceof SecurityError) {
      console.error(`🔒 Security violation: ${error.message}`);
      // Log security incident for investigation
    } else {
      console.error(`❌ Monitoring failed: ${error.message}`);
    }
  }
});

// Monitor schema changes hourly
cron.schedule('0 * * * *', async () => {
  try {
    const schemaRule = {
      id: 'user-schema-monitor',
      sourceId: 'prod_db',
      name: 'User Table Schema Monitor',
      tableName: 'users',
      ruleType: 'schema_change',
      checkIntervalMinutes: 60,
      isActive: true,
      schemaChangeConfig: {
        adaptationMode: 'manual',      // Require manual approval
        monitoringMode: 'full',        // Monitor all columns
        trackedColumns: {
          alertLevel: 'high',          // High-priority alerts
          trackTypes: true,
          trackNullability: false
        }
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await checkSchemaChanges(connector, schemaRule, metadataStorage);

    if (result.status === 'alert') {
      console.log(`🚨 Schema changes detected in users table: ${result.schemaChanges?.summary}`);
      // Send critical alert to operations team
    } else {
      console.log(`✅ Schema check passed: ${result.schemaChanges?.changeCount || 0} changes`);
    }
  } catch (error) {
    console.error(`❌ Schema monitoring failed: ${error.message}`);
  }
});
```

### 🔍 Package Signature Verification

Verify the integrity of FreshGuard Core packages:

```bash
# Download signature files from GitHub release
curl -L -o freshguard-core.tgz.sig "https://github.com/user/repo/releases/latest/download/freshguard-core.tgz.sig"
curl -L -o freshguard-core.tgz.crt "https://github.com/user/repo/releases/latest/download/freshguard-core.tgz.crt"

# Verify with cosign
cosign verify-blob --certificate freshguard-core.tgz.crt --signature freshguard-core.tgz.sig \
  --certificate-identity-regexp=".*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  freshguard-core.tgz
```

## 📚 API Documentation

### Security-First Connectors

```typescript
// Import secure connectors, monitoring functions, and error classes
import {
  PostgresConnector,
  DuckDBConnector,
  BigQueryConnector,
  SnowflakeConnector,
  checkFreshness,
  checkVolumeAnomaly,
  checkSchemaChanges,
  SecurityError,
  ConnectionError,
  TimeoutError,
  QueryError,
  ConfigurationError,
  MonitoringError
} from '@thias-se/freshguard-core';
```

### Error Classes

FreshGuard Core provides comprehensive error handling with specific error types:

- **`SecurityError`** - SQL injection attempts, invalid identifiers, blocked queries
- **`ConnectionError`** - Database connection failures, authentication issues
- **`TimeoutError`** - Query timeouts, connection timeouts
- **`QueryError`** - Syntax errors, table/column not found, execution failures
- **`ConfigurationError`** - Missing required fields, invalid configuration values
- **`MonitoringError`** - Freshness check failures, volume anomaly detection errors

All errors include:
- `error.code` - Machine-readable error code
- `error.timestamp` - Error occurrence timestamp
- `error.sanitized` - Whether the message is safe for user display

### `checkFreshness(connector, rule)`

Check data freshness for a given rule with security built-in.

**Parameters:**
- `connector` - Secure database connector (PostgresConnector, BigQueryConnector, etc.)
- `rule` - Monitoring rule configuration

**Returns:** `Promise<CheckResult>` with sanitized error messages

### `checkVolumeAnomaly(connector, rule)`

Check for volume anomalies with statistical safety measures.

**Parameters:**
- `connector` - Secure database connector
- `rule` - Monitoring rule configuration with validation

**Returns:** `Promise<CheckResult>` with overflow protection

### `checkSchemaChanges(connector, rule)`

Monitor database schema changes with configurable adaptation modes.

**Parameters:**
- `connector` - Secure database connector
- `rule` - Monitoring rule with `ruleType: 'schema_change'` and optional `schemaChangeConfig`
- `metadataStorage` (optional) - Metadata storage for baseline persistence

**Returns:** `Promise<CheckResult>` with `schemaChanges` field containing:
- `hasChanges` - Boolean indicating if changes were detected
- `addedColumns` - Array of newly added columns
- `removedColumns` - Array of removed columns (breaking changes)
- `modifiedColumns` - Array of type/constraint changes
- `summary` - Human-readable change summary
- `changeCount` - Total number of changes
- `severity` - Change impact level ('low', 'medium', 'high')

### Database Connectors

**PostgresConnector** - Production-ready with SSL enforcement
```typescript
const connector = new PostgresConnector({
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true, // Required by default
});
```

**BigQueryConnector** - Google Cloud with service account validation
**SnowflakeConnector** - Enterprise data platform with host validation
**DuckDBConnector** - Analytics with path traversal protection

### 🔧 Environment Setup

Copy `.env.example` to `.env` for secure configuration:

```bash
cp .env.example .env
# Edit .env with your secure credentials
```

The `.env.example` file includes comprehensive security guidelines and examples for all supported databases.

## License

MIT - See [LICENSE](./LICENSE)

## 📞 Support

### 📋 Documentation

**🚀 Getting Started**
- **🔧 [Integration Guide](docs/INTEGRATION_GUIDE.md)** - Complete integration examples for developers
- **🏠 [Self-Hosting Guide](docs/SELF_HOSTING.md)** - Production deployment with security features
- **🤝 [Contributing Guide](docs/CONTRIBUTING.md)** - Development setup and guidelines

**🔒 Security & Production**
- **🛡️ [Security Guide](docs/SECURITY_FOR_SELF_HOSTERS.md)**

**🏗️ Advanced Topics**
- **⚙️ Configuration Examples** - Environment-specific setups (dev/staging/prod)
- **📈 Monitoring & Observability** - Structured logging, metrics, and alerting
- **🔄 Multi-Database Setup** - PostgreSQL, BigQuery, Snowflake, DuckDB integration
- **🚨 Circuit Breakers & Resilience** - Automatic failure recovery and protection

### 💬 Community
- **🐛 [Issues](https://github.com/freshguard/freshguard/issues)** - Bug reports and feature requests
- **💭 [Discussions](https://github.com/freshguard/freshguard/discussions)** - Questions and community support

## Need Managed Hosting?

Self-hosting requires ops. Want a managed experience?

**[Try FreshGuard Cloud (COMING SOON)](https://freshguard.dev)**

---

Built with ❤️ by the FreshGuard community