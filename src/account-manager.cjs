'use strict';
const HOME_URLS = require('./platforms/registry.cjs').homeUrls();
// Passive extraction-window registry. Login cookies remain in persistent sessions;
// no page inspection, login checks, polling or account-state events run here.
class AccountManager {
  constructor({ createWindow }) {
    this.createWindow = createWindow;
    this.entries = new Map();
    this.disposed = false;
  }
  existing(platform) {
    const win = this.entries.get(platform)?.win;
    return win && !win.isDestroyed() ? win : null;
  }
  getWindow(platform) {
    if (this.disposed) throw new Error('程序正在关闭。');
    if (!HOME_URLS[platform]) throw new Error('不支持的平台。');
    const existing = this.existing(platform);
    if (existing) return existing;
    const win = this.createWindow(platform);
    const closed = () => {
      if (this.entries.get(platform)?.win === win) this.entries.delete(platform);
    };
    this.entries.set(platform, { win, closed });
    win.once('closed', closed);
    return win;
  }
  reset() {
    for (const { win } of this.entries.values()) if (!win.isDestroyed()) win.destroy();
    this.entries.clear();
  }
  dispose() {
    this.disposed = true;
    for (const { win, closed } of this.entries.values()) win.removeListener('closed', closed);
    this.entries.clear();
  }
}
module.exports = { AccountManager, HOME_URLS };
