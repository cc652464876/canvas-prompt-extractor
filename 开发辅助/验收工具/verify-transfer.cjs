'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT } = require('../../src/app-paths.cjs');

async function rejectLinks(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, 'Dependency link is not transferable: ' + file);
    if (entry.isDirectory()) await rejectLinks(file);
  }
}

function run(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error('Transfer verification failed (' + code + '): ' + output));
    });
  });
}

async function verify() {
  assert.equal(process.platform, 'win32', 'This verifies the Windows launcher.');
  await rejectLinks(path.join(ROOT, 'node_modules'));
  await fs.access(path.join(ROOT, 'runtime', 'node.exe'));
  await fs.access(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-transfer-'));
  const copiedRoot = path.join(temporary, '自由画布 复制验证');
  try {
    await fs.mkdir(copiedRoot);
    for (const name of [
      'src',
      'scripts',
      'node_modules',
      'runtime',
      'tools',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'launch.ps1',
      '启动自由画布提取.cmd',
      '开发辅助/验收工具',
      '开发辅助/测试代码'
    ]) {
      await fs.cp(path.join(ROOT, name), path.join(copiedRoot, name), { recursive: true });
    }
    const env = { ...process.env };
    // Neither the source directory nor the host's Node/Codex runtime may be used.
    for (const key of Object.keys(env)) {
      if (
        /^(path|node_path|node_options|electron_run_as_node|electron_override_dist_path|esbuild_binary_path)$/i.test(
          key
        )
      )
        delete env[key];
    }
    env.PATH = [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(';');
    env.USERPROFILE = temporary;
    const copiedNode = path.join(copiedRoot, 'runtime', 'node.exe');
    await run(
      copiedNode,
      [
        '-e',
        "const p=require('node:path');for(const n of ['esbuild','electron']){const f=require.resolve(n);if(!f.startsWith(process.cwd()+p.sep))throw Error('Dependency outside copy: '+f);}if(!require('electron').startsWith(process.cwd()+p.sep))throw Error('Electron outside copy');console.log('Local runtimes resolved');"
      ],
      { cwd: copiedRoot, env }
    );
    await run(
      copiedNode,
      ['--test', path.join(copiedRoot, '开发辅助', '测试代码', 'image-info.test.cjs')],
      { cwd: temporary, env }
    );
    // Start from a different directory and without Node.js/pnpm in PATH.
    const powershell = path.join(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    await run(
      powershell,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(copiedRoot, 'launch.ps1'),
        '-Verify',
        '-Wait'
      ],
      { cwd: temporary, env }
    );
    const log = await fs.readFile(path.join(copiedRoot, '.runtime', 'startup.log'), 'utf8');
    const errors = await fs.readFile(
      path.join(copiedRoot, '.runtime', 'startup-error.log'),
      'utf8'
    );
    const report = JSON.parse(
      await fs.readFile(
        path.join(copiedRoot, '开发辅助', '验收记录', 'v1.2', 'report.json'),
        'utf8'
      )
    );
    assert.equal(report.passed, true);
    assert.deepEqual(report.errors, []);
    assert.equal(errors.trim(), '', errors);
    assert.doesNotMatch(log, /Downloading Electron/);
    await fs.mkdir(path.join(ROOT, '.runtime'), { recursive: true });
    await fs.writeFile(
      path.join(ROOT, '.runtime', 'transfer-verification.json'),
      JSON.stringify(
        {
          passed: true,
          copiedRoot,
          bundledNode: true,
          dependencyLinks: 0,
          hostNodeInPath: false,
          electronDownload: false,
          checks: report.checks,
          errors: report.errors
        },
        null,
        2
      )
    );
    console.log(
      'PASS Copied directory starts using bundled Node and Electron, without host Node/pnpm or downloads.'
    );
    console.log('PASS ' + report.checks.length + ' Electron checks passed from the copy.');
  } finally {
    const resolved = path.resolve(temporary);
    const temporaryRoot = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('canvas-transfer-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
