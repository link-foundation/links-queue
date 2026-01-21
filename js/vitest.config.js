/**
 * Vitest configuration for coverage reporting.
 *
 * Note: Primary tests use test-anywhere for multi-runtime support (Node.js, Bun, Deno).
 * Vitest is used specifically for coverage reporting when running:
 *   npm run test:coverage
 *
 * For regular testing, use:
 *   npm test          (Node.js)
 *   bun test          (Bun)
 *   deno test         (Deno)
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use vitest globals for compatibility with test-anywhere style tests
    globals: true,

    // Test file patterns
    include: ['tests/**/*.test.js'],

    // Exclude benchmark files (they use different patterns)
    exclude: ['tests/**/*.benchmark.js', 'node_modules/**'],

    // Coverage configuration
    coverage: {
      // Use v8 provider for better performance
      provider: 'v8',

      // Enable coverage reporting
      enabled: true,

      // Coverage output directory
      reportsDirectory: './coverage',

      // Report formats
      reporter: ['text', 'text-summary', 'html', 'lcov', 'json'],

      // Source files to include in coverage
      include: ['src/**/*.js'],

      // Exclude from coverage
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.js',
        'node_modules/**',
        'tests/**',
        'scripts/**',
      ],

      // Coverage thresholds (targets from issue #23)
      // Setting to 0 initially, can be increased as coverage improves
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },

      // Clean coverage results before running
      clean: true,

      // Skip files with no tests
      skipFull: false,
    },

    // Test environment
    environment: 'node',

    // Reporter configuration
    reporters: ['verbose'],

    // Pool configuration for parallel test execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },

    // Timeout for individual tests
    testTimeout: 30000,

    // Hook timeout
    hookTimeout: 30000,
  },
});
