'use strict';
const fs = require('node:fs/promises'),
  fsSync = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const fixtures = require('../../测试代码/fixtures/text-platforms.cjs');
const { isTransparentRead } = require('../../../src/platform-presentation.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({
  ui,
  root,
  app,
  session,
  authorService,
  workWindows,
  workCache,
  getResult,
  getVisibleWindow,
  visibilityPath
}) => {
  const out = path.join(root, '开发辅助/验收记录/v1.3/selection-flow');
  await fs.mkdir(out, { recursive: true });
  const run = (code) => ui.webContents.executeJavaScript(code),
    checks = [],
    requests = [];
  const report = { passed: false, checks };
  const author = 'a'.repeat(32),
    url = 'https://www.liblib.tv/profile?uuid=' + author;
  const works = Array.from({ length: 3 }, (_, index) => ({
    templateUuid: (index + 1).toString(16).padStart(32, '0'),
    name: '测试第' + (index + 1) + '集',
    nickname: '缓存验收作者',
    ownerUuid: author
  }));
  const ses = session.fromPartition('persist:liblib');
  ses.protocol.handle('https', (request) => {
    const address = new URL(request.url);
    if (address.pathname === '/api/canvas/project/template/list') {
      requests.push('listing');
      return Response.json({ code: 0, data: { list: works, total: 3 } });
    }
    if (address.pathname.startsWith('/detail/')) {
      requests.push(address.pathname);
      const work = works.find((work) => address.pathname.endsWith(work.templateUuid));
      const snapshot = fixtures.liblib().snapshot;
      const html =
        '<!doctype html><meta charset="utf-8"><title>' +
        work.name +
        '</title><h1>' +
        work.name +
        '</h1><div aria-label="作者信息"><button>缓存验收作者</button></div><div class="react-flow"></div><script>const snapshot=' +
        JSON.stringify(snapshot).replace(/</g, '\\u003c') +
        ';document.querySelector(".react-flow").__reactFiber_fixture={memoizedProps:{nodes:snapshot.nodes,edges:snapshot.edges}};</script>';
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (address.pathname === '/profile')
      return new Response('<!doctype html><title>作者主页</title><h1>作者主页</h1>', {
        headers: { 'content-type': 'text/html;charset=utf-8' }
      });
    return new Response(null, { status: 204 });
  });
  const until = async (predicate) => {
    const deadline = Date.now() + 35000;
    while (!(await predicate())) {
      assert.ok(Date.now() < deadline, 'Selection flow deadline');
      await wait(50);
    }
  };
  const check = (text) => {
    checks.push(text);
    console.log('PASS', text);
  };
  try {
    await until(() =>
      run("document.querySelectorAll('#platform-shortcuts .site-shortcut').length===4")
    );
    assert.equal((await run('window.lab.info()')).value.platformVisible, true);
    await run(
      `document.getElementById('url').value=${JSON.stringify(url)};document.getElementById('url').dispatchEvent(new Event('input'))`
    );
    await wait(800);
    assert.deepEqual(requests, []);
    assert.equal(authorService.active, false);
    check('Typing or pasting a profile URL makes no request until the read button is clicked');
    assert.equal((await run('window.lab.visible(false)')).ok, true);
    await run("document.getElementById('start').click()");
    await until(() => authorService.active);
    assert.equal(authorService.snapshot().selectedIds.length, 3);
    await until(() => !authorService.reading);
    assert.ok(authorService.snapshot().works.every((work) => work.state === 'idle'));
    assert.equal(requests.filter((request) => request.startsWith('/detail/')).length, 0);
    assert.equal(workWindows.windows.size, 0);
    assert.equal((await run('window.lab.visible(true)')).ok, true);
    const profileWindow = getVisibleWindow();
    assert.ok(profileWindow && profileWindow.isVisible());
    assert.equal(isTransparentRead(profileWindow), false);
    assert.equal(profileWindow.getOpacity(), 1);
    await run('window.lab.visible(false)');
    assert.equal(profileWindow.getOpacity(), 0);
    await run('window.lab.visible(true)');
    assert.equal(profileWindow.getOpacity(), 1);
    await run('window.lab.visible(false)');
    check('Before any work tab exists, hiding and revealing restores the author homepage window');
    await run("document.getElementById('author-clear').click()");
    await until(() => authorService.snapshot().selectedIds.length === 0);
    assert.equal(await run("document.getElementById('author-read').disabled"), true);
    await run("document.getElementById('author-select-all').click()");
    await until(() => authorService.snapshot().selectedIds.length === 3);
    assert.equal(requests.filter((request) => request.startsWith('/detail/')).length, 0);
    check('Author URL reads only the work list; changing selections never opens a canvas');
    assert.equal(
      await run("document.getElementById('author-read').textContent"),
      '开始读取画布（3）'
    );
    await run("document.getElementById('author-read').click()");
    await until(() => !authorService.reading);
    assert.ok(authorService.snapshot().works.every((work) => work.state === 'ready'));
    assert.equal(
      await run("document.getElementById('author-read').textContent"),
      '开始读取画布（3）'
    );
    assert.ok(getResult().assets.length > 0);
    check('Clicking read loads the profile and selects all three works by default');
    assert.equal(workWindows.windows.size, 3);
    const records = [...workWindows.windows.values()];
    const windows = [...new Set(records.map((record) => record.window))];
    assert.equal(windows.length, 1);
    const browser = windows[0].browserToolbar;
    const contents = records.map((record) => record.tab.contents);
    assert.equal(new Set(contents).size, 3);
    const sorted = records.map((record) => record.tab.id).reverse();
    await browser.action('reorder', sorted);
    assert.deepEqual(
      browser.state().tabs.map((tab) => tab.id),
      sorted
    );
    assert.ok(contents.every((wc) => wc.session === ses));
    windows[0].minimize();
    await until(() => windows[0].isMinimized());
    await run('window.lab.visible(true)');
    await until(() => !windows[0].isMinimized());
    assert.equal(windows[0].getOpacity(), 1);
    await run('window.lab.visible(false)');
    check('Explicit reveal restores the shared work window from minimized and transparent states');
    check(
      'Three work pages share one native window with independent contents and draggable tab ordering'
    );
    assert.ok(
      windows.every(
        (window) => window.isVisible() && window.getOpacity() === 0 && isTransparentRead(window)
      )
    );
    const readCounts = requests.filter((request) => request.startsWith('/detail/')).length;
    assert.equal(readCounts, 3);
    const ids = works.map((work) => work.templateUuid);
    assert.equal(
      (await run(`window.lab.selectWorks(${JSON.stringify(ids.slice(0, 2))})`)).ok,
      true
    );
    assert.equal((await run('window.lab.visible(true)')).ok, true);
    assert.equal(records[2].tab.hidden, true);
    assert.ok(windows.every((window) => window.isVisible() && window.getOpacity() === 1));
    await run(`window.lab.selectWorks(${JSON.stringify([ids[0]])})`);
    assert.equal(records[1].tab.hidden, true);
    assert.equal(contents[1].isDestroyed(), false);
    await run('window.lab.visible(false)');
    await run(`window.lab.selectWorks(${JSON.stringify([ids[0], ids[2]])})`);
    assert.ok(windows.every((window) => window.getOpacity() === 0));
    assert.equal(requests.filter((request) => request.startsWith('/detail/')).length, readCounts);
    check(
      'Deselection hides tabs while preserving live pages; the shared window follows global visibility'
    );
    await run('window.lab.visible(true)');
    ui.show();
    ui.focus();
    await wait(100);
    assert.equal(ui.isFocused(), true);
    const nativeChanges = [];
    for (const window of windows)
      for (const method of ['show', 'showInactive', 'hide', 'focus']) {
        const original = window[method].bind(window);
        window[method] = (...args) => {
          nativeChanges.push(method);
          return original(...args);
        };
      }
    await run('window.lab.selectWorks(' + JSON.stringify([ids[0]]) + ')');
    await run('window.lab.selectWorks(' + JSON.stringify(ids) + ')');
    assert.deepEqual(
      browser.state().tabs.map((tab) => tab.id),
      sorted
    );
    assert.ok(records.every((record, index) => record.tab.contents === contents[index]));
    assert.deepEqual(nativeChanges, []);
    assert.equal(ui.isFocused(), true);
    assert.ok(windows.every((window) => !window.isAlwaysOnTop()));
    check(
      'Changing selections preserves main-window focus without native hide/show or always-on-top'
    );
    await run('window.lab.visible(false)');
    const currentAssets = getResult().assets.length;
    await run(`window.lab.extract(${JSON.stringify(url)},{mode:'full'})`);
    await until(() => !authorService.reading);
    assert.equal(authorService.snapshot().selectedIds.length, 3);
    assert.equal(getResult().assets.length, 0);
    await run("document.getElementById('author-read').click()");
    await until(() => !authorService.reading);
    assert.equal(getResult().assets.length, currentAssets);
    assert.equal(requests.filter((request) => request.startsWith('/detail/')).length, readCounts);
    assert.equal(workWindows.windows.size, 3);
    check(
      'Reopening the profile waits for explicit canvas read, then restores cache without page requests'
    );
    assert.equal(
      await run("document.querySelector('.split-field').textContent.includes('.md')"),
      false
    );
    assert.equal(JSON.parse(await fs.readFile(visibilityPath, 'utf8')).visible, false);
    assert.equal(await run("document.getElementById('visibility').textContent"), '显示平台');
    report.ownedCacheDirectories = [...workCache.directories];
    assert.ok(report.ownedCacheDirectories.length > 0);
    await run("document.getElementById('author-section').scrollIntoView({block:'center'})");
    await wait(100);
    assert.equal(
      await run(
        "(()=>{const a=document.getElementById('author-select-all').getBoundingClientRect(),c=document.getElementById('author-clear').getBoundingClientRect(),r=document.getElementById('author-read').getBoundingClientRect();return a.left<c.left&&c.right<=r.left&&r.width>0;})()"
      ),
      true
    );
    await fs.writeFile(path.join(out, 'ui.png'), (await ui.webContents.capturePage()).toPNG());
    report.workPages = records.map((record) => ({
      url: record.tab.contents.getURL(),
      visible: !record.tab.hidden,
      windowId: record.window.id
    }));
    report.pageLoads = readCounts;
    assert.equal(
      (
        await run(
          'window.lab.extract(' +
            JSON.stringify('https://www.liblib.tv/detail/' + works[0].templateUuid) +
            ', {mode:"full",split:true})'
        )
      ).ok,
      true
    );
    assert.equal(authorService.active, false);
    assert.ok(getResult().entries.length > 0);
    check('A direct work URL still reads its canvas immediately in one step');
    app.once('will-quit', () => {
      try {
        assert.ok(report.ownedCacheDirectories.every((directory) => !fsSync.existsSync(directory)));
        report.passed = true;
        checks.push(
          'Graceful application exit removes its session cache and keeps the display preference'
        );
        fsSync.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      } catch (error) {
        console.error(error.stack);
        process.exitCode = 1;
      }
    });
  } catch (error) {
    report.error = error.stack;
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    throw error;
  }
};
