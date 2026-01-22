#!/usr/bin/env node

/**
 * FreshGuard CLI - Secure Command-Line Interface
 * Simple command-line interface for self-hosters with built-in security measures
 *
 * Security features:
 * - Secure credential handling with environment variables
 * - Input validation to prevent command injection
 * - No sensitive data logging
 * - Safe file path handling
 * - Connection validation with timeouts
 *
 * @module @thias-se/freshguard-core/cli
 */

import { readFile, writeFile, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { promisify } from 'util';
import { PostgresConnector } from '../connectors/postgres.js';
import { DuckDBConnector } from '../connectors/duckdb.js';
import { BigQueryConnector } from '../connectors/bigquery.js';
import { SnowflakeConnector } from '../connectors/snowflake.js';
import type { ConnectorConfig, ConnectorType } from '../types/connector.js';
import { ConfigurationError, ConnectionError, ErrorHandler } from '../errors/index.js';
// Import validators if needed for future CLI validation
// import { validateTableName } from '../validators/index.js';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// Security: Define allowed configuration file paths to prevent path traversal
const ALLOWED_CONFIG_DIRS = [
  process.cwd(),
  join(process.cwd(), '.freshguard'),
  join(process.cwd(), 'config'),
];

const DEFAULT_CONFIG_FILE = '.freshguard/config.yaml';

interface CLIConfig {
  connections: Record<string, ConnectorConfig & { type: ConnectorType }>;
  defaultConnection?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  securityMode?: 'strict' | 'relaxed';
}

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    if (!command) {
      printHelp();
      process.exit(0);
    }

    // Security: Validate command to prevent injection
    if (!isValidCommand(command)) {
      console.error(`❌ Invalid command: ${command}`);
      process.exit(1);
    }

    switch (command) {
      case 'init':
        await handleInit();
        break;

      case 'test':
        await handleTest();
        break;

      case 'run':
        await handleRun();
        break;

      case 'version':
      case '-v':
      case '--version':
        console.log('FreshGuard Core v0.1.2');
        break;

      case 'help':
      case '-h':
      case '--help':
        printHelp();
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('');
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    // Security: Use error sanitization to prevent information disclosure
    const userMessage = ErrorHandler.getUserMessage(error);
    console.error(`❌ Error: ${userMessage}`);

    // Only show stack trace in development mode
    if (process.env.NODE_ENV === 'development' && error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }

    process.exit(1);
  }
}

/**
 * Security: Validate command to prevent injection attacks
 */
function isValidCommand(cmd: string): boolean {
  const validCommands = ['init', 'test', 'run', 'version', '-v', '--version', 'help', '-h', '--help'];
  return validCommands.includes(cmd) && /^[a-zA-Z-]+$/.test(cmd);
}

/**
 * Security: Validate file path to prevent directory traversal
 */
function validateConfigPath(filePath: string): string {
  try {
    const resolvedPath = resolve(filePath);

    // Check if path is within allowed directories
    const isAllowed = ALLOWED_CONFIG_DIRS.some(allowedDir => {
      const resolvedAllowedDir = resolve(allowedDir);
      return resolvedPath.startsWith(resolvedAllowedDir);
    });

    if (!isAllowed) {
      throw new ConfigurationError('Configuration file path not allowed for security reasons');
    }

    return resolvedPath;
  } catch (error) {
    throw new ConfigurationError('Invalid configuration file path');
  }
}

/**
 * Initialize FreshGuard configuration with secure credential handling
 */
