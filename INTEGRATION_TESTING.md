# Integration Testing Guide

This guide explains how to run integration tests for FreshGuard Core database connectors.

## Quick Start

```bash
# Start test databases
pnpm test:services:start

# Wait for services to be ready (or check logs)
pnpm test:services:logs

# Run integration tests only
pnpm test:integration

# Run full test suite (unit + integration)
pnpm test:full

# Stop test databases
pnpm test:services:stop
```

## Test Organization

### Unit Tests
- `tests/*.test.ts` (except `*.integration.test.ts`)
- Run without external dependencies
- Fast execution, always reliable
- Mocked database connections

### Integration Tests
- `tests/*.integration.test.ts`
- Require real database connections
- Test actual SQL execution and data handling
- Gracefully skip when databases unavailable

## Available Test Databases

| Service | Port | Database | User/Pass | Purpose |
|---------|------|----------|-----------|---------|
| PostgreSQL | 5433 | `freshguard_test` | `test`/`test` | Primary relational testing |

### Future Services (Commented in docker-compose.test.yml)
- MySQL 8.0 on port 3307
- Redis on port 6380

## Environment Variables

```bash
# Optional: Skip integration tests entirely
export TEST_SKIP_INTEGRATION=true

# Optional: Custom database URLs
export TEST_POSTGRES_URL="postgresql://test:test@localhost:5433/freshguard_test"
export TEST_MYSQL_URL="mysql://test:test@localhost:3307/freshguard_test"
```

## Test Patterns

### Graceful Degradation
```typescript
describe('PostgreSQL Integration', () => {
  let isConnected = false;

  beforeAll(async () => {
    try {
      const connector = new PostgreSQLConnector(config);
      await connector.testConnection();
      isConnected = true;
    } catch (error) {
      console.warn('PostgreSQL not available, skipping integration tests');
    }
  });

  it('should execute queries', { skip: !isConnected }, async () => {
    // Test only runs if connection succeeded
  });
});
```

### Test Data Setup
```typescript
beforeAll(async () => {
  if (isConnected) {
    await setupTestData();
  }
});

afterAll(async () => {
  if (isConnected) {
    await cleanupTestData();
  }
});
```

## Adding New Database Connectors

1. **Create Unit Tests**: `tests/connectors/your-db.test.ts`
   ```typescript
   // Test configuration validation
   // Test SQL injection prevention
   // Test error handling
   ```

2. **Create Integration Tests**: `tests/connectors/your-db.integration.test.ts`
   ```typescript
   // Test real connections
   // Test query execution
   // Test data types
   ```

3. **Add Docker Service**: Update `docker-compose.test.yml`
   ```yaml
   your_db_test:
     image: your-db:latest
     ports:
       - "5434:5432"
     environment:
       # Database setup
   ```

4. **Update Scripts**: Add to `package.json` if needed

## CI/CD Integration

### GitHub Actions
- Integration tests run automatically in CI
- PostgreSQL service container provided
- Tests skip gracefully if services fail

### Local Development
- Use `pnpm test:full` for complete validation
- Use `pnpm test:unit` for quick feedback
- Use `pnpm test:integration` when working on connectors

## Troubleshooting

### Database Connection Fails
```bash
# Check if containers are running
docker compose -f docker-compose.test.yml ps

# Check logs
pnpm test:services:logs

# Restart services
pnpm test:services:stop && pnpm test:services:start
```

### Port Conflicts
```bash
# Check what's using ports
lsof -i :5433
lsof -i :3307

# Kill conflicting processes or change ports in docker-compose.test.yml
```

### Memory Issues
```bash
# Increase Docker memory limits
# Or run fewer services simultaneously
```

### Test Data Persistence
- Test databases use tmpfs (in-memory) by default for speed
- Data is reset between test runs
- No cleanup needed

## Performance Tips

1. **Parallel Execution**: Vitest runs tests in parallel by default
2. **Service Warmup**: Allow 10 seconds for database startup
3. **Connection Pooling**: Reuse connections within test suites
4. **Selective Running**: Use `pnpm test:unit` during development

## Security Considerations

- Test databases run on non-standard ports to avoid conflicts
- No persistent data storage (tmpfs)
- Test credentials are non-production values
- SSL/TLS disabled for testing simplicity

## Examples

### Running Specific Tests
```bash
# Run only PostgreSQL tests
pnpm test -- postgres

# Run integration tests with coverage
pnpm test:integration --coverage

# Run in watch mode
pnpm test:integration --watch
```

### Debug Mode
```bash
# Show detailed logs
DEBUG=* pnpm test:integration

# Run single test file
pnpm test tests/connectors/postgres.integration.test.ts
```