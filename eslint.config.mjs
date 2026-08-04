import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * Three rules here are load bearing rather than stylistic.
 *
 *  1. The Anthropic SDK may be imported from exactly one file, lib/llm/client.ts.
 *     That file is where PHI_MODE and the BAA confirmation are checked before
 *     anything is transmitted. A second import path would be a way around the
 *     check, so it is a lint error.
 *  2. process.env may be read only in lib/env.ts and in build tooling. Every
 *     other read goes through the validated config object.
 *  3. console.* is banned outside the logger, which redacts before it writes.
 */
const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'drizzle/**',
      'playwright-report/**',
      'test-results/**',
      '.storage*/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message:
                'The model SDK may only be used from lib/llm/client.ts, which enforces ' +
                'the PHI mode and BAA checks before anything leaves the process.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read configuration from lib/env.ts, which validates it with Zod at startup.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The one file allowed to talk to Anthropic.
    files: ['lib/llm/client.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Configuration and build tooling that runs before the app exists.
    files: [
      'lib/env.ts',
      'lib/log/index.ts',
      // Reads NEXT_RUNTIME only, which webpack replaces with a literal per
      // bundle so that node-only code is eliminated from the edge bundle. That
      // is a build-time constant, not configuration.
      'instrumentation.ts',
      'drizzle.config.ts',
      'next.config.ts',
      'scripts/**/*.ts',
      // The migration runner is plain JavaScript so it can run in a production
      // container without the TypeScript loader, which is a dev dependency. It
      // cannot import lib/env.ts for the same reason.
      'scripts/**/*.mjs',
      'tests/**/*.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'e2e/**/*.ts',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['lib/log/index.ts'],
    rules: { 'no-console': 'off' },
  },
];

export default eslintConfig;
