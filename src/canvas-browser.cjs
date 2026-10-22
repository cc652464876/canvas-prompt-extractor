'use strict';
const { CanvasTabs } = require('./canvas-tabs.cjs');
const { createBrowserWindow } = require('./browser-window.cjs');
const { isBrowserAddress } = require('./browser-address.cjs');
const { getAdapter, resolvePlatform, httpsUrl } = require('./platforms/registry.cjs');
const {
  beginTransparentRead,
  endTransparentRead,
  isTransparentRead
} = require('./platform-presentation.cjs');
function canvasAddress(value) {
  try {
    const url = httpsUrl(value),
      { platform } = resolvePlatform(value);
    if (getAdapter(platform).isWorkUrl(url)) return url.href;
  } catch {}
  return '';
}
// Work selection is a controller of the shared browser; it owns no separate UI.
class CanvasBrowserWindow {
  constructor({ icon, getContext, onError = () => {} }) {
    Object.assign(this, { icon, getContext, onError });
    this.model = new CanvasTabs();
    this.pages = new Map();
    this.window = null;
    this.userHidden = true;
    this.disposed = false;
    this.revision = 0;
  }
  state() {
    return {
      ...this.window?.browserToolbar.state(),
      key: this.model.key,
      visible:
        !this.userHidden &&
        Boolean(this.window?.browserToolbar.tabs.size) &&
        !this.window?.isMinimized()
    };
  }
  publish() {
    this.window?.browserToolbar.sync();
  }
  setupPage(page) {
    const wc = page.contents;
    page.sourceUrl ||= page.url;
    page.generation = 0;
    if (page.managed) this.pages.set(page.id, page);
    const guard = (event, url) => {
      if (!isBrowserAddress(url)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('dom-ready', () => {
      if (page.managed) this.openOfficialCanvas(page);
    });
    wc.on('did-navigate-in-page', (_event, _url, main) => {
      if (main && page.managed) this.openOfficialCanvas(page);
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (!isBrowserAddress(url)) return { action: 'deny' };
      if (
        page.managed &&
        canvasAddress(url) &&
        getAdapter(resolvePlatform(url).platform).isCanvasUrl(new URL(url))
      ) {
        void this.window.browserToolbar.load(page, url).catch(() => {});
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        createWindow: (options) =>
          this.window.browserToolbar.addTab({
            url,
            incoming: options.webContents,
            webPreferences: options.webPreferences
          }).contents
      };
    });
  }
  openOfficialCanvas(page) {
    clearTimeout(page.timer);
    const generation = ++page.generation;
    // Manual navigation away from this work must not start the canvas poller.
    if (!canvasAddress(page.contents.getURL())) return;
    let attempts = 0;
    const poll = async () => {
      const wc = page.contents;
      if (
        this.disposed ||
        wc.isDestroyed() ||
        generation !== page.generation ||
        !canvasAddress(wc.getURL())
      )
        return;
      let result;
      try {
        const { platform } = resolvePlatform(wc.getURL());
        const openCanvas = getAdapter(platform).page.openCanvas;
        result = await wc.executeJavaScript('(' + openCanvas.toString() + ')(true,false)');
      } catch {
        /* Navigation can destroy the old document context. */
      }
      if (
        this.disposed ||
        wc.isDestroyed() ||
        generation !== page.generation ||
        result?.alreadyOpen
      )
        return;
      if (++attempts < 100) page.timer = setTimeout(poll, 600);
    };
    void poll();
  }
  present(focus = false) {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    const browser = win.browserToolbar;
    const visible = !this.userHidden && Boolean(browser.tabs.size);
    for (const tab of browser.tabs.values())
      if (tab.contents)
        tab.contents.setAudioMuted(!visible || tab.id !== browser.activeId || win.isMinimized());
    browser.sync();
    if (!visible) beginTransparentRead(win);
    else {
      const restoring = isTransparentRead(win);
      endTransparentRead(win, false, { keepVisible: true });
      if (restoring) browser.repaint();
      if (focus) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      } else if (!win.isVisible()) win.showInactive();
    }
  }
  scheduleRefresh() {
    if (!this.window || this.window.isDestroyed() || this.disposed) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => void this.refresh().catch((error) => this.onError(error.message)),
      70
    );
  }
  clearPage(page) {
    clearTimeout(page.timer);
    ++page.generation;
    this.pages.delete(page.id);
  }
  clearPages() {
    const browser = this.window?.isDestroyed() ? null : this.window?.browserToolbar;
    for (const page of this.pages.values()) this.clearPage(page);
    if (browser)
      for (const tab of [...browser.tabs.values()])
        if (tab.managed) browser.closeTab(tab.id, { remember: false, notify: false, empty: false });
    this.pages.clear();
  }
  async refresh(restore = false) {
    const revision = ++this.revision,
      context = await this.getContext();
    if (this.disposed || revision !== this.revision) return;
    if (this.model.key !== context.key) this.clearPages();
    this.model.sync(
      context.key,
      context.works
        .map((w) => ({
          id: w.id,
          title: w.title,
          url: canvasAddress(w.url)
        }))
        .filter((w) => w.url),
      restore
    );
    this.syncWorks();
  }
  syncWorks() {
    if (!this.window || this.window.isDestroyed()) return;
    const browser = this.window.browserToolbar,
      chosen = new Set(this.model.tabs.map((w) => w.id));
    const previousActive = browser.activeId;
    for (const tab of [...browser.tabs.values()])
      if (tab.managed && !chosen.has(tab.id)) {
        this.clearPage(tab);
        browser.closeTab(tab.id, { remember: false, notify: false, empty: false });
      }
    for (const work of this.model.tabs) {
      const tab = browser.tabs.get(work.id);
      if (!tab) {
        const { platform } = resolvePlatform(work.url);
        browser.addTab({
          ...work,
          managed: true,
          activate: false,
          lazy: true,
          homeUrl: getAdapter(platform).homeUrl,
          webPreferences: { partition: 'persist:' + platform }
        });
      } else if (tab.sourceUrl && tab.sourceUrl !== work.url) {
        tab.sourceUrl = work.url;
        void browser.load(tab, work.url).catch(() => {});
      }
    }
    if (!browser.tabs.has(previousActive) && this.model.activeId)
      browser.activate(this.model.activeId, false);
    this.present();
  }
  async open() {
    if (this.opening) return this.opening;
    this.opening = this.openWindow().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }
  async openWindow() {
    clearTimeout(this.refreshTimer);
    await this.refresh(true);
    if (!this.model.tabs.length) throw new Error('请先选择已公开画布且有有效作品链接的作品。');
    if (!this.window || this.window.isDestroyed()) {
      const win = (this.window = createBrowserWindow(
        {
          title: '画布',
          icon: this.icon,
          width: 1360,
          height: 900,
          minWidth: 760,
          minHeight: 520,
          show: false,
          backgroundColor: '#faf9fc',
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false
          }
        },
        {
          initialTab: false,
          homeUrl: getAdapter(resolvePlatform(this.model.tabs[0].url).platform).homeUrl,
          onTabCreated: (page) => this.setupPage(page),
          onEmpty: () => this.present()
        }
      ));
      win.on('browser-tab-activated', (tab) => {
        this.model.activate(tab.id);
        this.present();
      });
      win.on('browser-tab-closed', (tab) => {
        this.clearPage(tab);
        if (tab.managed) this.model.close(tab.id);
        this.present();
      });
      win.on('browser-tab-restored', (tab) => {
        if (this.model.selected.has(tab.id)) {
          this.model.dismissed.delete(tab.id);
          void this.refresh();
        }
      });
      win.on('browser-tabs-reordered', (ids) =>
        this.model.reorder(ids.filter((id) => this.model.selected.has(id)))
      );
      win.on('close', (event) => {
        if (this.disposed) return;
        event.preventDefault();
        this.userHidden = true;
        this.present();
      });
      win.once('closed', () => {
        this.clearPages();
        this.userHidden = true;
      });
      for (const name of ['minimize', 'restore']) win.on(name, () => this.present());
      await win.browserToolbar.ready;
      this.syncWorks();
    }
    this.userHidden = false;
    this.present(true);
    return true;
  }
  dispose() {
    this.disposed = true;
    ++this.revision;
    clearTimeout(this.refreshTimer);
    this.clearPages();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
  }
}
module.exports = { CanvasBrowserWindow, canvasAddress };
