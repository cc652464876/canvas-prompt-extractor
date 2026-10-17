'use strict';
const { browserAddress, isBrowserAddress } = require('../browser-address.cjs');
const { homeUrls } = require('../platforms/registry.cjs');
const { HOMES } = require('./author-profiles.cjs');
const hosts = {
  liblib: ['liblib.tv', 'www.liblib.tv', 'liblib.art', 'www.liblib.art'],
  jimeng: ['jimeng.jianying.com'],
  rhtv: ['rhtv.runninghub.cn', 'runninghub.cn', 'www.runninghub.cn'],
  tapnow: ['app.tapnow.plus', 'tapnow.plus', 'www.tapnow.plus'],
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
  handoff(url, partition) {
    const site = siteForUrl(url);
    if (!site || site.partition === partition) return false;
    this.open(url);
    return true;
  }
  create(url, partition, incoming = {}) {
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
        beforeNavigate: (address) => !this.handoff(address, partition)
      }
    );
    this.windows.set(win, { partition, url });
    win.once('closed', () => this.windows.delete(win));
    const wc = win.webContents;
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const guard = (event, address) => {
      if (!isBrowserAddress(address) || this.handoff(address, partition)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url: address }) => {
      if (!isBrowserAddress(address) || this.handoff(address, partition)) return { action: 'deny' };
      return {
        action: 'allow',
        createWindow: (options) => this.create(address, partition, options).webContents
      };
    });
    this.onOpen();
    return win;
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
  dispose() {
    for (const win of this.windows.keys()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
  }
}
module.exports = { IndependentBrowser, siteForUrl };
