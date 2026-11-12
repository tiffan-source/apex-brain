/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/user',
  resolve: { tsconfigPaths: true },
  test: {
    name: 'user',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/libs/user',
      provider: 'v8' as const,
    },
  },
}));
