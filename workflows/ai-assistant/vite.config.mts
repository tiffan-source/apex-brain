/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/workflows/ai-assistant',
  resolve: { tsconfigPaths: true },
  test: {
    name: 'ai-assistant',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/workflows/ai-assistant',
      provider: 'v8' as const,
    },
  },
}));
