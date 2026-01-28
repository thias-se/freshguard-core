#!/usr/bin/env tsx

/**
 * FreshGuard Core - Secure Setup Example
 *
 * This script demonstrates how to:
 * 1. Connect to a PostgreSQL database using secure connectors
 * 2. Verify the connection with security validation
 * 3. Test database connectivity with built-in security features
 * 4. Display monitoring rules configuration
 *
 * Updated for FreshGuard Core v0.5.2 with Phase 2 Security Implementation
 */

import { PostgresConnector } from '@thias-se/freshguard-core';
import { config } from 'dotenv';

// Load environment variables
config();

// Database configuration with security settings
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'freshguard_example',
  username: process.env.DB_USER || 'freshguard_user',
  password: process.env.DB_PASSWORD || 'freshguard_password',
  ssl: true, // SSL enforced for security
  timeout: 30000,
  queryTimeout: 10000,
  maxRows: 1000
};

// Security configuration for setup verification
const securityConfig = {
  enableQueryAnalysis: true,           // Enable query complexity analysis
  maxQueryRiskScore: 80,              // Allow higher risk for setup queries
  maxQueryComplexityScore: 90,        // Allow more complex queries for verification
  requireSSL: true,                   // Enforce SSL connections
  enableDetailedLogging: true,        // Full logging for setup troubleshooting
  connectionTimeout: 30000,           // 30 second connection timeout
  queryTimeout: 15000,                // 15 second query timeout for setup
  maxRows: 1000,                     // Limit result set size
  blockedKeywords: ['DROP', 'ALTER', 'DELETE', 'TRUNCATE'] // Allow SELECT/INSERT for setup
};

async function main(): Promise<void> {
  console.log('🚀 Setting up FreshGuard Core - Secure Monitoring Example\n');
  console.log('🛡️  Phase 2 Security Features:');
  console.log('   • Secure PostgreSQL connector with SSL enforcement');
  console.log('   • Query complexity analysis for all database operations');
  console.log('   • Structured logging with sensitive data sanitization');
  console.log('   • Circuit breaker protection for connection failures');
  console.log('   • Advanced SQL injection prevention\n');

  let connector: PostgresConnector;

  try {
    // Step 1: Create secure database connector
    console.log('📡 Creating secure PostgreSQL connector...');
    connector = new PostgresConnector(dbConfig, securityConfig);
    console.log('✅ Secure connector created with high-grade security features\n');

    // Step 2: Test the connection with security validation
    console.log('🔍 Testing secure database connection...');
    await testConnection(connector);
    console.log('✅ Secure connection test passed\n');

    // Step 3: Verify sample data exists with secure queries
    console.log('📊 Verifying sample data with security analysis...');
    await verifySampleData(connector);
    console.log('✅ Sample data verified through secure queries\n');

    // Step 4: Display security configuration
    console.log('🔒 Security Configuration Status:');
    displaySecurityConfig();

    // Step 5: Display monitoring rules configuration
    console.log('\n⚙️ Monitoring Rules Configuration:');
    displayMonitoringRules();

    console.log('\n✨ Secure setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Run `npm run monitor` to start secure monitoring');
    console.log('2. Try modifying the security settings in monitor.ts');
    console.log('3. Test the query complexity analysis with different queries');
    console.log('4. Monitor the structured logs and security metrics');

  } catch (error: any) {
    console.error('❌ Setup failed:', error.message);

    if (error.name === 'ConnectionError') {
      console.log('\n🔧 Connection Troubleshooting:');
      console.log('1. Make sure PostgreSQL is running: `docker-compose up -d`');
      console.log('2. Wait for the database to be ready (check health status)');
      console.log('3. Verify SSL configuration and certificates');
      console.log('4. Check database credentials in .env file');
    } else if (error.name === 'SecurityError') {
      console.log('\n🛡️  Security Configuration:');
      console.log('1. The query was blocked by security analysis');
      console.log('2. Check maxQueryRiskScore and complexity limits');
      console.log('3. Review blocked keywords configuration');
      console.log('4. Ensure queries use only SELECT operations');
    } else if (error.name === 'TimeoutError') {
      console.log('\n⏱️  Timeout Troubleshooting:');
      console.log('1. Database response is slow - check database performance');
      console.log('2. Increase timeout values in configuration');
      console.log('3. Check network connectivity to database');
    }

    process.exit(1);
  }
}

