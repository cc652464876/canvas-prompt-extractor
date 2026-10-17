'use strict';
const path = require('node:path'),
  fs = require('node:fs'),
  { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require('./build.cjs')()
  .then(() => {
    const executable = require('electron');
    if (!fs.existsSync(executable))
      throw new Error('Development runtime missing; install the pinned Electron dependency.');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [root, ...process.argv.slice(2)], {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true
    });
    child.on('error', (e) => {
      console.error(e);
      process.exitCode = 1;
    });
    child.on('exit', (code) => {
      process.exitCode = code === null ? 1 : code;
    });
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
