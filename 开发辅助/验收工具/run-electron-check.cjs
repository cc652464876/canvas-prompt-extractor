'use strict';
// Reuse an explicitly supplied installed runtime; no download or profile copy.
const path = require('node:path'),
  { spawn } = require('node:child_process');
const [runtime, ...args] = process.argv.slice(2);
if (!runtime || !path.isAbsolute(runtime) || !args.length)
  throw new Error(
    'Usage: node run-electron-check.cjs <absolute runtime executable> <app or script> [arguments]'
  );
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(runtime, args, { env, windowsHide: true, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
