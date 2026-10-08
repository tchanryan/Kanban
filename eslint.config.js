import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-desktop/**',
      'native/**/gen/**',
      'node_modules/**',
      '.next/**',
      'playwright-report/**',
      'test-results/**',
      'spikes/**/gen/**',
      'spikes/**/target/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: { ...hooks.configs.recommended.rules },
  },
  {
    files: [
      'src/contracts/**/*.ts',
      'src/domain/**/*.ts',
      'src/features/**/*.{ts,tsx}',
      'src/app/createServices.ts',
      'src/app/App.tsx',
      'src/components/**/*.{ts,tsx}',
      'src/services/workspaceQueryStore.ts',
      'src/services/backupCodec.ts',
      'src/services/backupService.ts',
      'src/services/workItemActions.ts',
      'src/services/workItemMutations.ts',
    ],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'dexie',
                'dexie-react-hooks',
                '**/db/*',
                '**/repositories/*',
                '**/platform/web/*',
              ],
              message:
                'Depend on application contracts; wire concrete storage only at the web composition root.',
            },
          ],
        },
      ],
    },
  },
);
