# Developer Experience Enhancement Proposal: Better Error Debugging

## Problem Statement

Developers integrating FreshGuard Core face poor debugging experience when database errors occur because:

1. **Aggressive Error Sanitization**: All database errors are sanitized for security, losing critical debugging details
2. **No Debug Mode**: No way to access raw database errors during development
3. **Silent Failures**: Many errors use `console.warn()` instead of structured logging
4. **Lost Query Context**: The actual SQL queries and parameters are not exposed when failures occur
5. **Missing Integration Guidance**: Error messages don't provide actionable next steps

## Current Behavior vs. Desired Behavior

### Current Experience
```typescript
// What developers see:
{
  "status": "failed",
  "error": "Query execution failed",
  "code": "QUERY_FAILED"
}

// What they need to debug:
// - What was the actual SQL query?
// - What were the parameters?
// - What was the raw database error?
// - Which part of the query failed?
```

### Desired Experience
```typescript
// Production (secure):
{
  "status": "failed",
  "error": "Query execution failed",
  "code": "QUERY_FAILED",
  "debugId": "abc123" // For correlation with logs
}

// Development/Debug mode:
{
  "status": "failed",
  "error": "Query execution failed",
  "code": "QUERY_FAILED",
  "debug": {
    "query": "SELECT COUNT(*) as row_count, MAX(order_date) as last_update FROM orders",
    "params": [],
    "rawError": "column \"order_date\" does not exist",
    "suggestion": "Verify column name in table schema"
  }
}
```

## Proposed Solutions

### 1. **Debug Mode Configuration**

Add debug configuration to expose raw errors in development environments:

```typescript
// src/types.ts - Add debug configuration
export interface FreshGuardConfig {
  // ... existing fields
  debug?: {
    enabled?: boolean;
    exposeQueries?: boolean;
    exposeRawErrors?: boolean;
    logLevel?: 'error' | 'warn' | 'info' | 'debug';
  };
}

// Auto-detect development environment
const isDevelopment = process.env.NODE_ENV === 'development' ||
                     process.env.FRESHGUARD_DEBUG === 'true';
```

### 2. **Enhanced Error Classes with Debug Information**

Extend error classes to preserve raw error information in debug mode:

```typescript
// src/errors/index.ts - Enhanced base class
export abstract class FreshGuardError extends Error {
  public readonly code: string;
  public readonly timestamp: Date;
  public readonly sanitized: boolean;
  public readonly debug?: DebugInfo; // New: debug information
  public readonly debugId?: string;  // New: correlation ID

  constructor(
    message: string,
    code: string,
    sanitized = true,
    debug?: DebugInfo
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.timestamp = new Date();
    this.sanitized = sanitized;
    this.debug = debug;
    this.debugId = generateDebugId(); // For log correlation
  }
}

interface DebugInfo {
  rawError?: string;
  query?: string;
  params?: unknown[];
  suggestion?: string;
  context?: Record<string, unknown>;
}
```

### 3. **Debug-Aware Error Factory**

Update error creation to include debug information when enabled:

```typescript
// src/errors/debug-factory.ts - New debug error factory
export class DebugErrorFactory {
  constructor(private config: FreshGuardConfig) {}

  createQueryError(
    message: string,
    rawError?: Error,
    queryContext?: {
      sql: string;
      params: unknown[];
      table: string;
    }
  ): QueryError {
    let debug: DebugInfo | undefined;

    if (this.config.debug?.enabled) {
      debug = {
        rawError: this.config.debug.exposeRawErrors ? rawError?.message : undefined,
        query: this.config.debug.exposeQueries ? queryContext?.sql : undefined,
        params: this.config.debug.exposeQueries ? queryContext?.params : undefined,
        suggestion: this.generateSuggestion(rawError, queryContext)
      };
    }

    return new QueryError(message, 'query', queryContext?.table, rawError, debug);
  }

  private generateSuggestion(rawError?: Error, context?: any): string | undefined {
    if (!rawError) return undefined;

    const message = rawError.message.toLowerCase();

    if (message.includes('column') && message.includes('does not exist')) {
      return `Verify that column '${context?.column}' exists in table '${context?.table}'. Use DESCRIBE ${context?.table} to check schema.`;
    }

    if (message.includes('table') && message.includes('does not exist')) {
      return `Table '${context?.table}' not found. Check table name and schema access permissions.`;
    }

    if (message.includes('permission denied')) {
      return `Database user lacks SELECT permissions on table '${context?.table}'. Grant appropriate permissions.`;
    }

    return undefined;
  }
}
```

