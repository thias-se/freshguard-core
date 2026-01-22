import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    // Project-specific TypeScript configuration
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        project: './tsconfig.eslint.json',
      },
    },
  },

  {
    // Files to include in linting
    files: ['src/**/*.ts', 'src/**/*.js', 'tests/**/*.ts'],
  },

  {
    // Custom rules for FreshGuard Core
    rules: {
      // Security rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Code quality rules
      '@typescript-eslint/prefer-readonly': 'warn',
      '@typescript-eslint/prefer-readonly-parameter-types': 'off', // Too strict for this project
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],

      // Import/export rules
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        disallowTypeAnnotations: false
      }],
      '@typescript-eslint/consistent-type-exports': 'error',

      // Performance rules
      '@typescript-eslint/prefer-for-of': 'warn',
      '@typescript-eslint/prefer-string-starts-ends-with': 'warn',

      // Best practices
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'warn',

      // Naming conventions for database/security project
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          prefix: ['I'] // Optional but common for interfaces
        },
        {
          selector: 'typeAlias',
          format: ['PascalCase']
        },
        {
          selector: 'enum',
          format: ['PascalCase']
        },
        {
          selector: 'class',
          format: ['PascalCase']
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow'
        }
      ],

      // Stylistic preferences
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',

      // Error handling
      '@typescript-eslint/only-throw-error': 'error',

      // Disable some rules that may be too strict for this project
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn', // Sometimes needed for type assertions
      '@typescript-eslint/unbound-method': 'off', // Can cause issues with logging
    },
  },

  {
    // Special rules for test files
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off', // Tests often need non-null assertions
      '@typescript-eslint/no-explicit-any': 'off', // Tests may need any for mocking
      '@typescript-eslint/explicit-function-return-type': 'off', // Not needed in tests
    },
  },

  {
    // Files to ignore
    ignores: [
      'dist/**/*',
      'node_modules/**/*',
      'coverage/**/*',
      '*.js', // Ignore root JS files like this config
      '**/*.d.ts' // Ignore declaration files
    ],
  }
);