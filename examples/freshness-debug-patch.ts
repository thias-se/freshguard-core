/**
 * PATCH: Enhanced freshness.ts with debug mode for better developer experience
 *
 * This shows the exact changes needed in src/monitor/freshness.ts to add
 * debug capabilities while maintaining security in production.
 */

// ==============================================
// BEFORE & AFTER COMPARISON
// ==============================================

/*
CURRENT PROBLEM (lines 275-283 in freshness.ts):

} catch (error) {
  // Re-throw with context but let error sanitizer handle the details
  throw new QueryError(
    'Failed to execute freshness query',
    'freshness_query',
    tableName,
    error instanceof Error ? error : undefined
  );
}

❌ This sanitizes away the actual database error that developers need for debugging!
*/

/*
ENHANCED VERSION WITH DEBUG MODE:
*/

// ==============================================
// 1. Enhanced Types (add to src/types.ts)
// ==============================================

interface FreshGuardConfig {
  timeoutMs?: number;
  debug?: {
    enabled?: boolean;
    exposeQueries?: boolean;     // Show actual SQL
    exposeRawErrors?: boolean;   // Show original DB errors
    logLevel?: 'error' | 'warn' | 'info' | 'debug';
  };
}

interface CheckResult {
  status: 'ok' | 'alert' | 'failed';
  executedAt: Date;
  executionDurationMs?: number;
  rowCount?: number;
  lastUpdate?: Date;
  lagMinutes?: number;
  error?: string;

  // NEW: Debug information
  debugId?: string;
  debug?: {
    query?: string;
    rawError?: string;
    suggestion?: string;
    duration?: number;
    context?: Record<string, unknown>;
  };
}

// ==============================================
// 2. Enhanced checkFreshness function signature
// ==============================================

// BEFORE:
export async function checkFreshness(
  db: Database,
  rule: MonitoringRule,
  metadataStorage?: MetadataStorage
): Promise<CheckResult>

// AFTER:
export async function checkFreshness(
  db: Database,
  rule: MonitoringRule,
  metadataStorage?: MetadataStorage,
  config?: FreshGuardConfig  // NEW: Optional config parameter
): Promise<CheckResult>

// ==============================================
// 3. Enhanced error handling in executeFreshnessQuery
// ==============================================

// BEFORE (lines 250-284):
async function executeFreshnessQuery(
  db: Database,
  tableName: string,
  timestampColumn: string
): Promise<{ rowCount: number; lastUpdate: Date | null; row: any }> {
  const query = sql`
    SELECT
      COUNT(*) as row_count,
      MAX(${sql.identifier(timestampColumn)}) as last_update
    FROM ${sql.identifier(tableName)}
  `;

  try {
    const result = await db.execute(query);
    // ... process result
  } catch (error) {
    // Re-throw with context but let error sanitizer handle the details
    throw new QueryError(
      'Failed to execute freshness query',
      'freshness_query',
      tableName,
      error instanceof Error ? error : undefined
    );
  }
}

// AFTER - Enhanced with debug context:
async function executeFreshnessQuery(
  db: Database,
  tableName: string,
  timestampColumn: string,
  config?: FreshGuardConfig  // NEW: Config parameter
): Promise<{ rowCount: number; lastUpdate: Date | null; row: any }> {
  const query = sql`
    SELECT
      COUNT(*) as row_count,
      MAX(${sql.identifier(timestampColumn)}) as last_update
    FROM ${sql.identifier(tableName)}
  `;

  const debugId = generateDebugId();
  const startTime = performance.now();

  try {
    // Log query in debug mode
    if (config?.debug?.enabled) {
      console.log(`[DEBUG-${debugId}] Executing freshness query:`, {
        table: tableName,
        column: timestampColumn,
        query: config.debug.exposeQueries ? query.toSQL() : '[SQL hidden in production]'
      });
    }

    const result = await db.execute(query);
    const row = result[0] as { row_count: string; last_update: Date | null };

    if (!row) {
      const error = new QueryError('Query returned empty result set', 'freshness_query', tableName);
      error.debug = config?.debug?.enabled ? {
        query: config.debug.exposeQueries ? query.toSQL() : undefined,
        duration: performance.now() - startTime,
        suggestion: `Table '${tableName}' may not exist or has no accessible rows. Check table name and permissions.`
      } : undefined;
      throw error;
    }

    const rowCount = parseInt(row.row_count, 10);
    const lastUpdate = row.last_update;

    return { rowCount, lastUpdate, row };

  } catch (error) {
    const duration = performance.now() - startTime;

    // Enhanced error with debug information
    const queryError = new QueryError(
      'Failed to execute freshness query',
      'freshness_query',
      tableName,
      error instanceof Error ? error : undefined
    );

    // Add debug information if enabled
    if (config?.debug?.enabled) {
      queryError.debug = {
        query: config.debug.exposeQueries ? query.toSQL() : undefined,
        rawError: config.debug.exposeRawErrors ? (error instanceof Error ? error.message : String(error)) : undefined,
        duration,
        suggestion: generateErrorSuggestion(error, tableName, timestampColumn),
        context: {
          table: tableName,
          column: timestampColumn,
          debugId
        }
      };

      // Log detailed error in debug mode
      console.error(`[DEBUG-${debugId}] Query execution failed:`, {
        table: tableName,
        rawError: config.debug.exposeRawErrors ? queryError.debug.rawError : '[Raw error hidden in production]',
        duration,
        suggestion: queryError.debug.suggestion
      });
    }

    throw queryError;
  }
}

