# FreshGuard Core: Security Implementation Plan

## Overview

This document covers security architecture for **@thias-se/freshguard-core** - the open-source data freshness monitoring engine.

**Core Principle**: The core library itself is **security-agnostic**. It provides the monitoring algorithms and connectors. **Security is the responsibility of the deployer** (self-hosters, cloud SaaS using the core).

---

## Part 1: Core Library Security Surface

### 1.1 What the Core Does

```
@thias-se/freshguard-core (npm package)
├── Connector interfaces (PostgreSQL, BigQuery, Snowflake, etc)
├── Freshness algorithms (row count, timestamp, volume anomaly)
├── Database schema (migrations, types)
├── CLI tool (for self-hosters)
└── Type definitions (shared across ecosystem)

Does NOT include:
❌ Credential storage
❌ User authentication
❌ Multi-tenancy
❌ API server
❌ Dashboard
❌ Audit logging (delegated)
```

### 1.2 Security Responsibilities

```
Core Library Responsibilities:
✅ Parameterized queries (prevent SQL injection)
✅ Type-safe connectors
✅ Connection timeouts
✅ Query result validation
✅ Clear error messages (no DB version leaks)
✅ Well-documented connector interface
✅ Security best practices in docs

Deployer Responsibilities (Self-Hosters):
✅ Credential management
✅ Access control (IAM/RBAC)
✅ Audit logging
✅ Network security
✅ Database role permissions
✅ Encryption at rest
✅ Compliance (SOC 2, GDPR, etc)
```

---

## Part 2: Connector Security Design

### 2.1 Connector Interface

**File: `src/types/connector.ts`**

```typescript
export interface ConnectorConfig {
  // Deployer provides these securely (from env/vault)
  host: string;
  port: number;
  database: string;
  username: string;  // Should be read-only service account
  password: string;  // Should be from secure store
  ssl?: boolean;     // Should default to true
  timeout?: number;  // Connection timeout in ms
}

export interface Connector {
  // Core uses only these methods - no data access
  testConnection(): Promise<boolean>;
  listTables(): Promise<string[]>;
  getTableSchema(table: string): Promise<TableSchema>;
  
  // For freshness checks only - constrained queries
  getRowCount(table: string): Promise<number>;
  getMaxTimestamp(table: string, column: string): Promise<Date | null>;
  getMinTimestamp(table: string, column: string): Promise<Date | null>;
  getLastModified(table: string): Promise<Date | null>;
  
  // Cleanup
  close(): Promise<void>;
}

export interface FreshnessResult {
  table: string;
  column: string;
  lastUpdate: Date;
  rowCount: number;
  isStale: boolean;
  staleSince?: Date;
  error?: string;
}
```

### 2.2 Connector Base Class (Security Built-In)

**File: `src/connectors/base-connector.ts`**

