import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';

// Project conventions from CLAUDE.md, enforced mechanically so the
// code-reviewer agent only has to check what needs judgment.
const RAW_PALETTE = '/\\b(zinc|emerald|violet)-\\d/';
const HEX_COLOR = '/#[0-9a-fA-F]{3,8}\\b/';

const iconImportPatterns = [
  { group: ['material-symbols*', '@material-symbols/*'], message: 'Use Lucide icons (lucide-react).' },
];

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Mate-style formatting: semicolons, single quotes, trailing commas.
    files: ['**/*.{ts,tsx,js}'],
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/indent': ['error', 2],
      '@stylistic/jsx-indent-props': ['error', 2],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/max-len': ['error', {
        code: 100,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreComments: true,
      }],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
      '@stylistic/member-delimiter-style': ['error', {
        multiline: { delimiter: 'semi', requireLast: true },
        singleline: { delimiter: 'semi', requireLast: false },
      }],
      curly: ['error', 'all'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' },
        { selector: `Literal[value=${RAW_PALETTE}]`, message: 'Use @theme color tokens, not raw palette classes.' },
        { selector: `TemplateElement[value.raw=${RAW_PALETTE}]`, message: 'Use @theme color tokens, not raw palette classes.' },
        { selector: `Literal[value=${HEX_COLOR}]`, message: 'No hex colors; use @theme color tokens.' },
        { selector: `TemplateElement[value.raw=${HEX_COLOR}]`, message: 'No hex colors; use @theme color tokens.' },
        { selector: 'Literal[value=/material-symbols/]', message: 'Use Lucide icons, not Material Symbols.' },
      ],
      'no-restricted-imports': ['error', { patterns: iconImportPatterns }],
    },
  },
  {
    // The packing engine is pure logic: no React, no network, no Supabase.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...iconImportPatterns,
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@supabase/*', '**/services/*', '**/lib/supabase*'],
              message: 'src/engine must stay pure: no React, network or Supabase imports.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'src/engine must stay pure: no network calls.' },
        { name: 'XMLHttpRequest', message: 'src/engine must stay pure: no network calls.' },
        { name: 'WebSocket', message: 'src/engine must stay pure: no network calls.' },
      ],
    },
  },
]);
