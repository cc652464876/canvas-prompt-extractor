'use strict';
const { BaseWindow, WebContentsView, ipcMain, Menu, nativeImage } = require('electron');
const path = require('node:path');
const { browserAddress, isBrowserAddress } = require('./browser-address.cjs');
const { bindDevToolsShortcut } = require('./devtools-shortcut.cjs');
const { applyTaskbarIdentity } = require('./windows-taskbar.cjs');
const { isTransparentRead } = require('./platform-presentation.cjs');
const { bindPageAudio, syncPageAudio } = require('./page-audio.cjs');
const { TAB_STRIP_HEIGHT, BROWSER_HEIGHT } = require('./browser-layout.cjs');
const toolbarFile = path.join(__dirname, 'browser-toolbar', 'index.html');
const toolbars = new Map(),
  browsers = new WeakMap();
async function favicon(contents, url, signal) {
  const response = await contents.session.fetch(url, { credentials: 'omit', signal });
  if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) return '';
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131072) return '';
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const icon = nativeImage.createFromBuffer(Buffer.concat(chunks));
  return icon.isEmpty() ? '' : icon.resize({ width: 16, height: 16 }).toDataURL();
}
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
      return { ok: true, state: browser.state() };
    } catch (error) {
      browser.report(error);
      return { ok: false, error: error.message };
    }
  });
}
function isManualBrowserNavigation(contents, url) {
  return Boolean(browsers.get(contents)?.manual && isBrowserAddress(url));
}
function createBrowserWindow(options = {}, controls = {}) {
  installToolbarIpc();
  const {
    homeUrl = 'https://www.google.com/',
    blocked = null,
    manual = false,
    beforeNavigate = () => true,
    initialTab = true,
    onTabCreated = () => {},
    onEmpty = (win) => win.close()
  } = controls;
  const blockedReason = typeof blocked === 'function' ? blocked : () => '';
  const { webPreferences = {}, webContents: incomingContents, ...nativeOptions } = options;
  const window = new BaseWindow({
    ...nativeOptions,
    titleBarStyle: 'hidden',
    // Leave the strip's shared 2px bottom bar below the native caption controls.
    titleBarOverlay: { color: '#dee1e6', symbolColor: '#34363a', height: TAB_STRIP_HEIGHT - 2 }
  });
  applyTaskbarIdentity(window);
  // BaseWindow needs its own application menu for native accelerators in DevTools.
  window.setMenu(Menu.getApplicationMenu());
  window.setAutoHideMenuBar(true);
  window.setMenuBarVisibility(false);
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
  const tabs = new Map(),
    closed = [];
  let activeId = null,
    serial = 0,
    ready = false,
    lastBlocked = '',
    readyResolve;
  const readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
  });
  const active = () => tabs.get(activeId);
  const visibleTabs = () => [...tabs.values()].filter((tab) => !tab.hidden);
  const browser = {
    tabs,
    ready: readyPromise,
    get activeId() {
      return activeId;
    },
    state() {
      const tab = active(),
        wc = tab?.contents;
      return {
        tabs: visibleTabs().map((item) => ({
          id: item.id,
          title: item.title || '新标签页',
          url: item.pending || item.contents?.getURL() || item.url || 'about:blank',
          loading: item.contents?.isLoading() || false,
          favicon: item.favicon || '',
          error: item.error || ''
        })),
        activeId,
        url: tab?.pending || wc?.getURL() || tab?.url || 'about:blank',
        canGoBack: wc?.navigationHistory.canGoBack() || false,
        canGoForward: wc?.navigationHistory.canGoForward() || false,
        loading: wc?.isLoading() || false,
        blocked: blockedReason(window) || '',
        error: tab?.error || '',
        maximized: !window.isDestroyed() && window.isMaximized()
      };
    },
    layout() {
      if (window.isDestroyed()) return;
      browser.syncAudio();
      const [width, height] = window.getContentSize();
      const top = window.isFullScreen() ? 0 : Math.min(height, BROWSER_HEIGHT);
      toolbar.setVisible(top > 0);
      toolbar.setBounds({ x: 0, y: 0, width, height: top });
      for (const tab of tabs.values())
        if (tab.view) {
          tab.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
          tab.view.setVisible(tab.id === activeId);
        }
    },
    syncAudio() {
      for (const tab of tabs.values()) if (tab.contents) syncPageAudio(tab.contents);
    },
    sync() {
      if (window.isDestroyed() || toolbar.webContents.isDestroyed()) return;
      browser.layout();
      const state = browser.state();
      lastBlocked = state.blocked;
      if (ready) toolbar.webContents.send('browser-toolbar:state', state);
    },
    report(error, tab = active()) {
      if (window.isDestroyed()) return;
      if (tab && tabs.get(tab.id) === tab) tab.error = error.message;
      browser.sync();
    },
    focusAddress() {
      toolbar.webContents.focus();
      toolbar.webContents.send('browser-toolbar:focus');
    },
    repaint() {
      if (window.isDestroyed()) return;
      toolbar.webContents.invalidate();
      active()?.contents?.invalidate();
    },
    materialize(tab) {
      if (tab.contents) return tab;
      tab.view = new WebContentsView(
        tab.incoming
          ? { webContents: tab.incoming }
          : {
              webPreferences: { ...webPreferences, ...tab.webPreferences }
            }
      );
      const wc = (tab.contents = tab.view.webContents);
      bindPageAudio(
        wc,
        () =>
          window.isDestroyed() ||
          !window.isVisible() ||
          window.isMinimized() ||
          isTransparentRead(window) ||
          tab.hidden ||
          tab.id !== activeId ||
          Boolean(blockedReason(window))
      );
      wc.once('destroyed', () => {
        if (!window.isDestroyed() && tabs.has(tab.id))
          browser.closeTab(tab.id, { remember: false });
      });
      window.contentView.addChildView(tab.view);
      window.contentView.addChildView(toolbar);
      browsers.set(wc, tab);
      bindDevToolsShortcut(wc);
      wc.on('before-input-event', onKey);
      for (const event of ['did-navigate', 'did-navigate-in-page'])
        wc.on(event, () => {
          tab.pending = '';
          tab.error = '';
          tab.url = wc.getURL();
          browser.sync();
        });
      for (const event of ['did-start-loading', 'did-stop-loading']) wc.on(event, browser.sync);
      wc.on('did-start-navigation', (_event, _url, inPlace, main) => {
        if (main && !inPlace) {
          tab.iconAbort?.abort();
          tab.favicon = '';
        }
      });
      wc.on('page-favicon-updated', (_event, urls) => {
        tab.iconAbort?.abort();
        const url = urls.find((value) => /^https?:\/\//i.test(value));
        if (!url) return;
        const controller = (tab.iconAbort = new AbortController());
        void favicon(wc, url, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
          .then((value) => {
            if (tabs.get(tab.id) !== tab || controller.signal.aborted) return;
            tab.favicon = value;
            browser.sync();
          })
          .catch(() => {});
      });
      wc.on('page-title-updated', (_event, title) => {
        tab.title = title || tab.title;
        if (tab.id === activeId) window.setTitle(tab.title || '新标签页');
        browser.sync();
      });
      wc.on('did-fail-load', (_event, code, description, _url, main) => {
        if (main && code !== -3) {
          tab.pending = '';
          browser.report(new Error('页面加载失败：' + description), tab);
        }
      });
      wc.setWindowOpenHandler(({ url }) => {
        if (!isBrowserAddress(url)) return { action: 'deny' };
        return {
          action: 'allow',
          createWindow: (settings) =>
            browser.addTab({
              url,
              incoming: settings.webContents,
              webPreferences: settings.webPreferences,
              manual: tab.manual,
              activate: true
            }).contents
        };
      });
      onTabCreated(tab, window);
      window.emit('browser-tab-created', tab);
      browser.layout();
      return tab;
    },
    start(tab) {
      browser.materialize(tab);
      if (!tab.started) {
        tab.started = true;
        if (!tab.incoming && tab.url) void browser.load(tab, tab.url).catch(() => {});
      }
      return tab;
    },
    addTab(spec = {}) {
      const id = spec.id || 'browser-tab-' + ++serial;
      if (tabs.has(id)) {
        if (spec.activate !== false) browser.activate(id);
        return tabs.get(id);
      }
      const tab = {
        ...spec,
        id,
        title: spec.title || '新标签页',
        url: spec.url || '',
        manual: spec.manual ?? true,
        pending: '',
        error: '',
        homeUrl: spec.homeUrl || homeUrl
      };
      tabs.set(id, tab);
      if (spec.activate !== false) browser.activate(id, false);
      else if (!spec.lazy) browser.start(tab);
      browser.sync();
      return tab;
    },
    activate(id, focus = true) {
      if (!tabs.has(id) || tabs.get(id).hidden) return;
      activeId = id;
      const tab = browser.start(active());
      window.setTitle(tab.title || nativeOptions.title || '新标签页');
      browser.sync();
      window.emit('browser-tab-activated', tab);
      if (focus) tab.contents.focus();
    },
    setTabVisible(id, visible) {
      const tab = tabs.get(id);
      if (!tab || tab.hidden === !visible) return;
      tab.hidden = !visible;
      if (tab.hidden && activeId === id) {
        activeId = null;
        const next = visibleTabs()[0];
        if (next) browser.activate(next.id, false);
      }
      if (visible && !activeId) browser.activate(id, false);
      browser.sync();
    },
    closeTab(id, { remember = true, notify = true, empty = true } = {}) {
      const tab = tabs.get(id);
      if (!tab) return;
      const ids = visibleTabs().map((item) => item.id),
        index = ids.indexOf(id);
      if (remember) {
        closed.push({
          id,
          title: tab.title,
          url: tab.contents?.getURL() || tab.url || 'about:blank',
          webPreferences: tab.webPreferences,
          manual: tab.manual,
          managed: tab.managed,
          platform: tab.platform,
          sourceUrl: tab.sourceUrl,
          homeUrl: tab.homeUrl
        });
        if (closed.length > 20) closed.shift();
      }
      tabs.delete(id);
      tab.iconAbort?.abort();
      if (tab.view) window.contentView.removeChildView(tab.view);
      if (tab.contents) {
        browsers.delete(tab.contents);
        if (!tab.contents.isDestroyed()) tab.contents.close({ waitForBeforeUnload: false });
      }
      if (id === activeId) {
        activeId = null;
        const next = visibleTabs().map((item) => item.id)[
          Math.min(index, visibleTabs().length - 1)
        ];
        if (next) browser.activate(next);
      }
      if (notify) window.emit('browser-tab-closed', tab);
      browser.sync();
      if (empty && !visibleTabs().length) onEmpty(window);
    },
    reorder(ids) {
      if (
        !Array.isArray(ids) ||
        ids.length !== visibleTabs().length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !tabs.has(id) || tabs.get(id).hidden)
      )
        return;
      let index = 0;
      const values = [...tabs.values()].map((tab) => (tab.hidden ? tab : tabs.get(ids[index++])));
      tabs.clear();
      for (const tab of values) tabs.set(tab.id, tab);
      window.emit('browser-tabs-reordered', ids);
      browser.sync();
    },
    async load(tab, url, settings) {
      browser.materialize(tab);
      tab.started = true;
      tab.pending = url;
      tab.error = '';
      browser.sync();
      try {
        await tab.contents.loadURL(url, settings);
      } catch (error) {
        if (error.code !== 'ERR_ABORTED' && error.errno !== -3)
          browser.report(new Error('页面加载失败：' + (error.code || error.message)), tab);
        throw error;
      }
    },
    async action(action, value) {
      if (action === 'state') return;
      if (action === 'hide') {
        window.close();
        return;
      }
      const reason = blockedReason(window);
      if (reason) throw new Error(reason);
      if (action === 'new-tab') {
        browser.addTab({ url: 'about:blank' });
        browser.focusAddress();
      } else if (action === 'activate') {
        // A tab drag keeps focus in the toolbar until the pointer is released.
        if (value && typeof value === 'object') browser.activate(value.id, value.focus !== false);
        else browser.activate(value);
      } else if (action === 'close-tab') browser.closeTab(value || activeId);
      else if (action === 'reorder') browser.reorder(value);
      else if (action === 'restore-tab') {
        const spec = closed.pop();
        if (spec) {
          browser.addTab(spec);
          window.emit('browser-tab-restored', spec);
        }
      } else if (action === 'tab-search') {
        Menu.buildFromTemplate(
          visibleTabs().map((tab) => ({
            label: tab.title || '新标签页',
            type: 'radio',
            checked: tab.id === activeId,
            click: () => {
              if (!blockedReason(window)) browser.activate(tab.id);
            }
          }))
        ).popup({ window, x: 8, y: TAB_STRIP_HEIGHT });
      } else if (action === 'tab-menu') {
        const tab = tabs.get(value);
        if (!tab) return;
        const run = (name, arg) => void browser.action(name, arg).catch(browser.report);
        Menu.buildFromTemplate([
          { label: '新建标签页', accelerator: 'CmdOrCtrl+T', click: () => run('new-tab') },
          {
            label: '重新加载',
            click: () => {
              if (!blockedReason(window)) tab.contents?.reload();
            }
          },
          {
            label: '复制标签页',
            click: () => {
              if (!blockedReason(window))
                browser.addTab({
                  url: tab.contents?.getURL() || tab.url,
                  webPreferences: tab.webPreferences,
                  platform: tab.platform
                });
            }
          },
          { type: 'separator' },
          {
            label: '关闭标签页',
            accelerator: 'CmdOrCtrl+W',
            click: () => run('close-tab', tab.id)
          },
          {
            label: '关闭其他标签页',
            enabled: tabs.size > 1,
            click: () => {
              if (blockedReason(window)) return;
              for (const id of [...tabs.keys()]) if (id !== tab.id) browser.closeTab(id);
            }
          },
          {
            label: '重新打开关闭的标签页',
            accelerator: 'CmdOrCtrl+Shift+T',
            enabled: closed.length > 0,
            click: () => run('restore-tab')
          }
        ]).popup({ window });
      } else {
        const tab = active(),
          wc = tab?.contents;
        if (!wc) return;
        const history = wc.navigationHistory;
        tab.error = '';
        tab.manual = true;
        if (action === 'back') {
          if (history.canGoBack()) history.goBack();
        } else if (action === 'forward') {
          if (history.canGoForward()) history.goForward();
        } else if (action === 'reload') wc.reload();
        else if (action === 'stop') wc.stop();
        else if (action === 'navigate' || action === 'home') {
          const url = action === 'home' ? tab.homeUrl : browserAddress(value);
          if (beforeNavigate(url, window, tab) !== false)
            void browser.load(tab, url).catch(() => {});
        } else throw new Error('不支持的浏览器操作。');
      }
      browser.sync();
    }
  };
  function onKey(event, input) {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const key = input.key.toLowerCase(),
      ctrl = input.control || input.meta;
    let action, value;
    if (ctrl && ['l', 't', 'w', 'tab', 'r'].includes(key)) {
      if (key === 'l') {
        event.preventDefault();
        browser.focusAddress();
        return;
      }
      if (key === 't') action = input.shift ? 'restore-tab' : 'new-tab';
      else if (key === 'w') action = input.shift ? 'hide' : 'close-tab';
      else if (key === 'r') action = 'reload';
      else {
        const ids = visibleTabs().map((tab) => tab.id),
          index = ids.indexOf(activeId);
        value = ids[(index + (input.shift ? -1 : 1) + ids.length) % ids.length];
        action = 'activate';
      }
    } else if (ctrl && /^[1-9]$/.test(key)) {
      const ids = visibleTabs().map((tab) => tab.id);
      value = ids[key === '9' ? ids.length - 1 : Number(key) - 1];
      action = 'activate';
    } else if (input.alt && ['ArrowLeft', 'ArrowRight', 'Home'].includes(input.key))
      action = input.key === 'Home' ? 'home' : input.key === 'ArrowLeft' ? 'back' : 'forward';
    else if (input.key === 'F5') action = 'reload';
    else if (input.key === 'Escape' && active()?.contents?.isLoading()) action = 'stop';
    else if (input.key === 'F11') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
      return;
    }
    if (action) {
      event.preventDefault();
      void browser.action(action, value).catch(browser.report);
    }
  }
  // Extraction always receives website contents, never the privileged toolbar.
  Object.defineProperty(window, 'webContents', {
    get: () => active()?.contents || toolbar.webContents
  });
  window.loadURL = (url, settings) => {
    if (!active()) browser.addTab({ url: '', manual: false });
    active().manual = false;
    return browser.load(active(), url, settings);
  };
  window.loadFile = (file, settings) => active().contents.loadFile(file, settings);
  window.browserToolbar = {
    ...browser,
    get activeId() {
      return activeId;
    },
    webContents: toolbar.webContents
  };
  toolbars.set(toolbar.webContents.id, browser);
  window.contentView.addChildView(toolbar);
  if (initialTab) browser.addTab({ url: '', incoming: incomingContents, manual });
  toolbar.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !input.isAutoRepeat) {
      event.preventDefault();
      const wc = active()?.contents;
      if (wc) wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'right' });
      return;
    }
    onKey(event, input);
  });
  toolbar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  toolbar.webContents.on('will-navigate', (event) => event.preventDefault());
  toolbar.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
  toolbar.webContents.once('did-finish-load', () => {
    ready = true;
    browser.sync();
    readyResolve();
  });
  for (const name of [
    'resize',
    'show',
    'hide',
    'minimize',
    'restore',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen'
  ])
    window.on(name, browser.sync);
  window.on('show', browser.repaint);
  window.on('restore', browser.repaint);
  const timer = blocked
    ? setInterval(() => {
        if (window.isDestroyed()) return;
        const current = blockedReason(window) || '';
        if (current !== lastBlocked) {
          if (!current && active()?.error === lastBlocked) active().error = '';
          if (current && active()) active().manual = false;
          browser.sync();
        }
      }, 200)
    : null;
  window.once('closed', () => {
    clearInterval(timer);
    toolbars.delete(toolbar.webContents.id);
    for (const tab of tabs.values())
      if (tab.contents) {
        tab.iconAbort?.abort();
        browsers.delete(tab.contents);
        if (!tab.contents.isDestroyed()) tab.contents.close({ waitForBeforeUnload: false });
      }
    tabs.clear();
    if (!toolbar.webContents.isDestroyed())
      toolbar.webContents.close({ waitForBeforeUnload: false });
  });
  browser.layout();
  void toolbar.webContents.loadFile(toolbarFile).catch(browser.report);
  return window;
}
module.exports = { createBrowserWindow, isManualBrowserNavigation };
