import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', '.next/**', 'docs/**', 'public/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,cjs,mjs}'],
    rules: {
      // Existing provider/ELK boundaries use any; narrowing them is separate work.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  }
];
