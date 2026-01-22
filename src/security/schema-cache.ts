/**
 * Schema Cache for FreshGuard Core Phase 2
 *
 * Caches table metadata with expiry for improved query analysis performance
 * and reduced database load from repeated schema queries.
 *
 * @license MIT
 */

import { StructuredLogger, createComponentLogger } from '../observability/logger.js';
import { MetricsCollector, createComponentMetrics } from '../observability/metrics.js';

// ==============================================
// Types and Interfaces
// ==============================================

/**
 * Cached table schema information
 */
export interface CachedTableSchema {
  /** Table name */
  tableName: string;
  /** Database name */
  database: string;
  /** Column information */
  columns: CachedColumnInfo[];
  /** Index information */
  indexes: CachedIndexInfo[];
  /** Estimated row count */
  estimatedRows: number;
  /** Table size in bytes */
  sizeBytes?: number;
  /** When this cache entry was created */
  cachedAt: Date;
  /** When this cache entry expires */
  expiresAt: Date;
  /** Hash of the table structure for change detection */
  structureHash: string;
}

/**
 * Cached column information
 */
export interface CachedColumnInfo {
  /** Column name */
  name: string;
  /** Data type */
  type: string;
  /** Whether column is nullable */
  nullable: boolean;
  /** Whether column has an index */
  indexed: boolean;
  /** Primary key column */
  isPrimaryKey: boolean;
  /** Foreign key information */
  foreignKey?: {
    referencedTable: string;
    referencedColumn: string;
  };
  /** Estimated cardinality (distinct values) */
  estimatedCardinality?: number;
}

/**
 * Cached index information
 */
export interface CachedIndexInfo {
  /** Index name */
  name: string;
  /** Columns in the index */
  columns: string[];
  /** Whether index is unique */
  unique: boolean;
  /** Index type (btree, hash, gin, etc.) */
  type: string;
  /** Whether this is a primary key index */
  isPrimary: boolean;
  /** Estimated index size */
  sizeBytes?: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total number of cache entries */
  totalEntries: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Cache hit rate percentage */
  hitRate: number;
  /** Number of expired entries removed */
  evictions: number;
  /** Total memory used by cache (estimated) */
  memoryUsage: number;
  /** Average cache entry age in milliseconds */
  averageAge: number;
  /** When cache statistics were last reset */
  lastResetTime: Date;
}

/**
 * Schema cache configuration
 */
export interface SchemaCacheConfig {
  /** Default TTL for cache entries in milliseconds */
  defaultTTL: number;
  /** Maximum number of cache entries */
  maxEntries: number;
  /** Cleanup interval in milliseconds */
  cleanupInterval: number;
  /** Enable automatic background refresh */
  enableAutoRefresh: boolean;
  /** Auto refresh threshold (refresh when entry is this % through TTL) */
  autoRefreshThreshold: number;
  /** Enable cache compression */
  enableCompression: boolean;
  /** Enable cache statistics */
  enableStats: boolean;
  /** Logger for cache operations */
  logger?: StructuredLogger;
  /** Metrics collector */
  metrics?: MetricsCollector;
}

/**
 * Cache key type
 */
type CacheKey = string; // Format: "database:table"

// ==============================================
// Default Configuration
// ==============================================

/**
 * Default schema cache configuration
 */
const DEFAULT_CONFIG: Required<Omit<SchemaCacheConfig, 'logger' | 'metrics'>> = {
  defaultTTL: 300000, // 5 minutes
  maxEntries: 1000,
  cleanupInterval: 60000, // 1 minute
  enableAutoRefresh: true,
  autoRefreshThreshold: 0.8, // Refresh at 80% of TTL
  enableCompression: false, // Disabled for simplicity
  enableStats: true
};

// ==============================================
// Cache Entry Management
// ==============================================

/**
 * Internal cache entry with metadata
 */
interface CacheEntry {
  /** The cached schema data */
  schema: CachedTableSchema;
  /** Last access time */
  lastAccessed: Date;
  /** Access count */
  accessCount: number;
  /** Whether entry needs refresh */
  needsRefresh: boolean;
}

// ==============================================
// Schema Cache Implementation
// ==============================================

/**
 * High-performance schema cache with TTL and LRU eviction
 */
export class SchemaCache {
  private cache = new Map<CacheKey, CacheEntry>();
  private config: Required<SchemaCacheConfig>;
  private logger: StructuredLogger;
  private metrics: MetricsCollector;
  private cleanupTimer?: NodeJS.Timeout;
  private stats: CacheStats;

  constructor(config: Partial<SchemaCacheConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      logger: config.logger || createComponentLogger('schema-cache'),
      metrics: config.metrics || createComponentMetrics('schema_cache'),
      ...config
    };

    this.logger = this.config.logger;
    this.metrics = this.config.metrics;

    // Initialize statistics
    this.stats = {
      totalEntries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      evictions: 0,
      memoryUsage: 0,
      averageAge: 0,
      lastResetTime: new Date()
    };

