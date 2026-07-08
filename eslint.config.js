// @ts-check
// Flat config (ESLint 9+). Lint pragmático para código de jogo:
// erros reais e higiene, sem brigar com o Prettier (formatação fica com ele).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // permite prefixo _ para descartes intencionais
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // código de jogo/gráficos usa any pontual (THREE, WebGL) — aviso, não erro
      '@typescript-eslint/no-explicit-any': 'off',
      // loops de game state usam while(true) com break controlado
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  prettier,
);
