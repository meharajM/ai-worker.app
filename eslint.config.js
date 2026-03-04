import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  // Global ignores
  { ignores: ['out/', 'dist/', 'node_modules/', '*.cjs', 'tests/'] },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended (type-aware OFF to keep lint fast)
  ...tseslint.configs.recommended,

  // All TS/TSX source files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      // React hooks
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // TypeScript — start lenient, tighten over time
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-require-imports': 'off',

      // Downgraded to warn — fix gradually, then promote to error
      'no-useless-escape': 'warn',
      'no-self-assign': 'warn',
      'no-case-declarations': 'warn',
      'no-empty': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/triple-slash-reference': 'warn',

      // General
      'no-console': 'off',
      'prefer-const': 'warn'
    }
  }
)
