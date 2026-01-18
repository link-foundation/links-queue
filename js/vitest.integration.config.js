/**
 * Vitest configuration for integration tests.
 *
 * Integration tests verify component interactions and end-to-end flows.
 * They may use real backends and test client-server communication.
 *
 * Usage:
 *   npm run test:integration
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use vitest globals
    globals: true,

    // Integration test file patterns
    include: ['tests/integration/**/*.test.js'],

    // Exclude unit tests and benchmarks
    exclude: ['tests/*.test.js', 'tests/**/*.benchmark.js', 'node_modules/**'],

    // Coverage configuration for integration tests
    coverage: {
      provider: 'v8',
      enabled: true,
      reportsDirectory: './coverage/integration',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.d.ts', 'node_modules/**', 'tests/**', 'scripts/**'],
    },

    // Test environment
    environment: 'node',

    // Reporter configuration
    reporters: ['verbose'],

    // Longer timeouts for integration tests
    testTimeout: 60000,
    hookTimeout: 60000,

    // Run integration tests sequentially to avoid port conflicts
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },

    // Setup files for integration tests
    setupFiles: ['./tests/integration/setup.js'],

    // Retry failed tests once (network flakiness)
    retry: 1,
  },
});
