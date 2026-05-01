import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'build/**', '*.config.js', 'supabase/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Reglas críticas de blindaje (post-incidente CapacityBar)
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      // Marca como "usados" los componentes referenciados en JSX
      // (sin esto, no-unused-vars reporta falsos positivos en imports JSX)
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // Bonus: detectar imports no usados (warning, no rompe build)
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Apagar reglas que generan ruido sin valor para nuestro caso
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
