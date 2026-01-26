/**
 * Example implementation of debug mode for FreshGuard Core
 * This shows how developers could get access to raw database errors
 * while maintaining security in production.
 */

// ==============================================
// Enhanced Types with Debug Support
// ==============================================

interface FreshGuardConfig {
  timeoutMs?: number;
  debug?: {
    enabled?: boolean;
    exposeQueries?: boolean;      // Show actual SQL
    exposeRawErrors?: boolean;    // Show original DB errors
    logLevel?: 'error' | 'warn' | 'info' | 'debug';
    correlationId?: string;       // For tracing
  };
}

interface DebugInfo {
  query?: string;                 // Actual SQL executed
  params?: unknown[];             // Query parameters
  rawError?: string;             // Original database error
  suggestion?: string;           // How to fix the issue
  duration?: number;             // Query execution time
  debugId?: string;              // Correlation ID
}

interface CheckResult {
  status: 'ok' | 'alert' | 'failed';
  timestamp: Date;
  lag?: number;
  error?: string;
  code?: string;
  debugId?: string;              // NEW: For log correlation
  debug?: DebugInfo;             // NEW: Debug information
}

// ==============================================
// Enhanced Error Classes
// ==============================================

class FreshGuardError extends Error {
  public readonly code: string;
  public readonly timestamp: Date;
  public readonly sanitized: boolean;
  public readonly debug?: DebugInfo;
  public readonly debugId: string;

  constructor(
    message: string,
    code: string,
    sanitized = true,
    debug?: DebugInfo
  ) {
    super(message);
    this.code = code;
    this.timestamp = new Date();
    this.sanitized = sanitized;
    this.debug = debug;
    this.debugId = generateDebugId();
  }
}

class QueryError extends FreshGuardError {
  constructor(
    message: string,
    queryType = 'unknown',
    table?: string,
    originalError?: Error,
    debug?: DebugInfo
  ) {
    const sanitizedMessage = QueryError.sanitizeQueryError(message, originalError);
    super(sanitizedMessage, 'QUERY_FAILED', true, debug);
  }

  private static sanitizeQueryError(message: string, originalError?: Error): string {
    // Existing sanitization logic...
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('syntax error')) return 'Invalid query syntax';
    if (lowerMessage.includes('table') && lowerMessage.includes('not exist')) return 'Table does not exist';
    return 'Query execution failed';
  }
}

// ==============================================
// Debug Error Factory
// ==============================================

class DebugErrorFactory {
  constructor(private config: FreshGuardConfig) {}

  createQueryError(
    message: string,
    rawError?: Error,
    queryContext?: {
      sql: string;
      params: unknown[];
      table: string;
      duration?: number;
    }
  ): QueryError {
    let debug: DebugInfo | undefined;

    if (this.config.debug?.enabled) {
      debug = {
        query: this.config.debug.exposeQueries ? queryContext?.sql : undefined,
        params: this.config.debug.exposeQueries ? queryContext?.params : undefined,
        rawError: this.config.debug.exposeRawErrors ? rawError?.message : undefined,
        suggestion: this.generateSuggestion(rawError, queryContext),
        duration: queryContext?.duration,
        debugId: generateDebugId()
      };
    }

    return new QueryError(message, 'query', queryContext?.table, rawError, debug);
  }

  private generateSuggestion(rawError?: Error, context?: any): string | undefined {
    if (!rawError) return undefined;

    const message = rawError.message.toLowerCase();

    if (message.includes('column') && message.includes('does not exist')) {
      return `Column not found. Run 'DESCRIBE ${context?.table}' to verify column names and types.`;
    }

    if (message.includes('table') && message.includes('does not exist')) {
      return `Table '${context?.table}' not found. Check spelling and database schema access.`;
    }

    if (message.includes('permission denied')) {
      return `Access denied. Grant SELECT permission: 'GRANT SELECT ON ${context?.table} TO your_user;'`;
    }

    if (message.includes('connection refused')) {
      return `Database connection failed. Verify host, port, and network connectivity.`;
    }

    if (message.includes('authentication failed')) {
      return `Login failed. Check username, password, and database name.`;
    }

    return undefined;
  }
}

// ==============================================
// Enhanced Freshness Check with Debug Support
// ==============================================

