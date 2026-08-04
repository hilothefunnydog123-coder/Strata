import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // The integration suites share one PostgreSQL database and each one owns
    // the corpus tables while it runs, so two files in parallel truncate each
    // other's rows and fail in ways that look like pipeline bugs. Running files
    // one at a time costs about two seconds across the whole suite, which is
    // cheaper than a test that fails only when it loses a race.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