### 4. **Enhanced Freshness Monitor with Debug Context**

Update the freshness checking to preserve query context:

```typescript
// src/monitor/freshness.ts - Enhanced with debug context
export async function checkFreshness(
  rule: MonitoringRule,
  connector: DatabaseConnector,
  config: FreshGuardConfig = {}
): Promise<CheckResult> {
  const debugFactory = new DebugErrorFactory(config);

  try {
    // Preserve query context for debugging
    const queryContext = {
      sql: `SELECT COUNT(*) as row_count, MAX(${rule.timestampColumn}) as last_update FROM ${rule.tableName}`,
      params: [],
      table: rule.tableName
    };

    const result = await executeWithTimeout(
      async () => {
        try {
          return await connector.executeQuery(queryContext.sql);
        } catch (rawError) {
          // Create debug-aware error
          throw debugFactory.createQueryError(
            'Query execution failed',
            rawError as Error,
            queryContext
          );
        }
      },
      config.timeoutMs || 30000,
      'freshness_check'
    );

    // ... rest of function

  } catch (error) {
    // Enhanced error handling with debug context
    const freshGuardError = ErrorHandler.sanitize(error);

    return {
      status: 'failed',
      timestamp: new Date(),
      error: freshGuardError.message,
      code: freshGuardError.code,
      debugId: freshGuardError.debugId,
      debug: config.debug?.enabled ? freshGuardError.debug : undefined
    };
  }
}
```

### 5. **Structured Error Logging Enhancement**

Replace `console.warn()` calls with structured logging:

```typescript
// src/monitor/freshness.ts - Replace console.warn with structured logging
// BEFORE:
catch (error) {
  console.warn(`Failed to save execution history: ${ErrorHandler.getUserMessage(error)}`);
}

// AFTER:
catch (error) {
  logger.warn('Metadata storage failed', {
    operation: 'saveExecutionHistory',
    ruleId: rule.id,
    table: rule.tableName,
    error: ErrorHandler.getUserMessage(error),
    debugId: error instanceof FreshGuardError ? error.debugId : undefined,
    debug: config.debug?.enabled ? {
      rawError: error.message,
      stack: error.stack
    } : undefined
  });
}
```

### 6. **Query Context Preservation**

Add query logging to connectors to preserve executed queries:

```typescript
// src/connectors/postgres.ts - Enhanced with query logging
export class PostgresConnector extends BaseConnector {
  async executeQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
    const startTime = performance.now();
    let queryContext: QueryContext;

    try {
      queryContext = {
        sql,
        params,
        connector: 'postgres',
        timestamp: new Date(),
        debugId: generateDebugId()
      };

      // Log query in debug mode
      if (this.config.debug?.enabled) {
        this.logger.debug('Executing query', queryContext);
      }

      const result = await this.client.query(sql, params);

      // Log successful execution
      this.logger.info('Query executed successfully', {
        ...queryContext,
        duration: performance.now() - startTime,
        rowCount: result.rowCount
      });

      return result.rows;

    } catch (error) {
      // Enhanced error with full context
      const duration = performance.now() - startTime;

      this.logger.error('Query execution failed', {
        ...queryContext,
        duration,
        error: ErrorHandler.getUserMessage(error),
        rawError: this.config.debug?.exposeRawErrors ? error.message : undefined
      });

      throw this.debugFactory.createQueryError(
        'Query execution failed',
        error as Error,
        queryContext
      );
    }
  }
}

interface QueryContext {
  sql: string;
  params: unknown[];
  connector: string;
  timestamp: Date;
  debugId: string;
}
```

### 7. **Error Dashboard/Summary**

Create error aggregation for integration debugging:

