'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { boundedRead } = require('../../../src/read-deadline.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])])
    );
  return value;
}
function semantics(result) {
  const node = (id) => String(id || '').replace(/^[a-f0-9]{32}::/i, '');
  const media = (asset) => {
    let url = asset.url || '';
    try {
      const parsed = new URL(url);
      url = parsed.origin + parsed.pathname;
    } catch {}
    return [asset.kind, url, asset.source, asset.role || ''];
  };
  const assets = new Map(result.assets.map((a) => [a.id, media(a)]));
  const order = (items) => items.map((v) => JSON.stringify(canonical(v))).sort();
  return {
    nodes: result.diagnostics.nodeCount,
    edges: result.diagnostics.edgeCount,
    counts: result.diagnostics.counts,
    entries: order(
      result.entries.map((e) => ({
        nodeId: node(e.nodeId),
        kind: e.kind,
        name: e.name,
        prompt: e.prompt,
        model: e.model,
        settings: e.settings,
        group: e.group,
        outputs: (e.outputAssetIds || []).map((id) => assets.get(id)),
        references: (e.references || []).map((r) => ({
          nodeId: node(r.nodeId),
          marker: r.marker,
          assets: (r.assetIds || []).map((id) => assets.get(id))
        })),
        texts: (e.referenceTexts || []).map((t) => ({ nodeId: node(t.nodeId), text: t.text }))
      }))
    ),
    assets: order(result.assets.map(media)),
    relationships: order(
      result.edges.map((e) => ({
        source: node(e.source),
        target: node(e.target),
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle
      }))
    )
  };
}
const digest = (data) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(data)))
    .digest('hex');