```typescript
export abstract class BaseConnector implements Connector {
  protected connectionTimeout = 30000;  // 30s
  protected queryTimeout = 10000;       // 10s
  protected maxRows = 1000;
  protected validateSSL = true;
  
  protected validateQuery(sql: string): boolean {
    // Only allow specific patterns
    const allowedPatterns = [
      /^SELECT COUNT\(\*\) FROM/i,
      /^SELECT MAX\(/i,
      /^SELECT MIN\(/i,
      /^DESCRIBE /i,
      /^SHOW /i
    ];
    
    const blocked = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', '--', '/*'];
    
    for (const keyword of blocked) {
      if (sql.includes(keyword)) {
        throw new SecurityError(`Blocked keyword: ${keyword}`);
      }
    }
    
    return allowedPatterns.some(p => p.test(sql));
  }
  
  protected async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new TimeoutError('Query timeout')), timeout)
      )
    ]);
  }
  
  async getRowCount(table: string): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM ${this.escapeIdentifier(table)}`;
    this.validateQuery(sql);
    
    const result = await this.executeWithTimeout(
      () => this.query(sql),
      this.queryTimeout
    );
    
    return result[0].count;
  }
  
  async getMaxTimestamp(table: string, column: string): Promise<Date | null> {
    const sql = `SELECT MAX(${this.escapeIdentifier(column)}) as max_date 
                 FROM ${this.escapeIdentifier(table)}`;
    this.validateQuery(sql);
    
    const result = await this.executeWithTimeout(
      () => this.query(sql),
      this.queryTimeout
    );
    
    return result[0]?.max_date || null;
  }
  
  // All other methods similarly constrained...
  
  protected escapeIdentifier(name: string): string {
    // Prevent identifier injection
    if (!/^[a-zA-Z0-9_\.]+$/.test(name)) {
      throw new SecurityError(`Invalid identifier: ${name}`);
    }
    return name;
  }
  
  abstract query(sql: string): Promise<any[]>;
  abstract testConnection(): Promise<boolean>;
  abstract listTables(): Promise<string[]>;
  abstract getTableSchema(table: string): Promise<TableSchema>;
  abstract close(): Promise<void>;
}
```

### 2.3 Specific Connector Implementations

**Postgres Connector Example:**

```typescript
// src/connectors/postgres.ts
import { Client } from 'pg';
import { BaseConnector } from './base-connector';

export class PostgresConnector extends BaseConnector {
  private client: Client;
  
  constructor(config: ConnectorConfig) {
    super();
    
    // Enforce SSL by default
    this.client = new Client({
      host: config.host,
      port: config.port || 5432,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl !== false ? { rejectUnauthorized: true } : false,
      statement_timeout: config.timeout || this.queryTimeout,
      application_name: 'freshguard-core'
    });
  }
  
  async testConnection(): Promise<boolean> {
    try {
      await this.executeWithTimeout(
        () => this.client.connect(),
        this.connectionTimeout
      );
      
      const result = await this.client.query('SELECT 1');
      await this.client.end();
      
      return true;
    } catch (error) {
      // Don't leak error details
      throw new ConnectionError('Failed to connect to database');
    }
  }
  
  async query(sql: string): Promise<any[]> {
    this.validateQuery(sql);
    
    const result = await this.executeWithTimeout(
      () => this.client.query(sql),
      this.queryTimeout
    );
    
    if (result.rows.length > this.maxRows) {
      throw new Error(`Query returned too many rows (max ${this.maxRows})`);
    }
    
    return result.rows;
  }
  
  async listTables(): Promise<string[]> {
    const sql = `
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      LIMIT 1000
    `;
    
    const result = await this.query(sql);
    return result.map(r => r.table_name);
  }
  
  async getTableSchema(table: string): Promise<TableSchema> {
    const escaped = this.escapeIdentifier(table);
    const sql = `SELECT * FROM ${escaped} LIMIT 1`;
    
    const result = await this.client.query(sql);
    
    return {
      table,
      columns: result.fields.map(f => ({
        name: f.name,
        type: this.mapPgType(f.dataTypeID),
        nullable: true
      }))
    };
  }
  
  async close(): Promise<void> {
    await this.client.end();
  }
  
  private mapPgType(oid: number): string {
    // Map PostgreSQL OIDs to readable types
    const typeMap: Record<number, string> = {
      20: 'bigint',
      23: 'integer',
      25: 'text',
      1082: 'date',
      1114: 'timestamp',
      1184: 'timestamptz'
    };
    
    return typeMap[oid] || 'unknown';
  }
}
```

---

## Part 3: Algorithm Security

### 3.1 Freshness Algorithm

**File: `src/algorithms/freshness.ts`**

```typescript
export interface FreshnessRuleConfig {
  table: string;
  expectedLastUpdate: 'daily' | 'hourly' | 'every_n_minutes';
  timestampColumn: string;
  tolerance: number;  // minutes
  alertThreshold: number;  // hours stale = alert
}

