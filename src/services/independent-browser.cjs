'use strict';
const { browserAddress, isBrowserAddress } = require('../browser-address.cjs');
const { homeUrls } = require('../platforms/registry.cjs');
const { HOMES } = require('./author-profiles.cjs');
const hosts = {
  liblib: ['liblib.tv', 'www.liblib.tv', 'liblib.art', 'www.liblib.art'],
  jimeng: ['jimeng.jianying.com'],
  rhtv: ['rhtv.runninghub.cn', 'runninghub.cn', 'www.runninghub.cn'],
  tapnow: ['app.tapnow.plus', 'tapnow.plus', 'www.tapnow.plus'],
  neowow: ['neowow.cn', 'www.neowow.cn'],
  xiaohongshu: ['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com', 'www.xhslink.com'],
  douyin: ['douyin.com', 'www.douyin.com', 'v.douyin.com', 'iesdouyin.com', 'www.iesdouyin.com'],
  bilibili: ['bilibili.com', 'www.bilibili.com', 'space.bilibili.com', 'b23.tv']
};
function siteForUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const id = Object.keys(hosts).find((key) => hosts[key].includes(host));
  if (!id) return null;
  return {
    id,
    partition: 'persist:' + (HOMES[id] ? 'social-' : '') + id,
    homeUrl: HOMES[id] || homeUrls()[id]
  };
}
// User browsing has its own window registry. Only persistent sessions are shared
// with extraction; selection and platform visibility never own these windows.
class IndependentBrowser {
  constructor({ createWindow, icon, onOpen = () => {} }) {
    Object.assign(this, { createWindow, icon, onOpen });
    this.windows = new Map();
  }
  handoff(url, partition, window = null) {
    const site = siteForUrl(url);
    if (!site || site.partition === partition) return false;
    if (window) this.openGroupedTab(window, url, site.partition, true);
    else this.open(url);
    return true;
  }
  create(url, partition, incoming = {}, grouped = false) {
    const win = this.createWindow(
      {
        ...incoming,
        icon: this.icon,
        width: 1280,
        height: 860,
        show: true,
        autoHideMenuBar: true,
        title: '网站访问',
        webPreferences: {
          ...incoming.webPreferences,
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false
        }
      },
      {
        homeUrl: siteForUrl(url)?.homeUrl || 'https://www.google.com/',
        manual: true,
        initialTab: !grouped,
        onTabCreated: (tab, window) =>
          this.configureContents(window, tab.contents, tab.webPreferences?.partition || partition),
        beforeNavigate: (address, window, tab) =>
          !this.handoff(
            address,
            tab?.webPreferences?.partition || partition,
            grouped ? window : null
          )
      }
    );
    this.windows.set(win, { partition, url, grouped });
    win.once('closed', () => this.windows.delete(win));
    // Lightweight service fixtures do not materialize WebContentsView tabs.
    if (!win.browserToolbar) this.configureContents(win, win.webContents, partition);
    this.onOpen();
    return win;
  }
  configureContents(win, wc, partition) {
    const handoff = (url) =>
      this.handoff(url, partition, this.windows.get(win)?.grouped ? win : null);
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const guard = (event, address) => {
      if (!isBrowserAddress(address) || handoff(address)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url: address }) => {
      if (!isBrowserAddress(address) || handoff(address)) return { action: 'deny' };
      return {
        action: 'allow',
        createWindow: (options) =>
          win.browserToolbar
            ? win.browserToolbar.addTab({
                url: address,
                incoming: options.webContents,
                webPreferences: { ...options.webPreferences, partition }
              }).contents
            : this.create(address, partition, options).webContents
      };
    });
  }
  open(input, { partition } = {}) {
    if (typeof input !== 'string' || !input.trim() || input.length > 8192)
      throw new Error('请输入网址或搜索关键词。');
    const url = browserAddress(input);
    partition ||= siteForUrl(url)?.partition || 'persist:browser';
    for (const [win, info] of this.windows) {
      if (
        !win.isDestroyed() &&
        info.partition === partition &&
        (win.webContents.getURL() || info.url) === url
      ) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        return win;
      }
    }
    const win = this.create(url, partition);
    void win.loadURL(url).catch(() => {});
    win.show();
    win.focus();
    return win;
  }
  openPlatform(platform) {
    const url = homeUrls()[platform];
    if (!url) throw new Error('不支持的平台。');
    return this.open(url, { partition: 'persist:' + platform });
  }
  openSocial(platform) {
    if (!HOMES[platform]) throw new Error('不支持的社交平台。');
    return this.open(HOMES[platform], { partition: 'persist:social-' + platform });
  }
  openGroupedTab(win, url, partition, activate = false) {
    const browser = win.browserToolbar;
    const existing = [...browser.tabs.values()].find(
      (tab) =>
        tab.webPreferences?.partition === partition &&
        (tab.presetUrl === url || (tab.contents?.getURL() || tab.url) === url)
    );
    if (existing) {
      if (activate) browser.activate(existing.id);
      return existing;
    }
    return browser.addTab({
      url,
      presetUrl: url,
      homeUrl: url,
      webPreferences: { partition },
      activate
    });
  }
  openAll() {
    if (!this.groupWindow || this.groupWindow.isDestroyed())
      this.groupWindow = this.create('https://www.google.com/', 'persist:browser', {}, true);
    const win = this.groupWindow;
    const sites = [
      ...Object.entries(homeUrls()).map(([id, url]) => ({ url, partition: 'persist:' + id })),
      { url: 'https://www.midjourney.com/', partition: 'persist:browser' },
      ...Object.entries(HOMES).map(([id, url]) => ({ url, partition: 'persist:social-' + id }))
    ];
    const tabs = sites.map((site) => this.openGroupedTab(win, site.url, site.partition));
    win.browserToolbar.activate(tabs[0].id);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { count: tabs.length };
  }
  dispose() {
    for (const win of this.windows.keys()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
  }
}
module.exports = { IndependentBrowser, siteForUrl };