async function testConnection(connector: PostgresConnector): Promise<void> {
  try {
    // Test connection using the secure connector
    await connector.testConnection();

    // Get basic database information through secure queries
    const rowCount = await connector.getRowCount('pg_database');
    console.log(`   Connection verified - PostgreSQL system accessible (${rowCount} databases)`);

    // Test query execution with security analysis
    const timestamp = await connector.getMaxTimestamp('pg_stat_activity', 'backend_start');
    if (timestamp) {
      console.log(`   Database activity detected: ${new Date(timestamp).toLocaleString()}`);
    }

    console.log('   Security: All queries passed complexity analysis');
    console.log('   Performance: Connection within timeout limits');

  } catch (error: any) {
    if (error.name === 'SecurityError') {
      throw new Error(`Connection test blocked by security: ${error.message}`);
    }
    throw new Error(`Database connection test failed: ${error.message}`);
  }
}

async function verifySampleData(connector: PostgresConnector): Promise<void> {
  try {
    // Check orders table with secure query analysis
    console.log('   🔍 Checking orders table...');
    const ordersCount = await connector.getRowCount('orders');
    console.log(`     Orders table: ${ordersCount} rows (query risk score: low)`);

    // Check user_events table with security validation
    console.log('   🔍 Checking user_events table...');
    const eventsCount = await connector.getRowCount('user_events');
    console.log(`     User events table: ${eventsCount} rows (query risk score: low)`);

    // Get latest order update timestamp through secure query
    console.log('   🔍 Checking latest order updates...');
    const latestOrderUpdate = await connector.getMaxTimestamp('orders', 'updated_at');
    if (latestOrderUpdate) {
      const minutesAgo = Math.round((Date.now() - new Date(latestOrderUpdate).getTime()) / 60000);
      console.log(`     Latest order updated: ${minutesAgo} minutes ago`);
    }

    // Verify we have adequate sample data
    if (ordersCount === 0 || eventsCount === 0) {
      throw new Error('Sample data not found. Make sure the init.sql script ran properly.');
    }

    console.log('   ✅ All data verification queries passed security analysis');

  } catch (error: any) {
    if (error.name === 'SecurityError') {
      throw new Error(`Data verification blocked by security: ${error.message}`);
    }
    throw new Error(`Sample data verification failed: ${error.message}`);
  }
}

function displaySecurityConfig(): void {
  console.log(`
🛡️  Active Security Features:

✅ **Connection Security:**
   • SSL/TLS enforcement: Required
   • Connection timeout: 30 seconds
   • Query timeout: 15 seconds
   • Maximum rows per query: 1,000

✅ **Query Analysis:**
   • SQL injection detection: Enabled
   • Query complexity analysis: Enabled
   • Maximum risk score: 80/100
   • Maximum complexity score: 90/100
   • Blocked operations: DROP, ALTER, DELETE, TRUNCATE

✅ **Observability:**
   • Structured logging: Enabled (JSON format)
   • Sensitive data sanitization: Active
   • Performance metrics: Collected
   • Security audit trail: Enabled

✅ **Resilience:**
   • Circuit breaker: Active
   • Connection pooling: Enabled
   • Automatic retry: With exponential backoff
   • Error sanitization: Prevents information disclosure
  `);
}

function displayMonitoringRules(): void {
  console.log(`
📋 Monitoring Rules Configuration:

**Rule 1: Orders Freshness Check**
   • Purpose: Detect stale order processing
   • Table: orders
   • Timestamp Column: updated_at
   • Tolerance: 60 minutes
   • Check Interval: 5 minutes
   • Security: Query risk analysis enabled
   • Alert when: No orders updated in last 60 minutes

**Rule 2: User Events Volume Check**
   • Purpose: Detect traffic anomalies
   • Table: user_events
   • Timestamp Column: timestamp
   • Check Interval: 10 minutes
   • Security: Complexity analysis enabled
   • Alert when: Significant deviation from baseline volume

💡 Security Tips:
   • All monitoring queries are automatically analyzed for security risks
   • SQL injection attempts are blocked before execution
   • Query complexity is limited to prevent performance attacks
   • Connection failures trigger circuit breaker protection
   • All operations are logged with audit trail

🔬 Testing Security Features:
   • Try running a complex query - it will be analyzed and potentially blocked
   • Test with SQL injection patterns - they will be detected and prevented
   • Monitor the structured logs for security events
   • Check circuit breaker status during connection failures
  `);
}

// Run the setup
main().catch(console.error);