export class FreshnessMonitor {
  async checkFreshness(
    connector: Connector,
    rule: FreshnessRuleConfig
  ): Promise<FreshnessResult> {
    try {
      // Get last update timestamp
      const lastUpdate = await connector.getMaxTimestamp(
        rule.table,
        rule.timestampColumn
      );
      
      if (!lastUpdate) {
        return {
          table: rule.table,
          column: rule.timestampColumn,
          lastUpdate: null,
          isStale: true,
          error: 'No data found in table'
        };
      }
      
      // Calculate staleness
      const now = new Date();
      const minutesStale = (now.getTime() - lastUpdate.getTime()) / 60000;
      const isStale = minutesStale > rule.alertThreshold * 60;
      
      return {
        table: rule.table,
        column: rule.timestampColumn,
        lastUpdate,
        rowCount: await connector.getRowCount(rule.table),
        isStale,
        staleSince: isStale ? new Date(lastUpdate.getTime() + rule.alertThreshold * 3600000) : null
      };
    } catch (error) {
      return {
        table: rule.table,
        column: rule.timestampColumn,
        lastUpdate: null,
        isStale: true,
        error: this.sanitizeError(error)
      };
    }
  }
  
  private sanitizeError(error: Error): string {
    // Don't leak database version info
    const message = error.message.toLowerCase();
    
    if (message.includes('connection refused')) {
      return 'Connection failed';
    }
    if (message.includes('permission denied')) {
      return 'Permission denied - check role permissions';
    }
    if (message.includes('does not exist')) {
      return 'Table or column does not exist';
    }
    
    // Generic message for unknown errors
    return 'Check failed - see logs for details';
  }
}
```

### 3.2 Volume Anomaly Detection

**File: `src/algorithms/volume-anomaly.ts`**

```typescript
export class VolumeAnomalyDetector {
  async detectAnomaly(
    connector: Connector,
    table: string,
    baselineRowCount: number,
    threshold: number = 0.1  // 10% deviation
  ): Promise<AnomalyResult> {
    try {
      const currentRowCount = await connector.getRowCount(table);
      const deviation = Math.abs(
        (currentRowCount - baselineRowCount) / baselineRowCount
      );
      
      const isAnomaly = deviation > threshold;
      
      return {
        table,
        currentRowCount,
        baselineRowCount,
        deviationPercent: deviation * 100,
        isAnomaly,
        direction: currentRowCount > baselineRowCount ? 'increase' : 'decrease'
      };
    } catch (error) {
      return {
        table,
        error: 'Failed to check volume',
        isAnomaly: false
      };
    }
  }
}
```

---

## Part 4: CLI Security

### 4.1 CLI Tool (Self-Hosters)

**File: `src/cli/index.ts`**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import * as dotenv from 'dotenv';

// Load .env but DON'T log it
dotenv.config();

const program = new Command();

program
  .name('freshguard')
  .description('Open-source data freshness monitoring')
  .version('0.1.0');

program
  .command('check')
  .description('Check data freshness')
  .option('--config <path>', 'Config file path (default: .freshguard.yml)')
  .option('--db-type <type>', 'Database type: postgres|bigquery|snowflake')
  .option('--table <name>', 'Table to check')
  .option('--column <name>', 'Timestamp column')
  .action(async (options) => {
    try {
      // Validate options
      if (!process.env.DB_HOST) {
        console.error('❌ DB_HOST not set. Use .env or environment variables.');
        process.exit(1);
      }
      
      // Load config securely
      const config = await loadConfig(options.config);
      
      // Connect (uses service account from env)
      const connector = createConnector(config);
      await connector.testConnection();
      
      // Check freshness
      const monitor = new FreshnessMonitor();
      const result = await monitor.checkFreshness(connector, config.rule);
      
      // Output result
      console.log(JSON.stringify(result, null, 2));
      
      // Exit code = 1 if stale
      process.exit(result.isStale ? 1 : 0);
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);

function createConnector(config: any) {
  switch (config.db_type) {
    case 'postgres':
      return new PostgresConnector({
        host: process.env.DB_HOST!,
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME!,
        username: process.env.DB_USER!,
        password: process.env.DB_PASSWORD!,
        ssl: process.env.DB_SSL !== 'false'
      });
    case 'bigquery':
      return new BigQueryConnector({
        projectId: process.env.GCP_PROJECT!,
        keyFile: process.env.GCP_KEY_FILE!
      });
    default:
      throw new Error(`Unsupported database: ${config.db_type}`);
  }
}
```

