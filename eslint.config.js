import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Project conventions from CLAUDE.md, enforced mechanically so the
// code-reviewer agent only has to check what needs judgment.
const RAW_PALETTE = '/\\b(zinc|emerald|violet)-\\d/'
const HEX_COLOR = '/#[0-9a-fA-F]{3,8}\\b/'

const iconImportPatterns = [
  { group: ['material-symbols*', '@material-symbols/*'], message: 'Use Lucide icons (lucide-react).' },
]

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
])
