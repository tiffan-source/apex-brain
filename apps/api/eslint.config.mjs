import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // Avec emitDecoratorMetadata, un type importé sans `import type` dans la signature d'une méthode
      // décorée devient une référence à une valeur qui n'existe pas (build Rolldown/Oxc : MISSING_EXPORT).
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports', disallowTypeAnnotations: false },
      ],
    },
  },
];