// ==============================================
// 4. Enhanced main checkFreshness function
// ==============================================

export async function checkFreshness(
  db: Database,
  rule: MonitoringRule,
  metadataStorage?: MetadataStorage,
  config?: FreshGuardConfig  // NEW: Optional config
): Promise<CheckResult> {
  const startTime = Date.now();
  const debugId = generateDebugId();

  try {
    // Validate input parameters for security
    validateFreshnessRule(rule);

    const timestampColumn = rule.timestampColumn || 'updated_at';
    const toleranceMinutes = rule.toleranceMinutes || 60;

    // Validate table and column names to prevent SQL injection
    validateTableName(rule.tableName);
    validateColumnName(timestampColumn);

    // Validate tolerance parameter range
    if (toleranceMinutes < 1 || toleranceMinutes > 10080) {
      throw new ConfigurationError('Tolerance minutes must be between 1 and 10080 (1 week)');
    }

    // Log debug info
    if (config?.debug?.enabled) {
      console.log(`[DEBUG-${debugId}] Starting freshness check:`, {
        table: rule.tableName,
        column: timestampColumn,
        tolerance: toleranceMinutes,
        ruleId: rule.id
      });
    }

    // Execute query with timeout protection - NOW PASSES CONFIG
    const queryResult = await executeWithTimeout(
      () => executeFreshnessQuery(db, rule.tableName, timestampColumn, config), // Pass config here
      config?.timeoutMs || 30000,
      'Freshness check query timeout'
    );

    // ... rest of the function logic stays the same ...

    if (!queryResult?.row) {
      const error = new QueryError('Query returned no results', 'freshness_query', rule.tableName);
      if (config?.debug?.enabled) {
        error.debug = {
          suggestion: `Query executed successfully but returned no rows. Check if table '${rule.tableName}' exists and is accessible.`,
          context: { table: rule.tableName, debugId }
        };
      }
      throw error;
    }

    // ... continue with existing logic ...

  } catch (error) {
    // Enhanced error handling in main function
    const userMessage = ErrorHandler.getUserMessage(error);
    const executedAt = new Date();
    const executionDurationMs = Date.now() - startTime;

    // Save execution result
    if (rule?.id) {
      await saveExecutionResult(metadataStorage, {
        ruleId: rule.id,
        status: 'failed',
        executionDurationMs,
        executedAt,
        error: userMessage,
      });
    }

    // Create result with debug info
    const result: CheckResult = {
      status: 'failed',
      error: userMessage,
      executionDurationMs,
      executedAt,
      debugId: debugId
    };

    // Add debug information if enabled
    if (config?.debug?.enabled && error instanceof QueryError && error.debug) {
      result.debug = error.debug;
    }

    return result;
  }
}

// ==============================================
// 5. Helper functions
// ==============================================

function generateDebugId(): string {
  return `fg-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
}

function generateErrorSuggestion(error: unknown, tableName: string, columnName: string): string {
  if (!(error instanceof Error)) return 'Check database connection and table access permissions.';

  const message = error.message.toLowerCase();

  if (message.includes('relation') && message.includes('does not exist')) {
    return `Table '${tableName}' does not exist. Verify table name and database schema.`;
  }

  if (message.includes('column') && message.includes('does not exist')) {
    return `Column '${columnName}' not found in table '${tableName}'. Check column name with: DESCRIBE ${tableName}`;
  }

  if (message.includes('permission denied') || message.includes('access denied')) {
    return `Access denied to table '${tableName}'. Grant SELECT permission: GRANT SELECT ON ${tableName} TO your_user;`;
  }

  if (message.includes('connection') && message.includes('refused')) {
    return `Database connection failed. Check host, port, and network connectivity.`;
  }

  if (message.includes('authentication failed')) {
    return `Authentication failed. Verify username, password, and database name.`;
  }

  if (message.includes('timeout')) {
    return `Query timeout. Table '${tableName}' may be very large. Consider adding indexes or increasing timeout.`;
  }

  if (message.includes('syntax error')) {
    return `SQL syntax error. This may indicate an issue with table/column names containing special characters.`;
  }

  return 'Check database connection, table existence, and access permissions.';
}

// ==============================================
// 6. Usage Examples
// ==============================================

// Development mode with full debugging
const devResult = await checkFreshness(db, rule, metadataStorage, {
  debug: {
    enabled: true,
    exposeQueries: true,
    exposeRawErrors: true,
    logLevel: 'debug'
  }
});

// Production mode (secure by default)
const prodResult = await checkFreshness(db, rule, metadataStorage);

// Environment-based configuration
const result = await checkFreshness(db, rule, metadataStorage, {
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    exposeQueries: true,
    exposeRawErrors: true
  }
});

// What developers would see:

// PRODUCTION (current behavior):
{
  "status": "failed",
  "error": "Query execution failed",
  "executedAt": "2024-01-26T10:30:00Z"
}

// DEVELOPMENT (new debug mode):
{
  "status": "failed",
  "error": "Query execution failed",
  "executedAt": "2024-01-26T10:30:00Z",
  "debugId": "fg-lxy123-abc45",
  "debug": {
    "query": "SELECT COUNT(*) as row_count, MAX(order_date) as last_update FROM orders",
    "rawError": "column \"order_date\" does not exist",
    "suggestion": "Column 'order_date' not found in table 'orders'. Check column name with: DESCRIBE orders",
    "duration": 45,
    "context": {
      "table": "orders",
      "column": "order_date",
      "debugId": "fg-lxy123-abc45"
    }
  }
}

export { checkFreshness, FreshGuardConfig, CheckResult };