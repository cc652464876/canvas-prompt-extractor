'use strict';
const { beginTransparentRead, endTransparentRead } = require('./platform-presentation.cjs');
function presentWindow(window, visible) {
  if (!window || window.isDestroyed()) return;
  if (visible) {
    // Selection changes adjust the existing shown window in place. Hiding and
    // showing it again can reorder native windows even with showInactive().
    endTransparentRead(window, false, { keepVisible: true });
    if (!window.isVisible()) window.showInactive();
  } else beginTransparentRead(window);
}
class WorkWindows {
  constructor({ createWindow, getVisible }) {
    this.createWindow = createWindow;
    this.getVisible = getVisible;
    this.windows = new Map();
    this.selected = new Set();
    this.authorMode = false;
  }
  owns(window) {
    return [...this.windows.values()].some((record) => record.window === window);
  }
  get(platform, url) {
    const key = platform + '|' + url;
    let record = this.windows.get(key);
    if (!record || record.window.isDestroyed()) {
      record = { platform, url, window: this.createWindow(platform) };
      this.windows.set(key, record);
    }
    this.present(record.window);
    return record.window;
  }
  select(works) {
    this.authorMode = true;
    this.selected = new Set(works.map((work) => work.url));
    this.sync();
  }
  leave() {
    this.authorMode = false;
    this.selected.clear();
    this.sync();
  }
  present(window) {
    const record = [...this.windows.values()].find((record) => record.window === window);
    if (record)
      presentWindow(window, this.authorMode && this.getVisible() && this.selected.has(record.url));
  }
  sync() {
    for (const { window } of this.windows.values()) this.present(window);
  }
  reset() {
    this.windows.clear();
    this.selected.clear();
    this.authorMode = false;
  }
}
module.exports = { WorkWindows, presentWindow };
