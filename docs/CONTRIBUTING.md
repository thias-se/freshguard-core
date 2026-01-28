# Contributing to FreshGuard Core

Thank you for your interest in contributing to FreshGuard Core! This document provides guidelines for contributing to the open-source core of FreshGuard.

## 🎯 What We're Building

FreshGuard Core is an open-source MIT-licensed data pipeline freshness monitoring engine for **self-hosted installations**. This is NOT the multi-tenant SaaS version.

### ✅ What Belongs in Core

- Database connectors (PostgreSQL, DuckDB, BigQuery, Snowflake, etc.)
- Monitoring algorithms (freshness, volume anomaly detection, schema changes)
- Alerting logic (when to alert, message formatting)
- Query execution engines
- CLI tools for self-hosters
- Single-tenant database schema
- Documentation and examples

### ❌ What Does NOT Belong in Core

- Multi-tenant features
- User authentication/authorization
- Team/workspace management
- Dashboard UI components
- Billing logic
- Usage tracking for SaaS

> **Important:** If you're unsure whether a feature belongs in core, ask in an issue first!

## 🚀 Getting Started

### Prerequisites

- Node.js 20+ and pnpm 10+
- PostgreSQL 12+ (for testing)
- Git

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/thias-se/freshguard-core.git
cd freshguard-core

# Install dependencies
pnpm install

# Build the package
pnpm build

# Run tests to verify setup
pnpm test
```

### Understanding the Codebase

```
freshguard-core/
├── src/                     # Core source code
│   ├── connectors/          # Database drivers
│   │   ├── postgres.ts      # PostgreSQL connector
│   │   ├── duckdb.ts        # DuckDB connector
│   │   ├── bigquery.ts      # BigQuery connector
│   │   ├── snowflake.ts     # Snowflake connector
│   │   ├── mysql.ts         # MySQL connector
│   │   ├── redshift.ts      # Redshift connector
│   │   └── index.ts         # Exports
│   ├── monitor/             # Core algorithms
│   │   ├── freshness.ts     # Freshness checking
│   │   ├── volume.ts        # Volume anomaly detection
│   │   ├── schema-changes.ts # Schema monitoring
│   │   └── index.ts         # Exports
│   ├── metadata/            # Metadata storage
│   ├── db/                  # Database schema and migrations
│   ├── cli/                 # CLI tool
│   ├── errors/              # Error handling
│   ├── security/            # Security utilities
│   ├── types.ts             # Type definitions
│   └── index.ts             # Public API
├── tests/                   # Test files
├── docs/                    # Documentation
├── dist/                    # Build output
└── .github/workflows/       # CI/CD pipelines
```

## 🔧 Development Workflow

### Before Making Changes

1. **Check if the feature fits**: Review the "What Belongs in Core" section above
2. **Search existing issues**: Check if someone is already working on it
3. **Create an issue**: Describe what you want to build (for features)
4. **Get feedback**: Wait for maintainer guidance before starting

### Making Changes

1. **Fork and branch**: Create a feature branch from `main`
   ```bash
   git checkout -b feature/add-snowflake-connector
   ```

2. **Follow code standards**:
   - Use TypeScript strict mode
   - Add JSDoc comments to public functions
   - Use descriptive variable names
   - Keep functions small and focused

3. **Add tests**: All new functionality must include tests
   ```bash
   pnpm test
   ```

4. **Check types**: Ensure no TypeScript errors
   ```bash
   pnpm type-check
   ```

5. **Test coverage**: Meet minimum thresholds
   ```bash
   pnpm test:coverage
   ```

### Code Quality Requirements

Before submitting a PR, ensure:

- ✅ **Tests pass**: `pnpm test`
- ✅ **Types check**: `pnpm type-check`
- ✅ **Builds successfully**: `pnpm build`
- ✅ **Test coverage**: Run coverage to ensure tests are comprehensive
  - Coverage thresholds are not currently enforced but we aim for good coverage
  - Focus on testing critical functionality and error paths

```bash
# Run all checks
pnpm pre-commit

