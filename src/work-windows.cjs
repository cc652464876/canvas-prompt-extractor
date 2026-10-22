'use strict';
const {
  beginTransparentRead,
  endTransparentRead,
  isTransparentRead
} = require('./platform-presentation.cjs');
function presentWindow(window, visible) {
  if (!window || window.isDestroyed()) return;
  if (visible) {
    const restoring = isTransparentRead(window);
    // Selection changes adjust the existing shown window in place. Hiding and
    // showing it again can reorder native windows even with showInactive().
    endTransparentRead(window, false, { keepVisible: true });
    if (restoring) window.browserToolbar?.repaint?.();
    if (!window.isVisible()) window.showInactive();
  } else beginTransparentRead(window);
}
class WorkWindows {
  constructor({ createWindow, getVisible, getHomeUrl = () => '' }) {
    this.createWindow = createWindow;
    this.getVisible = getVisible;
    this.getHomeUrl = getHomeUrl;
    this.window = null;
    this.serial = 0;
    this.windows = new Map();
    this.selected = new Set();
    this.authorMode = false;
  }
  owns(window) {
    return Boolean(window && this.window === window);
  }
  get hasSelectedPages() {
    return (
      this.authorMode && [...this.windows.values()].some((record) => this.selected.has(record.url))
    );
  }
  get(platform, url) {
    const key = platform + '|' + url;
    if (!this.window || this.window.isDestroyed()) {
      this.windows.clear();
      this.window = this.createWindow(platform, { initialTab: false });
      this.window.on('browser-tab-closed', (tab) => {
        for (const [key, record] of this.windows) if (record.tab === tab) this.windows.delete(key);
      });
      this.window.on('browser-tab-restored', (spec) => {
        if (!spec.sourceUrl || !spec.platform) return;
        const tab = this.window.browserToolbar.tabs.get(spec.id);
        if (tab)
          this.windows.set(spec.platform + '|' + spec.sourceUrl, {
            platform: spec.platform,
            url: spec.sourceUrl,
            tab,
            window: this.window
          });
      });
    }
    const browser = this.window.browserToolbar;
    let record = this.windows.get(key);
    if (!record) {
      const tab = browser.addTab({
        id: 'author-work-' + ++this.serial,
        title: this.titles?.get(url) || '作品页面',
        platform,
        sourceUrl: url,
        url: '',
        homeUrl: this.getHomeUrl(platform),
        manual: false,
        activate: false,
        lazy: true,
        webPreferences: { partition: 'persist:' + platform }
      });
      record = { platform, url, tab, window: this.window };
      this.windows.set(key, record);
    }
    browser.setTabVisible(record.tab.id, true);
    browser.activate(record.tab.id, false);
    this.present(record.window);
    return record.window;
  }
  select(works) {
    this.authorMode = true;
    this.selected = new Set(
      works.filter((work) => work.canvasAccess !== 'not-public').map((work) => work.url)
    );
    this.titles = new Map(works.map((work) => [work.url, work.title]));
    this.sync();
  }
  leave() {
    this.authorMode = false;
    this.selected.clear();
    this.sync();
  }
  present(window) {
    if (this.owns(window)) {
      for (const record of this.windows.values())
        window.browserToolbar.setTabVisible(
          record.tab.id,
          this.authorMode && this.selected.has(record.url)
        );
      presentWindow(
        window,
        this.authorMode && this.getVisible() && window.browserToolbar.state().tabs.length > 0
      );
    }
  }
  sync() {
    if (this.window && !this.window.isDestroyed()) this.present(this.window);
  }
  reset() {
    this.windows.clear();
    this.window = null;
    this.selected.clear();
    this.authorMode = false;
  }
}
module.exports = { WorkWindows, presentWindow };
