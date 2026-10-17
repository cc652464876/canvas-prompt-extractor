'use strict';
const bound = new WeakSet();
const owners = new WeakMap();
function installDevToolsMenu() {
  const { Menu, MenuItem, webContents, BrowserWindow } = require('electron');
  const menu =
    Menu.getApplicationMenu() ||
    Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      { role: 'help' }
    ]);
  if (menu.getMenuItemById('devtools-f12')) return;
  // Menu accelerators also work while the inspector itself has keyboard focus.
  menu.append(
    new MenuItem({
      id: 'devtools-f12',
      label: '开发者工具',
      accelerator: 'F12',
      visible: false,
      click: (_item, window) => {
        const focused = webContents.getFocusedWebContents();
        const owner = focused && owners.get(focused);
        if (owner && !owner.isDestroyed()) owner.closeDevTools();
        else (window || BrowserWindow.getFocusedWindow())?.webContents.toggleDevTools();
      }
    })
  );
  Menu.setApplicationMenu(menu);
}
function isF12(input) {
  return input.key === 'F12' && !input.control && !input.alt && !input.meta && !input.shift;
}
function bindDevToolsShortcut(contents, target = contents) {
  if (bound.has(contents)) return;
  bound.add(contents);
  contents.on('before-input-event', (event, input) => {
    if (!isF12(input) || input.type !== 'keyDown') return;
    event.preventDefault();
    if (input.isAutoRepeat || target.isDestroyed()) return;
    if (target.isDevToolsOpened()) target.closeDevTools();
    else target.openDevTools({ mode: 'right' });
  });
  contents.on('devtools-opened', () => {
    const inspector = contents.devToolsWebContents;
    if (inspector) owners.set(inspector, contents);
  });
}
module.exports = { bindDevToolsShortcut, installDevToolsMenu };
