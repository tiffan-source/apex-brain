/// <reference types='vitest' />
import { defineConfig } from 'vite';

/**
 * Un seul transformateur (Oxc, avec `emitDecoratorMetadata`) pour les tests et pour le build : ce que
 * Vitest vérifie est exactement ce qui tourne en production.
 */
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/api',
  resolve: { tsconfigPaths: true },
  build: {
    // Un bundle Node : le code de l'app et des libs est regroupé, les paquets npm restent externes.
    ssr: 'src/main.ts',
    outDir: '../../dist/apps/api',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    minify: false,
    rollupOptions: {
      output: { format: 'es' as const, entryFileNames: 'main.js' },
    },
  },
  test: {
    name: 'api',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    reporters: ['default'],
    passWithNoTests: true,
    coverage: {
      reportsDirectory: '../../coverage/apps/api',
      provider: 'v8' as const,
    },
  },
}));
