# FreshGuard Core - Secure Monitoring Example

This example demonstrates **FreshGuard Core v0.2.0** with **Phase 2 Security Implementation** for enterprise-grade data pipeline monitoring in a self-hosted environment.

## What This Example Shows

✅ **Enterprise Security** - Query complexity analysis, SQL injection protection, SSL enforcement
✅ **PostgreSQL Integration** - Secure connector with built-in security validation
✅ **Freshness Monitoring** - Detect when data becomes stale with automatic query analysis
✅ **Volume Anomaly Detection** - Identify unexpected changes in data volume
✅ **Schema Change Monitoring** - Track database schema evolution with configurable adaptation modes
✅ **Security Observability** - Structured logging, metrics, and audit trails
✅ **Production Resilience** - Circuit breakers, timeouts, and error sanitization
✅ **Alert Handling** - Secure notification channels with data sanitization

## Prerequisites

- **Node.js20+** (Check with `node --version`)
- **Docker & Docker Compose** (for PostgreSQL database)
- **pnpm** (package manager)

## Quick Start (5 minutes)

### 1. Clone and Setup

```bash
# If you're working with the FreshGuard repo
cd examples/basic-freshness-check

# Install dependencies
pnpm install
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# The defaults work with the included Docker setup
# Edit .env if you want to use a different database
```

### 3. Start Database

```bash
# Start PostgreSQL with sample data
docker-compose up -d

# Wait for database to be ready (about 10-15 seconds)
docker-compose logs -f postgres
# Look for: "database system is ready to accept connections"
```

### 4. Setup Monitoring

```bash
# Test connection and verify sample data
pnpm run setup
```

Expected output:
```
🚀 Setting up FreshGuard Core - Secure Monitoring Example

🛡️  Phase 2 Security Features:
   • Secure PostgreSQL connector with SSL enforcement
   • Query complexity analysis for all database operations
   • Structured logging with sensitive data sanitization
   • Circuit breaker protection for connection failures
   • Advanced SQL injection prevention

📡 Creating secure PostgreSQL connector...
✅ Secure connector created with enterprise security features

🔍 Testing secure database connection...
   Connection verified - PostgreSQL system accessible (4 databases)
   Security: All queries passed complexity analysis
   Performance: Connection within timeout limits
✅ Secure connection test passed

📊 Verifying sample data with security analysis...
   🔍 Checking orders table...
     Orders table: 6 rows (query risk score: low)
   🔍 Checking user_events table...
     User events table: 1050 rows (query risk score: low)
   🔍 Checking latest order updates...
     Latest order updated: 10 minutes ago
   ✅ All data verification queries passed security analysis
✅ Sample data verified through secure queries
```

### 5. Run Monitoring

```bash
# Execute monitoring checks
pnpm run monitor
```

Expected output:
```
🔍 FreshGuard Core - Secure Monitoring Example

🛡️  Phase 2 Security Features Enabled:
   • Query complexity analysis
   • SQL injection protection
   • SSL connection enforcement
   • Structured logging & metrics
   • Circuit breaker protection

📊 Monitoring 2 rules...
🕐 Started at: 2024-01-15T10:30:45.123Z

🔐 Initializing secure PostgreSQL connector...
✅ Secure connector initialized

🔍 Testing secure connection...
✅ Secure connection established

🔎 Checking: Orders Freshness Check
   Table: orders
   Type: freshness
   Security: Query analysis enabled
   Status: ✅ OK
   Data lag: 10 minutes
   Tolerance: 60 minutes
   Last update: 1/15/2024, 10:20:45 AM

🔎 Checking: User Events Volume Check
   Table: user_events
   Type: volume
   Security: Query analysis enabled
   Status: ✅ OK
   Current count: 50
   Expected count: 45
   Deviation: 11%

🔒 SECURITY & PERFORMANCE METRICS
==================================================
📊 Query Performance:
   • Queries executed: Protected by query analysis
   • SQL injection attempts blocked: 0
   • Average query time: < 100ms
   • Connection pool: Healthy

🛡️  Security Status:
   • SSL connection: ✅ Enforced
   • Query analysis: ✅ Enabled
   • Risk scoring: ✅ Active (max: 70)
   • Complexity limits: ✅ Active (max: 80)
   • Circuit breaker: ✅ Closed (healthy)
```

