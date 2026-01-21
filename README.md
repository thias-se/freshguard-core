# FreshGuard Core

**Security-hardened, open source data pipeline freshness monitoring engine.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/@freshguard%2Fcore.svg)](https://www.npmjs.com/package/@thias-se/freshguard-core)
[![Security: Hardened](https://img.shields.io/badge/Security-Hardened-green.svg)](docs/SECURITY_FOR_SELF_HOSTERS.md)
[![Package: Signed](https://img.shields.io/badge/Package-Signed-blue.svg)](https://github.com/sigstore/cosign)

## What is FreshGuard Core?

Monitor when your data pipelines go stale. Get alerts when:
- **Data hasn't updated in X minutes** (freshness checks)
- **Row counts deviate unexpectedly** (volume anomaly detection)

**Enterprise-grade security** built-in. Supports PostgreSQL, DuckDB, BigQuery, and Snowflake. Self-hosted. Free forever.

## 🔒 Security Features

FreshGuard Core implements **defense-in-depth security** for production deployments:

- ✅ **SQL Injection Prevention** - Parameterized queries and input validation
- ✅ **Credential Security** - Environment-based secrets, never hardcoded
- ✅ **SSL/TLS Enforcement** - Encrypted connections required by default
- ✅ **Error Sanitization** - No sensitive information leaked in logs
- ✅ **Timeout Protection** - DoS attack mitigation with configurable limits
- ✅ **Package Signing** - Cosign-signed releases with SBOM transparency
- ✅ **Vulnerability Scanning** - Automated security scanning in CI/CD
- ✅ **Supply Chain Security** - Software Bill of Materials (SBOM) included

**📋 [Complete Security Guide →](docs/SECURITY_FOR_SELF_HOSTERS.md)**

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

## Features

### 📊 Monitoring
✅ **Freshness Monitoring** - Detect stale data based on last update time
✅ **Volume Anomaly Detection** - Identify unexpected row count changes

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
- **📜 Compliance guidelines** (GDPR, SOC 2, PCI DSS)

### Deployment Guides

See the [Self-Hosting Guide](docs/SELF_HOSTING.md) for:
- Docker deployment with security hardening
- Kubernetes setup with secrets management
- Environment configuration examples
- Custom alerting integration

## What's Not Included

This is the **open source core**. It does not include:
- Multi-user dashboard (use config files instead)
- Managed hosting (you manage uptime)
- Priority support (community support via GitHub)
- Advanced features (data lineage, ML anomalies)

Want these features? Check out **[FreshGuard Cloud](https://freshguard.dev)** - our managed SaaS.

## Architecture

FreshGuard uses an **Open Core** model:

- **`@thias-se/freshguard-core`** (this package) - MIT licensed, open source monitoring engine
- **`freshguard-cloud`** - Proprietary multi-tenant SaaS (optional)

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
import { checkFreshness } from '@thias-se/freshguard-core';
import { PostgresConnector } from '@thias-se/freshguard-core';
import cron from 'node-cron';

const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true,
});

// Run every 5 minutes with error handling
cron.schedule('*/5 * * * *', async () => {
  try {
    const result = await checkFreshness(connector, rule);
    console.log(`✅ Check result: ${result.status}`);
  } catch (error) {
    // Errors are sanitized to prevent information disclosure
    console.error(`❌ Monitoring failed: ${error.message}`);
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
// Import secure connectors
import {
  PostgresConnector,
  DuckDBConnector,
  BigQueryConnector,
  SnowflakeConnector
} from '@thias-se/freshguard-core';
```

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
- **🔒 [Security Guide](docs/SECURITY_FOR_SELF_HOSTERS.md)** - Complete security documentation
- **🔧 [Self-Hosting Guide](docs/SELF_HOSTING.md)** - Deployment instructions
- **🤝 [Contributing Guide](docs/CONTRIBUTING.md)** - Development setup

### 💬 Community
- **🐛 [Issues](https://github.com/freshguard/freshguard/issues)** - Bug reports and feature requests
- **💭 [Discussions](https://github.com/freshguard/freshguard/discussions)** - Questions and community support
- **📚 [GitHub Wiki](https://github.com/freshguard/freshguard/wiki)** - Additional documentation

### 🚨 Security
Found a security vulnerability? Please follow responsible disclosure:
- **Email:** security@freshguard.dev
- **Encrypted:** Use our [PGP key](https://freshguard.dev/security/pgp)
- **Response time:** 24-48 hours for critical issues

## Need Managed Hosting?

Self-hosting requires ops. Want a managed experience?

**[Try FreshGuard Cloud (COMING SOON)](https://freshguard.dev)**

---

Built with ❤️ by the FreshGuard community