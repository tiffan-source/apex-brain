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
    // Deux points d'entrée sur le même code : `main.js` écoute sur un port (serveur Node,
    // développement), `serverless.js` est la fonction Vercel (ADR 0009).
    ssr: true,
    outDir: '../../dist/apps/api',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: { main: 'src/main.ts', serverless: 'src/serverless.ts' },
      output: {
        format: 'es' as const,
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
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
