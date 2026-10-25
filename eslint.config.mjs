import nx from '@nx/eslint-plugin';

/** Les SDK d'infrastructure et le framework HTTP : interdits au noyau, au domaine et au workflow. */
const infrastructureImports = [
  '@supabase/*',
  'firebase',
  'firebase/*',
  'firebase-admin',
  'firebase-admin/*',
  '@google/genai',
  '@nestjs/*',
  'express',
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/tmp', '**/vite.config.*.timestamp*', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.mts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              // Le noyau partagé (Result, CoreError, IdGenerator) ne dépend de rien.
              sourceTag: 'type:kernel',
              onlyDependOnLibsWithTags: ['type:kernel'],
              bannedExternalImports: infrastructureImports,
            },
            {
              // Un domaine ne connaît que le noyau : ni les autres domaines, ni l'IA, ni l'infrastructure.
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:kernel'],
              bannedExternalImports: infrastructureImports,
            },
            {
              // Un workflow compose des domaines, sans jamais toucher à leur infrastructure.
              sourceTag: 'type:workflow',
              onlyDependOnLibsWithTags: ['type:domain', 'type:kernel'],
              bannedExternalImports: infrastructureImports,
            },
            {
              // L'infrastructure implémente les ports du domaine et des workflows.
              sourceTag: 'type:infra',
              onlyDependOnLibsWithTags: ['type:domain', 'type:workflow', 'type:kernel'],
            },
            {
              // L'application est la racine de composition : elle seule assemble tout.
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:infra', 'type:workflow', 'type:domain', 'type:kernel'],
            },
          ],
        },
      ],
    },
  },
  {
    // Les doublures de test (`@org/<lib>/testing`) ne partent jamais en production.
    files: ['**/*.ts'],
    ignores: ['**/*.spec.ts', '**/src/testing.ts', '**/src/lib/testing/**', '**/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@org/*/testing'],
              message: 'Les doublures de test ne sont importées que par les tests.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