    // Start cleanup timer
    this.startCleanupTimer();

    this.logger.info('Schema cache initialized', {
      defaultTTL: this.config.defaultTTL,
      maxEntries: this.config.maxEntries,
      cleanupInterval: this.config.cleanupInterval,
      autoRefresh: this.config.enableAutoRefresh
    });
  }

  /**
   * Get cached table schema
   */
  get(database: string, tableName: string): CachedTableSchema | null {
    const key = this.makeKey(database, tableName);
    const entry = this.cache.get(key);

    if (!entry) {
      this.recordMiss();
      return null;
    }

    // Check if entry has expired
    const now = new Date();
    if (now > entry.schema.expiresAt) {
      this.cache.delete(key);
      this.recordMiss();
      this.logger.debug('Cache entry expired', { database, tableName });
      return null;
    }

    // Check if entry needs refresh (auto-refresh)
    if (this.config.enableAutoRefresh) {
      const ageRatio = (now.getTime() - entry.schema.cachedAt.getTime()) /
                      (entry.schema.expiresAt.getTime() - entry.schema.cachedAt.getTime());

      if (ageRatio >= this.config.autoRefreshThreshold) {
        entry.needsRefresh = true;
        this.logger.debug('Cache entry marked for refresh', {
          database,
          tableName,
          ageRatio
        });
      }
    }

    // Update access metadata
    entry.lastAccessed = now;
    entry.accessCount++;

    this.recordHit();
    this.logger.debug('Cache hit', { database, tableName, accessCount: entry.accessCount });

    return { ...entry.schema }; // Return copy to prevent mutations
  }

  /**
   * Store table schema in cache
   */
  set(schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'>): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.defaultTTL);

    const cachedSchema: CachedTableSchema = {
      ...schema,
      cachedAt: now,
      expiresAt
    };

    const key = this.makeKey(schema.database, schema.tableName);

    // Check if we need to evict entries
    if (this.cache.size >= this.config.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }

    // Store the entry
    const entry: CacheEntry = {
      schema: cachedSchema,
      lastAccessed: now,
      accessCount: 1,
      needsRefresh: false
    };

    this.cache.set(key, entry);
    this.updateStats();

    this.logger.debug('Schema cached', {
      database: schema.database,
      tableName: schema.tableName,
      columns: schema.columns.length,
      indexes: schema.indexes.length,
      estimatedRows: schema.estimatedRows,
      expiresAt: expiresAt.toISOString()
    });
  }

  /**
   * Remove table schema from cache
   */
  delete(database: string, tableName: string): boolean {
    const key = this.makeKey(database, tableName);
    const deleted = this.cache.delete(key);

    if (deleted) {
      this.updateStats();
      this.logger.debug('Schema cache entry deleted', { database, tableName });
    }

    return deleted;
  }

  /**
   * Check if table schema exists in cache and is valid
   */
  has(database: string, tableName: string): boolean {
    const key = this.makeKey(database, tableName);
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check expiry
    const now = new Date();
    if (now > entry.schema.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get entries that need refresh
   */
  getEntriesNeedingRefresh(): Array<{ database: string; tableName: string }> {
    const needingRefresh: Array<{ database: string; tableName: string }> = [];

    for (const [key, entry] of this.cache) {
      if (entry.needsRefresh) {
        const { database, tableName } = this.parseKey(key);
        needingRefresh.push({ database, tableName });
      }
    }

    return needingRefresh;
  }

  /**
   * Mark entry as refreshed
   */
  markAsRefreshed(database: string, tableName: string): void {
    const key = this.makeKey(database, tableName);
    const entry = this.cache.get(key);

    if (entry) {
      entry.needsRefresh = false;
      this.logger.debug('Cache entry marked as refreshed', { database, tableName });
    }
  }

  /**
   * Get all cached table names for a database
   */
  getTablesForDatabase(database: string): string[] {
    const tables: string[] = [];

    for (const [key, entry] of this.cache) {
      const parsed = this.parseKey(key);
      if (parsed.database === database && new Date() <= entry.schema.expiresAt) {
        tables.push(parsed.tableName);
      }
    }

    return tables.sort();
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const entriesCleared = this.cache.size;
    this.cache.clear();
    this.stats = {
      ...this.stats,
      totalEntries: 0,
      memoryUsage: 0
    };

    this.logger.info('Schema cache cleared', { entriesCleared });
  }

  /**
   * Clear expired entries
   */
  clearExpired(): number {
    const now = new Date();
    let expiredCount = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.schema.expiresAt) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      this.updateStats();
      this.stats.evictions += expiredCount;
      this.logger.debug('Expired cache entries cleared', { expiredCount });
    }

    return expiredCount;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      totalEntries: this.cache.size,
      hits: 0,
      misses: 0,
      hitRate: 0,
      evictions: 0,
      memoryUsage: this.estimateMemoryUsage(),
      averageAge: this.calculateAverageAge(),
      lastResetTime: new Date()
    };

    this.logger.info('Cache statistics reset');
  }

  /**
   * Stop cache cleanup timer
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.logger.info('Schema cache stopped');
  }

  /**
   * Export cache data for persistence
   */
  export(): CachedTableSchema[] {
    const schemas: CachedTableSchema[] = [];

    for (const entry of this.cache.values()) {
      schemas.push({ ...entry.schema });
    }

    return schemas;
  }

  /**
   * Import cache data from persistence
   */
  import(schemas: CachedTableSchema[]): number {
    let importedCount = 0;
    const now = new Date();

    for (const schema of schemas) {
      // Only import non-expired entries
      if (now <= schema.expiresAt) {
        const key = this.makeKey(schema.database, schema.tableName);
        const entry: CacheEntry = {
          schema,
          lastAccessed: now,
          accessCount: 0,
          needsRefresh: false
        };

        this.cache.set(key, entry);
        importedCount++;
      }
    }

    this.updateStats();
    this.logger.info('Cache data imported', { importedCount, totalSchemas: schemas.length });

    return importedCount;
  }

  // ==============================================
  // Private Methods
  // ==============================================

  /**
   * Create cache key from database and table name
   */
  private makeKey(database: string, tableName: string): CacheKey {
    return `${database}:${tableName}`;
  }

  /**
   * Parse cache key back to database and table name
   */
  private parseKey(key: CacheKey): { database: string; tableName: string } {
    const [database, tableName] = key.split(':', 2);
    return { database, tableName };
  }

  /**
   * Record cache hit
   */
  private recordHit(): void {
    this.stats.hits++;
    this.updateHitRate();
  }

  /**
   * Record cache miss
   */
  private recordMiss(): void {
    this.stats.misses++;
    this.updateHitRate();
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: CacheKey | null = null;
    let oldestTime = new Date();

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const { database, tableName } = this.parseKey(oldestKey);
      this.cache.delete(oldestKey);
      this.stats.evictions++;

      this.logger.debug('LRU cache entry evicted', {
        database,
        tableName,
        lastAccessed: oldestTime.toISOString()
      });
    }
  }

  /**
   * Update cache statistics
   */
  private updateStats(): void {
    this.stats.totalEntries = this.cache.size;
    this.stats.memoryUsage = this.estimateMemoryUsage();
    this.stats.averageAge = this.calculateAverageAge();
  }

  /**
   * Estimate memory usage of cache
   */
  private estimateMemoryUsage(): number {
    let totalSize = 0;

    for (const entry of this.cache.values()) {
      // Rough estimation of schema object size
      totalSize += JSON.stringify(entry.schema).length * 2; // Rough byte estimate
      totalSize += 200; // Overhead for entry metadata
    }

    return totalSize;
  }

  /**
   * Calculate average age of cache entries
   */
  private calculateAverageAge(): number {
    if (this.cache.size === 0) return 0;

    const now = new Date().getTime();
    let totalAge = 0;

    for (const entry of this.cache.values()) {
      totalAge += now - entry.schema.cachedAt.getTime();
    }

    return totalAge / this.cache.size;
  }

  /**
   * Start cleanup timer for expired entries
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.clearExpired();
    }, this.config.cleanupInterval);
  }
}

// ==============================================
// Utility Functions
// ==============================================

/**
 * Generate structure hash for change detection
 */