## Understanding the Example

### Database Schema

The example creates two monitoring targets:

```sql
-- Orders table - for freshness monitoring
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_total DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP  -- ← Monitored
);

-- User events table - for volume monitoring
CREATE TABLE user_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP  -- ← Monitored
);
```

### Monitoring Rules

**Rule 1: Orders Freshness**
- **Purpose**: Detect when order updates stop flowing
- **Logic**: Alert if no orders updated in last 60 minutes
- **Use Case**: Critical business process monitoring

**Rule 2: User Events Volume**
- **Purpose**: Detect unusual spikes or drops in user activity
- **Logic**: Compare recent volume to historical baseline
- **Use Case**: Traffic anomaly detection

### File Structure

```
basic-freshness-check/
├── README.md              # This file
├── package.json           # Dependencies and scripts
├── docker-compose.yml     # PostgreSQL setup
├── init.sql              # Sample database schema/data
├── .env.example          # Configuration template
├── setup.ts              # Database connection verification
└── monitor.ts            # Main monitoring logic
```

## Detailed Usage

### Understanding the Code

**setup.ts** - Secure connector setup and verification:
```typescript
import { PostgresConnector } from '@thias-se/freshguard-core';

// Create secure connector with enterprise security features
const connector = new PostgresConnector(dbConfig, {
  enableQueryAnalysis: true,      // SQL injection protection
  maxQueryRiskScore: 80,         // Block high-risk queries
  requireSSL: true,              // Enforce secure connections
  enableDetailedLogging: true    // Full audit trail
});

// Test connection with security validation
await connector.testConnection();
```

**monitor.ts** - Secure monitoring with automatic query analysis:
```typescript
import {
  PostgresConnector,
  checkFreshness,
  checkVolumeAnomaly
} from '@thias-se/freshguard-core';

// Security configuration for production
const securityConfig = {
  enableQueryAnalysis: true,
  maxQueryRiskScore: 70,           // Block risky queries
  maxQueryComplexityScore: 80,     // Limit query complexity
  requireSSL: true,                // SSL enforced
  blockedKeywords: ['INSERT', 'UPDATE', 'DELETE', 'DROP']
};

const connector = new PostgresConnector(dbConfig, securityConfig);

// Execute secure monitoring check
const result = await checkFreshness(connector, rule);
```

### Customizing Monitoring Rules

Edit the `MONITORING_RULES` array in `monitor.ts`:

```typescript
const MONITORING_RULES: MonitoringRule[] = [
  {
    id: 'orders-freshness',
    tableName: 'orders',
    ruleType: 'freshness',
    toleranceMinutes: 30,        // ← Reduce for more sensitive alerts
    timestampColumn: 'updated_at',
    // ...
  }
];
```

**Common modifications:**
- **toleranceMinutes**: How long before data is considered stale
- **timestampColumn**: Which column contains the timestamp to monitor
- **tableName**: Which table to monitor

### Triggering Alerts

To see alerts in action:

**Option 1: Adjust tolerance**
```typescript
toleranceMinutes: 5,  // Very sensitive - alerts quickly
```

**Option 2: Modify sample data**
```sql
-- Connect to database
docker exec -it freshguard-example-db psql -U freshguard_user -d freshguard_example

-- Make all orders old
UPDATE orders SET updated_at = NOW() - INTERVAL '2 hours';

-- Run monitoring again
\q
pnpm run monitor
```

**Option 3: Stop data flow simulation**
```sql
-- In production, this would be pipeline failure
-- Here we just make timestamps old
UPDATE orders SET updated_at = '2024-01-01 00:00:00';
```

### Production Integration

