// @ts-check

import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'core/**/*.ts', 'worker/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['*.js', '*.mjs', 'scripts/**/*.{js,mjs}', 'releases/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
  {
    ignores: ['dist/', 'lib/', 'coverage/', 'node_modules/'],
  },
)
