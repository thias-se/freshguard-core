# Debugging Guide for FreshGuard Core

This guide explains how to enable enhanced debugging features in FreshGuard Core to troubleshoot database connectivity issues, query problems, and monitoring failures during development.

## Overview

FreshGuard Core includes a comprehensive debugging system that can expose:
- **Actual SQL queries** being executed
- **Raw database error messages** with full context
- **Actionable suggestions** for fixing common issues
- **Query execution timing** and performance data
- **Detailed error context** for troubleshooting

By default, all errors are sanitized for security. Debug mode allows you to see the full error details during development while maintaining security in production.

## Quick Start

### Enable Debug Mode

#### Option 1: Environment Variable (Automatic)
Set the environment variable to automatically enable debug mode:

```bash
# Enable debug mode
export NODE_ENV=development
# OR
export FRESHGUARD_DEBUG=true

# Run your application
node your-app.js
```

#### Option 2: Configuration Object (Manual)
Pass debug configuration directly to monitoring functions:

```javascript
import { checkFreshness } from '@freshguard/core';

const result = await checkFreshness(db, rule, metadataStorage, {
  debug: {
    enabled: true,              // Enable debug mode
    exposeQueries: true,        // Show actual SQL queries
    exposeRawErrors: true,      // Show raw database errors
    logLevel: 'debug'          // Set log level
  }
});

// Check for debug information
if (result.status === 'failed' && result.debug) {
  console.log('SQL Query:', result.debug.query);
  console.log('Raw Error:', result.debug.rawError);
  console.log('Suggestion:', result.debug.suggestion);
}
```

## Configuration Options

### Debug Configuration Interface

```typescript
interface DebugConfig {
  enabled?: boolean;              // Enable/disable debug mode
  exposeQueries?: boolean;        // Include SQL queries in debug output
  exposeRawErrors?: boolean;      // Include raw database error messages
  logLevel?: 'error' | 'warn' | 'info' | 'debug'; // Minimum log level
  correlationId?: string;         // Custom correlation ID for tracing
}
```

### Configuration Examples

#### Full Debug Mode (Development)
```javascript
const fullDebugConfig = {
  debug: {
    enabled: true,
    exposeQueries: true,
    exposeRawErrors: true,
    logLevel: 'debug'
  }
};
```

#### Safe Debug Mode (Staging)
```javascript
const safeDebugConfig = {
  debug: {
    enabled: true,
    exposeQueries: true,        // Show queries
    exposeRawErrors: false,     // Hide raw errors for security
    logLevel: 'info'
  }
};
```

#### Production Mode (Default)
```javascript
// No debug config = production mode
const result = await checkFreshness(db, rule, metadataStorage);
// OR explicitly disable
const prodConfig = {
  debug: {
    enabled: false
  }
};
```

## What Debug Mode Reveals

### Normal Error (Production)
```json
{
  "status": "failed",
  "error": "Query execution failed",
  "executedAt": "2024-01-26T10:30:00Z"
}
```

### Enhanced Error (Debug Mode)
```json
{
  "status": "failed",
  "error": "Query execution failed",
  "executedAt": "2024-01-26T10:30:00Z",
  "debugId": "fg-lxy123-abc45",
  "debug": {
    "query": "SELECT COUNT(*) as row_count, MAX(order_date) as last_update FROM orders",
    "rawError": "column \"order_date\" does not exist",
    "suggestion": "Column 'order_date' not found in table 'orders'. Use DESCRIBE orders to check available columns.",
    "duration": 45,
    "context": {
      "table": "orders",
      "column": "order_date",
      "operation": "freshness_query",
      "debugId": "fg-lxy123-abc45"
    }
  }
}
```

## Common Issues and Solutions

### 1. Table Not Found

#### Error Message:
```
rawError: "relation \"orders\" does not exist"
suggestion: "Table 'orders' does not exist. Verify table name and database schema access."
```

#### Solutions:
- Check table name spelling and case sensitivity
- Verify you're connected to the correct database
- Check schema/namespace (e.g., `public.orders` vs `orders`)
- Verify user has access to the table

#### Debugging Commands:
```sql
-- List all tables
\dt
-- Or in SQL
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check specific table
SELECT * FROM information_schema.tables WHERE table_name = 'orders';
```

### 2. Column Not Found

#### Error Message:
```
rawError: "column \"order_date\" does not exist"
suggestion: "Column 'order_date' not found in table 'orders'. Use DESCRIBE orders to check available columns."
```

#### Solutions:
- Check column name spelling and case sensitivity
- Verify column exists in the table
- Check if column name needs quoting for special characters

#### Debugging Commands:
```sql
-- PostgreSQL: List columns
\d orders
-- Or in SQL
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'orders';

-- Check for similar column names
SELECT column_name FROM information_schema.columns
WHERE table_name = 'orders' AND column_name ILIKE '%date%';
```

### 3. Permission Denied

#### Error Message:
```
rawError: "permission denied for table orders"
suggestion: "Access denied to table 'orders'. Grant SELECT permission: GRANT SELECT ON orders TO your_user;"
```

#### Solutions:
- Grant proper permissions to the database user
- Check if user exists and is properly configured
- Verify connection string uses correct username

