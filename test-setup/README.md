# Test Setup Guide

This directory contains scripts and configurations for setting up integration test databases.

## Overview

FreshGuard Core integration tests require real databases with test data to verify:
- Database connector functionality
- Query execution with realistic data
- Freshness monitoring with recent timestamps
- Security validation with actual database operations

## Supported Databases

### PostgreSQL (Primary)
- **Setup**: Automatic via Docker Compose
- **Test Data**: Initialized automatically on container start
- **Port**: 5433 (non-standard to avoid conflicts)
- **Connection**: `postgresql://test:test@localhost:5433/freshguard_test`

### DuckDB (Secondary)
- **Setup**: Manual via setup script
- **Test Data**: Populated via Node.js script
- **File**: `/tmp/customer_test.duckdb`
- **Connection**: File-based database

## Quick Start

### 1. Start All Test Services
```bash
# Start PostgreSQL and setup DuckDB
pnpm test:db:setup:all

# Verify setup
pnpm test:integration:improved
```

### 2. Individual Setup

#### PostgreSQL Only
```bash
# Start PostgreSQL container with test data
pnpm test:services:start

# Wait for initialization (about 15 seconds)
sleep 15

# Run PostgreSQL tests
pnpm test:integration
```

#### DuckDB Only
```bash
# Create DuckDB test database
pnpm test:db:setup

# Run DuckDB tests (if bindings available)
TEST_SKIP_INTEGRATION=false pnpm test:integration:improved
```

## Test Data Schema

Both databases contain identical test data:

### Tables
- **customers** (5 records): Customer information with recent updates
- **orders** (8 records): Order data with timestamps in last 24 hours
- **products** (5 records): Product catalog with metadata
- **daily_summary** (3 records): Aggregated daily metrics
- **user_sessions** (5 records): Session data with recent activity

### Key Features
- **Recent Timestamps**: All `updated_at` fields within last 24-48 hours
- **Referential Integrity**: Orders reference customers and products
- **Realistic Data**: Names, emails, prices, and quantities are realistic
- **Volume Testing**: Sufficient rows for aggregation and counting tests

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEST_SKIP_INTEGRATION` | `false` | Skip all integration tests |
| `TEST_POSTGRES_URL` | Auto-generated | Override PostgreSQL connection |

## Troubleshooting

### PostgreSQL Issues

#### Connection Refused
```bash
# Check if containers are running
docker ps

# Check container logs
pnpm test:services:logs

# Restart services
pnpm test:services:stop
pnpm test:services:start
```

#### Missing Test Data
```bash
# Recreate containers (this will re-run init script)
pnpm test:services:stop
docker volume prune -f  # Remove any persistent volumes
pnpm test:services:start
```

### DuckDB Issues

#### Native Bindings Missing
```
Error: Cannot resolve module '@duckdb/node-api'
```

**Solution**: This is expected in some environments. DuckDB tests will skip gracefully.

#### Permission Denied
```
Error: permission denied, cannot create '/tmp/customer_test.duckdb'
```

**Solution**: Check `/tmp` directory permissions or set custom path:
```bash
export DUCKDB_TEST_PATH='/path/to/writable/directory/test.duckdb'
node test-setup/setup-duckdb.js
```

### CI/CD Environments

#### GitHub Actions
PostgreSQL tests run automatically with service containers. DuckDB may skip if native bindings aren't available.

#### Docker Environments
```bash
# Run integration tests in Docker
docker run --rm -v $(pwd):/app -w /app node:20 \
  bash -c "corepack enable pnpm && pnpm install && pnpm test:db:setup:all && pnpm test:integration:improved"
```

## File Structure

```
test-setup/
├── README.md                    # This file
├── init-postgres.sql           # PostgreSQL schema and test data
├── init-duckdb.sql            # DuckDB schema and test data
└── setup-duckdb.js            # DuckDB initialization script
```

## Database Schemas

### PostgreSQL (init-postgres.sql)
- Uses SERIAL primary keys
- TIMESTAMP with timezone support
- INET type for IP addresses
- Foreign key constraints
- Automatic indexes on updated_at columns

### DuckDB (init-duckdb.sql)
- Uses INTEGER primary keys
- TIMESTAMP support (no timezone)
- VARCHAR for IP addresses (no INET type)
- No foreign key constraints (DuckDB limitation)
- Manual INSERT OR IGNORE for upserts

## Security Testing

The test databases include data specifically designed for security validation:

- **SQL Injection Prevention**: Table names and data that could trigger vulnerabilities
- **Query Pattern Validation**: Complex queries to test allowlist patterns
- **Error Handling**: Invalid references to test sanitized error messages
- **Access Control**: Simulated production-like access patterns

## Performance Considerations

### PostgreSQL
- **tmpfs Storage**: Data stored in memory for faster tests
- **Single Connection**: Tests use single connection pool
- **Health Checks**: Container waits for PostgreSQL to be ready

### DuckDB
- **File-Based**: Persistent file storage (could use :memory: for speed)
- **Single-Threaded**: DuckDB handles concurrent access internally
- **Cleanup**: Manual file cleanup may be needed

## Integration with CI/CD

### Required Workflows

1. **Service Startup**: Start PostgreSQL container
2. **Health Checks**: Wait for database readiness
3. **Data Verification**: Confirm test data exists
4. **Test Execution**: Run integration test suite
5. **Cleanup**: Stop containers and clean volumes

### Example GitHub Actions

```yaml
services:
  postgres:
    image: postgres:15
    env:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: freshguard_test
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5

steps:
  - name: Setup databases
    run: |
      pnpm test:db:setup

  - name: Run integration tests
    run: |
      pnpm test:integration:improved
```

## Maintenance

### Adding New Test Data
1. Update `init-postgres.sql` and `init-duckdb.sql`
2. Ensure data is realistic and recent (< 24 hours)
3. Update `EXPECTED_TABLES` object in test files
4. Rebuild containers: `pnpm test:services:stop && pnpm test:services:start`

### Adding New Database Connectors
1. Create new init script in `test-setup/`
2. Add Docker service to `docker-compose.test.yml` (if applicable)
3. Add setup script to `package.json`
4. Update integration tests to include new connector

### Data Freshness
Test data includes recent timestamps to simulate production freshness monitoring:
- Orders updated within last hour
- Sessions active within last 30 minutes
- Daily summaries from today and yesterday

To maintain realistic test scenarios, consider running data refresh scripts periodically in long-running test environments.