export function generateStructureHash(columns: CachedColumnInfo[], indexes: CachedIndexInfo[]): string {
  const structure = {
    columns: columns.map(c => ({ name: c.name, type: c.type, nullable: c.nullable })),
    indexes: indexes.map(i => ({ name: i.name, columns: i.columns, unique: i.unique }))
  };

  return hashString(JSON.stringify(structure));
}

/**
 * Simple string hash function
 */
function hashString(str: string): string {
  let hash = 0;
  if (str.length === 0) return hash.toString();

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash).toString(16);
}

// ==============================================
// Factory Functions
// ==============================================

/**
 * Create a schema cache with default configuration
 */
export function createSchemaCache(config?: Partial<SchemaCacheConfig>): SchemaCache {
  return new SchemaCache(config);
}

/**
 * Create a high-capacity cache for large deployments
 */
export function createHighCapacityCache(): SchemaCache {
  return new SchemaCache({
    defaultTTL: 600000, // 10 minutes
    maxEntries: 5000,
    cleanupInterval: 120000, // 2 minutes
    enableAutoRefresh: true,
    autoRefreshThreshold: 0.7
  });
}

/**
 * Create a fast cache for development/testing
 */
export function createFastCache(): SchemaCache {
  return new SchemaCache({
    defaultTTL: 60000, // 1 minute
    maxEntries: 100,
    cleanupInterval: 15000, // 15 seconds
    enableAutoRefresh: false
  });
}

// ==============================================
// Default Cache Instance
// ==============================================

/**
 * Default schema cache instance
 */
export const defaultSchemaCache = createSchemaCache();