```typescript
// src/observability/error-tracker.ts - New error aggregation
export class ErrorTracker {
  private errors: Map<string, ErrorSummary> = new Map();

  track(error: FreshGuardError, context?: Record<string, unknown>) {
    const key = `${error.code}-${error.constructor.name}`;
    const existing = this.errors.get(key) || {
      code: error.code,
      type: error.constructor.name,
      count: 0,
      firstSeen: error.timestamp,
      lastSeen: error.timestamp,
      samples: []
    };

    existing.count++;
    existing.lastSeen = error.timestamp;
    existing.samples.push({
      message: error.message,
      debugId: error.debugId,
      context
    });

    // Keep only recent samples
    if (existing.samples.length > 5) {
      existing.samples.shift();
    }

    this.errors.set(key, existing);
  }

  getSummary(): ErrorSummary[] {
    return Array.from(this.errors.values())
      .sort((a, b) => b.count - a.count);
  }
}
```

### 8. **Enhanced CheckResult Interface**

Update result interface to include debug information:

```typescript
// src/types.ts - Enhanced CheckResult
export interface CheckResult {
  status: 'ok' | 'alert' | 'failed';
  timestamp: Date;
  lag?: number;
  error?: string;
  code?: string;
  debugId?: string;        // New: correlation ID
  debug?: {               // New: debug information
    query?: string;
    params?: unknown[];
    rawError?: string;
    suggestion?: string;
    duration?: number;
  };
  metadata?: {
    queryDuration?: number;
    rowCount?: number;
    // ... existing metadata
  };
}
```

## Implementation Strategy

### Phase 1: Core Debug Infrastructure (Week 1)
- [ ] Add debug configuration to types
- [ ] Enhance error classes with debug information
- [ ] Create DebugErrorFactory
- [ ] Add debugId generation

### Phase 2: Query Context Preservation (Week 2)
- [ ] Update connectors to preserve query context
- [ ] Enhance freshness/volume monitors with debug context
- [ ] Replace console.warn with structured logging

### Phase 3: Integration Enhancements (Week 3)
- [ ] Add error tracker/aggregation
- [ ] Create debug utilities for integrators
- [ ] Add query execution logging
- [ ] Update CheckResult interface

### Phase 4: Documentation & Examples (Week 4)
- [ ] Create debugging guide for integrators
- [ ] Add debug configuration examples
- [ ] Document error codes and suggested fixes
- [ ] Create troubleshooting runbook

## Example Usage

### For Library Integrators

```typescript
// Development mode with full debugging
import { checkFreshness } from '@freshguard/core';

const result = await checkFreshness(rule, connector, {
  debug: {
    enabled: true,
    exposeQueries: true,
    exposeRawErrors: true,
    logLevel: 'debug'
  }
});

if (result.status === 'failed') {
  console.log('Debug info:', result.debug);
  // Output:
  // {
  //   query: "SELECT COUNT(*) as row_count...",
  //   rawError: "column 'order_date' does not exist",
  //   suggestion: "Verify column name in table schema"
  // }
}
```

### Environment-based Configuration

```typescript
// Automatic development mode detection
const result = await checkFreshness(rule, connector, {
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    exposeQueries: true,
    exposeRawErrors: true
  }
});
```

### Error Aggregation

```typescript
// Get error summary for debugging
import { ErrorTracker } from '@freshguard/core/observability';

const tracker = new ErrorTracker();
const summary = tracker.getSummary();

// Output recent error patterns:
// [
//   { code: 'QUERY_FAILED', type: 'QueryError', count: 15, ... },
//   { code: 'CONNECTION_FAILED', type: 'ConnectionError', count: 3, ... }
// ]
```

## Benefits

1. **Better Integration DX**: Developers can see actual SQL queries and database errors during development
2. **Security Maintained**: Production deployments still use sanitized errors
3. **Actionable Errors**: Suggestions guide developers to fix common issues
4. **Correlation**: Debug IDs connect errors to log entries
5. **Error Patterns**: Aggregation helps identify systemic integration issues
6. **Structured Logging**: Better observability pipeline integration

## Backward Compatibility

- Default behavior unchanged (sanitized errors)
- Debug mode is opt-in
- Existing error codes and messages preserved
- No breaking changes to public APIs

This proposal addresses the core developer experience issue while maintaining the security posture of the library.