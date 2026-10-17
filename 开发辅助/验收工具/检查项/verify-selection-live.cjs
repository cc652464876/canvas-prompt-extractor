'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { semantics, digest } = require('./verify-hidden-rendering.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({ ui, root, authorService, workWindows, workCache }) => {
  const out = path.join(root, '开发辅助/验收记录/v1.3/selection-live');
  await fs.mkdir(out, { recursive: true });
  const report = { passed: false, works: [] },
    run = (code) => ui.webContents.executeJavaScript(code);
  const baseline = JSON.parse(
    await fs.readFile(path.join(root, '.runtime/hidden-baselines.json'), 'utf8')
  );
  try {
    assert.equal((await run('window.lab.visible(false)')).ok, true);
    const response = await run(
      "window.lab.extract('https://www.liblib.tv/profile?uuid=555929c6461b41a2a6ae244803bfd03c',{mode:'full'})"
    );
    assert.equal(response.ok, true, JSON.stringify(response));
    const snapshot = authorService.snapshot();
    assert.equal(snapshot.selectedIds.length, snapshot.works.length);
    const works = snapshot.works.filter((work) => baseline[work.url]);
    assert.equal(works.length, 2);
    authorService.select(works.map((work) => work.id));
    const deadline = Date.now() + 160000;
    while (authorService.reading) {
      assert.ok(Date.now() < deadline, 'Live selection read timed out');
      await wait(250);
    }
    let selected = authorService
      .snapshot()
      .works.filter((work) => works.some((chosen) => chosen.id === work.id));
    report.retries = [];
    for (const failed of selected.filter((work) => work.state === 'error')) {
      report.retries.push({ title: failed.title, error: failed.error });
      console.log('Retrying real work once:', failed.title, failed.error);
      authorService.retry(failed.id);
      const retryDeadline = Date.now() + 110000;
      while (authorService.reading) {
        assert.ok(Date.now() < retryDeadline, 'Live retry timed out');
        await wait(250);
      }
    }
    selected = authorService
      .snapshot()
      .works.filter((work) => works.some((chosen) => chosen.id === work.id));
    assert.ok(
      selected.every((work) => work.state === 'ready'),
      JSON.stringify(selected)
    );
    for (const work of works) {
      const actual = await workCache.get(workCache.key(work, { mode: 'full' }));
      const expected = JSON.parse(await fs.readFile(baseline[work.url], 'utf8')).result;
      assert.ok(actual);
      assert.equal(digest(semantics(actual)), digest(semantics(expected)), work.title);
      const window = workWindows.windows.get('liblib|' + work.url).window;
      assert.equal(window.isVisible(), true);
      assert.equal(window.getOpacity(), 0);
      report.works.push({
        title: work.title,
        nodes: actual.diagnostics.nodeCount,
        prompts: actual.entries.length,
        assets: actual.assets.length,
        matchesVisibleBaseline: true,
        windowVisible: window.isVisible(),
        opacity: window.getOpacity()
      });
    }
    const pages = [...workWindows.windows.values()].map((record) => record.window);
    authorService.select([]);
    authorService.select(works.map((work) => work.id));
    assert.equal(authorService.reading, false);
    assert.deepEqual(
      [...workWindows.windows.values()].map((record) => record.window),
      pages
    );
    report.reselectionReusesPagesAndData = true;
    await fs.writeFile(path.join(out, 'ui.png'), (await ui.webContents.capturePage()).toPNG());
    report.passed = true;
    console.log(
      'PASS Real author selection, separate live pages, cache and baseline comparison',
      JSON.stringify(report.works)
    );
  } catch (error) {
    report.error = error.stack;
    throw error;
  } finally {
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
};
