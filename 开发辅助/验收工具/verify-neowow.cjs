'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { normalize } = require('../../src/normalize.cjs');
const { ProjectStore } = require('../../src/project-store.cjs');
const { loadLocalProject } = require('../../src/local-project.cjs');
const { DownloadQueue } = require('../../src/download-queue.cjs');
const { createMediaFetcher } = require('../../src/services/media-fetcher.cjs');
const reader = require('../../src/platforms/neowow/reader.cjs');
const profile = require('../../src/platforms/neowow/profile.cjs');
const { createProfilePageReader } = require('../../src/services/profile-page.cjs');
const fixture = require('../测试代码/fixtures/neowow.cjs');
const { verificationPath, ROOT } = require('../../src/app-paths.cjs');
const output = verificationPath(ROOT, 'neowow-synthetic');
app.whenReady().then(async () => {
  let window;
  const checks = [],
    requests = [];
  try {
    await fs.mkdir(output, { recursive: true });
    const runOutput = await fs.mkdtemp(path.join(output, 'run-'));
    const ses = session.fromPartition('neowow-synthetic');
    const sample = fixture();
    const html = `<!doctype html><meta charset="utf-8"><title>合成公开画布 · NeoWOW</title><div id="app"><div class="canvas-preview-dialog"><div class="preview-title">合成公开画布</div><div class="vue-flow"><div class="vue-flow__node">只渲染一个可见节点</div></div></div></div><script>
      const flow = document.querySelector('.vue-flow');
      const props = ${JSON.stringify(sample.snapshot).replace(/</g, '\\u003c')};
      document.querySelector('#app')._vnode = {component:{type:{__name:'App'},subTree:{children:[{component:{type:{__name:'CanvasPreviewDialog'},props:{visible:true,title:'合成公开画布',templateCode:'fixture'},subTree:{component:{type:{__name:'VueFlow'},props,subTree:{el:flow}},el:flow}}}]}}};
    </script>`;
    const creatorId = '1988244264030547968';
    const listed = (id) => ({
      id,
      title: '同名作品',
      sessionId: 'SSN_shared',
      isPublic: 1,
      dataType: 2
    });
    await ses.protocol.handle('https', async (request) => {
      requests.push({ url: request.url, referer: request.headers.get('referer') });
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith('/ucenter/creator-homepage/')) {
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.get('accessToken'), 'synthetic-session');
        const body = await request.json();
        assert.equal(body.userId, creatorId);
        const info = pathname.endsWith('/view');
        if (!info) {
          assert.equal(body.tab, 'works');
          assert.equal(body.sort, 'latest');
          assert.equal(body.pageSize, 20);
        }
        return Response.json(
          info
            ? {
                success: true,
                data: { profile: { nickname: '合成作者' }, stats: { workCount: 3 } }
              }
            : {
                success: true,
                data: body.pageNum === 1 ? [listed('1'), listed('2')] : [listed('2'), listed('3')],
                totalCount: 3,
                pageIndex: body.pageNum
              }
        );
      }
      if (pathname === '/creator')
        return new Response(
          '<div id="app"></div><script>localStorage.setItem("token","synthetic-session")</script>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } }
        );
      if (new URL(request.url).hostname === 'neowow.cn')
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return new Response(new Uint8Array([1, 2, 3]));
    });
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true
      }
    });
    await window.loadURL(sample.metadata.inputUrl);
    const run = (code) => window.webContents.executeJavaScript(code);
    const snapshot = await run('(' + reader.readCanvas.toString() + ')()');
    assert.equal(snapshot.found, true);
    assert.equal(snapshot.nodes.length, 10);
    assert.equal(snapshot.visibleNodes, 1);
    assert.equal(snapshot.edges.length, 4);
    checks.push(
      'Production-shaped Vue tree extracts full model beyond visible nodes in sandboxed Chromium'
    );
    const result = normalize(snapshot, sample.metadata);
    const store = new ProjectStore(path.join(runOutput, 'projects'));
    await store.create(result, { split: true, mode: 'full' });
    await store.saveText('text');
    const loaded = await loadLocalProject(store.directory);
    assert.equal(loaded.result.metadata.platform, 'neowow');
    assert.equal(loaded.result.schemaVersion, 2);
    assert.equal(loaded.result.entries.length, result.entries.length);
    assert.ok((await fs.readdir(store.directory)).some((name) => name.endsWith('.md')));
    checks.push('NeoWow saves Markdown and TXT and reloads schema-2 offline projects');
    const wav = await fs.readFile(path.join(ROOT, '开发辅助/测试代码/fixtures/reader-media.wav'));
    const fetcher = createMediaFetcher({
      session: {
        fromPartition: (id) => {
          assert.equal(id, 'persist:neowow');
          return {
            fetch: async (url, options) => {
              assert.equal(options.headers.Referer, 'https://neowow.cn/');
              requests.push({ url, referer: options.headers.Referer });
              return new Response(wav, {
                headers: { 'content-type': 'audio/wav', 'content-length': String(wav.length) }
              });
            }
          };
        }
      },
      metadata: result.metadata
    });
    const asset = result.assets.find((a) => a.kind === 'audio');
    const queue = new DownloadQueue({
      fetcher,
      filePath: (a) => path.join(runOutput, a.fileName),
      interval: 0,
      retryDelays: []
    });
    assert.equal((await queue.start([asset], ['audio'])).done, 1);
    assert.deepEqual(await fs.readFile(path.join(runOutput, asset.fileName)), wav);
    checks.push('Download queue preserves audio bytes and binds NeoWow session and Referer');
    await run(`document.body.insertAdjacentHTML('beforeend','<h2>欢迎登录</h2>')`);
    assert.equal((await run('(' + reader.readCanvas.toString() + ')()')).found, false);
    await run(
      `document.querySelector('h2').remove();document.querySelector('.canvas-preview-dialog').remove();document.body.insertAdjacentHTML('beforeend','<div class="agift-overlay"><button class="agift-close">关闭</button><button class="agift-primary">收下这份好礼</button></div><div class="video-works-page"><button id="process">查看制作过程</button><button id="reward">赞赏查看创作过程</button><button id="clone">复制项目</button></div>');window.clicks=[];document.querySelectorAll('button').forEach(b=>b.onclick=()=>window.clicks.push(b.className||b.id))`
    );
    assert.equal((await run('(' + reader.openCanvas.toString() + ')(false,false)')).clicked, false);
    assert.equal(
      (await run('(' + reader.openCanvas.toString() + ')(true,true)')).closedPopup,
      true
    );
    assert.deepEqual(await run('window.clicks'), ['agift-close']);
    await run(`document.querySelector('.agift-overlay').remove()`);
    assert.equal((await run('(' + reader.openCanvas.toString() + ')(true,true)')).clicked, true);
    assert.deepEqual(await run('window.clicks'), ['agift-close', 'process']);
    await run(`document.querySelector('#process').remove()`);
    assert.equal((await run('(' + reader.openCanvas.toString() + ')(true,true)')).clicked, true);
    assert.deepEqual(await run('window.clicks'), ['agift-close', 'process', 'reward']);
    await run(
      `document.querySelector('#reward').textContent='确认赞赏';document.body.insertAdjacentHTML('beforeend','<div class="rwd-dialog">赞赏授权</div>')`
    );
    assert.match((await run('(' + reader.inspectWork.toString() + ')()')).accessError, /赞赏授权/);
    assert.equal((await run('(' + reader.openCanvas.toString() + ')(true,true)')).clicked, false);
    checks.push(
      'Login prevents false empty reads; access gates stop before any reward payment or clone control'
    );
    const authorSignal = new AbortController().signal;
    const author = await profile.readProfile(
      'https://neowow.cn/creator?userId=' + creatorId,
      null,
      authorSignal,
      () => {},
      (address, read) => createProfilePageReader(() => window)(address, read, authorSignal)
    );
    assert.equal(author.uuid, creatorId);
    assert.equal(author.author, '合成作者');
    assert.deepEqual(
      author.works.map((work) => work.id),
      ['1', '2', '3']
    );
    assert.deepEqual(author.selectedIds, []);
    assert.equal(JSON.stringify(author).includes('synthetic-session'), false);
    checks.push(
      'Creator listing reads authenticated paginated APIs from an unmounted page, preserves long IDs, deduplicates by work ID and keeps credentials in the website'
    );
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify({ passed: true, checks }, null, 2)
    );
    for (const check of checks) console.log('PASS ' + check);
  } catch (error) {
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify({ passed: false, checks, error: error.stack }, null, 2)
    );
    console.error(error);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    app.exit(process.exitCode || 0);
  }
});