# Or run individually
pnpm build && pnpm type-check && pnpm test:coverage
```

## 📝 Adding New Features

### Adding a Database Connector

Example: Adding a new connector

1. **Create connector file**: `src/connectors/new-connector.ts`
2. **Implement interface**:
   ```typescript
   interface DatabaseConnector {
     testConnection(): Promise<void>;
     listTables(): Promise<string[]>;
     executeQuery(sql: string): Promise<any>;
   }
   ```
3. **Add tests**: `tests/connectors/new-connector.test.ts`
4. **Export**: Add to `src/connectors/index.ts`
5. **Update README**: Add example usage
6. **Integration test**: Test with real database instance

### Adding a Monitoring Algorithm

Example: Adding latency detection

1. **Create algorithm**: `src/monitor/latency.ts`
2. **Export function**: `export async function checkLatency(config) { }`
3. **Add tests**: `tests/monitor/latency.test.ts`
4. **Add to public API**: `src/index.ts`
5. **Document**: Update README with examples

### Updating Types

If adding new types to `src/types.ts`:

1. **Single-tenant only**: No `workspaceId` or multi-tenant features
2. **Backwards compatible**: Don't break existing interfaces
3. **Well-documented**: Add JSDoc comments
4. **Export properly**: Ensure types are exported from main package

## 🧪 Testing Guidelines

### Test Structure

```typescript
// tests/monitor/freshness.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { checkFreshness } from '../src/monitor/freshness.js';

describe('checkFreshness', () => {
  beforeEach(async () => {
    // Setup test database
  });

  it('should detect fresh data', async () => {
    // Test implementation
  });

  it('should alert on stale data', async () => {
    // Test implementation
  });
});
```

### Test Requirements

- **Unit tests**: All algorithms and utilities
- **Integration tests**: Database connectors with real databases
- **Error handling**: Test failure cases
- **Edge cases**: Empty tables, invalid configs, network issues

### Running Tests

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Watch mode during development
pnpm test -- --watch

# Run specific test file
pnpm test -- freshness.test.ts

# Run unit tests only
pnpm test:unit

# Run integration tests only
pnpm test:integration
```

## 📋 Pull Request Process

### Before Submitting

1. **Rebase on main**: Ensure your branch is up-to-date
2. **Run all checks**: Tests, types, build, coverage
3. **Update docs**: If adding features, update relevant documentation
4. **Self-review**: Read through your changes carefully

### PR Description Template

```markdown
## Description
Brief description of what this PR does.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Coverage thresholds met
- [ ] No TypeScript errors
- [ ] Follows single-tenant principles

## Testing
Describe how you tested this change.
```

### Review Process

1. **Automated checks**: GitHub Actions will run tests
2. **Maintainer review**: A maintainer will review the code
3. **Feedback**: Address any requested changes
4. **Approval**: Once approved, the PR will be merged

## 🔒 Security & Compliance

### Open Core Principles

- **Everything is open source**: No proprietary code in core packages
- **MIT licensed**: All contributions become MIT licensed
- **Single-tenant focused**: No multi-tenant features
- **Self-hostable**: Must work without external services

### Security Considerations

- **No secrets in code**: Use environment variables
- **Validate inputs**: Sanitize user inputs to prevent injection
- **Least privilege**: Database connections should use minimal permissions
- **Dependency security**: Keep dependencies updated

## 📚 Documentation

### Code Documentation

- **JSDoc comments**: All public functions need documentation
- **Type annotations**: Use TypeScript types extensively
- **README examples**: Update package READMEs when adding features

### User Documentation

- **Self-hosting guide**: Update `docs/SELF_HOSTING.md` if needed
- **Configuration examples**: Provide realistic usage examples
- **Migration guides**: For breaking changes

## 🚢 Release Process

### Version Management

- **Semantic versioning**: We follow semver (MAJOR.MINOR.PATCH)
- **Breaking changes**: Require major version bump
- **New features**: Minor version bump
- **Bug fixes**: Patch version bump

### Publishing

1. **Update version**: In `package.json`
2. **Update CHANGELOG**: Document changes
3. **Tag release**: `git tag v1.2.3`
4. **Push tag**: `git push origin v1.2.3`
5. **Automated publish**: GitHub Actions publishes to npm

## ❓ Getting Help

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Questions and general discussion
- **Documentation**: Check `docs/` folder first

### Issue Templates

- **Bug Report**: Use the bug report template
- **Feature Request**: Use the feature request template
- **Question**: Use GitHub Discussions

## 🎉 Recognition

Contributors are recognized in:
- Git commit history
- Release notes
- Project README
- Annual contributor lists

Thank you for contributing to FreshGuard Core! 🚀