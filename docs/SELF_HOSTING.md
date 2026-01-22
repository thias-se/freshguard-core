# Self-Hosting FreshGuard Core

Complete guide for self-hosting FreshGuard Core with enterprise-grade security and monitoring.

## What You Get (Free, Self-Hosted)

✅ **Enterprise Security** - Query complexity analysis, SQL injection protection, circuit breakers
✅ **Core Monitoring Engine** - Freshness + Volume anomaly detection
✅ **Multi-Database Support** - PostgreSQL, BigQuery, Snowflake, DuckDB connectors
✅ **Production Observability** - Structured logging, metrics, performance monitoring
✅ **Custom Alerting** - Slack/Email/PagerDuty integration via APIs
✅ **Full Control** - Your data stays on your infrastructure
✅ **Docker & Kubernetes Ready** - Production-ready deployment examples

## What's Not Included (Cloud-Only)

❌ **Multi-tenant Dashboard** - You get programmatic API or config files
❌ **99.9% SLA** - Your uptime = your responsibility
❌ **Managed Infrastructure** - You handle deployment and scaling
❌ **Priority Support** - Community support via GitHub

## Quick Start

### Installation

```bash
npm install @thias-se/freshguard-core
# or
pnpm add @thias-se/freshguard-core
```

### Basic Setup

```typescript
import { PostgresConnector } from '@thias-se/freshguard-core';

// Production-ready configuration with security features
const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  port: parseInt(process.env.DB_PORT!),
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,           // Use read-only user
  password: process.env.DB_PASSWORD!,       // From secure vault
  ssl: true,                                // Always require SSL
  timeout: 30000,
  queryTimeout: 10000
}, {
  // Security configuration
  enableQueryAnalysis: true,                // Enable complexity analysis
  maxQueryRiskScore: 70,                   // Block high-risk queries
  maxQueryComplexityScore: 80,             // Limit query complexity
  enableDetailedLogging: false,            // Reduce log volume in prod
  requireSSL: true                         // Enforce SSL connections
});

// Check data freshness with automatic security protection
const rowCount = await connector.getRowCount('orders');
const lastUpdate = await connector.getMaxTimestamp('orders', 'created_at');

console.log(`Orders: ${rowCount} rows, last update: ${lastUpdate}`);
```

## Security Configuration

FreshGuard Core includes enterprise-grade security features that must be properly configured.

### Production Security Setup

```typescript
import { PostgresConnector, SecurityConfig } from '@thias-se/freshguard-core';

const prodSecurityConfig: Partial<SecurityConfig> = {
  // Query Security Analysis
  enableQueryAnalysis: true,              // Always enable in production
  maxQueryRiskScore: 70,                 // Block high-risk queries (0-100)
  maxQueryComplexityScore: 80,           // Block overly complex queries

  // Connection Security
  requireSSL: true,                      // Enforce SSL connections
  connectionTimeout: 30000,              // 30 second connection timeout
  queryTimeout: 10000,                   // 10 second query timeout
  maxRows: 1000,                        // Limit result set size

  // Query Pattern Security
  allowedQueryPatterns: [                // Override defaults if needed
    /^SELECT COUNT\(\*\) FROM/i,
    /^SELECT MAX\(/i,
    /^SELECT MIN\(/i
  ],
  blockedKeywords: [                     // Additional blocked keywords
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE'
  ],

  // Logging and Monitoring
  enableDetailedLogging: false           // Reduce log volume in production
};

const connector = new PostgresConnector(dbConfig, prodSecurityConfig);
```

### Development Configuration

```typescript
const devSecurityConfig: Partial<SecurityConfig> = {
  // More permissive for development
  enableQueryAnalysis: true,
  maxQueryRiskScore: 90,                 // Allow riskier queries for testing
  maxQueryComplexityScore: 100,          // Allow complex queries for debugging
  enableDetailedLogging: true,           // Full logging for development
  requireSSL: false                      // Allow non-SSL for local dev
};
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

### Environment Variables

```bash
# Database Configuration
DB_HOST=your-secure-database-host
DB_PORT=5432
DB_NAME=production_db
DB_USER=freshguard_monitor           # Read-only user
DB_PASSWORD=secure_vault_password    # From secret management system

