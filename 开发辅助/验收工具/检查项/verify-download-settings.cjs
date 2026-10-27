'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { verificationPath } = require('../../../src/app-paths.cjs');
const { readDownloadConcurrency } = require('../../../src/download-preference.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({ ui, root, downloadPreferencePath, createQueue }) => {
  const run = (code) => ui.webContents.executeJavaScript(code),
    checks = [],
    errors = [];
  ui.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) errors.push(event.message);
  });
  async function until(code) {
    for (let i = 0; i < 100; i++) {
      if (await run(code)) return;
      await wait(25);
    }
    throw new Error('Timed out: ' + code);
  }
  const label = `document.querySelector('#download-concurrency-trigger .dropdown-label').textContent`;
  async function choose(value) {
    await run(
      `document.getElementById('download-concurrency-trigger').click();document.querySelector('#download-concurrency-menu [data-value="${value}"]').click()`
    );
    await until(
      `(async()=>(${label}==='${value}'&&(await window.lab.info()).value.downloadSettings.concurrency===${value}))()`
    );
    assert.equal(readDownloadConcurrency(downloadPreferencePath), value);
  }
  await until(`!document.getElementById('download-concurrency-trigger').disabled`);
  assert.equal(await run(label), '2');
  assert.equal(createQueue().concurrency, 2);
  assert.equal(
    await run(
      `document.getElementById('download-concurrency-trigger').closest('section')!==document.getElementById('prompt-font-size').closest('section')`
    ),
    true
  );
  await run(`document.getElementById('theme-toggle').click()`);
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#download-concurrency-menu [role=option]')].map(button=>button.textContent.replace('✓',''))`
    ),
    ['1', '2', '3', '4', '5', '6', '7', '8', '16']
  );
  for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 16]) {
    await choose(value);
    const queue = createQueue();
    assert.equal(queue.concurrency, value);
    assert.equal(queue.interval, 1000);
    assert.deepEqual(queue.retryDelays, [5000, 15000]);
  }
  checks.push(
    'All nine options persist and reach the actual download queue; request spacing stays 1000ms'
  );
  await choose(4);
  const previousQueue = createQueue();
  await choose(16);
  assert.equal(previousQueue.concurrency, 4);
  assert.equal(createQueue().concurrency, 16);
  await choose(4);
  for (const value of [0, 9, 17, '4']) {
    const result = await run(`window.lab.downloadConcurrency(${JSON.stringify(value)})`);
    assert.equal(result.ok, false);
    assert.equal(readDownloadConcurrency(downloadPreferencePath), 4);
  }
  checks.push(
    'New settings apply only to new queues; invalid IPC values cannot change the saved setting'
  );
  await new Promise((resolve) => {
    ui.webContents.once('did-finish-load', resolve);
    ui.reload();
  });
  await until(`!document.getElementById('download-concurrency-trigger').disabled&&${label}==='4'`);
  checks.push('Reload restores four from the main process preference');
  const out = verificationPath(root, 'download-settings');
  await fs.mkdir(out, { recursive: true });
  for (const [width, height] of [
    [1100, 900],
    [680, 620]
  ]) {
    ui.setSize(width, height);
    await run(
      `document.getElementById('theme-toggle').click();document.getElementById('download-concurrency-trigger').scrollIntoView({block:'center'});document.getElementById('download-concurrency-trigger').click()`
    );
    await wait(150);
    const bounds = await run(
      `(()=>{const menu=document.getElementById('download-concurrency-menu'),r=menu.getBoundingClientRect(),t=document.getElementById('download-concurrency-trigger').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,triggerWidth:t.width,menuWidth:r.width,allVisible:menu.scrollHeight<=menu.clientHeight+1&&[...menu.children].every(button=>{const b=button.getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom;})};})()`
    );
    assert.ok(bounds.triggerWidth <= 90 && bounds.menuWidth <= 90);
    assert.equal(bounds.allVisible, true);
    assert.ok(
      bounds.left >= 0 &&
        bounds.right <= bounds.width &&
        bounds.top >= 0 &&
        bounds.bottom <= bounds.height
    );
    await fs.writeFile(
      path.join(out, 'menu-' + width + '.png'),
      (await ui.webContents.capturePage()).toPNG()
    );
    await run(
      `document.getElementById('download-concurrency-trigger').click();document.getElementById('appearance-close').click()`
    );
  }
  checks.push(
    'Separate download row has a compact dropdown showing all nine options at both window sizes'
  );
  await run(
    `document.getElementById('theme-toggle').click();document.getElementById('appearance-reset').click()`
  );
  await until(
    `(async()=>(${label}==='2'&&(await window.lab.info()).value.downloadSettings.concurrency===2))()`
  );
  assert.equal(readDownloadConcurrency(downloadPreferencePath), 2);
  assert.equal(createQueue().concurrency, 2);
  checks.push('Restore defaults persists two and restores the queue default');
  if (process.platform === 'win32') {
    const { execFile } = require('node:child_process'),
      { promisify } = require('node:util'),
      { createBrowserWindow } = require('../../../src/browser-window.cjs'),
      { APP_ICON } = require('../../../src/app-paths.cjs'),
      { APP_USER_MODEL_ID, syncTaskbarShortcuts } = require('../../../src/windows-taskbar.cjs'),
      { shell } = require('electron');
    const shortcuts = path.join(out, 'shortcut-fixture');
    await fs.mkdir(shortcuts, { recursive: true });
    const oldLink = path.join(shortcuts, 'Electron.lnk'),
      otherLink = path.join(shortcuts, 'Other.lnk');
    assert.equal(
      shell.writeShortcutLink(oldLink, 'create', {
        target: process.execPath,
        appUserModelId: APP_USER_MODEL_ID
      }),
      true
    );
    assert.equal(
      shell.writeShortcutLink(otherLink, 'create', {
        target: process.execPath,
        appUserModelId: 'org.example.other-app'
      }),
      true
    );
    const otherBefore = shell.readShortcutLink(otherLink);
    syncTaskbarShortcuts({ shell, programsDirectory: shortcuts, root: shortcuts });
    for (const file of [oldLink, path.join(shortcuts, '自由画布提取 v1.4.lnk')]) {
      const link = shell.readShortcutLink(file);
      assert.equal(link.icon, APP_ICON);
      assert.equal(link.appUserModelId, APP_USER_MODEL_ID);
      assert.ok(link.args.includes(path.join(shortcuts, 'launch.ps1')));
    }
    assert.deepEqual(shell.readShortcutLink(otherLink), otherBefore);
    checks.push(
      'Old Electron shortcut gets the app icon and launcher; unrelated shortcuts remain intact'
    );
    const browser = createBrowserWindow({ show: false }, { initialTab: false });
    try {
      for (const [name, window] of [
        ['main', ui],
        ['browser', browser]
      ]) {
        const { stdout } = await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(__dirname, 'read-taskbar-properties.ps1'),
            '-Handle',
            window.getNativeWindowHandle().readBigUInt64LE().toString(),
            '-IconPath',
            path.join(out, name + '-native-icon.png')
          ],
          { encoding: 'utf8', windowsHide: true, timeout: 15000 }
        );
        const properties = JSON.parse(stdout);
        assert.equal(properties.appId, APP_USER_MODEL_ID);
        assert.equal(properties.icon, APP_ICON + ',0');
        assert.equal(properties.name, '自由画布提取');
        assert.ok(properties.command.includes(path.join(root, 'launch.ps1')));
        await fs.writeFile(
          path.join(out, name + '-taskbar.json'),
          JSON.stringify(properties, null, 2)
        );
      }
    } finally {
      browser.destroy();
    }
    checks.push(
      'Native Windows properties and icons identify both the main and browser windows as this app'
    );
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify({ passed: true, checks }, null, 2)
  );
  for (const check of checks) console.log('PASS ' + check);
};
