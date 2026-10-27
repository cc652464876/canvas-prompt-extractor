'use strict';
// Visibility and temporary readers share one native mute decision. Releasing a
// reader must not unmute a hidden page or another reader's active task.
const pages = new WeakMap();
function stateFor(contents) {
  if (!pages.has(contents))
    pages.set(contents, {
      holds: new Set(),
      shouldMute: null,
      previousMuted: contents.isAudioMuted()
    });
  return pages.get(contents);
}
function syncPageAudio(contents) {
  if (contents.isDestroyed()) return;
  const state = pages.get(contents);
  if (!state) return;
  const muted = Boolean(
    state.holds.size || (state.shouldMute ? state.shouldMute() : state.previousMuted)
  );
  if (contents.isAudioMuted() !== muted) contents.setAudioMuted(muted);
}
function bindPageAudio(contents, shouldMute) {
  stateFor(contents).shouldMute = shouldMute;
  syncPageAudio(contents);
}
function holdPageAudio(contents) {
  const state = stateFor(contents),
    hold = Symbol();
  if (!state.shouldMute && !state.holds.size) state.previousMuted = contents.isAudioMuted();
  state.holds.add(hold);
  syncPageAudio(contents);
  return () => {
    state.holds.delete(hold);
    syncPageAudio(contents);
  };
}
module.exports = { bindPageAudio, syncPageAudio, holdPageAudio };