# Security Configuration
FRESHGUARD_MAX_RISK_SCORE=70
FRESHGUARD_MAX_COMPLEXITY_SCORE=80
FRESHGUARD_ENABLE_QUERY_ANALYSIS=true
FRESHGUARD_REQUIRE_SSL=true

# Monitoring Configuration
FRESHGUARD_LOG_LEVEL=info
FRESHGUARD_ENABLE_METRICS=true
FRESHGUARD_DETAILED_LOGGING=false

# Application Configuration
NODE_ENV=production
PORT=3000
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

# Security: Create non-root user
RUN addgroup -g 1001 -S freshguard && adduser -S -u 1001 freshguard -G freshguard

# Application setup
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --omit=dev

# Copy application code
COPY . .
RUN chown -R freshguard:freshguard /app

# Security: Run as non-root user
USER freshguard

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["npm", "start"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: freshguard-monitor
  labels:
    app: freshguard-monitor
spec:
  replicas: 2
  selector:
    matchLabels:
      app: freshguard-monitor
  template:
    metadata:
      labels:
        app: freshguard-monitor
    spec:
      containers:
      - name: freshguard
        image: your-registry/freshguard-monitor:latest
        ports:
        - containerPort: 3000
        env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: freshguard-secrets
              key: db-password
        - name: FRESHGUARD_MAX_RISK_SCORE
          value: "70"
        - name: FRESHGUARD_ENABLE_QUERY_ANALYSIS
          value: "true"
        - name: NODE_ENV
          value: "production"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        # Security Context
        securityContext:
          runAsNonRoot: true
          runAsUser: 1001
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
          capabilities:
            drop:
            - ALL
        # Health Checks
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Secret
metadata:
  name: freshguard-secrets
type: Opaque
data:
  db-password: <base64-encoded-password>
---
apiVersion: v1
kind: Service
metadata:
  name: freshguard-service
spec:
  selector:
    app: freshguard-monitor
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: ClusterIP
```

## Monitoring and Observability

### Structured Logging

FreshGuard Core provides comprehensive structured logging:

```typescript
import { createDatabaseLogger } from '@thias-se/freshguard-core';

// Configure logging for your environment
const logger = createDatabaseLogger('postgres', {
  level: process.env.FRESHGUARD_LOG_LEVEL || 'info',
  serviceName: 'freshguard-monitor',
  baseContext: {
    environment: process.env.NODE_ENV,
    version: process.env.APP_VERSION,
    region: process.env.AWS_REGION
  }
});

// Logs are automatically generated by connectors
// Example log output:
{
  "level": "info",
  "time": "2024-01-22T10:30:00.000Z",
  "service": "freshguard-core",
  "component": "postgres",
  "operation": "getRowCount",
  "table": "orders",
  "duration": 150,
  "success": true,
  "rowCount": 50000
}
```

### Metrics Collection

```typescript
import { createComponentMetrics } from '@thias-se/freshguard-core';

// Metrics are automatically collected by connectors
const connector = new PostgresConnector(dbConfig, {
  enableMetrics: true
});

// Access metrics for monitoring systems
const metrics = connector.getMetrics();

// Export to Prometheus format
const prometheusMetrics = metrics.exportPrometheus();

// Key metrics available:
// - freshguard_queries_total{database,table,operation,status}
// - freshguard_query_duration_seconds{database,table,operation}
// - freshguard_circuit_breaker_state{name}
// - freshguard_cache_operations_total{type,status}
```

### Health Check Endpoint

```typescript
import express from 'express';
import { PostgresConnector } from '@thias-se/freshguard-core';

const app = express();
const connector = new PostgresConnector(dbConfig);

app.get('/health', async (req, res) => {
  try {
    // Test database connectivity
    await connector.testConnection();

    // Check cache statistics
    const cacheStats = connector.getSchemaCacheStats();

    // Check circuit breaker status
    const circuitBreakerStats = connector.getCircuitBreakerStats();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        cacheHitRatio: cacheStats.hitRatio,
        circuitBreakerState: circuitBreakerStats.state
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

app.get('/metrics', (req, res) => {
  const metrics = connector.getMetrics().exportPrometheus();
  res.set('Content-Type', 'text/plain');
  res.send(metrics);
});

app.listen(3000);
```

## Data Freshness Monitoring

### Configuration-Based Monitoring

Create `freshguard-config.yaml`:

```yaml
# FreshGuard Configuration
databases:
  production:
    type: postgres
    host: ${DB_HOST}
    port: 5432
    database: ${DB_NAME}
    username: ${DB_USER}
    password: ${DB_PASSWORD}
    ssl: true

    # Security settings
    security:
      enableQueryAnalysis: true
      maxQueryRiskScore: 70
      maxQueryComplexityScore: 80
      requireSSL: true

# Monitoring rules
rules:
  - id: orders_freshness
    database: production
    table: orders
    type: freshness
    timestampColumn: created_at
    frequency: 300              # Check every 5 minutes
    toleranceMinutes: 60        # Alert if > 1 hour stale
    enabled: true

    alerts:
      - type: slack
        webhook: ${SLACK_WEBHOOK_URL}
        severity: warning

      - type: pagerduty
        integrationKey: ${PAGERDUTY_INTEGRATION_KEY}
        severity: critical
        onlyAfter: 120            # Only page after 2 hours

  - id: events_volume_anomaly
    database: production
    table: events
    type: volume_anomaly
    frequency: 900              # Check every 15 minutes
    baselineWindowDays: 7       # Use 7-day baseline
    deviationThreshold: 25      # Alert if ±25% from baseline
    enabled: true

    alerts:
      - type: email
        addresses: ["data-team@company.com"]
        severity: warning
```

### Programmatic Monitoring

```typescript
import {
  PostgresConnector,
  MonitoringRule,
  checkFreshness,
  checkVolumeAnomaly
} from '@thias-se/freshguard-core';
import cron from 'node-cron';

// Initialize secure connector
const connector = new PostgresConnector(dbConfig, {
  enableQueryAnalysis: true,
  maxQueryRiskScore: 70,
  enableDetailedLogging: process.env.NODE_ENV !== 'production'
});

// Define monitoring rules
const rules: MonitoringRule[] = [
  {
    id: 'orders-freshness',
    type: 'freshness',
    table: 'orders',
    timestampColumn: 'created_at',
    toleranceMinutes: 60,
    frequency: 300,
    alerts: [{
      type: 'slack',
      webhook: process.env.SLACK_WEBHOOK_URL!
    }]
  },
  {
    id: 'events-volume',
    type: 'volume_anomaly',
    table: 'events',
    baselineWindowDays: 7,
    deviationThreshold: 25,
    frequency: 900,
    alerts: [{
      type: 'pagerduty',
      integrationKey: process.env.PAGERDUTY_KEY!
    }]
  }
];

// Schedule monitoring with automatic security protection
async function runMonitoring() {
  for (const rule of rules) {
    try {
      let result;

      if (rule.type === 'freshness') {
        result = await checkFreshness(connector, rule);
      } else if (rule.type === 'volume_anomaly') {
        result = await checkVolumeAnomaly(connector, rule);
      }

      // Handle alerts
      if (result?.status === 'alert') {
        await sendAlert(rule, result);
      }

    } catch (error) {
      console.error(`Monitoring failed for rule ${rule.id}:`, error.message);
      // Log but don't crash - other rules should continue
    }
  }
}

// Schedule monitoring
cron.schedule('*/5 * * * *', runMonitoring);
```

## Support and Resources

- **Integration Guide**: [Complete integration documentation](./INTEGRATION_GUIDE.md)
- **Security Guide**: [Comprehensive security documentation](./SECURITY_FOR_SELF_HOSTERS.md)
- **GitHub Issues**: [Report bugs or request features](https://github.com/thias-se/freshguard-core/issues)
- **GitHub Discussions**: [Ask questions and share experiences](https://github.com/thias-se/freshguard-core/discussions)

## License

MIT License - Free for commercial and personal use. See [LICENSE](../LICENSE) for details.

---

**Ready to deploy enterprise-grade data monitoring?** 🚀

Start with the [Integration Guide](./INTEGRATION_GUIDE.md) for detailed implementation examples, then refer to the [Security Guide](./SECURITY_FOR_SELF_HOSTERS.md) for production hardening.