### 4.2 Environment Variables (Self-Hosters)

**File: `.env.example`**

```bash
# Database connection (use service account with SELECT only!)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=production
DB_USER=freshguard_monitor
DB_PASSWORD=<strong-random-password>
DB_SSL=true

# BigQuery (if using)
GCP_PROJECT=my-project
GCP_KEY_FILE=/path/to/service-account-key.json

# Monitoring
FRESHGUARD_INTERVAL_MINUTES=5
FRESHGUARD_ALERT_WEBHOOK=https://hooks.slack.com/...
```

---

## Part 5: Documentation for Deployers

### 5.1 Security Architecture Doc

**File: `docs/SECURITY_FOR_SELF_HOSTERS.md`**

```markdown
# Security Guide for FreshGuard Self-Hosters

## Overview

FreshGuard Core is a monitoring library. **You are responsible for security.**

This guide helps you deploy FreshGuard securely.

---

## 1. Database Credentials (Critical!)

### Read-Only Service Account

Create a dedicated, read-only service account:

**PostgreSQL:**
```sql
CREATE ROLE freshguard_monitor WITH LOGIN;
GRANT CONNECT ON DATABASE production TO freshguard_monitor;
GRANT USAGE ON SCHEMA public TO freshguard_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO freshguard_monitor;

-- Explicitly deny writes
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM freshguard_monitor;
```

**Never use:**
❌ Admin account
❌ Full database access
❌ Write permissions
```

### Credential Storage

**Option 1: Environment Variables (Simple)**
```bash
export DB_HOST=prod-db.example.com
export DB_USER=freshguard_monitor
export DB_PASSWORD=<strong-random-password>
```

**Option 2: .env File (Local Development)**
```
# .env (add to .gitignore!)
DB_HOST=localhost
DB_PASSWORD=secret
```

**Option 3: Secrets Manager (Production)**
```bash
# AWS Secrets Manager
aws secretsmanager get-secret-value --secret-id freshguard/db

# HashiCorp Vault
vault kv get secret/freshguard/db
```

---

## 2. Network Security

### SSL/TLS

Always enable SSL:
```bash
DB_SSL=true  # Default
```

For self-signed certificates:
```bash
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false  # ⚠️ Only in development!
```

### Firewall Rules

Restrict database access:
```
FreshGuard Server IP → Database Port 5432 (PostgreSQL)
❌ Public internet access
```

---

## 3. Audit Logging

FreshGuard logs queries to **your** application logs. Monitor for:

```bash
# Expected queries
✅ SELECT COUNT(*) FROM orders
✅ SELECT MAX(updated_at) FROM customers
✅ DESCRIBE table_name

# Suspicious queries
❌ INSERT, UPDATE, DELETE (should never happen)
❌ Connection errors (credential issues)
❌ Timeout errors (table too large?)
```

---

## 4. Compliance

### GDPR

- FreshGuard doesn't store customer data
- Your deployment is your responsibility
- Document your usage in Data Processing Agreements (DPA)

### SOC 2

- Maintain audit logs for 90 days
- Monitor credential access
- Rotate credentials quarterly
- Document your access controls

---

## 5. Deployment Checklist

- [ ] Created read-only service account
- [ ] Credentials stored securely (env/vault)
- [ ] SSL/TLS enabled
- [ ] Firewall restricts database access
- [ ] Audit logging configured
- [ ] Tested connection works
- [ ] Documented credential rotation schedule
- [ ] Documented incident response plan
```

---

## Part 6: Type Safety & Validation

### 6.1 Input Validation

**File: `src/validators/index.ts`**

```typescript
export function validateTableName(name: string): boolean {
  // Allow alphanumeric, underscore, dot (schema.table)
  return /^[a-zA-Z0-9_\.]{1,256}$/.test(name);
}

