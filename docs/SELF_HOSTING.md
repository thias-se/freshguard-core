# Self-Hosting FreshGuard Core

Guide for self-hosting FreshGuard Core in your own environment.

## What You Get (Free, Self-Hosted)

✅ **Basic Security** - Input validation, SQL injection protection, secure connections
✅ **Core Monitoring** - Freshness, volume anomaly detection, and schema change monitoring
✅ **Multi-Database Support** - PostgreSQL, BigQuery, Snowflake, DuckDB, MySQL, Redshift
✅ **Structured Logging** - JSON logging with error sanitization
✅ **Custom Integration** - Build your own alerting with the API
✅ **Full Control** - Your data stays on your infrastructure
✅ **CLI Tool** - Command-line interface for basic operations

## What's Not Included (Cloud-Only)

❌ **Multi-tenant Dashboard** - You get programmatic API or config files
❌ **Uptime SLA** - Your uptime = your responsibility
❌ **Managed Infrastructure** - You handle deployment and scaling

## Quick Start

### Installation

```bash
pnpm add @thias-se/freshguard-core
```

### Basic Setup

```typescript
import { PostgresConnector, checkFreshness } from '@thias-se/freshguard-core';
import type { MonitoringRule } from '@thias-se/freshguard-core';

// Basic configuration
const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  port: parseInt(process.env.DB_PORT!) || 5432,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,     // Use read-only user
  password: process.env.DB_PASSWORD!, // From environment variables
  ssl: true,                          // Enable SSL
});

// Define monitoring rule
const rule: MonitoringRule = {
  id: 'orders-freshness',
  sourceId: 'main_db',
  name: 'Orders Freshness Check',
  tableName: 'orders',
  ruleType: 'freshness',
  toleranceMinutes: 60,
  timestampColumn: 'created_at',
  checkIntervalMinutes: 5,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Check freshness
const result = await checkFreshness(connector, rule);
console.log(`Status: ${result.status}, Lag: ${result.lagMinutes}m`);
```

## Security Best Practices

FreshGuard Core includes basic security features that are enabled by default.

### Connection Security

```typescript
import { PostgresConnector } from '@thias-se/freshguard-core';

// Secure connection configuration
const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  port: parseInt(process.env.DB_PORT!) || 5432,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,     // Use dedicated read-only user
  password: process.env.DB_PASSWORD!, // Store in environment variables
  ssl: true,                          // Always use SSL in production
});
```

### Environment Variables

Always use environment variables for sensitive configuration:

```bash
# Required database configuration
DB_HOST=your-database-host
DB_PORT=5432
DB_NAME=your-database
DB_USER=freshguard_readonly
DB_PASSWORD=secure-random-password

# Application configuration
NODE_ENV=production
LOG_LEVEL=info
```

### Database User Setup

Create dedicated read-only users for FreshGuard:

```sql
-- PostgreSQL Example
CREATE ROLE freshguard_readonly;
GRANT CONNECT ON DATABASE myapp TO freshguard_readonly;
GRANT USAGE ON SCHEMA public TO freshguard_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO freshguard_readonly;

-- Prevent any write operations
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM freshguard_readonly;

CREATE USER freshguard_monitor WITH PASSWORD 'secure_random_password';
GRANT freshguard_readonly TO freshguard_monitor;
```

## Production Deployment

## Using the CLI Tool

The included CLI provides basic operations:

```bash
# Set up your database connection
export FRESHGUARD_DATABASE_URL="postgresql://user:password@localhost:5432/mydb"

# Initialize configuration
pnpm exec freshguard init

# Test the connection
pnpm exec freshguard test

# Run basic monitoring
pnpm exec freshguard run
```

## Docker Example (Basic)

A simple Docker setup for reference:

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Use environment variables for configuration
ENV NODE_ENV=production

CMD ["node", "dist/your-app.js"]
```

## Environment Configuration

Set up your environment variables:

```bash
# Database connection
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database
DB_USER=freshguard_readonly
DB_PASSWORD=your_secure_password

