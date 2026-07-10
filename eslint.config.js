// Flat ESLint config. Keeps the codebase's existing discipline machine-enforced: zero `any`,
// no unused vars (except _-prefixed), bounded complexity/function length. Stylistic rules are
// `warn` so they surface in review without blocking CI; correctness rules stay `error`.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.js', '*.config.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      complexity: ['warn', 18],
      'max-lines-per-function': ['warn', { max: 140, skipBlankLines: true, skipComments: true }],
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'max-lines-per-function': 'off',
    },
  }
);
