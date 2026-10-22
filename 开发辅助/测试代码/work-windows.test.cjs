'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { WorkWindows } = require('../../src/work-windows.cjs');
const { isTransparentRead } = require('../../src/platform-presentation.cjs');
const { EventEmitter } = require('node:events');
function windowFixture() {
  const window = Object.assign(new EventEmitter(), {
    opacity: 1,
    visible: false,
    focusable: true,
    destroyed: false,
    getOpacity() {
      return this.opacity;
    },
    isFocusable() {
      return this.focusable;
    },
    isDestroyed() {
      return this.destroyed;
    },
    isVisible() {
      return this.visible;
    },
    setOpacity(value) {
      this.opacity = value;
    },
    setFocusable(value) {
      this.focusable = value;
    },
    setSkipTaskbar() {},
    setIgnoreMouseEvents() {},
    calls: [],
    showInactive() {
      this.calls.push('showInactive');
      this.visible = true;
    },
    hide() {
      this.calls.push('hide');
      this.visible = false;
    }
  });
  const tabs = new Map();
  window.browserToolbar = {
    tabs,
    addTab(spec) {
      const tab = { ...spec, contents: {} };
      tabs.set(tab.id, tab);
      return tab;
    },
    setTabVisible(id, visible) {
      tabs.get(id).hidden = !visible;
    },
    activate(id) {
      this.activeId = id;
    },
    state() {
      return { tabs: [...tabs.values()].filter((tab) => !tab.hidden) };
    }
  };
  return window;
}
test('Selected works share one window but retain separate tabs, sessions and live page identities', () => {
  let visible = true,
    created = 0;
  const library = new WorkWindows({
    createWindow: () => {
      created++;
      return windowFixture();
    },
    getVisible: () => visible
  });
  const a = { url: 'https://liblib.tv/detail/a', title: 'A' },
    b = { url: 'https://jimeng.jianying.com/ai-tool/work-detail/b', title: 'B' };
  library.select([a, b]);
  const wa = library.get('liblib', a.url),
    wb = library.get('jimeng', b.url);
  assert.equal(wa, wb);
  const [ta, tb] = [...wa.browserToolbar.tabs.values()];
  assert.notEqual(ta.contents, tb.contents);
  assert.equal(ta.webPreferences.partition, 'persist:liblib');
  assert.equal(tb.webPreferences.partition, 'persist:jimeng');
  assert.equal(tb.title, 'B');
  const ids = [...wa.browserToolbar.tabs.keys()];
  assert.equal(wa.opacity, 1);
  assert.equal(wb.opacity, 1);
  wa.calls.length = 0;
  wb.calls.length = 0;
  library.select([b]);
  assert.equal(wa.visible, true);
  assert.equal(ta.hidden, true);
  assert.equal(tb.hidden, false);
  assert.equal(wa.destroyed, false);
  assert.equal(wb.opacity, 1);
  visible = false;
  library.sync();
  assert.equal(wb.visible, true);
  assert.equal(wb.opacity, 0);
  library.select([a, b]);
  assert.equal(wa.opacity, 0);
  visible = true;
  library.sync();
  assert.equal(wa.opacity, 1);
  assert.equal(wb.opacity, 1);
  assert.equal(isTransparentRead(wa), false);
  assert.deepEqual(wa.calls, []);
  assert.deepEqual(wb.calls, []);
  assert.deepEqual([...wa.browserToolbar.tabs.keys()], ids);
  assert.equal(library.get('liblib', a.url), wa);
  assert.equal([...wa.browserToolbar.tabs.values()][0], ta);
  assert.equal(created, 1);
  library.leave();
  assert.equal(wa.opacity, 0);
  assert.equal(wb.opacity, 0);
  assert.ok([...wa.browserToolbar.tabs.values()].every((tab) => tab.hidden));
  library.select([a]);
  assert.equal(ta.hidden, false);
  assert.equal(library.get('liblib', a.url), wa);
  assert.equal(created, 1);
});
