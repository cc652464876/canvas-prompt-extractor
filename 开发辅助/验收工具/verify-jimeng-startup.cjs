'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createProfilePageReader } = require('../../src/services/profile-page.cjs');
const { createAuthorService } = require('../../src/services/author.cjs');
app.setPath(
  'userData',
  require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'jimeng-first-read-'))
);
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => app.exit(1), 40000);
const url = 'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAACOLDSTARTAUTHOR';
let window,
  loads = 0;
app
  .whenReady()
  .then(async () => {
    session.defaultSession.protocol.handle('https', (request) => {
      if (!new URL(request.url).pathname.includes('/personal/'))
        return new Response('', { status: 404 });
      loads++;
      // First navigation has the site's shell, but its lazy author panel has not
      // mounted. A cache-warmed reload can mount it, matching the reported case.
      const shell =
        '<!doctype html><meta charset="utf-8"><nav>创作 探索 资产 主体</nav><aside>画布 未命名画布</aside><main id="author"></main>';
      return new Response(
        shell +
          (loads === 1
            ? ''
            : `<script>
      author.innerHTML='<div class="item-test" onclick="films()"><span>AI短片</span></div>';
      function films(){author.innerHTML='<h1>小文</h1><div class="item-test active-test"><span>AI短片</span></div>'+Array.from({length:34},(_,i)=>'<div class="masonry-layout-item" data-index="'+i+'"><div class="card-test"><img data-apm-action="short-video-card">作品'+i+'</div></div>').join('')+'<p>没有更多了</p>';
        [...document.querySelectorAll('.card-test')].forEach((card,i)=>card.__reactFiber_fixture={memoizedProps:{domainModel:{id:String(100+i),effectType:210,commonAttr:{title:'作品'+i},author:{name:'小文'},video:{originVideo:{videoUrl:'https://cdn.example.com/'+i+'.mp4'}},canvasInfo:undefined}}});}
      </script>`),
        { headers: { 'content-type': 'text/html;charset=utf-8' } }
      );
    });
    window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false }
    });
    const loading = [],
      notices = [];
    let result;
    const service = createAuthorService({
      fetcher: () => {
        throw new Error('Jimeng listing must use its page');
      },
      readProfilePage: createProfilePageReader(() => window),
      readWork: () => {
        throw new Error('Private works must not open canvases');
      },
      cancelRead: () => {},
      publish: (r) => {
        result = r;
      },
      send: (type, payload) => {
        if (type === 'author-loading') loading.push(payload);
        if (type === 'status') notices.push(payload.message);
      },
      getRoot: () => app.getPath('userData'),
      getOptions: () => ({})
    });
    const started = Date.now();
    // Exactly one user invocation, with no second call from the verification.
    const profile = await service.open(url);
    assert.equal(loads, 2);
    assert.deepEqual(loading, [true, false]);
    assert.equal(profile.author, '小文');
    assert.equal(profile.works.length, 34);
    assert.equal(result.assets.length, 34);
    assert.equal(result.authorProfile.pending, 0);
    assert.ok(notices.some((message) => message.includes('初始化')));
    assert.ok(notices.some((message) => message.includes('自动重新加载一次')));
    assert.equal(service.reading, false);
    const out = path.resolve(__dirname, '../验收记录/v1.3/jimeng-startup');
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify(
        {
          passed: true,
          mode: 'isolated-cold-start-fixture',
          userReadCalls: 1,
          automaticReloads: loads - 1,
          workCount: profile.works.length,
          elapsedMs: Date.now() - started,
          notices
        },
        null,
        2
      )
    );
    console.log('PASS 首次打开仅网站外壳时，单次读取自动恢复并取得34部作品和34个视频记录');
    console.log('PASS 自动恢复期间持续保持任务运行状态，不读取未公开画布');
  })
  .then(
    () => finish(0),
    (error) => {
      console.error(error);
      finish(1);
    }
  );
function finish(code) {
  clearTimeout(watchdog);
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(code);
}
