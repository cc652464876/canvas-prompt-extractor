'use strict';
const path = require('node:path'),
  fs = require('node:fs'),
  { spawn } = require('node:child_process');
const name = process.argv[2];
if (!name || name !== path.basename(name) || !/^verify-[\w-]+\.cjs$/.test(name))
  throw new Error('Provide a verification script name.');
const target = path.join(__dirname, name);
if (!fs.existsSync(target)) throw new Error('Verification script missing: ' + name);
require('../../scripts/build.cjs')()
  .then(() => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [target, ...process.argv.slice(3)], {
      env,
      windowsHide: true,
      stdio: 'inherit'
    });
    child.on('error', (e) => {
      console.error(e);
      process.exitCode = 1;
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
    });
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
