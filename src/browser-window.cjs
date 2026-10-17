'use strict';
const { BaseWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');
const { browserAddress, isBrowserAddress } = require('./browser-address.cjs');
const { bindDevToolsShortcut } = require('./devtools-shortcut.cjs');
const toolbarFile = path.join(__dirname, 'browser-toolbar', 'index.html');
const toolbars = new Map();
const browsers = new WeakMap();
let ipcInstalled = false;
function installToolbarIpc() {
  if (ipcInstalled) return;
  ipcInstalled = true;
  ipcMain.handle('browser-toolbar:action', async (event, action, value) => {
    const browser = toolbars.get(event.sender.id);
    if (!browser || event.senderFrame !== event.sender.mainFrame)
      return { ok: false, error: '无效的浏览器窗口。' };
    try {
      await browser.action(action, value);
      browser.sync();
      return { ok: true, state: browser.state() };
    } catch (error) {
      browser.error = error.message;
      browser.sync();
      return { ok: false, error: error.message };
    }
  });
}
function isManualBrowserNavigation(contents, url) {
  return Boolean(browsers.get(contents)?.manual && isBrowserAddress(url));
}
function createBrowserWindow(
  options = {},
  {
    homeUrl = 'https://www.google.com/',
    blocked = null,
    manual = false,
    beforeNavigate = () => true
  } = {}
) {
  installToolbarIpc();
  const blockedReason = typeof blocked === 'function' ? blocked : () => '';
  const { webPreferences = {}, webContents: incomingContents, ...nativeOptions } = options;
  const window = new BaseWindow(nativeOptions);
  const page = new WebContentsView(
    incomingContents ? { webContents: incomingContents } : { webPreferences }
  );
  const toolbar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'browser-toolbar', 'preload.cjs'),
      partition: 'browser-toolbar',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  window.contentView.addChildView(page);
  window.contentView.addChildView(toolbar);
  // Keep the existing extraction interface: the website remains the window's
  // public WebContents, with the same sessions, frames and read adapters.
  window.webContents = page.webContents;
  const browser = {
    manual,
    lastBlocked: '',
    error: '',
    pending: '',
    ready: false,
    state() {
      const history = page.webContents.navigationHistory;
      return {
        url: browser.pending || page.webContents.getURL() || 'about:blank',
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
        blocked: blockedReason(window) || '',
        error: browser.error
      };
    },
    layout() {
      if (window.isDestroyed()) return;
      const [width, height] = window.getContentSize();
      const top = Math.min(height, browser.error ? 74 : 48);
      toolbar.setBounds({ x: 0, y: 0, width, height: top });
      page.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
    },
    sync() {
      if (
        window.isDestroyed() ||
        page.webContents.isDestroyed() ||
        toolbar.webContents.isDestroyed()
      )
        return;
      browser.layout();
      const state = browser.state();
      browser.lastBlocked = state.blocked;
      if (browser.ready) toolbar.webContents.send('browser-toolbar:state', state);
    },
    async action(action, value) {
      if (action === 'state') return;
      const reason = blockedReason(window);
      if (reason) throw new Error(reason);
      browser.error = '';
      const wc = page.webContents,
        history = wc.navigationHistory;
      if (!['navigate', 'back', 'forward', 'reload', 'home'].includes(action))
        throw new Error('不支持的浏览器操作。');
      browser.manual = true;
      if (action === 'back') {
        if (history.canGoBack()) history.goBack();
      } else if (action === 'forward') {
        if (history.canGoForward()) history.goForward();
      } else if (action === 'reload') wc.reload();
      else {
        const url = action === 'home' ? homeUrl : browserAddress(value);
        if (beforeNavigate(url, window) === false) return;
        browser.pending = url;
        void wc.loadURL(url).catch((error) => {
          if (!window.isDestroyed() && error.code !== 'ERR_ABORTED' && error.errno !== -3) {
            browser.pending = '';
            browser.error = '页面加载失败：' + (error.code || error.message);
            browser.sync();
          }
        });
      }
      browser.sync();
    }
  };
  browsers.set(page.webContents, browser);
  toolbars.set(toolbar.webContents.id, browser);
  window.loadURL = (url, settings) => {
    browser.manual = false;
    browser.pending = url;
    browser.error = '';
    browser.sync();
    return page.webContents.loadURL(url, settings);
  };
  window.loadFile = (file, settings) => page.webContents.loadFile(file, settings);
  window.browserToolbar = {
    webContents: toolbar.webContents,
    state: browser.state,
    action: browser.action
  };
  bindDevToolsShortcut(page.webContents);
  bindDevToolsShortcut(toolbar.webContents, page.webContents);
  toolbar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  toolbar.webContents.on('will-navigate', (event) => event.preventDefault());
  toolbar.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
  toolbar.webContents.on('did-finish-load', () => {
    browser.ready = true;
    browser.sync();
  });
  for (const event of ['did-navigate', 'did-navigate-in-page'])
    page.webContents.on(event, () => {
      browser.pending = '';
      browser.error = '';
      browser.sync();
    });
  for (const event of ['did-start-loading', 'did-stop-loading'])
    page.webContents.on(event, () => browser.sync());
  page.webContents.on('page-title-updated', (_event, title) => {
    if (!window.isDestroyed()) window.setTitle(title || nativeOptions.title || '平台页面');
  });
  page.webContents.on('did-fail-load', (_event, code, description, _url, main) => {
    if (main && code !== -3) {
      browser.pending = '';
      browser.error = '页面加载失败：' + description;
      browser.sync();
    }
  });
  const onKey = (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if ((input.control || input.meta) && input.key.toLowerCase() === 'l') {
      event.preventDefault();
      toolbar.webContents.focus();
      toolbar.webContents.send('browser-toolbar:focus');
    } else if (input.alt && ['ArrowLeft', 'ArrowRight'].includes(input.key)) {
      event.preventDefault();
      void browser.action(input.key === 'ArrowLeft' ? 'back' : 'forward').catch((error) => {
        browser.error = error.message;
        browser.sync();
      });
    }
  };
  page.webContents.on('before-input-event', onKey);
  toolbar.webContents.on('before-input-event', onKey);
  window.on('resize', browser.layout);
  window.on('show', browser.sync);
  const timer = blocked
    ? setInterval(() => {
        if (window.isDestroyed()) return;
        const current = blockedReason(window) || '';
        if (current !== browser.lastBlocked) {
          if (!current && browser.error === browser.lastBlocked) browser.error = '';
          if (current) browser.manual = false;
          browser.sync();
        }
      }, 200)
    : null;
  window.once('closed', () => {
    clearInterval(timer);
    toolbars.delete(toolbar.webContents.id);
    browsers.delete(page.webContents);
    for (const contents of [toolbar.webContents, page.webContents])
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
  });
  browser.layout();
  void toolbar.webContents.loadFile(toolbarFile).catch(() => {});
  return window;
}
module.exports = { createBrowserWindow, isManualBrowserNavigation };
