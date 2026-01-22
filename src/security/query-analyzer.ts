/**
 * Query Complexity Analyzer for FreshGuard Core Phase 2
 *
 * Analyzes SQL queries for complexity and security risks, providing
 * risk scoring and recommendations for safe query execution.
 *
 * @license MIT
 */

// ==============================================
// Types and Interfaces
// ==============================================

/**
 * Query complexity analysis result
 */
export interface QueryComplexity {
  /** Whether the query should be allowed to execute */
  allowExecution: boolean;
  /** Risk score from 0 (safe) to 100 (dangerous) */
  riskScore: number;
  /** Complexity score based on query structure */
  complexityScore: number;
  /** Estimated execution cost */
  estimatedCost: number;
  /** Security warnings found */
  securityWarnings: string[];
  /** Performance warnings found */
  performanceWarnings: string[];
  /** Recommendations for optimization */
  recommendations: string[];
  /** Query analysis details */
  details: QueryAnalysisDetails;
}

/**
 * Detailed query analysis breakdown
 */
export interface QueryAnalysisDetails {
  /** Query type (SELECT, INSERT, etc.) */
  queryType: string;
  /** Number of tables involved */
  tableCount: number;
  /** Number of joins */
  joinCount: number;
  /** Has subqueries */
  hasSubqueries: boolean;
  /** Has aggregations */
  hasAggregations: boolean;
  /** Has wildcards in SELECT */
  hasWildcards: boolean;
  /** Has LIMIT clause */
  hasLimit: boolean;
  /** LIMIT value if present */
  limitValue?: number;
  /** Has WHERE clause */
  hasWhere: boolean;
  /** Has ORDER BY clause */
  hasOrderBy: boolean;
  /** Has GROUP BY clause */
  hasGroupBy: boolean;
  /** Has HAVING clause */
  hasHaving: boolean;
  /** Estimated result set size */
  estimatedResultSize: number;
}

/**
 * Table metadata for analysis
 */
export interface TableMetadata {
  /** Table name */
  name: string;
  /** Estimated row count */
  estimatedRows: number;
  /** Table size in bytes */
  sizeBytes?: number;
  /** Available indexes */
  indexes: IndexInfo[];
  /** Column information */
  columns: ColumnInfo[];
  /** When metadata was last updated */
  lastUpdated: Date;
}

/**
 * Index information
 */
export interface IndexInfo {
  /** Index name */
  name: string;
  /** Columns in the index */
  columns: string[];
  /** Whether index is unique */
  unique: boolean;
  /** Index type (btree, hash, etc.) */
  type?: string;
}

/**
 * Column information
 */
export interface ColumnInfo {
  /** Column name */
  name: string;
  /** Data type */
  type: string;
  /** Whether column is nullable */
  nullable: boolean;
  /** Whether column is indexed */
  indexed: boolean;
  /** Estimated cardinality */
  cardinality?: number;
}

/**
 * Query analyzer configuration
 */
export interface QueryAnalyzerConfig {
  /** Maximum risk score to allow execution (0-100) */
  maxRiskScore: number;
  /** Maximum complexity score to allow (0-100) */
  maxComplexityScore: number;
  /** Maximum estimated cost to allow */
  maxEstimatedCost: number;
  /** Maximum result set size to allow */
  maxResultSetSize: number;
  /** Enable performance analysis */
  enablePerformanceAnalysis: boolean;
  /** Enable security analysis */
  enableSecurityAnalysis: boolean;
  /** Custom risk factors */
  customRiskFactors: RiskFactor[];
}

/**
 * Custom risk factor definition
 */
export interface RiskFactor {
  /** Pattern to match */
  pattern: RegExp;
  /** Risk score to add (0-100) */
  riskScore: number;
  /** Description of the risk */
  description: string;
  /** Whether this should block execution */
  blocking: boolean;
}

// ==============================================
// Default Configuration
// ==============================================

/**
 * Default query analyzer configuration
 */
const DEFAULT_CONFIG: QueryAnalyzerConfig = {
  maxRiskScore: 70,
  maxComplexityScore: 80,
  maxEstimatedCost: 1000000, // 1 million cost units
  maxResultSetSize: 10000,
  enablePerformanceAnalysis: true,
  enableSecurityAnalysis: true,
  customRiskFactors: []
};

