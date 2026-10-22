import globals from 'globals';
export default [
  {
    ignores: [
      'node_modules/**',
      'build/**',
      '开发辅助/验收记录/**',
      'src/browser-toolbar/vendor/**'
    ]
  },
  {
    files: [
      'src/**/*.js',
      'src/**/*.cjs',
      'scripts/**/*.cjs',
      '开发辅助/验收工具/**/*.cjs',
      '开发辅助/测试代码/**/*.cjs'
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2026, ...globals.browser }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }]
    }
  },
  {
    files: ['src/ui/**/*.js', 'src/canvas-browser/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...Object.fromEntries(Object.keys(globals.node).map((k) => [k, 'off'])),
        ...globals.browser,
        ...globals.es2026
      }
    }
  }
];
