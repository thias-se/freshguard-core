# FreshGuard Core Integration Guide

Complete guide for integrating FreshGuard Core's security features into your project.

## Quick Start

### Installation

```bash
npm install @thias-se/freshguard-core
# or
pnpm add @thias-se/freshguard-core
```

### Basic Setup

```typescript
import { PostgresConnector, SecurityConfig } from '@thias-se/freshguard-core';

const connector = new PostgresConnector({
  host: process.env.DB_HOST!,
  port: parseInt(process.env.DB_PORT!),
  database: process.env.DB_NAME!,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  ssl: true,
  timeout: 30000,
  queryTimeout: 10000
});

// Check data freshness
const rowCount = await connector.getRowCount('orders');
const lastUpdate = await connector.getMaxTimestamp('orders', 'created_at');

console.log(`Orders: ${rowCount} rows, last update: ${lastUpdate}`);
```

## Security Configuration

FreshGuard Core provides enterprise-grade security features that should be configured for your environment.

### Development Environment Configuration

```typescript
const devSecurityConfig: Partial<SecurityConfig> = {
  // Permissive for development
  maxQueryRiskScore: 90,
  maxQueryComplexityScore: 100,
  enableQueryAnalysis: true,
  enableDetailedLogging: true,

  // Development connection settings
  connectionTimeout: 60000,
  queryTimeout: 30000,
  maxRows: 10000,
  requireSSL: false  // Only for local development
};

const connector = new PostgresConnector(dbConfig, devSecurityConfig);
```

### Production Environment Configuration

```typescript
const prodSecurityConfig: Partial<SecurityConfig> = {
  // Strict security for production
  maxQueryRiskScore: 70,          // Block high-risk queries
  maxQueryComplexityScore: 80,    // Limit query complexity
  enableQueryAnalysis: true,      // Always enable in production
  enableDetailedLogging: false,   // Reduce log volume

  // Production connection settings
  connectionTimeout: 30000,
  queryTimeout: 10000,
  maxRows: 1000,
  requireSSL: true               // Always require SSL in production
};

const connector = new PostgresConnector(dbConfig, prodSecurityConfig);
```

### Staging Environment Configuration

```typescript
const stagingSecurityConfig: Partial<SecurityConfig> = {
  // Balanced configuration for staging
  maxQueryRiskScore: 80,
  maxQueryComplexityScore: 90,
  enableQueryAnalysis: true,
  enableDetailedLogging: true,   // Detailed logs for debugging

  connectionTimeout: 45000,
  queryTimeout: 15000,
  maxRows: 5000,
  requireSSL: true
};
```

## Advanced Security Features

### Query Complexity Analysis

Automatically analyzes and scores queries for security and performance risks.

```typescript
import { createQueryAnalyzer } from '@thias-se/freshguard-core';

const analyzer = createQueryAnalyzer({
  maxRiskScore: 70,              // Block queries above this risk score
  maxComplexityScore: 80,        // Block overly complex queries
  enableSecurityAnalysis: true,  // SQL injection detection
  enablePerformanceAnalysis: true // Performance optimization hints
});

// Analyze a query before execution
const analysis = analyzer.analyzeQuery('SELECT * FROM users WHERE active = true');

console.log('Risk Score:', analysis.riskScore);         // 0-100 security risk
console.log('Complexity:', analysis.complexityScore);   // Query complexity
console.log('Allow Execution:', analysis.allowExecution); // true/false
console.log('Warnings:', analysis.securityWarnings);    // Security issues
console.log('Recommendations:', analysis.recommendations); // Optimization tips
```

### Schema Caching

High-performance table metadata caching with automatic expiry.