async function checkFreshness(
  rule: MonitoringRule,
  connector: DatabaseConnector,
  config: FreshGuardConfig = {}
): Promise<CheckResult> {
  const debugFactory = new DebugErrorFactory(config);
  const startTime = performance.now();

  try {
    // Build query context for debugging
    const queryContext = {
      sql: `SELECT COUNT(*) as row_count, MAX(${rule.timestampColumn}) as last_update FROM ${rule.tableName}`,
      params: [] as unknown[],
      table: rule.tableName
    };

    // Log query in debug mode
    if (config.debug?.enabled) {
      console.log(`[DEBUG] Executing freshness check:`, {
        table: rule.tableName,
        query: config.debug.exposeQueries ? queryContext.sql : '[hidden]',
        timestamp: new Date().toISOString()
      });
    }

    const result = await executeWithTimeout(
      async () => {
        try {
          const queryResult = await connector.executeQuery(queryContext.sql);
          queryContext.duration = performance.now() - startTime;
          return queryResult;
        } catch (rawError) {
          queryContext.duration = performance.now() - startTime;
          throw debugFactory.createQueryError(
            'Freshness query execution failed',
            rawError as Error,
            queryContext
          );
        }
      },
      config.timeoutMs || 30000,
      'freshness_check'
    );

    // Process result normally...
    if (!result || result.length === 0) {
      throw debugFactory.createQueryError(
        'No data returned from freshness query',
        undefined,
        queryContext
      );
    }

    const row = result[0];
    const rowCount = parseInt(row.row_count || '0');
    const lastUpdate = row.last_update;

    if (rowCount === 0) {
      return {
        status: 'failed',
        timestamp: new Date(),
        error: 'No data found in table',
        code: 'NO_DATA',
        debug: config.debug?.enabled ? {
          query: queryContext.sql,
          duration: queryContext.duration,
          suggestion: `Table '${rule.tableName}' appears to be empty. Verify data exists.`
        } : undefined
      };
    }

    if (!lastUpdate) {
      return {
        status: 'failed',
        timestamp: new Date(),
        error: 'No timestamp data found',
        code: 'NO_TIMESTAMP',
        debug: config.debug?.enabled ? {
          query: queryContext.sql,
          duration: queryContext.duration,
          suggestion: `Column '${rule.timestampColumn}' contains no valid timestamps. Check column data type and values.`
        } : undefined
      };
    }

    // Calculate freshness
    const now = new Date();
    const lastUpdateDate = new Date(lastUpdate);
    const lagMs = now.getTime() - lastUpdateDate.getTime();
    const lagMinutes = Math.round(lagMs / (1000 * 60));

    const status = lagMinutes > rule.maxLagMinutes ? 'alert' : 'ok';

    return {
      status,
      timestamp: now,
      lag: lagMinutes,
      debug: config.debug?.enabled ? {
        query: queryContext.sql,
        duration: queryContext.duration,
        debugId: generateDebugId()
      } : undefined
    };

  } catch (error) {
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

// ==============================================
// Usage Examples
// ==============================================

// Example 1: Development mode with full debugging
async function developmentExample() {
  const config: FreshGuardConfig = {
    debug: {
      enabled: true,              // Enable debug mode
      exposeQueries: true,        // Show actual SQL
      exposeRawErrors: true,      // Show raw DB errors
      logLevel: 'debug'
    }
  };

  const result = await checkFreshness(rule, connector, config);

  if (result.status === 'failed' && result.debug) {
    console.log('❌ Freshness check failed');
    console.log('Query:', result.debug.query);
    console.log('Raw Error:', result.debug.rawError);
    console.log('Suggestion:', result.debug.suggestion);
    console.log('Duration:', result.debug.duration + 'ms');

    // Example output:
    // Query: SELECT COUNT(*) as row_count, MAX(order_date) as last_update FROM orders
    // Raw Error: column "order_date" does not exist
    // Suggestion: Column not found. Run 'DESCRIBE orders' to verify column names and types.
    // Duration: 45ms
  }
}

// Example 2: Environment-based debug mode
async function environmentBasedExample() {
  const config: FreshGuardConfig = {
    debug: {
      enabled: process.env.NODE_ENV === 'development' ||
               process.env.FRESHGUARD_DEBUG === 'true',
      exposeQueries: true,
      exposeRawErrors: true
    }
  };

  const result = await checkFreshness(rule, connector, config);
  return result;
}

// Example 3: Production mode (no debug info)
async function productionExample() {
  const config: FreshGuardConfig = {
    // debug not enabled - secure by default
  };

  const result = await checkFreshness(rule, connector, config);

  // result.debug will be undefined
  // Only sanitized error messages exposed
  return result;
}

// Example 4: Selective debug information
async function selectiveDebugExample() {
  const config: FreshGuardConfig = {
    debug: {
      enabled: true,
      exposeQueries: true,       // ✅ Show SQL queries
      exposeRawErrors: false,    // ❌ Don't show raw DB errors
      logLevel: 'info'
    }
  };

  const result = await checkFreshness(rule, connector, config);

  // result.debug.query will be available
  // result.debug.rawError will be undefined
  return result;
}

// ==============================================
// Helper Functions
// ==============================================

function generateDebugId(): string {
  return Math.random().toString(36).substr(2, 9);
}

function executeWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationType: string
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(`${operationType} timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// Mock interfaces for example
interface MonitoringRule {
  id: string;
  tableName: string;
  timestampColumn: string;
  maxLagMinutes: number;
}

interface DatabaseConnector {
  executeQuery(sql: string): Promise<any[]>;
}

class ErrorHandler {
  static sanitize(error: unknown): FreshGuardError {
    // Implementation from the actual code
    if (error instanceof FreshGuardError) return error;
    return new QueryError('Unknown error occurred');
  }
}

class TimeoutError extends FreshGuardError {
  constructor(message: string) {
    super(message, 'OPERATION_TIMEOUT', true);
  }
}

export {
  FreshGuardConfig,
  CheckResult,
  DebugInfo,
  checkFreshness,
  developmentExample,
  environmentBasedExample,
  productionExample,
  selectiveDebugExample
};