/**
 * Default risk factors for security analysis
 */
const DEFAULT_RISK_FACTORS: RiskFactor[] = [
  {
    pattern: /union\s+all|union\s+select/i,
    riskScore: 30,
    description: 'UNION operations can be expensive and may indicate injection attempts',
    blocking: false
  },
  {
    pattern: /\bor\s+1\s*=\s*1\b/i,
    riskScore: 90,
    description: 'Classic SQL injection pattern detected',
    blocking: true
  },
  {
    pattern: /\bor\s+\'.*?\'\s*=\s*\'.*?\'/i,
    riskScore: 85,
    description: 'Potential SQL injection with string comparison',
    blocking: true
  },
  {
    pattern: /;\s*drop\s+table/i,
    riskScore: 100,
    description: 'SQL injection attempt to drop table',
    blocking: true
  },
  {
    pattern: /;\s*delete\s+from/i,
    riskScore: 100,
    description: 'SQL injection attempt to delete data',
    blocking: true
  },
  {
    pattern: /select\s+\*\s+from\s+information_schema/i,
    riskScore: 40,
    description: 'Information schema access - potentially sensitive',
    blocking: false
  },
  {
    pattern: /select\s+.*\s+from\s+.*\s+where\s+1\s*=\s*1/i,
    riskScore: 70,
    description: 'Suspicious WHERE clause that always evaluates to true',
    blocking: false
  },
  {
    pattern: /\/\*.*?\*\//,
    riskScore: 20,
    description: 'SQL comments detected - review for injection attempts',
    blocking: false
  },
  {
    pattern: /--.*$/m,
    riskScore: 25,
    description: 'SQL line comments detected - review for injection attempts',
    blocking: false
  }
];

// ==============================================
// SQL Parser Utilities
// ==============================================

/**
 * Simple SQL parser for query analysis
 * Note: This is a simplified parser for basic analysis
 */
