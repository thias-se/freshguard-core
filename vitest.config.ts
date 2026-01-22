import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Increase timeout for integration tests with external services
    testTimeout: 30000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',
      ],
      // Thresholds disabled - coverage will run but not fail builds
      // thresholds: {
      //   lines: 40,      // Slightly below current 44.32% (prevent regression)
      //   functions: 4,   // Current level - enforce no regression
      //   branches: 50,   // Current level - maintain branch coverage
      //   statements: 40, // Slightly below current 44.32%
      // },
    },
    // Environment variables for integration tests
    env: {
      TEST_POSTGRES_URL: 'postgresql://test:test@localhost:5433/freshguard_test',
      TEST_SKIP_INTEGRATION: process.env.TEST_SKIP_INTEGRATION || 'false',
    },
    // Separate workspaces for different test types (if needed in the future)
    // workspace: 'vitest.workspace.ts',
  },
});