#### Debugging Commands:
```sql
-- Check current user
SELECT current_user;

-- Check table permissions
SELECT grantee, privilege_type FROM information_schema.table_privileges
WHERE table_name = 'orders';

-- Grant permissions (run as admin)
GRANT SELECT ON orders TO your_username;
```

### 4. Connection Issues

#### Error Message:
```
rawError: "connection refused"
suggestion: "Database server at localhost:5432 is not accepting connections. Check if server is running and port is correct."
```

#### Solutions:
- Verify database server is running
- Check host and port are correct
- Verify network connectivity and firewall settings
- Check SSL/TLS configuration

#### Debugging Commands:
```bash
# Test network connectivity
telnet localhost 5432
# Or
nc -zv localhost 5432

# Check if PostgreSQL is running
pg_isready -h localhost -p 5432

# Test connection with psql
psql -h localhost -p 5432 -U username -d database
```

### 5. Authentication Failed

#### Error Message:
```
rawError: "password authentication failed for user \"admin\""
suggestion: "Authentication failed for localhost. Verify username, password, and database name are correct."
```

#### Solutions:
- Verify username and password are correct
- Check database name exists
- Verify user is allowed to connect from your host
- Check pg_hba.conf configuration (PostgreSQL)

## Logging and Correlation

### Debug Logging
When debug mode is enabled, FreshGuard will log detailed information to the console:

```javascript
// Example debug logs
[DEBUG-fg-lxy123-abc45] Starting freshness check: {
  table: 'orders',
  ruleId: 'freshness-rule-1',
  timestamp: '2024-01-26T10:30:00.000Z'
}

[DEBUG] Executing freshness query: {
  table: 'orders',
  column: 'created_at',
  query: 'SELECT COUNT(*) as row_count, MAX(created_at) as last_update FROM orders'
}

[DEBUG-fg-lxy123-abc45] Query execution failed: {
  table: 'orders',
  rawError: 'column "created_at" does not exist',
  duration: 45,
  suggestion: 'Column not found. Run DESCRIBE orders to verify column names.'
}
```

### Correlation IDs
Each debug session gets a unique correlation ID (`debugId`) that appears in:
- Debug logs
- Error responses
- Console output

Use this ID to trace related log entries across your application.

## Environment-Based Configuration

### Development Environment
```javascript
// Auto-detects development mode
process.env.NODE_ENV = 'development';

// FreshGuard automatically enables:
// - debug mode
// - query exposure
// - raw error exposure
// - debug-level logging

const result = await checkFreshness(db, rule); // Debug enabled automatically
```

### Staging Environment
```javascript
// Selective debugging for staging
const stagingConfig = {
  debug: {
    enabled: true,
    exposeQueries: true,        // Safe to expose queries
    exposeRawErrors: false,     // Hide raw errors for security
    logLevel: 'info'           // Reduce log verbosity
  }
};
```

### Production Environment
```javascript
// Production (default behavior)
process.env.NODE_ENV = 'production';

// FreshGuard automatically:
// - Disables debug mode
// - Sanitizes all errors
// - Hides query details
// - Uses minimal logging

const result = await checkFreshness(db, rule); // Secure by default
```

## Integration with Existing Code

### Upgrading Existing Implementations

#### Before (v0.6.x)
```javascript
try {
  const result = await checkFreshness(db, rule, metadataStorage);
  if (result.status === 'failed') {
    console.log('Error:', result.error); // Generic sanitized message
  }
} catch (error) {
  console.log('Failed:', error.message); // Minimal information
}
```

#### After (v0.7.x with Debug)
```javascript
try {
  const result = await checkFreshness(db, rule, metadataStorage, {
    debug: { enabled: process.env.NODE_ENV === 'development' }
  });

  if (result.status === 'failed') {
    console.log('Error:', result.error);

    // Enhanced debugging in development
    if (result.debug) {
      console.log('SQL Query:', result.debug.query);
      console.log('Raw Error:', result.debug.rawError);
      console.log('How to fix:', result.debug.suggestion);
      console.log('Debug ID:', result.debugId); // For log correlation
    }
  }
} catch (error) {
  console.log('Failed:', error.message);
}
```

### Error Handling Patterns

#### Pattern 1: Conditional Debug Logging
```javascript
const config = {
  debug: {
    enabled: process.env.DEBUG_FRESHGUARD === 'true',
    exposeQueries: true,
    exposeRawErrors: true
  }
};

const result = await checkFreshness(db, rule, metadataStorage, config);

if (result.status === 'failed') {
  // Always log the safe error
  logger.error('Freshness check failed', {
    rule: rule.id,
    table: rule.tableName,
    error: result.error
  });

  // Conditionally log debug info
  if (result.debug) {
    logger.debug('Debug information', {
      debugId: result.debugId,
      query: result.debug.query,
      suggestion: result.debug.suggestion,
      duration: result.debug.duration
    });
  }
}
```