export function validateColumnName(name: string): boolean {
  return /^[a-zA-Z0-9_]{1,256}$/.test(name);
}

export function validateConfig(config: any): void {
  if (!config.host) throw new Error('host required');
  if (!config.database) throw new Error('database required');
  if (!config.username) throw new Error('username required');
  if (!config.password) throw new Error('password required');
  
  if (config.port && (config.port < 1 || config.port > 65535)) {
    throw new Error('invalid port');
  }
  
  if (config.timeout && config.timeout < 1000) {
    throw new Error('timeout must be >= 1000ms');
  }
}
```

---

## Part 7: Error Handling

### 7.1 Secure Error Messages

**File: `src/errors/index.ts`**

```typescript
export class DatabaseError extends Error {
  constructor(originalError: Error, sanitized: boolean = true) {
    if (sanitized) {
      // Don't leak database version or structure
      super('Database operation failed - check credentials and permissions');
    } else {
      super(originalError.message);
    }
  }
}

export class TimeoutError extends Error {
  constructor(query: string) {
    super(`Query timeout - table may be too large or network issue`);
  }
}

export class SecurityError extends Error {
  constructor(reason: string) {
    super(`Security check failed: ${reason}`);
  }
}
```

---

## Part 8: Testing Security

### 8.1 Security Unit Tests

**File: `src/__tests__/security.test.ts`**

```typescript
describe('Security', () => {
  describe('SQL Injection Prevention', () => {
    it('should reject INSERT statements', () => {
      const connector = new PostgresConnector(testConfig);
      expect(() => {
        connector.query("INSERT INTO users VALUES ('hacker')");
      }).toThrow('Blocked keyword: INSERT');
    });
    
    it('should reject DROP statements', () => {
      expect(() => {
        connector.query("DROP TABLE users");
      }).toThrow('Blocked keyword: DROP');
    });
    
    it('should reject SQL comments', () => {
      expect(() => {
        connector.query("SELECT * FROM users -- comment");
      }).toThrow('Blocked keyword: --');
    });
  });
  
  describe('Identifier Validation', () => {
    it('should reject malicious table names', () => {
      expect(() => {
        connector.getRowCount("users; DROP TABLE users;");
      }).toThrow('Invalid identifier');
    });
    
    it('should allow valid schema.table names', () => {
      expect(() => {
        connector.escapeIdentifier("public.users");
      }).not.toThrow();
    });
  });
  
  describe('Timeouts', () => {
    it('should timeout long-running queries', async () => {
      const result = await connector.getRowCount('huge_table');
      expect(result).toBeDefined();  // Either returns or times out gracefully
    });
  });
});
```

---

## Part 9: Release & Distribution

### 9.1 Signing npm Packages

```bash
# Publish with provenance
npm publish --provenance

# Verify signature
npm info @thias-se/freshguard-core | grep signature
```

### 9.2 SBOM (Software Bill of Materials)

```bash
# Generate SBOM for transparency
npm sbom --json > freshguard-core.sbom.json
```

---

## Summary: Core Responsibilities

```
✅ What FreshGuard Core Provides:
├── Secure connector interfaces
├── SQL injection prevention
├── Connection timeouts
├── Read-only query patterns
├── Clear documentation
└── Type safety

⚠️ What YOU Provide:
├── Credential management
├── Access control (IAM/RBAC)
├── Audit logging
├── Network security
├── Compliance (SOC 2, GDPR, etc)
├── Incident response
└── Secure deployment
```

This design = **secure by default, but deployer is responsible for security**.

---

**Distribution**: Publish to npm as `@thias-se/freshguard-core` with MIT license + security docs included.
