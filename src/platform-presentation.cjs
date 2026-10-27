'use strict';
// Native opacity only: the website still runs in an ordinary shown window.
// Keep this experiment opt-in until real extraction has been verified.
const transparentWindows = new WeakMap();
function isTransparentRead(window) {
  return transparentWindows.has(window);
}
function beginTransparentRead(window) {
  if (transparentWindows.has(window)) return;
  const previous = {
    opacity: window.getOpacity(),
    focusable: window.isFocusable()
  };
  transparentWindows.set(window, previous);
  try {
    window.browserToolbar?.syncAudio?.();
    window.setOpacity(0);
    window.setSkipTaskbar(true);
    window.setIgnoreMouseEvents(true);
    window.setFocusable(false);
    if (!window.isVisible()) window.showInactive();
  } catch (error) {
    endTransparentRead(window);
    throw error;
  }
}
function endTransparentRead(window, reveal = false, { keepVisible = false } = {}) {
  const previous = transparentWindows.get(window);
  if (!previous) return;
  transparentWindows.delete(window);
  if (window.isDestroyed()) return;
  // Cleanup hides before restoring opacity. Selection presentation can instead
  // restore a window in place to preserve native stacking order.
  if (!keepVisible || !window.isVisible()) window.hide();
  window.setIgnoreMouseEvents(false);
  window.setFocusable(previous.focusable);
  window.setSkipTaskbar(false);
  window.setOpacity(previous.opacity);
  if (reveal) window.show();
  window.browserToolbar?.syncAudio?.();
}
module.exports = { beginTransparentRead, endTransparentRead, isTransparentRead };