module.exports = async ({
  ui,
  root,
  app,
  runExtraction,
  authorService,
  getWindow,
  getFeedback
}) => {
  const out = path.join(root, '开发辅助/验收记录/v1.3/hidden-rendering');
  await fs.mkdir(out, { recursive: true });
  const baselinePaths = JSON.parse(
    await fs.readFile(path.join(root, '.runtime/hidden-baselines.json'), 'utf8')
  );
  const baseline = await Promise.all(
    Object.entries(baselinePaths).map(async ([url, file]) => ({
      url,
      file,
      result: JSON.parse(await fs.readFile(file, 'utf8')).result
    }))
  );
  assert.ok(
    baseline.length >= 2,
    'Two earlier visible-mode real projects are required for comparison'
  );
  const shows = [],
    windows = [],
    results = [],
    checks = [];
  const created = (_event, win) => {
    if (win === ui) return;
    windows.push(win);
    win.on('show', () => shows.push({ title: win.getTitle(), at: new Date().toISOString() }));
  };
  app.on('browser-window-created', created);
  const report = async (extra) =>
    fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify({ passed: false, checks, results, shows, ...extra }, null, 2)
    );
  try {
    assert.equal(app.commandLine.hasSwitch('headless'), false);
    await ui.webContents.executeJavaScript(`document.getElementById('show-first').checked=false`);
    assert.equal(
      await ui.webContents.executeJavaScript(`document.getElementById('show-first').checked`),
      false
    );
    for (const previous of baseline.slice(0, 2)) {
      const started = Date.now();
      console.log('Hidden read:', previous.result.metadata.title);
      const result = await runExtraction(previous.url, {
        mode: 'full',
        visible: false,
        timeout: 65000
      });
      const elapsedMs = Date.now() - started,
        win = getWindow(),
        prefs = win.webContents.getLastWebPreferences();
      assert.equal(win.isVisible(), false);
      assert.equal(win.isMinimized(), false);
      assert.equal(Boolean(prefs.offscreen), false);
      assert.equal(prefs.backgroundThrottling, false);
      assert.equal(getFeedback().overlay.isVisible(), false);
      const rendering = await boundedRead(
        () =>
          win.webContents.executeJavaScript(
            `(async()=>{const start=performance.now();let frames=0;await new Promise(resolve=>{const tick=()=>{if(++frames>=6)resolve();else requestAnimationFrame(tick)};requestAnimationFrame(tick)});return{visibility:document.visibilityState,hidden:document.hidden,focused:document.hasFocus(),frames,frameElapsedMs:performance.now()-start,width:innerWidth,height:innerHeight}})()`
          ),
        { timeoutMs: 4000 }
      );
      assert.equal(rendering.visibility, 'visible');
      assert.equal(rendering.hidden, false);
      assert.equal(rendering.frames, 6);
      const picture = await win.webContents.capturePage(),
        bitmap = picture.toBitmap(),
        colors = new Set();
      for (
        let offset = 0;
        offset < bitmap.length;
        offset += Math.max(4, Math.floor(bitmap.length / 4096 / 4) * 4)
      )
        colors.add(bitmap.readUInt32LE(offset));
      assert.ok(colors.size > 10, 'Hidden window must produce actual painted page content');
      const expected = semantics(previous.result),
        actual = semantics(result),
        matches = digest(expected) === digest(actual);
      const record = {
        title: result.metadata.title,
        url: previous.url,
        elapsedMs,
        nodes: actual.nodes,
        edges: actual.edges,
        entries: result.entries.length,
        assets: result.assets.length,
        baselineFile: previous.file,
        matchesVisibleBaseline: matches,
        semanticHash: digest(actual),
        baselineSemanticHash: digest(expected),
        windowVisible: win.isVisible(),
        offscreen: Boolean(prefs.offscreen),
        backgroundThrottling: prefs.backgroundThrottling,
        rendering,
        paintedColorSamples: colors.size
      };
      results.push(record);
      await fs.writeFile(path.join(out, result.metadata.title + '-hidden.png'), picture.toPNG());
      await fs.writeFile(
        path.join(out, result.metadata.title + '-result.json'),
        JSON.stringify(result, null, 2)
      );
      if (!matches)
        await fs.writeFile(
          path.join(out, result.metadata.title + '-comparison.json'),
          JSON.stringify({ expected, actual }, null, 2)
        );
      await report();
      assert.equal(
        matches,
        true,
        'Hidden read differs from the previous visible-mode result: ' + result.metadata.title
      );
      checks.push(
        'Hidden rendering preserves complete nodes, prompts, assets and relationships: ' +
          result.metadata.title
      );
      console.log(
        'PASS',
        result.metadata.title,
        JSON.stringify({
          elapsedMs,
          nodes: record.nodes,
          entries: record.entries,
          assets: record.assets,
          frames: rendering.frames,
          matchesVisibleBaseline: matches
        })
      );
    }
    await authorService.open(
      'https://www.liblib.tv/profile?uuid=555929c6461b41a2a6ae244803bfd03c',
      { mode: 'full' }
    );
    const selected = authorService
      .snapshot()
      .works.filter((w) => baseline.some((b) => b.url === w.url))
      .slice(0, 2);
    assert.equal(selected.length, 2);
    authorService.select(selected.map((w) => w.id));
    const deadline = Date.now() + 150000;
    while (authorService.reading) {
      assert.ok(Date.now() < deadline, 'Author selection read exceeded deadline');
      await wait(500);
    }
    const snapshot = authorService.snapshot();
    assert.ok(
      snapshot.works
        .filter((w) => snapshot.selectedIds.includes(w.id))
        .every((w) => w.state === 'ready')
    );
    assert.equal(getWindow().isVisible(), false);
    assert.equal(getFeedback().overlay.isVisible(), false);
    checks.push(
      'Author selection also reads two real works without showing a platform or progress window'
    );
    assert.deepEqual(shows, []);
    assert.ok(windows.length >= 2);
    checks.push(
      'All platform and progress windows remained hidden throughout; no headless or offscreen mode enabled'
    );
    await report({ passed: true });
    console.log('PASS Hidden-rendering verification completed without any shown windows');
  } catch (error) {
    const win = getWindow(),
      diagnostic = { error: error.message };
    if (win && !win.isDestroyed()) {
      diagnostic.hiddenWindow = {
        visible: win.isVisible(),
        loading: win.webContents.isLoadingMainFrame(),
        url: win.webContents.getURL()
      };
      try {
        diagnostic.page = await boundedRead(
          () =>
            win.webContents.executeJavaScript(
              `({url:location.href,readyState:document.readyState,visibility:document.visibilityState,title:document.title,text:document.body?.innerText.slice(0,2500),frames:[...document.querySelectorAll('iframe')].map(f=>f.src)})`
            ),
          { timeoutMs: 2500 }
        );
      } catch (e) {
        diagnostic.pageError = e.message;
      }
      try {
        const picture = await boundedRead(() => win.webContents.capturePage(), { timeoutMs: 2500 });
        await fs.writeFile(path.join(out, 'hidden-failure.png'), picture.toPNG());
      } catch {}
    }
    const started = Date.now();
    console.log(
      'Hidden mode did not finish; running the same work with its window visible for comparison'
    );
    try {
      const control = await runExtraction(baseline[0].url, {
        mode: 'full',
        visible: true,
        timeout: 65000
      });
      diagnostic.visibleControl = {
        success: true,
        elapsedMs: Date.now() - started,
        nodes: control.diagnostics.nodeCount,
        entries: control.entries.length,
        assets: control.assets.length,
        matchesPreviousVisibleBaseline:
          digest(semantics(control)) === digest(semantics(baseline[0].result))
      };
      console.log('Visible control:', JSON.stringify(diagnostic.visibleControl));
    } catch (controlError) {
      diagnostic.visibleControl = {
        success: false,
        elapsedMs: Date.now() - started,
        error: controlError.message
      };
      console.log('Visible control:', JSON.stringify(diagnostic.visibleControl));
    } finally {
      getWindow()?.hide();
    }
    await report(diagnostic);
    throw error;
  } finally {
    app.removeListener('browser-window-created', created);
  }
};
module.exports.semantics = semantics;
module.exports.digest = digest;
