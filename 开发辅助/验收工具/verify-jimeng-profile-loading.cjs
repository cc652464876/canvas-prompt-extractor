'use strict';
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { boundedRead } = require('../../src/read-deadline.cjs');
const { loadWork } = require('../../src/page-navigation.cjs');
const { createProfilePageReader } = require('../../src/services/profile-page.cjs');
const { readProfile } = require('../../src/platforms/jimeng/profile.cjs');
const shortUrl = 'https://jimeng.jianying.com/s/T2TtwM3Nlb8/';
const canonical =
  'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAAD3z98Zd1pFYZ1P2OzjmDuuLHzNt5JRNfYlDep8kTH8ESmYzarv3lgNNsqkSVLMGw';
app.setPath('userData', require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'jimeng-loading-')));
app.on('window-all-closed', () => {});
const live = process.argv.includes('--live');
const watchdog = setTimeout(() => app.exit(1), live ? 60000 : 25000);
let window, server;
const checks = [];
app
  .whenReady()
  .then(async () => {
    if (live) {
      window = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false }
      });
      const controller = new AbortController(),
        started = Date.now();
      const readPage = createProfilePageReader(() => window);
      console.log('Checking the supplied live share URL in an isolated, signed-out session');
      const result = await readProfile(
        shortUrl,
        null,
        controller.signal,
        () => {},
        (address, read) => readPage(address, read, controller.signal)
      );
      assert.equal(result.url, canonical);
      checks.push(
        '真实分享链接完成跳转并读取 AI短片 栏目；隔离会话实际返回 ' +
          result.works.length +
          ' 部作品'
      );
      await saveReport('live-isolated-session', {
        workCount: result.works.length,
        elapsedMs: Date.now() - started,
        note: '隔离会话未登录，结果以平台实际返回为准，不代表已登录作者全量作品验收。'
      });
      for (const check of checks) console.log('PASS ' + check);
      return;
    }
    // DOM-ready occurs, but this image keeps Chromium's main load unfinished.
    server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.write(Buffer.from('89504e470d0a1a0a', 'hex'));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    session.defaultSession.protocol.handle('https', (request) => {
      if (new URL(request.url).pathname.startsWith('/s/'))
        return new Response(null, {
          status: 302,
          headers: { location: canonical + '?scene=persona' }
        });
      return new Response(
        `<!doctype html><meta charset="utf-8"><img src="${origin}/unfinished.png"><div id="content"><div class="item-test" onclick="films()"><span>AI短片</span></div><p>灵感栏目</p></div><script>
      function films(){content.innerHTML='<div class="item-test active-test"><span>AI短片</span></div>'+Array.from({length:6},(_,i)=>'<div class="masonry-layout-item" data-index="'+i+'"><div class="card-test"><img data-apm-action="short-video-card">作品'+i+'</div></div>').join('')+'<p>没有更多了</p>';
      [...document.querySelectorAll('.card-test')].forEach((card,i)=>card.__reactFiber_fixture={memoizedProps:{domainModel:{id:String(100+i),effectType:210,commonAttr:{title:'作品'+i},author:{name:'测试作者'},video:{originVideo:{videoUrl:'https://cdn.example.com/'+i+'.mp4'}},canvasInfo:undefined}}});}
    </script>`,
        { headers: { 'content-type': 'text/html;charset=utf-8' } }
      );
    });
    window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    await loadWork(window, shortUrl, new AbortController().signal);
    const wc = window.webContents;
    assert.equal(wc.isLoadingMainFrame(), true);
    await assert.rejects(
      boundedRead(() => wc.executeJavaScript('document.readyState'), { timeoutMs: 400 }),
      { code: 'READ_OPERATION_TIMEOUT' }
    );
    checks.push('旧执行方式在 DOM 已就绪、图片未加载完成时仍等待并超时');
    assert.equal(
      await boundedRead(() => wc.mainFrame.executeJavaScript('document.readyState'), {
        timeoutMs: 1500
      }),
      'interactive'
    );
    checks.push('当前主文档可以立即读取，不必等待媒体资源加载完成');
    const controller = new AbortController();
    const readPage = createProfilePageReader(() => window);
    const result = await readProfile(
      shortUrl,
      null,
      controller.signal,
      () => {},
      (address, read) => readPage(address, read, controller.signal)
    );
    assert.equal(result.url, canonical);
    assert.equal(result.works.length, 6);
    assert.ok(result.works.every((work) => work.canvasAccess === 'not-public'));
    assert.equal(wc.isLoadingMainFrame(), true);
    checks.push('生产流程在页面持续加载时仍可跳转分享链接、切换 AI短片 并读取6部作品');
    await saveReport('isolated-pending-resource-fixture');
    for (const check of checks) console.log('PASS ' + check);
  })
  .then(
    () => finish(0),
    (error) => {
      console.error(error);
      for (const check of checks) console.log('PASS ' + check);
      void finish(1);
    }
  );
async function saveReport(mode, details = {}) {
  const out = path.resolve(__dirname, '../验收记录/v1.3/jimeng-profile-loading');
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(
    path.join(out, live ? 'live-report.json' : 'report.json'),
    JSON.stringify({ passed: true, mode, checks, ...details }, null, 2)
  );
}
async function finish(code) {
  clearTimeout(watchdog);
  if (window && !window.isDestroyed()) window.destroy();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  app.exit(code);
}
