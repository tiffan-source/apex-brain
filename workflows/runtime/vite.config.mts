/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/workflows/runtime',
  resolve: { tsconfigPaths: true },
  test: {
    name: 'workflow-runtime',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/workflows/runtime',
      provider: 'v8' as const,
    },
  },
}));