```typescript
import { createSchemaCache } from '@thias-se/freshguard-core';

const cache = createSchemaCache({
  maxEntries: 1000,           // Cache up to 1000 table schemas
  ttlMinutes: 60,             // Cache for 60 minutes
  refreshThresholdMinutes: 45, // Refresh when 45 minutes old
  enableBackgroundRefresh: true // Auto-refresh in background
});

// Cache automatically used by connectors
const connector = new PostgresConnector(dbConfig, {
  enableQueryAnalysis: true  // Enables automatic schema caching
});

// Manual cache operations if needed
const stats = cache.getStats();
console.log(`Cache hit ratio: ${stats.hitRatio}%`);
```

### Circuit Breaker Protection

Automatic failure protection and recovery.

```typescript
import { createCircuitBreaker } from '@thias-se/freshguard-core';

const circuitBreaker = createCircuitBreaker({
  name: 'database-connection',
  failureThreshold: 5,        // Open after 5 failures
  successThreshold: 3,        // Close after 3 successes
  recoveryTimeout: 60000,     // Try recovery after 1 minute
  enableDetailedLogging: true
});

// Circuit breaker is automatically used by connectors
// You can also use it manually for other operations
try {
  const result = await circuitBreaker.execute(() => {
    return someRiskyOperation();
  });
} catch (error) {
  if (error.message.includes('circuit breaker')) {
    console.log('Service temporarily unavailable');
    // Handle graceful degradation
  }
}
```

## Error Handling

FreshGuard Core provides structured error handling with detailed information.

```typescript
import {
  SecurityError,
  ValidationError,
  TimeoutError,
  CircuitBreakerOpenError
} from '@thias-se/freshguard-core';

try {
  const result = await connector.getRowCount('suspicious_table');
} catch (error) {
  if (error instanceof SecurityError) {
    // Security policy violation
    console.error('Security violation:', error.message);
    console.error('Risk details:', error.details);

  } else if (error instanceof ValidationError) {
    // Input validation failed
    console.error('Validation failed:', error.errors);

  } else if (error instanceof TimeoutError) {
    // Operation timed out
    console.error('Operation timeout:', error.message);

  } else if (error instanceof CircuitBreakerOpenError) {
    // Circuit breaker is open
    console.error('Service unavailable:', error.message);
    // Implement graceful degradation

  } else {
    // Other database errors (sanitized)
    console.error('Database error:', error.message);
  }
}
```

## Logging and Monitoring

### Structured Logging Setup

```typescript
import { createDatabaseLogger } from '@thias-se/freshguard-core';

// Configure structured logging
const logger = createDatabaseLogger('postgres', {
  level: 'info',                    // info, debug, warn, error
  serviceName: 'my-data-service',
  baseContext: {
    environment: process.env.NODE_ENV,
    version: process.env.APP_VERSION,
    region: process.env.AWS_REGION
  }
});

// Automatic logging by connectors
const connector = new PostgresConnector(dbConfig, {
  enableDetailedLogging: process.env.NODE_ENV !== 'production'
});

// Manual logging if needed
logger.info('Custom operation', {
  operation: 'data-export',
  recordCount: 1500
});
```

### Metrics Collection

```typescript
import { createComponentMetrics } from '@thias-se/freshguard-core';

// Set up metrics collection
const metrics = createComponentMetrics('freshguard-integration');

// Metrics are automatically collected by connectors
// Access collected metrics
const stats = metrics.getStats();
console.log('Query performance:', stats.query_duration_percentiles);
console.log('Success rate:', stats.success_rate);

// Export for Prometheus/monitoring system
const prometheusMetrics = metrics.exportPrometheus();
```

## Database-Specific Integration

### PostgreSQL

```typescript
import { PostgresConnector } from '@thias-se/freshguard-core';

const postgres = new PostgresConnector({
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  username: 'readonly_user',      // Use read-only user
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: true }, // Enforce SSL certificate validation
  timeout: 30000,
  queryTimeout: 10000,
  maxRows: 1000
}, {
  enableQueryAnalysis: true,
  maxQueryRiskScore: 70
});
```

### BigQuery