class SimpleSQLParser {
  /**
   * Parse basic query structure
   */
  static parseQuery(sql: string): QueryAnalysisDetails {
    const normalizedSql = sql.trim().toLowerCase();

    // Determine query type
    const queryType = this.getQueryType(normalizedSql);

    // Count tables (simplified - counts FROM and JOIN clauses)
    const tableCount = this.countTables(normalizedSql);

    // Count joins
    const joinCount = this.countJoins(normalizedSql);

    // Check for various SQL constructs
    const hasSubqueries = /\(\s*select\b/.test(normalizedSql);
    const hasAggregations = /\b(count|sum|avg|max|min|group_concat)\s*\(/.test(normalizedSql);
    const hasWildcards = /select\s+\*\s+from\b/.test(normalizedSql);
    const hasWhere = /\bwhere\b/.test(normalizedSql);
    const hasOrderBy = /\border\s+by\b/.test(normalizedSql);
    const hasGroupBy = /\bgroup\s+by\b/.test(normalizedSql);
    const hasHaving = /\bhaving\b/.test(normalizedSql);

    // Check for LIMIT
    const limitMatch = /\blimit\s+(\d+)/.exec(normalizedSql);
    const hasLimit = !!limitMatch;
    const limitValue = limitMatch ? parseInt(limitMatch[1], 10) : undefined;

    // Estimate result set size (simplified)
    const estimatedResultSize = this.estimateResultSize(
      tableCount,
      hasWhere,
      hasLimit,
      limitValue
    );

    return {
      queryType,
      tableCount,
      joinCount,
      hasSubqueries,
      hasAggregations,
      hasWildcards,
      hasLimit,
      limitValue,
      hasWhere,
      hasOrderBy,
      hasGroupBy,
      hasHaving,
      estimatedResultSize
    };
  }

  /**
   * Get query type from SQL
   */
  private static getQueryType(sql: string): string {
    if (sql.startsWith('select')) return 'SELECT';
    if (sql.startsWith('insert')) return 'INSERT';
    if (sql.startsWith('update')) return 'UPDATE';
    if (sql.startsWith('delete')) return 'DELETE';
    if (sql.startsWith('create')) return 'CREATE';
    if (sql.startsWith('drop')) return 'DROP';
    if (sql.startsWith('alter')) return 'ALTER';
    if (sql.startsWith('show')) return 'SHOW';
    if (sql.startsWith('describe') || sql.startsWith('desc')) return 'DESCRIBE';
    return 'UNKNOWN';
  }

  /**
   * Count number of tables in query
   */
  private static countTables(sql: string): number {
    // Count FROM clauses
    const fromMatches = sql.match(/\bfrom\s+[\w\.]+/g) || [];
    // Count JOIN clauses
    const joinMatches = sql.match(/\bjoin\s+[\w\.]+/g) || [];

    return fromMatches.length + joinMatches.length;
  }

  /**
   * Count number of joins
   */
  private static countJoins(sql: string): number {
    const joinMatches = sql.match(/\b(inner\s+join|left\s+join|right\s+join|full\s+join|join)\b/g) || [];
    return joinMatches.length;
  }

  /**
   * Estimate result set size
   */
  private static estimateResultSize(
    tableCount: number,
    hasWhere: boolean,
    hasLimit: boolean,
    limitValue?: number
  ): number {
    // If LIMIT is specified, use that as max
    if (hasLimit && limitValue) {
      return Math.min(limitValue, 10000);
    }

    // Base estimate on table count and filtering
    let estimate = Math.pow(1000, tableCount); // Exponential growth with joins

    // Reduce estimate if WHERE clause exists (assumes filtering)
    if (hasWhere) {
      estimate = Math.floor(estimate * 0.1); // Assume WHERE reduces by 90%
    }

    // Cap at reasonable maximum
    return Math.min(estimate, 100000);
  }
}

// ==============================================
// Query Complexity Analyzer
// ==============================================

/**
 * Analyzes SQL queries for complexity and security risks
 */
export class QueryComplexityAnalyzer {
  private config: QueryAnalyzerConfig;
  private readonly riskFactors: RiskFactor[];

  constructor(config: Partial<QueryAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.riskFactors = [
      ...DEFAULT_RISK_FACTORS,
      ...(config.customRiskFactors || [])
    ];
  }

  /**
   * Analyze a SQL query for complexity and security risks
   */
  analyzeQuery(sql: string, tableMetadata: TableMetadata[] = []): QueryComplexity {
    // Parse query structure
    const details = SimpleSQLParser.parseQuery(sql);

    // Calculate scores
    const complexityScore = this.calculateComplexityScore(details, tableMetadata);
    const riskScore = this.calculateRiskScore(sql, details);
    const estimatedCost = this.calculateEstimatedCost(details, tableMetadata);

    // Generate warnings and recommendations
    const securityWarnings = this.generateSecurityWarnings(sql, details);
    const performanceWarnings = this.generatePerformanceWarnings(details, tableMetadata);
    const recommendations = this.generateRecommendations(details, securityWarnings, performanceWarnings);

    // Determine if execution should be allowed
    const allowExecution = this.shouldAllowExecution(
      sql,
      riskScore,
      complexityScore,
      estimatedCost,
      details
    );

    return {
      allowExecution,
      riskScore,
      complexityScore,
      estimatedCost,
      securityWarnings,
      performanceWarnings,
      recommendations,
      details
    };
  }

  /**
   * Calculate query complexity score (0-100)
   */
  private calculateComplexityScore(
    details: QueryAnalysisDetails,
    tableMetadata: TableMetadata[]
  ): number {
    let score = 0;

    // Base score by query type
    switch (details.queryType) {
      case 'SELECT': score += 5; break;
      case 'INSERT': score += 15; break;
      case 'UPDATE': score += 20; break;
      case 'DELETE': score += 25; break;
      case 'CREATE': score += 30; break;
      case 'DROP': score += 50; break;
      case 'ALTER': score += 40; break;
      default: score += 10;
    }

    // Table complexity
    score += Math.min(details.tableCount * 10, 30); // Max 30 for tables

    // Join complexity
    score += Math.min(details.joinCount * 15, 40); // Max 40 for joins

    // Subquery complexity
    if (details.hasSubqueries) score += 20;

    // Aggregation complexity
    if (details.hasAggregations) score += 10;

    // Wildcard penalty (SELECT *)
    if (details.hasWildcards) score += 15;

    // Missing WHERE clause on multi-table queries
    if (details.tableCount > 1 && !details.hasWhere) score += 25;

    // Large result set penalty
    if (details.estimatedResultSize > 1000) score += 10;
    if (details.estimatedResultSize > 10000) score += 20;

    // No LIMIT on potentially large results
    if (!details.hasLimit && details.estimatedResultSize > 1000) score += 15;

    return Math.min(score, 100);
  }

  /**
   * Calculate security risk score (0-100)
   */
  private calculateRiskScore(sql: string, details: QueryAnalysisDetails): number {
    let score = 0;

    if (!this.config.enableSecurityAnalysis) {
      return 0;
    }

    // Check against risk factors
    for (const factor of this.riskFactors) {
      if (factor.pattern.test(sql)) {
        score += factor.riskScore;
      }
    }

    // Additional risk factors based on query structure
    if (details.queryType !== 'SELECT' && details.queryType !== 'SHOW' && details.queryType !== 'DESCRIBE') {
      score += 30; // Non-read operations are inherently riskier
    }

    // Multiple statements (potential injection)
    const statementCount = sql.split(';').filter(s => s.trim()).length;
    if (statementCount > 1) {
      score += 40;
    }

    return Math.min(score, 100);
  }

  /**
   * Calculate estimated execution cost
   */
  private calculateEstimatedCost(
    details: QueryAnalysisDetails,
    tableMetadata: TableMetadata[]
  ): number {
    let cost = 1; // Base cost

    // Cost based on estimated result size
    cost += details.estimatedResultSize * 0.1;

    // Join costs (exponential)
    if (details.joinCount > 0) {
      cost *= Math.pow(10, details.joinCount);
    }

    // Table scan costs
    for (let i = 0; i < details.tableCount; i++) {
      const metadata = tableMetadata[i];
      if (metadata) {
        cost += metadata.estimatedRows * 0.01;
      } else {
        cost += 10000; // Unknown table - assume large
      }
    }

    // Subquery costs
    if (details.hasSubqueries) {
      cost *= 5;
    }

    // Aggregation costs
    if (details.hasAggregations) {
      cost *= 2;
    }

    // Sorting costs
    if (details.hasOrderBy && !details.hasLimit) {
      cost *= 3;
    }

    return Math.floor(cost);
  }

  /**
   * Generate security warnings
   */
  private generateSecurityWarnings(sql: string, details: QueryAnalysisDetails): string[] {
    const warnings: string[] = [];

    if (!this.config.enableSecurityAnalysis) {
      return warnings;
    }

    // Check risk factors
    for (const factor of this.riskFactors) {
      if (factor.pattern.test(sql)) {
        warnings.push(factor.description);
      }
    }

    // Additional security checks
    if (details.queryType !== 'SELECT' && details.queryType !== 'SHOW' && details.queryType !== 'DESCRIBE') {
      warnings.push('Non-read operation detected - ensure proper authorization');
    }

    if (sql.includes(';') && sql.split(';').filter(s => s.trim()).length > 1) {
      warnings.push('Multiple SQL statements detected - potential injection risk');
    }

    if (details.hasWildcards && details.tableCount > 0) {
      warnings.push('SELECT * detected - may expose sensitive columns');
    }

    return warnings;
  }

  /**
   * Generate performance warnings
   */
  private generatePerformanceWarnings(
    details: QueryAnalysisDetails,
    tableMetadata: TableMetadata[]
  ): string[] {
    const warnings: string[] = [];

    if (!this.config.enablePerformanceAnalysis) {
      return warnings;
    }

    // Large result set without LIMIT
    if (details.estimatedResultSize > 1000 && !details.hasLimit) {
      warnings.push(`Large result set estimated (${details.estimatedResultSize}) without LIMIT clause`);
    }

    // Multiple joins without WHERE
    if (details.joinCount > 1 && !details.hasWhere) {
      warnings.push('Multiple JOINs without WHERE clause may produce Cartesian product');
    }

    // SELECT * on large tables
    if (details.hasWildcards && tableMetadata.some(t => t.estimatedRows > 10000)) {
      warnings.push('SELECT * on large table(s) - consider selecting specific columns');
    }

    // ORDER BY without LIMIT on large result
    if (details.hasOrderBy && !details.hasLimit && details.estimatedResultSize > 1000) {
      warnings.push('ORDER BY without LIMIT on large result set - consider adding LIMIT');
    }

    // Subqueries
    if (details.hasSubqueries) {
      warnings.push('Subqueries detected - consider using JOINs for better performance');
    }

    return warnings;
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    details: QueryAnalysisDetails,
    securityWarnings: string[],
    performanceWarnings: string[]
  ): string[] {
    const recommendations: string[] = [];

    // Security recommendations
    if (securityWarnings.length > 0) {
      recommendations.push('Review security warnings and validate query source');
    }

    if (details.hasWildcards) {
      recommendations.push('Replace SELECT * with specific column names');
    }

    // Performance recommendations
    if (!details.hasLimit && details.estimatedResultSize > 1000) {
      recommendations.push('Add LIMIT clause to prevent large result sets');
    }

    if (details.joinCount > 0 && !details.hasWhere) {
      recommendations.push('Add WHERE clause to filter results and improve performance');
    }

    if (details.hasOrderBy && details.estimatedResultSize > 1000) {
      recommendations.push('Consider adding indexes on ORDER BY columns');
    }

    if (details.hasSubqueries) {
      recommendations.push('Consider rewriting subqueries as JOINs');
    }

    if (performanceWarnings.length > 2) {
      recommendations.push('Query complexity is high - consider breaking into smaller queries');
    }

    return recommendations;
  }

  /**
   * Determine if query execution should be allowed
   */
  private shouldAllowExecution(
    sql: string,
    riskScore: number,
    complexityScore: number,
    estimatedCost: number,
    details: QueryAnalysisDetails
  ): boolean {
    // Check against thresholds
    if (riskScore > this.config.maxRiskScore) {
      return false;
    }

    if (complexityScore > this.config.maxComplexityScore) {
      return false;
    }

    if (estimatedCost > this.config.maxEstimatedCost) {
      return false;
    }

    if (details.estimatedResultSize > this.config.maxResultSetSize) {
      return false;
    }

    // Check for blocking risk factors
    for (const factor of this.riskFactors) {
      if (factor.blocking && factor.pattern.test(sql)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueryAnalyzerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Add custom risk factor
   */
  addRiskFactor(factor: RiskFactor): void {
    this.riskFactors.push(factor);
  }

  /**
   * Get current configuration
   */
  getConfig(): QueryAnalyzerConfig {
    return { ...this.config };
  }
}

// ==============================================
// Factory Functions
// ==============================================

/**
 * Create a query analyzer with default configuration
 */
export function createQueryAnalyzer(config?: Partial<QueryAnalyzerConfig>): QueryComplexityAnalyzer {
  return new QueryComplexityAnalyzer(config);
}

/**
 * Create a strict security analyzer
 */
export function createSecurityAnalyzer(): QueryComplexityAnalyzer {
  return new QueryComplexityAnalyzer({
    maxRiskScore: 30,
    maxComplexityScore: 50,
    maxEstimatedCost: 100000,
    maxResultSetSize: 1000,
    enableSecurityAnalysis: true,
    enablePerformanceAnalysis: false
  });
}

/**
 * Create a performance-focused analyzer
 */
export function createPerformanceAnalyzer(): QueryComplexityAnalyzer {
  return new QueryComplexityAnalyzer({
    maxRiskScore: 100, // Allow all from security perspective
    maxComplexityScore: 60,
    maxEstimatedCost: 500000,
    maxResultSetSize: 5000,
    enableSecurityAnalysis: false,
    enablePerformanceAnalysis: true
  });
}

// ==============================================
// Default Analyzer Instance
// ==============================================

/**
 * Default query analyzer instance
 */
export const defaultQueryAnalyzer = createQueryAnalyzer();