# Application settings
NODE_ENV=production
LOG_LEVEL=info
```

## Basic Monitoring

### Simple Health Check

Create a basic health check for your monitoring:

```typescript
import { PostgresConnector } from '@thias-se/freshguard-core';

const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true,
});

// Simple health check function
async function healthCheck() {
  try {
    await connector.testConnection();
    console.log('✅ Database connection healthy');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

// Run health check
healthCheck();
```

### Logging

FreshGuard Core includes structured logging. Logs are output in JSON format and can be collected by your logging system.

```typescript
// Logs are automatically generated by connectors
// Example log output:
{
  "level": "info",
  "time": "2024-01-22T10:30:00.000Z",
  "operation": "checkFreshness",
  "table": "orders",
  "duration": 150,
  "success": true
}
```

## Data Freshness Monitoring

### Programmatic Monitoring

Build your own monitoring system using the core API:

```typescript
import {
  PostgresConnector,
  checkFreshness,
  checkVolumeAnomaly,
  createMetadataStorage
} from '@thias-se/freshguard-core';
import type { MonitoringRule } from '@thias-se/freshguard-core';

// Set up database connection
const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true,
});

// Set up metadata storage (for volume monitoring)
const metadataStorage = await createMetadataStorage();

// Define monitoring rules
const freshnessRule: MonitoringRule = {
  id: 'orders-freshness',
  sourceId: 'main_db',
  name: 'Orders Freshness Check',
  tableName: 'orders',
  ruleType: 'freshness',
  toleranceMinutes: 60,
  timestampColumn: 'created_at',
  checkIntervalMinutes: 5,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const volumeRule: MonitoringRule = {
  id: 'orders-volume',
  sourceId: 'main_db',
  name: 'Orders Volume Check',
  tableName: 'orders',
  ruleType: 'volume_anomaly',
  checkIntervalMinutes: 15,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Run checks
async function runMonitoring() {
  try {
    // Check freshness
    const freshnessResult = await checkFreshness(connector, freshnessRule);
    if (freshnessResult.status === 'alert') {
      console.log(`⚠️ Data is stale: ${freshnessResult.lagMinutes}m`);
      // Send your own alerts here
    }

    // Check volume
    const volumeResult = await checkVolumeAnomaly(connector, volumeRule, metadataStorage);
    if (volumeResult.status === 'alert') {
      console.log(`⚠️ Volume anomaly detected`);
      // Send your own alerts here
    }

  } catch (error) {
    console.error('Monitoring check failed:', error.message);
  }
}
```

### Simple Scheduling

For regular monitoring, you can set up a simple schedule:

```typescript
// Simple monitoring loop
setInterval(async () => {
  await runMonitoring();
}, 5 * 60 * 1000); // Run every 5 minutes
```

### Custom Alerting

Build your own alerting by checking the results:

```typescript
// Example: Send Slack notification
async function sendSlackAlert(message: string) {
  if (process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
  }
}

// Use in your monitoring
if (result.status === 'alert') {
  await sendSlackAlert(`⚠️ Data freshness alert: ${result.lagMinutes}m lag`);
}
```

## Support and Resources

- **Integration Guide**: [Implementation examples](./INTEGRATION_GUIDE.md)
- **Security Guide**: [Security considerations](./SECURITY_FOR_SELF_HOSTERS.md)
- **GitHub Issues**: [Report bugs or request features](https://github.com/thias-se/freshguard-core/issues)
- **GitHub Discussions**: [Ask questions and share experiences](https://github.com/thias-se/freshguard-core/discussions)

## Next Steps

1. **Start Simple**: Use the CLI tool to test connectivity and basic monitoring
2. **Build Custom Logic**: Use the API to create monitoring that fits your needs
3. **Add Alerting**: Integrate with your existing notification systems
4. **Scale Up**: Deploy in your preferred environment (Docker, systemd, etc.)

## License

MIT License - Free for commercial and personal use. See [LICENSE](../LICENSE) for details.