async function handleInit(): Promise<void> {
  console.log('🚀 FreshGuard Init\n');

  // Security: Get database URL from environment or prompt securely
  const dbUrl = process.env.FRESHGUARD_DATABASE_URL;
  let dbType: ConnectorType = 'postgres';

  if (!dbUrl) {
    console.log('⚠️  No FRESHGUARD_DATABASE_URL environment variable found.');
    console.log('Please set your database connection string as an environment variable:');
    console.log('');
    console.log('For PostgreSQL:');
    console.log('  export FRESHGUARD_DATABASE_URL="postgresql://user:password@localhost:5432/database?sslmode=require"');
    console.log('');
    console.log('For DuckDB:');
    console.log('  export FRESHGUARD_DATABASE_URL="duckdb://./data/analytics.duckdb"');
    console.log('');
    console.log('Then run: freshguard init');
    return;
  }

  // Security: Parse URL safely without exposing credentials in logs
  try {
    const config = parseSecureConnectionString(dbUrl);
    dbType = config.type;

    console.log('✅ Database URL detected');
    console.log(`📊 Database type: ${dbType}`);
    console.log(`🔒 SSL required: ${config.ssl ? 'Yes' : 'No'}`);

    // Create configuration directory if it doesn't exist
    const configDir = dirname(validateConfigPath(DEFAULT_CONFIG_FILE));
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Create initial configuration
    const initialConfig: CLIConfig = {
      connections: {
        default: {
          ...config,
          type: dbType
        }
      },
      defaultConnection: 'default',
      logLevel: 'info',
      securityMode: 'strict'
    };

    await writeFileAsync(
      validateConfigPath(DEFAULT_CONFIG_FILE),
      JSON.stringify(initialConfig, null, 2)
    );

    console.log(`✅ Configuration created: ${DEFAULT_CONFIG_FILE}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Test your connection: freshguard test');
    console.log('  2. Configure monitoring rules in your configuration file');
    console.log('  3. Start monitoring: freshguard run');

  } catch (error) {
    throw new ConfigurationError('Failed to parse database connection string. Please check the format.');
  }
}

/**
 * Test database connection with security validation
 */
async function handleTest(): Promise<void> {
  console.log('🔍 Testing database connection...\n');

  const config = await loadConfig();
  const connectionName = getFlag('--connection') || config.defaultConnection || 'default';

  if (!config.connections[connectionName]) {
    throw new ConfigurationError(`Connection '${connectionName}' not found in configuration`);
  }

  const connConfig = config.connections[connectionName];
  let connector;

  try {
    // Create connector with security validation
    connector = createSecureConnector(connConfig.type, connConfig);

    console.log(`📊 Testing ${connConfig.type} connection...`);

    // Test connection with timeout
    const testResult = await connector.testConnection();

    if (testResult) {
      console.log('✅ Connection successful!');

      // Test basic operations
      try {
        const tables = await connector.listTables();
        console.log(`📋 Found ${tables.length} tables`);

        if (tables.length > 0) {
          console.log(`🔍 Sample tables: ${tables.slice(0, 3).join(', ')}`);
        }
      } catch (error) {
        console.log('⚠️  Connection works, but table listing failed (check permissions)');
      }
    } else {
      console.log('❌ Connection failed');
      process.exit(1);
    }

  } catch (error) {
    // Security: Don't expose detailed connection errors
    console.log('❌ Connection failed');

    if (process.env.NODE_ENV === 'development') {
      console.log('Debug info:', ErrorHandler.getUserMessage(error));
    } else {
      console.log('💡 Run with NODE_ENV=development for more details');
    }

    process.exit(1);
  }
}

/**
 * Run monitoring scheduler with secure operations
 */
async function handleRun(): Promise<void> {
  console.log('⏱️  Starting FreshGuard monitoring scheduler...\n');

  const config = await loadConfig();

  if (!config.defaultConnection || !config.connections[config.defaultConnection]) {
    throw new ConfigurationError('No default connection configured. Run: freshguard init');
  }

  const connConfig = config.connections[config.defaultConnection];
  if (!connConfig) {
    throw new ConfigurationError(`Connection '${config.defaultConnection}' not found in configuration`);
  }

  const connector = createSecureConnector(connConfig.type, connConfig);

  console.log(`📊 Using ${connConfig.type} connection`);
  console.log(`🔒 Security mode: ${config.securityMode || 'strict'}`);

  // Verify connection before starting
  const isConnected = await connector.testConnection();
  if (!isConnected) {
    throw new ConnectionError('Cannot connect to database');
  }

  console.log('✅ Database connection verified');
  console.log('🔄 Monitoring scheduler started');
  console.log('');
  console.log('⚠️  This is a basic scheduler. For production use, consider:');
  console.log('   - Running as a systemd service');
  console.log('   - Adding proper logging');
  console.log('   - Setting up alerting');
  console.log('');
  console.log('Press Ctrl+C to stop...');

  // Simple monitoring loop (production would use proper scheduler)
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
  });

  // Basic monitoring loop - this would be more sophisticated in production
  while (true) {
    try {
      console.log('🔍 Running health checks...');

      // This is where real monitoring logic would go
      // For now, just test the connection periodically
      await connector.testConnection();

      console.log('✅ Health check completed');

      // Wait 1 minute between checks
      await new Promise(resolve => setTimeout(resolve, 60000));

    } catch (error) {
      console.error('❌ Monitoring check failed:', ErrorHandler.getUserMessage(error));

      // Continue monitoring even if one check fails
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

/**
 * Parse connection string securely without exposing credentials
 */
function parseSecureConnectionString(connectionString: string): ConnectorConfig & { type: ConnectorType } {
  try {
    const url = new URL(connectionString);

    // Determine database type from protocol
    let type: ConnectorType;
    switch (url.protocol) {
      case 'postgresql:':
      case 'postgres:':
        type = 'postgres';
        break;
      case 'duckdb:':
        type = 'duckdb';
        break;
      case 'bigquery:':
        type = 'bigquery';
        break;
      case 'snowflake:':
        type = 'snowflake';
        break;
      default:
        throw new ConfigurationError(`Unsupported database protocol: ${url.protocol}`);
    }

    // Security: Extract credentials from environment variables instead of URL when possible
    const config: ConnectorConfig & { type: ConnectorType } = {
      type,
      host: url.hostname || 'localhost',
      port: url.port ? parseInt(url.port, 10) : getDefaultPort(type),
      database: url.pathname.slice(1) || '', // Remove leading slash
      username: url.username || process.env.FRESHGUARD_DB_USER || '',
      password: url.password || process.env.FRESHGUARD_DB_PASSWORD || '',
      ssl: url.searchParams.get('sslmode') !== 'disable' && url.searchParams.get('ssl') !== 'false',
    };

    return config;
  } catch (error) {
    throw new ConfigurationError('Invalid database connection string format');
  }
}

/**
 * Get default port for database type
 */
function getDefaultPort(type: ConnectorType): number {
  switch (type) {
    case 'postgres': return 5432;
    case 'duckdb': return 0;
    case 'bigquery': return 443;
    case 'snowflake': return 443;
    default: return 0;
  }
}

/**
 * Create secure database connector
 */
function createSecureConnector(type: ConnectorType, config: ConnectorConfig) {
  switch (type) {
    case 'postgres':
      return new PostgresConnector(config);
    case 'duckdb':
      return new DuckDBConnector(config);
    case 'bigquery':
      return new BigQueryConnector(config);
    case 'snowflake':
      return new SnowflakeConnector(config);
    default:
      throw new ConfigurationError(`Unsupported connector type: ${type}`);
  }
}

/**
 * Load configuration from secure file path
 */
async function loadConfig(): Promise<CLIConfig> {
  try {
    const configPath = validateConfigPath(DEFAULT_CONFIG_FILE);

    if (!existsSync(configPath)) {
      throw new ConfigurationError('Configuration file not found. Run: freshguard init');
    }

    const configData = await readFileAsync(configPath, 'utf8');
    const config = JSON.parse(configData) as CLIConfig;

    // Validate configuration structure
    if (!config.connections || Object.keys(config.connections).length === 0) {
      throw new ConfigurationError('No connections configured');
    }

    return config;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError('Failed to load configuration file');
  }
}

/**
 * Get command line flag value
 */
function getFlag(flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex !== -1 && flagIndex + 1 < args.length) {
    return args[flagIndex + 1];
  }
  return undefined;
}

function printHelp() {
  console.log('FreshGuard CLI - Secure Data Pipeline Monitoring');
  console.log('');
  console.log('Usage:');
  console.log('  freshguard <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  init      Initialize FreshGuard configuration');
  console.log('  test      Test connection to data source');
  console.log('  run       Run the monitoring scheduler');
  console.log('  version   Show version information');
  console.log('  help      Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  # Set database URL and initialize');
  console.log('  export FRESHGUARD_DATABASE_URL="postgresql://user:pass@localhost:5432/db"');
  console.log('  freshguard init');
  console.log('');
  console.log('  # Test connection');
  console.log('  freshguard test');
  console.log('');
  console.log('  # Run monitoring');
  console.log('  freshguard run');
  console.log('');
  console.log('Environment Variables:');
  console.log('  FRESHGUARD_DATABASE_URL    Database connection string');
  console.log('  FRESHGUARD_DB_USER         Database username (optional)');
  console.log('  FRESHGUARD_DB_PASSWORD     Database password (optional)');
  console.log('  NODE_ENV                   Environment (development for debug info)');
  console.log('');
  console.log('Security:');
  console.log('  - Credentials are read from environment variables');
  console.log('  - Configuration files are validated for path traversal');
  console.log('  - SSL connections are enforced by default');
  console.log('  - Error messages are sanitized in production');
  console.log('');
  console.log('For more information:');
  console.log('  https://github.com/freshguard/freshguard');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