```typescript
import { BigQueryConnector } from '@thias-se/freshguard-core';

const bigquery = new BigQueryConnector({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, // Service account key
  location: 'US',
  timeout: 60000,
  queryTimeout: 30000,
  maxRows: 10000
}, {
  enableQueryAnalysis: true,
  maxQueryComplexityScore: 90  // BigQuery can handle more complex queries
});
```

### Snowflake

```typescript
import { SnowflakeConnector } from '@thias-se/freshguard-core';

const snowflake = new SnowflakeConnector({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USERNAME,
  password: process.env.SNOWFLAKE_PASSWORD,
  database: 'ANALYTICS',
  warehouse: 'COMPUTE_WH',
  schema: 'PUBLIC',
  timeout: 45000,
  queryTimeout: 20000
}, {
  enableQueryAnalysis: true,
  maxQueryRiskScore: 80
});
```

### DuckDB (Embedded)

```typescript
import { DuckDBConnector } from '@thias-se/freshguard-core';

const duckdb = new DuckDBConnector({
  path: './data/analytics.duckdb',  // File path for embedded DuckDB
  readonly: true,                   // Read-only mode for safety
  timeout: 15000,
  queryTimeout: 5000
}, {
  enableQueryAnalysis: false  // Less critical for embedded local databases
});
```

## Production Deployment

### Environment Variables

```bash
# Database Configuration
DB_HOST=your-database-host
DB_PORT=5432
DB_NAME=production_db
DB_USER=freshguard_readonly
DB_PASSWORD=secure_password_from_vault

# Security Configuration
FRESHGUARD_MAX_RISK_SCORE=70
FRESHGUARD_MAX_COMPLEXITY_SCORE=80
FRESHGUARD_ENABLE_QUERY_ANALYSIS=true
FRESHGUARD_ENABLE_DETAILED_LOGGING=false

# Monitoring
FRESHGUARD_LOG_LEVEL=info
FRESHGUARD_METRICS_ENABLED=true
```

### Docker Configuration

```dockerfile
FROM node:18-alpine

# Security: Run as non-root user
RUN addgroup -g 1001 -S freshguard && adduser -S -u 1001 freshguard -G freshguard
USER freshguard

# Application setup
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Security: Drop privileges and run read-only
EXPOSE 3000
CMD ["npm", "start"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: data-monitoring
spec:
  replicas: 2
  selector:
    matchLabels:
      app: data-monitoring
  template:
    metadata:
      labels:
        app: data-monitoring
    spec:
      containers:
      - name: app
        image: your-app:latest
        env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        - name: FRESHGUARD_MAX_RISK_SCORE
          value: "70"
        - name: FRESHGUARD_ENABLE_QUERY_ANALYSIS
          value: "true"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        securityContext:
          runAsNonRoot: true
          runAsUser: 1001
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
```

## Security Best Practices

### 1. Database Credentials

```typescript
// ✅ GOOD: Use environment variables or secret management
const connector = new PostgresConnector({
  host: process.env.DB_HOST,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD  // From vault/secret manager
});

// ❌ BAD: Hardcoded credentials
const connector = new PostgresConnector({
  username: 'user',
  password: 'password123'  // Never do this
});
```

### 2. Read-Only Database Users

Create dedicated read-only database users for FreshGuard:

```sql
-- PostgreSQL example
CREATE ROLE freshguard_readonly;
GRANT CONNECT ON DATABASE myapp TO freshguard_readonly;
GRANT USAGE ON SCHEMA public TO freshguard_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO freshguard_readonly;

-- Prevent any write operations
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM freshguard_readonly;

CREATE USER freshguard_user WITH PASSWORD 'secure_password';
GRANT freshguard_readonly TO freshguard_user;
```

### 3. Network Security