**Secure Scheduling with Enterprise Features:**
```typescript
import cron from 'node-cron';
import { PostgresConnector } from '@thias-se/freshguard-core';

// Production security configuration
const prodSecurityConfig = {
  enableQueryAnalysis: true,
  maxQueryRiskScore: 50,         // Stricter in production
  requireSSL: true,
  enableDetailedLogging: false,   // Reduce log volume
  connectionTimeout: 15000
};

// Secure scheduled monitoring
cron.schedule('*/5 * * * *', async () => {
  const connector = new PostgresConnector(dbConfig, prodSecurityConfig);
  try {
    const results = await runSecureMonitoring(connector);
    await handleSecureAlerts(results);
  } catch (error) {
    // Secure error handling - no sensitive data in logs
    logger.error('Monitoring failed', {
      error: error.message,  // Already sanitized
      timestamp: new Date().toISOString()
    });
  }
});
```

**Secure Alert Handling:**
```typescript
if (result.status === 'alert') {
  // Secure Slack notification with audit trail
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SLACK_TOKEN}` // Authenticated
    },
    body: JSON.stringify({
      text: `🚨 ${rule.name}: ${sanitizeAlertMessage(result.message)}`,
      attachments: [{
        color: 'danger',
        fields: [
          { title: 'Security', value: 'Query analysis passed', short: true },
          { title: 'Audit ID', value: generateAuditId(), short: true }
        ]
      }]
    })
  });

  // Encrypted email with sanitized content
  await sendSecureEmail({
    to: process.env.ALERT_EMAIL,
    subject: `🛡️ Secure Data Alert: ${rule.name}`,
    body: sanitizeAlertMessage(result.message),
    encryption: 'TLS',
    auditTrail: true
  });
}
```

## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker-compose ps

# Check PostgreSQL logs
docker-compose logs postgres

# Test connection manually
docker exec -it freshguard-example-db psql -U freshguard_user -d freshguard_example -c "SELECT NOW();"
```

### Common Error Messages

**"connection refused"**
- PostgreSQL not started: `docker-compose up -d`
- Wrong port/host in DATABASE_URL

**"database does not exist"**
- Database creation failed: Check docker-compose logs
- Wrong database name in connection string

**"Sample data not found"**
- init.sql didn't run: Recreate containers with `docker-compose down -v && docker-compose up -d`

**"Module not found"**
- Dependencies not installed: `pnpm install`
- FreshGuard Core not built: Check main package

### Performance Considerations

**For large tables:**
- Add indexes on timestamp columns: `CREATE INDEX idx_orders_updated_at ON orders(updated_at);`
- Use table partitioning for historical data
- Consider sampling for volume checks

**For high frequency:**
- Use connection pooling
- Cache baseline calculations
- Implement proper error handling and retries

## Next Steps

### Extending This Example

1. **Add More Rules**: Monitor additional tables and metrics
2. **Custom Alerts**: Integrate with your notification systems
3. **Dashboard**: Build a simple web UI to view results
4. **Historical Tracking**: Store check results for trend analysis

### Production Deployment

1. **Environment Management**: Use proper secrets management
2. **Error Handling**: Add comprehensive logging and error recovery
3. **Monitoring the Monitor**: Health checks for the monitoring system itself
4. **Scaling**: Consider multiple instances for high availability

### Other Database Types

FreshGuard Core supports multiple databases:
- **DuckDB**: For analytical workloads
- **More coming**: MySQL, BigQuery, Snowflake

See the main FreshGuard documentation for connector examples.

## Learn More

- **FreshGuard Core Documentation**: [Main README](../../README.md)
- **API Reference**: [TypeScript definitions](../../src/types.ts)
- **Self-Hosting Guide**: [docs/SELF_HOSTING.md](../../docs/SELF_HOSTING.md)
- **Contributing**: [docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md)

## Support

- **Issues**: [GitHub Issues](https://github.com/freshguard/freshguard/issues)
- **Discussions**: [GitHub Discussions](https://github.com/freshguard/freshguard/discussions)

---

**🎉 You now have a working data freshness monitoring system!**

Try modifying the rules, adding new tables to monitor, or integrating with your existing alerting infrastructure.