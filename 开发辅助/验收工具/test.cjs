'use strict';
const path = require('node:path'),
  fs = require('node:fs'),
  { spawn } = require('node:child_process');
const { ROOT, TEST_ROOT } = require('../../src/app-paths.cjs');
require('../../scripts/build.cjs')()
  .then(() => {
    const files = fs
      .readdirSync(TEST_ROOT)
      .filter((name) => name.endsWith('.test.cjs'))
      .sort();
    if (!files.length) throw new Error('No unit tests found.');
    const child = spawn(
      process.execPath,
      ['--test', ...files.map((name) => path.join(TEST_ROOT, name))],
      {
        cwd: ROOT,
        stdio: 'inherit',
        windowsHide: true
      }
    );
    child.on('error', (error) => {
      console.error(error);
      process.exitCode = 1;
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
    });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