```typescript
// ✅ GOOD: Always use SSL in production
const connector = new PostgresConnector({
  ssl: {
    rejectUnauthorized: true,  // Verify SSL certificates
    ca: process.env.DB_CA_CERT // Custom CA if needed
  }
});

// ✅ GOOD: Restrict network access
// Use VPC/security groups to limit database access to your application only
```

### 4. Query Timeout Configuration

```typescript
// ✅ GOOD: Set appropriate timeouts
const connector = new PostgresConnector(config, {
  queryTimeout: 10000,        // 10 second timeout
  connectionTimeout: 30000,   // 30 second connection timeout
  maxRows: 1000              // Limit result set size
});
```

### 5. Error Handling

```typescript
try {
  const result = await connector.getRowCount('users');
} catch (error) {
  // ✅ GOOD: Log errors securely (no sensitive data exposure)
  logger.error('Database query failed', {
    operation: 'getRowCount',
    table: 'users',
    error: error.message  // Already sanitized by FreshGuard
  });

  // ❌ BAD: Don't log full error objects (may contain sensitive data)
  // console.log('Error:', error);
}
```

## Testing Your Integration

### Unit Testing

```typescript
import { PostgresConnector } from '@thias-se/freshguard-core';

describe('FreshGuard Integration', () => {
  let connector: PostgresConnector;

  beforeEach(() => {
    connector = new PostgresConnector(testConfig, {
      enableQueryAnalysis: true,
      maxQueryRiskScore: 50  // Stricter for tests
    });
  });

  test('should handle normal queries', async () => {
    const count = await connector.getRowCount('test_table');
    expect(typeof count).toBe('number');
  });

  test('should block dangerous queries', async () => {
    await expect(
      connector.getRowCount("test_table'; DROP TABLE users; --")
    ).rejects.toThrow('Invalid table name');
  });
});
```

### Load Testing

```typescript
async function loadTest() {
  const connector = new PostgresConnector(config);

  // Test 100 concurrent queries
  const queries = Array(100).fill(null).map(() =>
    connector.getRowCount('orders')
  );

  const start = Date.now();
  const results = await Promise.all(queries);
  const duration = Date.now() - start;

  console.log(`100 queries completed in ${duration}ms`);
  console.log(`Average: ${duration/100}ms per query`);
}
```

## Troubleshooting

### Common Issues

1. **High Query Risk Scores**
```typescript
// Check what's triggering security warnings
const analysis = analyzer.analyzeQuery(yourQuery);
console.log('Risk score:', analysis.riskScore);
console.log('Security warnings:', analysis.securityWarnings);
console.log('Recommendations:', analysis.recommendations);
```

2. **Circuit Breaker Opening**
```typescript
// Check circuit breaker status
const stats = circuitBreaker.getStats();
console.log('Circuit breaker state:', stats.state);
console.log('Failure count:', stats.failureCount);
console.log('Last failure:', stats.lastFailureTime);
```

3. **Poor Cache Performance**
```typescript
// Monitor cache performance
const cacheStats = cache.getStats();
console.log('Hit ratio:', cacheStats.hitRatio);
console.log('Cache size:', cacheStats.size);
console.log('Evictions:', cacheStats.evictions);
```

### Debug Mode

Enable detailed logging for troubleshooting:

```typescript
const connector = new PostgresConnector(config, {
  enableDetailedLogging: true,  // Enable debug logs
  enableQueryAnalysis: true
});

// This will log:
// - Query analysis details
// - Security warnings and scores
// - Cache hit/miss information
// - Circuit breaker state changes
// - Performance metrics
```

## Support and Resources

- **GitHub Issues**: [Report bugs or request features](https://github.com/thias-se/freshguard-core/issues)
- **Documentation**: [Complete docs](https://github.com/thias-se/freshguard-core/docs)
- **Security Guide**: [Self-hosting security guide](./SECURITY_FOR_SELF_HOSTERS.md)
- **Contributing**: [Development guide](./CONTRIBUTING.md)

## License

MIT License - see [LICENSE](../LICENSE) for details.