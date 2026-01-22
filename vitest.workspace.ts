import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Unit tests - fast, no external dependencies
  {
    test: {
      name: 'unit',
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/**/*.integration.test.ts'],
      environment: 'node',
      testTimeout: 10000,
      coverage: {
        provider: 'v8',
        reporter: ['text'],
        exclude: [
          'node_modules/',
          'dist/',
          'tests/',
          '**/*.d.ts',
          '**/*.config.*',
          '**/index.ts',
        ],
      },
    },
  },

  // Integration tests - slower, require external services
  {
    test: {
      name: 'integration',
      include: ['tests/**/*.integration.test.ts'],
      environment: 'node',
      testTimeout: 60000,  // Longer timeout for database operations
      hookTimeout: 30000,  // Time for database setup/teardown
      env: {
        TEST_POSTGRES_URL: 'postgresql://test:test@localhost:5433/freshguard_test',
        TEST_MYSQL_URL: 'mysql://test:test@localhost:3307/freshguard_test',
        TEST_SKIP_INTEGRATION: process.env.TEST_SKIP_INTEGRATION || 'false',
      },
      coverage: {
        provider: 'v8',
        reporter: ['text'],
      },
    },
  },

  // Security tests - focused on security validations
  {
    test: {
      name: 'security',
      include: ['tests/**/security*.test.ts'],
      environment: 'node',
      testTimeout: 30000,
      coverage: {
        provider: 'v8',
        reporter: ['text'],
      },
    },
  },
]);