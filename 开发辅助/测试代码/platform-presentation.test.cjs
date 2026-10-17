'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  beginTransparentRead,
  endTransparentRead,
  isTransparentRead
} = require('../../src/platform-presentation.cjs');
function fixture() {
  const events = [];
  const state = {
    opacity: 1,
    focusable: true,
    visible: false,
    mouseIgnored: false,
    skipTaskbar: false,
    destroyed: false
  };
  const win = {
    getOpacity: () => state.opacity,
    isFocusable: () => state.focusable,
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    setOpacity: (value) => {
      events.push(['opacity', value, state.visible]);
      state.opacity = value;
    },
    setFocusable: (value) => {
      state.focusable = value;
    },
    setSkipTaskbar: (value) => {
      state.skipTaskbar = value;
    },
    setIgnoreMouseEvents: (value) => {
      state.mouseIgnored = value;
    },
    showInactive: () => {
      events.push(['show', state.opacity]);
      state.visible = true;
    },
    show: () => {
      events.push(['reveal', state.opacity, state.focusable, state.mouseIgnored]);
      state.visible = true;
    },
    hide: () => {
      events.push(['hide']);
      state.visible = false;
    }
  };
  return { win, state, events };
}
test('Silent read never exposes an opaque window on entry or cleanup, including repeated cleanup', () => {
  const { win, state, events } = fixture();
  beginTransparentRead(win);
  assert.equal(isTransparentRead(win), true);
  assert.equal(state.visible, true);
  assert.equal(state.mouseIgnored, true);
  assert.equal(state.skipTaskbar, true);
  beginTransparentRead(win);
  assert.deepEqual(
    events.filter((e) => e[0] === 'show'),
    [['show', 0]]
  );
  endTransparentRead(win);
  endTransparentRead(win);
  assert.equal(isTransparentRead(win), false);
  assert.deepEqual(state, {
    opacity: 1,
    focusable: true,
    visible: false,
    mouseIgnored: false,
    skipTaskbar: false,
    destroyed: false
  });
  assert.ok(events.filter((e) => e[0] === 'opacity' && e[1] === 1).every((e) => e[2] === false));
});
test('Manual display restores mouse and keyboard access and survives later extraction cleanup', () => {
  const { win, state, events } = fixture();
  beginTransparentRead(win);
  endTransparentRead(win, true);
  assert.deepEqual(events.at(-1), ['reveal', 1, true, false]);
  endTransparentRead(win);
  assert.equal(state.visible, true);
  assert.equal(isTransparentRead(win), false);
});
test('A destroyed transparent window can be released safely', () => {
  const { win, state } = fixture();
  beginTransparentRead(win);
  state.destroyed = true;
  endTransparentRead(win);
  assert.equal(isTransparentRead(win), false);
});
test('A failed native show restores input and opacity without exposing the page', () => {
  const { win, state } = fixture();
  win.showInactive = () => {
    throw new Error('native failure');
  };
  assert.throws(() => beginTransparentRead(win), /native failure/);
  assert.equal(state.opacity, 1);
  assert.equal(state.mouseIgnored, false);
  assert.equal(state.focusable, true);
  assert.equal(state.visible, false);
  assert.equal(isTransparentRead(win), false);
});
