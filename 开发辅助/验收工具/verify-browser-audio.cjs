'use strict';
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBrowserWindow } = require('../../src/browser-window.cjs');
const { ExtractionFeedback } = require('../../src/extraction-feedback.cjs');
const { holdPageAudio } = require('../../src/page-audio.cjs');
const { beginTransparentRead, endTransparentRead } = require('../../src/platform-presentation.cjs');
const { installDevToolsMenu } = require('../../src/devtools-shortcut.cjs');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-audio-check-')));
app.on('window-all-closed', () => {});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await wait(25);
  }
  throw new Error('Audio state did not settle');
}
setTimeout(() => app.exit(1), 20000).unref();
app
  .whenReady()
  .then(async () => {
    installDevToolsMenu();
    let reading = false;
    const win = createBrowserWindow(
      { show: false, width: 800, height: 600, webPreferences: { backgroundThrottling: false } },
      { blocked: () => (reading ? '正在读取画布' : '') }
    );
    try {
      await win.browserToolbar.ready;
      const browser = win.browserToolbar,
        first = win.webContents,
        firstId = browser.activeId;
      assert.equal(first.isAudioMuted(), true, 'Initially hidden pages must start muted');
      await win.loadURL('data:text/html,<title>Audio policy</title><audio></audio>');
      win.showInactive();
      assert.equal(first.isAudioMuted(), false);
      win.hide();
      assert.equal(first.isAudioMuted(), true, 'Native hide must mute synchronously');
      win.showInactive();
      assert.equal(first.isAudioMuted(), false);
      beginTransparentRead(win);
      assert.equal(win.isVisible(), true, 'Transparent reads keep rendering');
      assert.equal(first.isAudioMuted(), true, 'Transparent pages must be silent');
      await win.loadURL('data:text/html,<title>Reload while hidden</title>');
      assert.equal(first.isAudioMuted(), true, 'Navigation must preserve hidden mute');
      const second = browser.addTab({ url: 'about:blank' });
      assert.equal(second.contents.isAudioMuted(), true, 'New hidden tabs must start muted');
      endTransparentRead(win, true);
      assert.equal(second.contents.isAudioMuted(), false);
      assert.equal(first.isAudioMuted(), true, 'Background tabs must remain muted');
      browser.activate(firstId, false);
      assert.equal(first.isAudioMuted(), false);
      assert.equal(second.contents.isAudioMuted(), true);
      win.minimize();
      await until(() => win.isMinimized() && first.isAudioMuted());
      win.restore();
      await until(() => !win.isMinimized() && !first.isAudioMuted());
      console.log(
        'PASS hidden, transparent, minimized and background tabs mute; visible active tabs restore'
      );

      for (const phase of ['done', 'error', 'cancelled']) {
        reading = true;
        const release = holdPageAudio(first);
        browser.syncAudio();
        const feedback = new ExtractionFeedback(win, { frameTimeoutMs: 100 });
        await feedback.initialize();
        browser.sync();
        assert.equal(first.isAudioMuted(), true, 'Toolbar updates cannot unmute a reader');
        beginTransparentRead(win);
        endTransparentRead(win, true);
        assert.equal(first.isAudioMuted(), true, 'Showing a reading page must keep it muted');
        browser.activate(second.id, false);
        assert.equal(second.contents.isAudioMuted(), true, 'All platform tabs mute during reading');
        browser.activate(firstId, false);
        feedback.dismiss();
        assert.equal(first.isAudioMuted(), true, 'Dismissing progress does not release mute');
        if (phase !== 'done') beginTransparentRead(win);
        await feedback.finish('finished', phase);
        assert.equal(first.isAudioMuted(), true, 'Task mute lasts through feedback cleanup');
        reading = false;
        browser.syncAudio();
        assert.equal(
          first.isAudioMuted(),
          true,
          'Independent task mute survives navigation unlock'
        );
        release();
        release();
        browser.syncAudio();
        assert.equal(first.isAudioMuted(), phase !== 'done', 'Cleanup follows current visibility');
        await feedback.dispose();
        assert.equal(
          first.isAudioMuted(),
          phase !== 'done',
          'Disposing old feedback preserves policy'
        );
        if (phase !== 'done') endTransparentRead(win, true);
        assert.equal(first.isAudioMuted(), false, 'Reveal after reading restores the active page');
      }
      console.log(
        'PASS success, errors and cancellation preserve mute until reading ends and obey current visibility'
      );

      browser.activate(second.id, false);
      const release = holdPageAudio(first);
      beginTransparentRead(win);
      browser.closeTab(firstId);
      release();
      assert.equal(
        second.contents.isAudioMuted(),
        true,
        'Closed page cleanup cannot unmute hidden siblings'
      );
      console.log('PASS page destruction and repeated releases are safe');
      app.exit(0);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
