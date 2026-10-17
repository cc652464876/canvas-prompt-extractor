'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AccountManager } = require('../../src/account-manager.cjs');
function setup() {
  const windows = [];
  const manager = new AccountManager({
    createWindow: () => {
      const win = new EventEmitter();
      win.webContents = new EventEmitter();
      win.isDestroyed = () => Boolean(win.dead);
      win.destroy = () => {
        win.dead = true;
        win.emit('closed');
      };
      windows.push(win);
      return win;
    },
    inspect: () => {
      throw new Error('Login inspection must not run');
    },
    pollInterval: 1
  });
  return { manager, windows };
}
test('Registry starts without opening pages and reuses each extraction window', () => {
  const { manager, windows } = setup();
  assert.equal(windows.length, 0);
  assert.equal(manager.getWindow('liblib'), manager.getWindow('liblib'));
  assert.equal(windows.length, 1);
  assert.throws(() => manager.getWindow('unknown'));
  manager.reset();
});
test('Navigation, focus and elapsed time never trigger login monitoring', async () => {
  const { manager } = setup(),
    win = manager.getWindow('liblib');
  assert.deepEqual(win.webContents.eventNames(), []);
  win.emit('focus');
  win.webContents.emit('dom-ready');
  win.webContents.emit('did-finish-load');
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(manager.refresh, undefined);
  assert.equal(manager.start, undefined);
  assert.deepEqual(win.webContents.eventNames(), []);
  manager.reset();
});
test('Closing or resetting windows releases registry entries', () => {
  const { manager } = setup(),
    first = manager.getWindow('liblib');
  first.destroy();
  assert.equal(manager.existing('liblib'), null);
  assert.notEqual(manager.getWindow('liblib'), first);
  manager.getWindow('jimeng');
  manager.reset();
  assert.equal(manager.entries.size, 0);
});
test('Disposal detaches listeners and prevents new extraction windows', () => {
  const { manager } = setup(),
    win = manager.getWindow('liblib');
  manager.dispose();
  assert.equal(win.listenerCount('closed'), 0);
  assert.throws(() => manager.getWindow('liblib'));
});
