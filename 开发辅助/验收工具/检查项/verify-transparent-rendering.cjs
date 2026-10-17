'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { boundedRead } = require('../../../src/read-deadline.cjs');
const {
  beginTransparentRead,
  endTransparentRead,
  isTransparentRead
} = require('../../../src/platform-presentation.cjs');
const { semantics, digest } = require('./verify-hidden-rendering.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({
  root,
  app,
  ui,
  runExtraction,
  authorService,
  getWindow,
  getFeedback
}) => {
  const out = path.join(root, '开发辅助/验收记录/v1.3/transparent-rendering');
  await fs.mkdir(out, { recursive: true });
  const baselinePaths = JSON.parse(
    await fs.readFile(path.join(root, '.runtime/hidden-baselines.json'), 'utf8')
  );
  const baselines = await Promise.all(
    Object.entries(baselinePaths).map(async ([url, file]) => ({
      url,
      file,
      result: JSON.parse(await fs.readFile(file, 'utf8')).result
    }))
  );
  const report = { passed: false, results: [], samples: [], shownWindows: [], rendering: [] };
  assert.equal(
    await ui.webContents.executeJavaScript("document.getElementById('show-first').checked"),
    false
  );
  const created = (_event, win) => {
    if (win === ui) return;
    win.on('show', () =>
      report.shownWindows.push({
        title: win.getTitle(),
        opacity: win.getOpacity(),
        focused: win.isFocused(),
        transparentRead: isTransparentRead(win)
      })
    );
  };
  app.on('browser-window-created', created);
  const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  let sampling;
  try {
    assert.equal(app.commandLine.hasSwitch('headless'), false);
    for (const baseline of baselines) {
      console.log('Transparent read:', baseline.result.metadata.title);
      const started = Date.now();
      let done = false;
      const extraction = runExtraction(baseline.url, {
        mode: 'full',
        visible: false,
        timeout: 65000
      });
      const sample = async () => {
        let painted = false;
        while (!done) {
          const win = getWindow();
          if (win && !win.isDestroyed() && isTransparentRead(win)) {
            const native = {
              visible: win.isVisible(),
              opacity: win.getOpacity(),
              focused: win.isFocused(),
              focusable: win.isFocusable(),
              minimized: win.isMinimized(),
              offscreen: Boolean(win.webContents.getLastWebPreferences().offscreen),
              backgroundThrottling: win.webContents.getBackgroundThrottling(),
              overlayVisible: Boolean(getFeedback()?.overlay?.isVisible())
            };
            report.samples.push(native);
            assert.equal(native.visible, true);
            assert.equal(native.opacity, 0);
            assert.equal(native.focused, false);
            assert.equal(native.minimized, false);
            assert.equal(native.offscreen, false);
            assert.equal(native.backgroundThrottling, false);
            assert.equal(native.overlayVisible, false);
            if (
              !painted &&
              Date.now() - started > 3000 &&
              win.webContents.getURL().startsWith('https:')
            ) {
              painted = true;
              const rendering = { title: baseline.result.metadata.title };
              try {
                rendering.page = await boundedRead(
                  () =>
                    win.webContents.executeJavaScript(
                      `(async()=>{let frames=0;const start=performance.now();await new Promise(resolve=>{const frame=()=>{if(++frames===6)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});return {visibility:document.visibilityState,focused:document.hasFocus(),frames,elapsed:performance.now()-start,width:innerWidth,height:innerHeight}})()`
                    ),
                  { timeoutMs: 2500 }
                );
              } catch (e) {
                rendering.frameError = e.message;
              }
              try {
                const picture = await boundedRead(() => win.webContents.capturePage(), {
                  timeoutMs: 2500
                });
                await fs.writeFile(
                  path.join(out, baseline.result.metadata.title + '-transparent.png'),
                  picture.toPNG()
                );
                const bitmap = picture.toBitmap(),
                  colors = new Set();
                for (
                  let i = 0;
                  i < bitmap.length;
                  i += Math.max(4, Math.floor(bitmap.length / 4096 / 4) * 4)
                )
                  colors.add(bitmap.readUInt32LE(i));
                rendering.paintedColors = colors.size;
              } catch (e) {
                rendering.captureError = e.message;
              }
              report.rendering.push(rendering);
            }
          }
          await wait(250);
        }
      };
      sampling = sample();
      // Attach a rejection handler immediately; it is awaited below after extraction.
      sampling.catch(() => {});
      let result;
      try {
        result = await extraction;
      } finally {
        done = true;
        await sampling;
      }
      const expected = digest(semantics(baseline.result)),
        actual = digest(semantics(result));
      report.results.push({
        title: result.metadata.title,
        elapsedMs: Date.now() - started,
        nodes: result.diagnostics.nodeCount,
        entries: result.entries.length,
        assets: result.assets.length,
        matchesVisibleBaseline: expected === actual,
        semanticHash: actual,
        baselineSemanticHash: expected
      });
      await fs.writeFile(
        path.join(out, result.metadata.title + '-result.json'),
        JSON.stringify(result, null, 2)
      );
      await save();
      assert.equal(actual, expected, 'Transparent extraction must match the visible baseline');
      assert.equal(getWindow().isVisible(), false, 'Cleanup hides the native window');
      assert.equal(getWindow().getOpacity(), 1, 'Cleanup restores opacity');
      assert.equal(getWindow().isFocusable(), true, 'Cleanup restores keyboard input');
      assert.equal(isTransparentRead(getWindow()), false);
      console.log('PASS', JSON.stringify(report.results.at(-1)));
    }
    const win = getWindow();
    beginTransparentRead(win);
    try {
      report.stablePage = await boundedRead(
        () =>
          win.webContents.executeJavaScript(
            '({visibility:document.visibilityState,readyState:document.readyState,focused:document.hasFocus()})'
          ),
        { timeoutMs: 2000 }
      );
      try {
        report.stableAnimation = await boundedRead(
          () =>
            win.webContents.executeJavaScript(
              '(async()=>{let frames=0;await new Promise(resolve=>{function tick(){if(++frames===6)resolve();else requestAnimationFrame(tick)};requestAnimationFrame(tick)});return {frames,visibility:document.visibilityState}})()'
            ),
          { timeoutMs: 2500 }
        );
      } catch (e) {
        report.stableAnimationError = e.message;
      }
    } finally {
      endTransparentRead(win);
    }
    console.log(
      'Stable page animation:',
      JSON.stringify(report.stableAnimation || { error: report.stableAnimationError })
    );
    // Native cleanup must also run when cancellation interrupts an active read.
    const cancelled = runExtraction(baselines[0].url, {
      mode: 'full',
      visible: false,
      timeout: 65000
    });
    const cancelledResult = cancelled.then(
      () => null,
      (error) => error
    );
    const cancelDeadline = Date.now() + 10000;
    while (!isTransparentRead(getWindow())) {
      assert.ok(Date.now() < cancelDeadline, 'Expected an active transparent read');
      await wait(25);
    }
    await ui.webContents.executeJavaScript('window.lab.cancel()');
    assert.equal((await cancelledResult)?.code, 'READ_CANCELLED');
    assert.equal(getWindow().isVisible(), false);
    assert.equal(getWindow().getOpacity(), 1);
    assert.equal(getWindow().isFocusable(), true);
    report.cancellationRestored = true;
    await authorService.open(
      'https://www.liblib.tv/profile?uuid=555929c6461b41a2a6ae244803bfd03c',
      { mode: 'full' }
    );
    const selected = authorService
      .snapshot()
      .works.filter((work) => baselines.some((b) => b.url === work.url));
    assert.equal(selected.length, 2);
    authorService.select(selected.map((work) => work.id));
    const authorDeadline = Date.now() + 150000;
    const authorNative = [];
    while (authorService.reading) {
      assert.ok(Date.now() < authorDeadline, 'Author batch timed out');
      const platform = getWindow();
      if (isTransparentRead(platform)) {
        authorNative.push({
          visible: platform.isVisible(),
          opacity: platform.getOpacity(),
          focused: platform.isFocused(),
          overlayVisible: Boolean(getFeedback()?.overlay?.isVisible())
        });
      }
      await wait(100);
    }
    const snapshot = authorService.snapshot();
    report.authorWorks = snapshot.works
      .filter((work) => snapshot.selectedIds.includes(work.id))
      .map((work) => ({ title: work.title, state: work.state, error: work.error }));
    assert.ok(report.authorWorks.every((work) => work.state === 'ready'));
    assert.ok(authorNative.length > 0);
    assert.ok(
      authorNative.every(
        (native) =>
          native.visible && native.opacity === 0 && !native.focused && !native.overlayVisible
      )
    );
    assert.equal(getWindow().isVisible(), false);
    assert.equal(getWindow().getOpacity(), 1);
    report.authorNativeSamples = authorNative.length;
    console.log('PASS Author batch and cancellation cleanup');
    assert.ok(report.samples.length > 0);
    assert.ok(report.shownWindows.length > 0);
    assert.ok(
      report.shownWindows.every((w) => w.opacity === 0 && !w.focused && w.transparentRead),
      'No opaque or focused window should appear'
    );
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      report.cleanedWindow = {
        visible: win.isVisible(),
        opacity: win.getOpacity(),
        focusable: win.isFocusable(),
        transparentRead: isTransparentRead(win)
      };
      try {
        report.failurePage = await boundedRead(
          () =>
            win.webContents.executeJavaScript(
              `({url:location.href,readyState:document.readyState,visibility:document.visibilityState,text:document.body?.innerText.slice(0,1800)})`
            ),
          { timeoutMs: 2500 }
        );
      } catch (e) {
        report.pageError = e.message;
      }
    }
    throw error;
  } finally {
    app.removeListener('browser-window-created', created);
    await save();
  }
};
