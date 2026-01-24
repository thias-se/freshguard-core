/**
 * Factory for creating metadata storage instances
 */

import type { MetadataStorage } from './interface.js';
import type { MetadataStorageConfig } from './types.js';
import { DuckDBMetadataStorage } from './duckdb-storage.js';
import { PostgreSQLMetadataStorage } from './postgresql-storage.js';

/**
 * Create metadata storage with auto-detection or explicit config
 */
export async function createMetadataStorage(
  config?: MetadataStorageConfig
): Promise<MetadataStorage> {
  let storage: MetadataStorage;

  if (!config) {
    // Default to DuckDB for simplicity
    storage = new DuckDBMetadataStorage();
  } else if (config.type === 'duckdb') {
    storage = new DuckDBMetadataStorage(config.path);
  } else if (config.type === 'postgresql') {
    if (!config.url) {
      throw new Error('PostgreSQL URL is required');
    }
    storage = new PostgreSQLMetadataStorage(config.url);
  } else {
    throw new Error(`Unknown storage type: ${(config as any).type}`);
  }

  await storage.initialize();
  return storage;
}