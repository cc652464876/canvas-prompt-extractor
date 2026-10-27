'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { ROOT, APP_ICON } = require('./app-paths.cjs');
const APP_USER_MODEL_ID = 'com.freecanvas.extractor.v1_4';
function launchDetails(root = ROOT) {
  const target = path.join(
    process.env.SystemRoot || 'C:/Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  return {
    target,
    args: `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${path.join(root, 'launch.ps1')}"`,
    cwd: root,
    description: '自由画布提取 v1.4',
    icon: APP_ICON,
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID
  };
}
function syncTaskbarShortcuts({ shell, programsDirectory, root = ROOT }) {
  if (process.platform !== 'win32') return [];
  const details = launchDetails(root),
    paths = new Set([path.join(programsDirectory, '自由画布提取 v1.4.lnk')]),
    updated = [];
  fs.mkdirSync(programsDirectory, { recursive: true });
  // Windows may find an old Electron shortcut with our AppUserModelID before
  // considering the window's icon. Repair every matching link, including its
  // launch arguments, so none of them can keep advertising Electron's icon.
  for (const directory of [root, programsDirectory]) {
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.lnk'))) {
      const link = path.join(directory, file);
      try {
        const previous = shell.readShortcutLink(link);
        const sameApp = previous.appUserModelId === APP_USER_MODEL_ID;
        const sameLauncher =
          previous.target.toLowerCase() === details.target.toLowerCase() &&
          previous.args.includes(`"${path.join(root, 'launch.ps1')}"`);
        if (sameApp || sameLauncher) paths.add(link);
      } catch {}
    }
  }
  for (const link of paths) {
    const exists = fs.existsSync(link);
    if (exists) {
      const previous = shell.readShortcutLink(link);
      if (Object.entries(details).every(([key, value]) => previous[key] === value)) continue;
    }
    if (!shell.writeShortcutLink(link, exists ? 'update' : 'create', details))
      throw new Error('无法更新程序任务栏快捷方式：' + link);
    updated.push(link);
  }
  return updated;
}
function applyTaskbarIdentity(window) {
  if (process.platform !== 'win32') return;
  const details = launchDetails();
  // Source builds run inside electron.exe. Give Windows the product's identity
  // and launch icon explicitly so its taskbar group does not use Electron's icon.
  window.setIcon(APP_ICON);
  window.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: APP_ICON,
    appIconIndex: 0,
    relaunchCommand: `"${details.target}" ${details.args}`,
    relaunchDisplayName: '自由画布提取'
  });
}
module.exports = { APP_USER_MODEL_ID, applyTaskbarIdentity, syncTaskbarShortcuts };
