import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'spikes/**',
    'format/**',
    'docs/**',
    '**/dist/**',
    'coverage/**',
    'packages/core/src/generated/**',
    'pnpm-lock.yaml',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
