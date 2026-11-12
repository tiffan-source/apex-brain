import nx from '@nx/eslint-plugin';

/** Les SDK d'infrastructure et le framework HTTP : interdits au noyau, au domaine et au workflow. */
const infrastructureImports = [
  '@supabase/*',
  'firebase',
  'firebase/*',
  'firebase-admin',
  'firebase-admin/*',
  '@google/genai',
  '@anthropic-ai/sdk',
  '@anthropic-ai/sdk/*',
  '@nestjs/*',
  'express',
];

/** Les fichiers de test, seuls à pouvoir importer les doublures. */
const testFiles = ['**/*.spec.ts', '**/src/testing.ts', '**/src/lib/testing/**', '**/test/**'];

const testingImports = {
  group: ['@org/*/testing'],
  message: 'Les doublures de test ne sont importées que par les tests.',
};

const bffImports = {
  group: ['@org/*/bff'],
  message:
    "Les lectures BFF ne servent que les clients : seuls l'adaptateur qui les implémente et l'app les importent.",
};

const relativeBffImports = {
  group: ['**/bff', '**/bff/**'],
  message: 'Une commande (ou Akari) ne lit jamais une lecture BFF.',
};

/**
 * À ajouter à la configuration d'un projet qui implémente ou expose les lectures BFF (l'infrastructure,
 * l'app) : il peut importer `@org/<lib>/bff`, toujours pas les doublures de test.
 */
export const allowBffImports = {
  files: ['**/*.ts'],
  ignores: testFiles,
  rules: {
    'no-restricted-imports': ['error', { patterns: [testingImports] }],
  },
};

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
              // Un domaine ne connaît que le noyau : ni les autres domaines, ni l'identité (la personne,
              // ses rôles : il ne reçoit que l'id du propriétaire), ni l'IA, ni l'infrastructure.
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:kernel'],
              bannedExternalImports: infrastructureImports,
            },
            {
              // L'identité (user, auth) : qui est la personne, ses rôles, comment elle se connecte.
              // Invisible du métier et des workflows ; seules l'infrastructure et l'app la voient.
              sourceTag: 'type:identity',
              onlyDependOnLibsWithTags: ['type:identity', 'type:kernel'],
              bannedExternalImports: infrastructureImports,
            },
            {
              // Un workflow compose des domaines, sans jamais toucher à leur infrastructure.
              sourceTag: 'type:workflow',
              onlyDependOnLibsWithTags: ['type:domain', 'type:kernel'],
              bannedExternalImports: infrastructureImports,
            },
            {
              // L'infrastructure implémente les ports du domaine, de l'identité et des workflows.
              sourceTag: 'type:infra',
              onlyDependOnLibsWithTags: ['type:domain', 'type:identity', 'type:workflow', 'type:kernel'],
            },
            {
              // L'application est la racine de composition : elle seule assemble tout.
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:infra',
                'type:workflow',
                'type:domain',
                'type:identity',
                'type:kernel',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    // Les doublures de test (`@org/<lib>/testing`) ne partent jamais en production, et les lectures
    // BFF (`@org/<lib>/bff`) ne servent que les clients : seules l'infrastructure qui les implémente
    // et l'application qui les expose les importent (docs/adr/0006-commandes-et-bff.md).
    files: ['**/*.ts'],
    ignores: testFiles,
    rules: {
      'no-restricted-imports': ['error', { patterns: [testingImports, bffImports] }],
    },
  },
  {
    // Dans un domaine, le dossier `bff/` ne sert que ses propres fichiers : une commande, un modèle ou
    // la façade d'Akari ne lisent jamais une lecture BFF.
    files: ['**/src/lib/**/*.ts'],
    ignores: [...testFiles, '**/src/lib/bff/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [testingImports, bffImports, relativeBffImports] }],
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
