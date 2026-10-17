'use strict';
const path = require('node:path'),
  { spawn } = require('node:child_process');
require('../../scripts/build.cjs')().then(() => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.resolve(__dirname, '../..'), '--verify-authors'], {
    env,
    stdio: 'inherit',
    windowsHide: true
  });
  child.on('exit', (code) => (process.exitCode = code || 0));
  child.on('error', (e) => {
    console.error(e);
    process.exitCode = 1;
  });
});
