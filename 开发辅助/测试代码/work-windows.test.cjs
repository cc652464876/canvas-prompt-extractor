'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { WorkWindows } = require('../../src/work-windows.cjs');
const { isTransparentRead } = require('../../src/platform-presentation.cjs');
function windowFixture() {
  return {
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
  };
}
test('Two selected works keep separate live pages; deselection and global hiding change opacity only', () => {
  let visible = true,
    created = 0;
  const library = new WorkWindows({
    createWindow: () => {
      created++;
      return windowFixture();
    },
    getVisible: () => visible
  });
  const a = { url: 'https://liblib.tv/detail/a' },
    b = { url: 'https://liblib.tv/detail/b' };
  library.select([a, b]);
  const wa = library.get('liblib', a.url),
    wb = library.get('liblib', b.url);
  assert.notEqual(wa, wb);
  assert.equal(wa.opacity, 1);
  assert.equal(wb.opacity, 1);
  wa.calls.length = 0;
  wb.calls.length = 0;
  library.select([b]);
  assert.equal(wa.visible, true);
  assert.equal(wa.opacity, 0);
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
  assert.equal(library.get('liblib', a.url), wa);
  assert.equal(created, 2);
  library.leave();
  assert.equal(wa.opacity, 0);
  assert.equal(wb.opacity, 0);
});
