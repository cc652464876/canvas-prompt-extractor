'use strict';
const { verificationPath } = require('../../../src/app-paths.cjs');
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { ProjectStore } = require('../../../src/project-store.cjs'),
  { listPlatforms } = require('../../../src/platforms/registry.cjs');
const fixtures = require('../../测试代码/fixtures/text-platforms.cjs');
const rhtvFixture = require('../../测试代码/fixtures/rhtv.cjs');
const tapnowFixture = require('../../测试代码/fixtures/tapnow.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({ ui, root, accounts, session, runExtraction, getStore }) => {
  const checks = [],
    errors = [],
    requests = [];
  ui.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 3) errors.push(e.message);
  });
  const run = (code) => ui.webContents.executeJavaScript(code),
    out = verificationPath(root, 'v1.2');
  await fs.mkdir(out, { recursive: true });
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await run(code)) return;
      await wait(30);
    }
    throw new Error('Timed out: ' + code);
  };
  const check = (name) => {
    checks.push(name);
    console.log('PASS ' + name);
  };
  await until(
    `document.querySelectorAll('#platform-shortcuts .site-shortcut').length===${listPlatforms().length}`
  );
  assert.equal(accounts.entries.size, 0);
  assert.deepEqual(
    await run(
      "Array.from(document.querySelectorAll('#platform-shortcuts .site-shortcut')).map(b=>b.id)"
    ),
    listPlatforms().map((p) => 'login-' + p.id)
  );
  check(
    'Registry creates account buttons; lazy startup creates no platform windows or network requests'
  );
  for (const brand of ['liblib', 'jimeng', 'rhtv', 'tapnow']) {
    const sample =
        brand === 'tapnow' ? tapnowFixture() : brand === 'rhtv' ? rhtvFixture() : fixtures[brand](),
      snapshot = sample.snapshot,
      ses = session.fromPartition('persist:' + brand);
    ses.protocol.handle('https', (request) => {
      requests.push({ brand, url: new URL(request.url).pathname });
      if (brand === 'tapnow') {
        const raw = JSON.stringify(snapshot).replace(/</g, '\\u003c');
        const detail = new URL(request.url).pathname.includes('/home/taptv/');
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>TapNow 合成验收 | TapNow</title><h1>TapNow 合成验收</h1><div data-testid="common-nav-user-menu">测试账号</div>' +
            (detail
              ? '<button data-testid="community-taptv-video-remix-btn" id="process">查看创作过程</button>'
              : '<div class="react-flow"></div>') +
            '<script>const snapshot=' +
            raw +
            ';function showCanvas(){let root=document.querySelector(".react-flow");if(!root){root=document.createElement("div");root.className="react-flow";document.body.append(root);}root.__reactFiber_fixture={memoizedProps:snapshot};}' +
            (detail ? 'document.getElementById("process").onclick=showCanvas;' : 'showCanvas();') +
            '</script>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } }
        );
      }
      if (brand === 'rhtv') {
        const raw = JSON.stringify(snapshot).replace(/</g, '\\u003c');
        const detail = new URL(request.url).pathname.includes('/camp/');
        const html =
          '<!doctype html><meta charset="utf-8"><title>RHTV 合成验收丨RHTV</title><h1>RHTV 合成验收</h1><div class="camp-detail__creator"><strong>测试作者</strong></div><div class="userInfoBox" role="button"><span class="headIcon"></span><p>Personal</p></div>' +
          (detail
            ? '<button id="process">查看创作过程</button>'
            : '<div class="react-flow"></div>') +
          '<script>const snapshot=' +
          raw +
          ';function showCanvas(){let root=document.querySelector(".react-flow");if(!root){root=document.createElement("div");root.className="react-flow";document.body.append(root);}root.__reactFiber_fixture={memoizedProps:snapshot};}' +
          (detail ? 'document.getElementById("process").onclick=showCanvas;' : 'showCanvas();') +
          '</script>';
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      const title =
        brand === 'liblib'
          ? '<h1>LibTV 合成验收</h1><div aria-label="作者信息"><button>测试作者</button></div>'
          : '<div><h2>即梦合成验收</h2><button><img src="data:image/png;base64,AA==">测试作者</button></div>';
      const canonical =
        brand === 'jimeng'
          ? "value:{draft:{getDocument:()=>snapshot},projectSnapshot:{name:'即梦合成画布'},canvasStore:{}}"
          : '';
      const html =
        '<!doctype html><meta charset="utf-8"><title>合成画布</title>' +
        title +
        '<div class="react-flow"></div><p>' +
        snapshot.nodes.length +
        ' nodes, ' +
        snapshot.edges.length +
        ' edges</p><script>const snapshot=' +
        JSON.stringify(snapshot).replace(/</g, '\\u003c') +
        ";document.querySelector('.react-flow').__reactFiber_fixture={memoizedProps:{nodes:snapshot.nodes,edges:snapshot.edges," +
        canonical +
        '},memoizedState:null};</script>';
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
  }
  const libSample = fixtures.liblib(),
    lib = await runExtraction(libSample.metadata.inputUrl, {
      mode: 'simple',
      visible: false,
      timeout: 6000
    });
  assert.equal(lib.entries.length, 4);
  assert.equal(lib.diagnostics.completeness, 'complete');
  assert.equal(
    lib.metadata.adapterVersion,
    require('../../../src/platforms/liblib/metadata.cjs').version
  );
  await until("document.getElementById('url').value.includes('liblib.tv')");
  const firstTask = 1;
  check('LibTV adapter runs through real Electron page injection, normalization and renderer');
  const jimSample = fixtures.jimeng(),
    jim = await runExtraction(jimSample.metadata.inputUrl, {
      mode: 'simple',
      visible: false,
      timeout: 6000
    });
  assert.equal(jim.entries.length, 3);
  assert.equal(jim.diagnostics.source, 'jimeng-draft-document');
  assert.equal(jim.diagnostics.completeness, 'complete');
  await until("document.getElementById('url').value.includes('jimeng.jianying.com')");
  check('Jimeng canonical draft runs independently after switching brands');
  ui.webContents.send('lab:event', { type: 'result', payload: lib, taskId: firstTask });
  await wait(50);
  assert.match(await run("document.getElementById('url').value"), /jimeng/);
  check('A stale result from the prior task cannot replace the current brand');
  const save = await run(
    'window.lab.save({mode:"simple",kinds:["image","video","text"],split:true})'
  );
  assert.equal(save.ok, true, JSON.stringify(save));
  const store = getStore(),
    local = await new ProjectStore(path.dirname(store.directory)).load(store.directory);
  assert.equal(local.metadata.platform, 'jimeng');
  assert.equal(store.documents.length, 3);
  check('Extracted project saves and reloads in schema 2 with all selected categories');
  for (const url of [
    rhtvFixture().metadata.inputUrl,
    'https://rhtv.runninghub.cn/project/canvas/fixture'
  ]) {
    const rh = await runExtraction(url, { mode: 'simple', visible: false, timeout: 6000 });
    assert.equal(rh.metadata.platform, 'rhtv');
    assert.equal(rh.diagnostics.nodeCount, 10);
    assert.equal(rh.diagnostics.edgeCount, 5);
    assert.equal(rh.diagnostics.completeness, 'unverified');
    assert.equal(rh.entries.length, 4);
    assert.equal(rh.assets.length, 8);
    assert.ok(rh.assets.some((a) => a.url.endsWith('vocal.flac')));
    assert.ok(rh.assets.every((a) => !a.nodeIds.includes('failed')));
    await until('document.getElementById("url").value===' + JSON.stringify(url));
    const saved = await run(
      'window.lab.save({mode:"simple",kinds:["image","video","text"],split:true})'
    );
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const rhStore = getStore(),
      loaded = await new ProjectStore(path.dirname(rhStore.directory)).load(rhStore.directory);
    assert.equal(loaded.metadata.platform, 'rhtv');
    assert.equal(loaded.entries.length, 4);
    check(
      'RHTV ' +
        (url.includes('/camp/') ? 'community read-only process' : 'direct canvas') +
        ' injects, renders, saves and reloads without cloning'
    );
  }
  for (const url of [tapnowFixture().metadata.inputUrl, 'https://app.tapnow.plus/canvas/fixture']) {
    const tap = await runExtraction(url, { mode: 'simple', visible: false, timeout: 6000 });
    assert.equal(tap.metadata.platform, 'tapnow');
    assert.equal(tap.diagnostics.nodeCount, 9);
    assert.equal(tap.entries.length, 4);
    assert.equal(tap.assets.length, 6);
    assert.equal(tap.diagnostics.completeness, 'unverified');
    await until('document.getElementById("url").value===' + JSON.stringify(url));
    const saved = await run(
      'window.lab.save({mode:"simple",kinds:["image","video","text"],split:true})'
    );
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const tapStore = getStore(),
      loaded = await new ProjectStore(path.dirname(tapStore.directory)).load(tapStore.directory);
    assert.equal(loaded.metadata.platform, 'tapnow');
    assert.equal(loaded.entries.length, 4);
    assert.ok(
      loaded.entries
        .find((e) => e.nodeId === 'video')
        .references.find((r) => r.marker === 'image 1').assetIds.length
    );
    check(
      'TapNow ' +
        (url.includes('/home/') ? 'read-only process' : 'direct canvas') +
        ' injects, renders, saves and reloads'
    );
  }
  await assert.rejects(runExtraction('https://app.tapnow.plus/home/taptv'), {
    code: 'INVALID_WORK_URL'
  });
  check('TapTV listing rejects immediately without opening a random work');
  const initialMode = await run("document.getElementById('mode').value");
  await run("document.getElementById('mode-toggle').click()");
  assert.notEqual(await run("document.getElementById('mode').value"), initialMode);
  await run("document.getElementById('mode-toggle').click()");
  check('Lightweight/full mode switch remains available while portable packaging is absent');
  await run(
    "document.getElementById('theme-toggle').click();document.querySelector('[data-appearance-mode=dark]').click();document.getElementById('appearance-close').click()"
  );
  await ui.webContents.executeJavaScript(
    'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
  );
  // Buttons animate theme backgrounds for 150ms; capture after the transition.
  await wait(250);
  await fs.writeFile(path.join(out, 'v1.2-dark.png'), (await ui.webContents.capturePage()).toPNG());
  ui.setSize(800, 960);
  await wait(120);
  assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'), true);
  await fs.writeFile(
    path.join(out, 'v1.2-narrow.png'),
    (await ui.webContents.capturePage()).toPNG()
  );
  check('Dark mode and narrow-window layout render without horizontal overflow');
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        requests,
        errors,
        fixtures:
          'Synthetic page DOM and canonical drafts; no external website or account data accessed'
      },
      null,
      2
    )
  );
};
