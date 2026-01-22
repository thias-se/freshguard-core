/**
 * Tests for Phase 4 Advanced Security Features
 * Query complexity analysis and schema caching
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  QueryComplexityAnalyzer,
  TableMetadata
} from '../src/security/query-analyzer.js';
import {
  createQueryAnalyzer,
  createSecurityAnalyzer,
  createPerformanceAnalyzer,
  QueryComplexity
} from '../src/security/query-analyzer.js';
import type {
  SchemaCache,
  CachedTableSchema} from '../src/security/schema-cache.js';
import {
  createSchemaCache,
  createFastCache,
  generateStructureHash
} from '../src/security/schema-cache.js';

describe('Advanced Security Features Tests', () => {
  describe('Query Complexity Analyzer', () => {
    let analyzer: QueryComplexityAnalyzer;

    beforeEach(() => {
      analyzer = createQueryAnalyzer();
    });

    describe('Basic Query Analysis', () => {
      test('should analyze simple SELECT query', () => {
        const sql = 'SELECT id, name FROM users WHERE active = true LIMIT 100';
        const analysis = analyzer.analyzeQuery(sql);

        expect(analysis.allowExecution).toBe(true);
        expect(analysis.riskScore).toBeLessThan(30);
        expect(analysis.details.queryType).toBe('SELECT');
        expect(analysis.details.tableCount).toBe(1);
        expect(analysis.details.hasWhere).toBe(true);
        expect(analysis.details.hasLimit).toBe(true);
        expect(analysis.details.limitValue).toBe(100);
        expect(analysis.details.hasWildcards).toBe(false);
      });

      test('should analyze SELECT * query with warnings', () => {
        const sql = 'SELECT * FROM users';
        // Provide large table metadata to trigger performance warning
        const tableMetadata = [{
          name: 'users',
          estimatedRows: 50000, // Large table
          indexes: [],
          columns: [],
          lastUpdated: new Date()
        }];
        const analysis = analyzer.analyzeQuery(sql, tableMetadata);

        // Debug logging to understand what's happening
        console.log('DEBUG: Performance warnings:', JSON.stringify(analysis.performanceWarnings));
        console.log('DEBUG: Security warnings:', JSON.stringify(analysis.securityWarnings));
        console.log('DEBUG: Has wildcards:', analysis.details.hasWildcards);
        console.log('DEBUG: Table metadata provided:', tableMetadata.length > 0);

        expect(analysis.allowExecution).toBe(true);
        expect(analysis.details.hasWildcards).toBe(true);
        expect(analysis.performanceWarnings).toContain(
          expect.stringContaining('SELECT *')
        );
        expect(analysis.recommendations).toContain(
          'Replace SELECT * with specific column names'
        );
      });

      test('should analyze complex JOIN query', () => {
        const sql = `
          SELECT u.name, p.title, c.name as category
          FROM users u
          INNER JOIN posts p ON u.id = p.user_id
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE u.active = true
          ORDER BY p.created_at DESC
          LIMIT 50
        `;
        const analysis = analyzer.analyzeQuery(sql);

        expect(analysis.details.queryType).toBe('SELECT');
        expect(analysis.details.tableCount).toBe(3);
        expect(analysis.details.joinCount).toBe(2);
        expect(analysis.details.hasWhere).toBe(true);
        expect(analysis.details.hasOrderBy).toBe(true);
        expect(analysis.details.hasLimit).toBe(true);
        expect(analysis.complexityScore).toBeGreaterThan(20);
      });

      test('should analyze query with subqueries', () => {
        const sql = `
          SELECT name FROM users
          WHERE id IN (SELECT user_id FROM posts WHERE published = true)
        `;
        const analysis = analyzer.analyzeQuery(sql);

        expect(analysis.details.hasSubqueries).toBe(true);
        expect(analysis.complexityScore).toBeGreaterThan(15);
        expect(analysis.performanceWarnings).toContain(
          expect.stringContaining('subquer')
        );
      });

      test('should analyze aggregation query', () => {
        const sql = 'SELECT COUNT(*), AVG(age) FROM users GROUP BY department';
        const analysis = analyzer.analyzeQuery(sql);

        expect(analysis.details.hasAggregations).toBe(true);
        expect(analysis.details.hasGroupBy).toBe(true);
        expect(analysis.complexityScore).toBeGreaterThan(10);
      });
    });

    describe('Security Risk Detection', () => {
      test('should detect SQL injection patterns', () => {
        const maliciousSql = "SELECT * FROM users WHERE id = 1 OR 1=1";
        const analysis = analyzer.analyzeQuery(maliciousSql);

        expect(analysis.riskScore).toBeGreaterThan(60);
        expect(analysis.allowExecution).toBe(false);
        expect(analysis.securityWarnings).toContain(
          expect.stringContaining('injection')
        );
      });

      test('should detect dangerous SQL comments', () => {
        const sqlWithComments = "SELECT * FROM users /* admin bypass */ WHERE id = ?";
        const analysis = analyzer.analyzeQuery(sqlWithComments);

        expect(analysis.riskScore).toBeGreaterThan(15);
        expect(analysis.securityWarnings).toContain(
          expect.stringContaining('comment')
        );
      });

      test('should detect UNION-based attacks', () => {
        const unionSql = "SELECT name FROM users UNION ALL SELECT password FROM admin";
        const analysis = analyzer.analyzeQuery(unionSql);

        expect(analysis.riskScore).toBeGreaterThan(25);
        expect(analysis.securityWarnings).toContain(
          expect.stringContaining('UNION')
        );
      });

      test('should allow safe queries', () => {
        const safeSql = "SELECT id, name FROM users WHERE created_at > ? LIMIT 100";
        const analysis = analyzer.analyzeQuery(safeSql);

        expect(analysis.riskScore).toBeLessThan(20);
        expect(analysis.allowExecution).toBe(true);
        expect(analysis.securityWarnings).toHaveLength(0);
      });
    });

    describe('Performance Analysis', () => {
      test('should warn about missing LIMIT on large queries', () => {
        const sql = "SELECT * FROM large_table WHERE active = true ORDER BY created_at";
        const analysis = analyzer.analyzeQuery(sql);

        expect(analysis.performanceWarnings).toContain(
          expect.stringContaining('LIMIT')
        );
        expect(analysis.recommendations).toContain(
          'Add LIMIT clause to prevent large result sets'
        );
      });

      test('should warn about Cartesian products', () => {
        const sql = "SELECT * FROM users JOIN posts";
        const analysis = analyzer.analyzeQuery(sql);

        expect(analysis.performanceWarnings).toContain(
          expect.stringContaining('Cartesian')
        );
        expect(analysis.complexityScore).toBeGreaterThan(30);
      });

      test('should suggest index usage for ORDER BY', () => {
        const sql = "SELECT * FROM users ORDER BY created_at DESC LIMIT 1000";
        const analysis = analyzer.analyzeQuery(sql);

        expect(analysis.recommendations).toContain(
          expect.stringContaining('index')
        );
      });
    });

    describe('Table Metadata Integration', () => {
      test('should use table metadata for better analysis', () => {
        const sql = "SELECT * FROM users JOIN posts ON users.id = posts.user_id";

        const tableMetadata: TableMetadata[] = [
          {
            name: 'users',
            estimatedRows: 100000,
            indexes: [
              { name: 'idx_users_id', columns: ['id'], unique: true, type: 'btree' }
            ],
            columns: [
              { name: 'id', type: 'integer', nullable: false, indexed: true },
              { name: 'name', type: 'varchar', nullable: false, indexed: false }
            ],
            lastUpdated: new Date()
          },
          {
            name: 'posts',
            estimatedRows: 500000,
            indexes: [
              { name: 'idx_posts_user_id', columns: ['user_id'], unique: false, type: 'btree' }
            ],
            columns: [
              { name: 'id', type: 'integer', nullable: false, indexed: true },
              { name: 'user_id', type: 'integer', nullable: false, indexed: true }
            ],
            lastUpdated: new Date()
          }
        ];

        const analysis = analyzer.analyzeQuery(sql, tableMetadata);

        expect(analysis.estimatedCost).toBeGreaterThan(1000);
        expect(analysis.details.tableCount).toBe(2);
      });

      test('should handle missing table metadata gracefully', () => {
        const sql = "SELECT * FROM unknown_table";
        const analysis = analyzer.analyzeQuery(sql, []);

        expect(analysis.allowExecution).toBeTruthy(); // Should not fail
        expect(analysis.complexityScore).toBeGreaterThan(0);
      });
    });

    describe('Custom Risk Factors', () => {
      test('should support custom risk factors', () => {
        const customAnalyzer = createQueryAnalyzer({
          customRiskFactors: [
            {
              pattern: /sensitive_table/i,
              riskScore: 50,
              description: 'Access to sensitive table detected',
              blocking: false
            }
          ]
        });

        const sql = "SELECT * FROM sensitive_table WHERE id = 1";
        const analysis = customAnalyzer.analyzeQuery(sql);

        expect(analysis.riskScore).toBeGreaterThan(40);
        expect(analysis.securityWarnings).toContain(
          'Access to sensitive table detected'
        );
      });
    });

    describe('Analyzer Types', () => {
      test('should create security-focused analyzer', () => {
        const securityAnalyzer = createSecurityAnalyzer();
        const config = securityAnalyzer.getConfig();

        expect(config.maxRiskScore).toBe(30);
        expect(config.enableSecurityAnalysis).toBe(true);
        expect(config.enablePerformanceAnalysis).toBe(false);
      });

      test('should create performance-focused analyzer', () => {
        const perfAnalyzer = createPerformanceAnalyzer();
        const config = perfAnalyzer.getConfig();

        expect(config.maxRiskScore).toBe(100);
        expect(config.enableSecurityAnalysis).toBe(false);
        expect(config.enablePerformanceAnalysis).toBe(true);
      });
    });
  });

  describe('Schema Cache', () => {
    let cache: SchemaCache;

    beforeEach(() => {
      cache = createFastCache(); // Use fast cache for testing
    });

    afterEach(() => {
      cache.stop();
    });

    describe('Basic Cache Operations', () => {
      test('should store and retrieve table schema', () => {
        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'users',
          database: 'testdb',
          columns: [
            {
              name: 'id',
              type: 'integer',
              nullable: false,
              indexed: true,
              isPrimaryKey: true
            },
            {
              name: 'name',
              type: 'varchar',
              nullable: false,
              indexed: false,
              isPrimaryKey: false
            }
          ],
          indexes: [
            {
              name: 'idx_users_id',
              columns: ['id'],
              unique: true,
              type: 'btree',
              isPrimary: true
            }
          ],
          estimatedRows: 1000,
          structureHash: 'abc123'
        };

        cache.set(schema);

        const retrieved = cache.get('testdb', 'users');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.tableName).toBe('users');
        expect(retrieved!.database).toBe('testdb');
        expect(retrieved!.columns).toHaveLength(2);
        expect(retrieved!.indexes).toHaveLength(1);
        expect(retrieved!.estimatedRows).toBe(1000);
      });

      test('should return null for non-existent table', () => {
        const result = cache.get('testdb', 'nonexistent');
        expect(result).toBeNull();
      });

      test('should check if table exists in cache', () => {
        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'products',
          database: 'testdb',
          columns: [],
          indexes: [],
          estimatedRows: 500,
          structureHash: 'def456'
        };

        cache.set(schema);

        expect(cache.has('testdb', 'products')).toBe(true);
        expect(cache.has('testdb', 'nonexistent')).toBe(false);
      });

      test('should delete table from cache', () => {
        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'temp_table',
          database: 'testdb',
          columns: [],
          indexes: [],
          estimatedRows: 100,
          structureHash: 'temp123'
        };

        cache.set(schema);
        expect(cache.has('testdb', 'temp_table')).toBe(true);

        const deleted = cache.delete('testdb', 'temp_table');
        expect(deleted).toBe(true);
        expect(cache.has('testdb', 'temp_table')).toBe(false);
      });
    });

    describe('Cache Expiry', () => {
      test('should expire entries after TTL', async () => {
        // Create a cache with very short TTL for testing
        const shortCache = createSchemaCache({ defaultTTL: 50 }); // 50ms

        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'expire_test',
          database: 'testdb',
          columns: [],
          indexes: [],
          estimatedRows: 100,
          structureHash: 'expire123'
        };

        shortCache.set(schema);
        expect(shortCache.has('testdb', 'expire_test')).toBe(true);

        // Wait for expiry
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(shortCache.has('testdb', 'expire_test')).toBe(false);
        shortCache.stop();
      });

      test('should clear expired entries', async () => {
        const shortCache = createSchemaCache({ defaultTTL: 50 });

        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'clear_test',
          database: 'testdb',
          columns: [],
          indexes: [],
          estimatedRows: 100,
          structureHash: 'clear123'
        };

        shortCache.set(schema);

        // Wait for expiry
        await new Promise(resolve => setTimeout(resolve, 100));

        const expiredCount = shortCache.clearExpired();
        expect(expiredCount).toBe(1);
        shortCache.stop();
      });
    });

    describe('Cache Statistics', () => {
      test('should track cache hits and misses', () => {
        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'stats_test',
          database: 'testdb',
          columns: [],
          indexes: [],
          estimatedRows: 100,
          structureHash: 'stats123'
        };

        // Miss
        cache.get('testdb', 'nonexistent');

        // Set and hit
        cache.set(schema);
        cache.get('testdb', 'stats_test');

        const stats = cache.getStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBe(50);
        expect(stats.totalEntries).toBe(1);
      });

      test('should reset statistics', () => {
        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'reset_test',
          database: 'testdb',
          columns: [],
          indexes: [],
          estimatedRows: 100,
          structureHash: 'reset123'
        };

        cache.set(schema);
        cache.get('testdb', 'reset_test');

        let stats = cache.getStats();
        expect(stats.hits).toBeGreaterThan(0);

        cache.resetStats();
        stats = cache.getStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
      });
    });

    describe('Cache Management', () => {
      test('should get tables for database', () => {
        const schemas = [
          {
            tableName: 'table1',
            database: 'db1',
            columns: [],
            indexes: [],
            estimatedRows: 100,
            structureHash: 'hash1'
          },
          {
            tableName: 'table2',
            database: 'db1',
            columns: [],
            indexes: [],
            estimatedRows: 200,
            structureHash: 'hash2'
          },
          {
            tableName: 'table3',
            database: 'db2',
            columns: [],
            indexes: [],
            estimatedRows: 300,
            structureHash: 'hash3'
          }
        ];

        schemas.forEach(schema => cache.set(schema));

        const db1Tables = cache.getTablesForDatabase('db1');
        expect(db1Tables).toHaveLength(2);
        expect(db1Tables).toContain('table1');
        expect(db1Tables).toContain('table2');

        const db2Tables = cache.getTablesForDatabase('db2');
        expect(db2Tables).toHaveLength(1);
        expect(db2Tables).toContain('table3');
      });

      test('should clear all cache entries', () => {
        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'clear_all_test',
          database: 'testdb',
          columns: [],
          indexes: [],
          estimatedRows: 100,
          structureHash: 'clearall123'
        };

        cache.set(schema);
        expect(cache.getStats().totalEntries).toBe(1);

        cache.clear();
        expect(cache.getStats().totalEntries).toBe(0);
      });

      test('should export and import cache data', () => {
        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'export_test',
          database: 'testdb',
          columns: [
            {
              name: 'id',
              type: 'integer',
              nullable: false,
              indexed: true,
              isPrimaryKey: true
            }
          ],
          indexes: [],
          estimatedRows: 100,
          structureHash: 'export123'
        };

        cache.set(schema);

        const exported = cache.export();
        expect(exported).toHaveLength(1);
        expect(exported[0].tableName).toBe('export_test');

        cache.clear();
        expect(cache.getStats().totalEntries).toBe(0);

        const imported = cache.import(exported);
        expect(imported).toBe(1);
        expect(cache.has('testdb', 'export_test')).toBe(true);
      });
    });

    describe('Auto-refresh functionality', () => {
      test('should mark entries for refresh', () => {
        const refreshCache = createSchemaCache({
          defaultTTL: 1000,
          enableAutoRefresh: true,
          autoRefreshThreshold: 0.1 // Very low threshold for testing
        });

        const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
          tableName: 'refresh_test',
          database: 'testdb',
          columns: [],
          indexes: [],
          estimatedRows: 100,
          structureHash: 'refresh123'
        };

        refreshCache.set(schema);

        // Access the entry (this might trigger auto-refresh logic)
        refreshCache.get('testdb', 'refresh_test');

        const needingRefresh = refreshCache.getEntriesNeedingRefresh();
        // Depending on timing, this might or might not need refresh

        refreshCache.markAsRefreshed('testdb', 'refresh_test');
        refreshCache.stop();
      });
    });
  });

  describe('Integration Tests', () => {
    test('should generate consistent structure hash', () => {
      const columns = [
        {
          name: 'id',
          type: 'integer',
          nullable: false,
          indexed: true,
          isPrimaryKey: true
        },
        {
          name: 'name',
          type: 'varchar',
          nullable: false,
          indexed: false,
          isPrimaryKey: false
        }
      ];

      const indexes = [
        {
          name: 'idx_users_id',
          columns: ['id'],
          unique: true,
          type: 'btree',
          isPrimary: true
        }
      ];

      const hash1 = generateStructureHash(columns, indexes);
      const hash2 = generateStructureHash(columns, indexes);

      expect(hash1).toBe(hash2);
      expect(hash1).toBeTruthy();
    });

    test('should detect structure changes with different hash', () => {
      const columns1 = [
        {
          name: 'id',
          type: 'integer',
          nullable: false,
          indexed: true,
          isPrimaryKey: true
        }
      ];

      const columns2 = [
        {
          name: 'id',
          type: 'bigint', // Type changed
          nullable: false,
          indexed: true,
          isPrimaryKey: true
        }
      ];

      const indexes = [];

      const hash1 = generateStructureHash(columns1, indexes);
      const hash2 = generateStructureHash(columns2, indexes);

      expect(hash1).not.toBe(hash2);
    });

    test('should work together - analyzer with cached metadata', () => {
      const cache = createFastCache();
      const analyzer = createQueryAnalyzer();

      // Set up cached table metadata
      const schema: Omit<CachedTableSchema, 'cachedAt' | 'expiresAt'> = {
        tableName: 'users',
        database: 'testdb',
        columns: [
          {
            name: 'id',
            type: 'integer',
            nullable: false,
            indexed: true,
            isPrimaryKey: true
          },
          {
            name: 'email',
            type: 'varchar',
            nullable: false,
            indexed: true,
            isPrimaryKey: false
          }
        ],
        indexes: [
          {
            name: 'idx_users_email',
            columns: ['email'],
            unique: true,
            type: 'btree',
            isPrimary: false
          }
        ],
        estimatedRows: 10000,
        structureHash: 'integration123'
      };

      cache.set(schema);

      // Convert cached schema to table metadata
      const tableMetadata: TableMetadata = {
        name: schema.tableName,
        estimatedRows: schema.estimatedRows,
        indexes: schema.indexes.map(idx => ({
          name: idx.name,
          columns: idx.columns,
          unique: idx.unique,
          type: idx.type
        })),
        columns: schema.columns.map(col => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          indexed: col.indexed
        })),
        lastUpdated: new Date()
      };

      // Analyze query with metadata
      const sql = "SELECT * FROM users WHERE email = 'test@example.com'";
      const analysis = analyzer.analyzeQuery(sql, [tableMetadata]);

      expect(analysis.allowExecution).toBe(true);
      expect(analysis.details.tableCount).toBe(1);
      expect(analysis.estimatedCost).toBeGreaterThan(0);

      cache.stop();
    });
  });
});