#### Pattern 2: Environment-Aware Configuration
```javascript
function createFreshGuardConfig() {
  const isDev = process.env.NODE_ENV === 'development';
  const isTest = process.env.NODE_ENV === 'test';

  return {
    timeoutMs: isDev ? 60000 : 30000, // Longer timeout in dev
    debug: {
      enabled: isDev || isTest,
      exposeQueries: isDev, // Only in development
      exposeRawErrors: isDev,
      logLevel: isDev ? 'debug' : 'info'
    }
  };
}

const result = await checkFreshness(db, rule, metadata, createFreshGuardConfig());
```

## Testing with Debug Mode

### Unit Tests
```javascript
import { checkFreshness } from '@freshguard/core';

test('should provide debug information on failure', async () => {
  const config = {
    debug: { enabled: true, exposeQueries: true, exposeRawErrors: true }
  };

  const result = await checkFreshness(mockDb, rule, metadata, config);

  expect(result.debug.query).toContain('SELECT COUNT(*)');
  expect(result.debug.suggestion).toBeDefined();
  expect(result.debugId).toMatch(/^fg-/);
});
```

### Integration Tests
```javascript
test('should work in both debug and production modes', async () => {
  // Test production mode
  const prodResult = await checkFreshness(db, rule, metadata);
  expect(prodResult.debug).toBeUndefined();

  // Test debug mode
  const debugResult = await checkFreshness(db, rule, metadata, {
    debug: { enabled: true }
  });

  if (debugResult.status === 'failed') {
    expect(debugResult.debug).toBeDefined();
  }
});
```

## Security Considerations

### What's Safe to Enable in Production

❌ **Never enable in production:**
- `exposeRawErrors: true` - Can leak sensitive information
- `logLevel: 'debug'` - Creates excessive logs

✅ **Safe for production:**
- `enabled: true` with `exposeRawErrors: false`
- `exposeQueries: true` (if SQL queries don't contain sensitive data)
- `logLevel: 'info'` or `'error'`

### Data Sanitization
Even in debug mode, FreshGuard:
- Still validates and sanitizes user inputs
- Still uses parameterized queries
- Still applies security checks
- Only exposes additional error context, not sensitive data

### Recommended Production Debug Config
```javascript
// Safe production debugging for urgent issues
const emergencyDebugConfig = {
  debug: {
    enabled: true,              // Enable for troubleshooting
    exposeQueries: true,        // SQL queries are usually safe
    exposeRawErrors: false,     // Never expose raw errors in prod
    logLevel: 'info'           // Minimal logging
  }
};
```

## Troubleshooting Debug Mode

### Debug Mode Not Working

1. **Check environment variables:**
   ```bash
   echo $NODE_ENV
   echo $FRESHGUARD_DEBUG
   ```

2. **Verify configuration:**
   ```javascript
   console.log('Debug config:', config.debug);
   ```

3. **Check console output:**
   Look for `[DEBUG]` prefixed log messages

### Debug Information Not Appearing

1. **Ensure errors are occurring:**
   Debug info only appears when there are failures

2. **Check configuration:**
   ```javascript
   // Make sure all options are enabled
   const config = {
     debug: {
       enabled: true,
       exposeQueries: true,
       exposeRawErrors: true
     }
   };
   ```

3. **Verify function call:**
   Ensure you're passing the config parameter:
   ```javascript
   // ❌ Wrong - missing config
   await checkFreshness(db, rule, metadata);

   // ✅ Correct - with config
   await checkFreshness(db, rule, metadata, config);
   ```

## Best Practices

1. **Use Environment-Based Configuration:**
   ```javascript
   const config = {
     debug: {
       enabled: process.env.NODE_ENV !== 'production',
       exposeQueries: true,
       exposeRawErrors: process.env.NODE_ENV === 'development'
     }
   };
   ```

2. **Log Debug Information Appropriately:**
   ```javascript
   if (result.debug) {
     // Use structured logging instead of console.log
     logger.debug('Query execution details', {
       debugId: result.debugId,
       duration: result.debug.duration,
       suggestion: result.debug.suggestion
     });
   }
   ```

3. **Correlation with Application Logs:**
   ```javascript
   const debugId = result.debugId;
   logger.error('Freshness check failed', {
     debugId,
     rule: rule.id,
     // Include debugId in all related log entries
   });
   ```

4. **Handle Suggestions Programmatically:**
   ```javascript
   if (result.debug?.suggestion) {
     // Show suggestion to developers
     console.log(`💡 Suggestion: ${result.debug.suggestion}`);

     // Or integrate with error reporting
     errorReporter.reportWithContext(result.error, {
       suggestion: result.debug.suggestion,
       debugId: result.debugId
     });
   }
   ```

## Getting Help

When reporting issues, please include:

1. **Debug ID** from error responses
2. **Raw error message** (if not sensitive)
3. **Configuration used**
4. **Environment details** (Node.js version, database version)
5. **Complete error response** with debug information

Example issue report:
```
Debug ID: fg-lxy123-abc45
Error: Query execution failed
Raw Error: column "created_at" does not exist
Configuration: { enabled: true, exposeQueries: true }
Environment: Node.js 18.x, PostgreSQL 15.x
Suggestion: Column 'created_at' not found in table 'orders'
```

This helps us provide better support and improve the debugging experience!