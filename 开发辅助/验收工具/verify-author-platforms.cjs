'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { TaskScope } = require('../../src/services/task-scope.cjs');
const { createExtractionService } = require('../../src/services/extraction.cjs');
const { createProfilePageReader } = require('../../src/services/profile-page.cjs');
const { readProfile: readJimeng } = require('../../src/platforms/jimeng/profile.cjs');
const { CanvasBrowserWindow, canvasAddress } = require('../../src/canvas-browser.cjs');
const { resolveTheme } = require('../../src/theme.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.resolve(__dirname, '../..');
const windows = new Map();
const urls = {
  liblib: 'https://www.liblib.tv/detail/',
  jimeng: 'https://jimeng.jianying.com/ai-tool/work-detail/',
  rhtv: 'https://www.runninghub.cn/projects/canvas/camp/',
  tapnow: 'https://app.tapnow.plus/home/taptv/3/'
};
const affected = process.argv.includes('--affected-platforms')
  ? ['liblib', 'jimeng']
  : Object.keys(urls);
let output, canvasBrowser;
const checks = [];
const check = (text) => {
  checks.push(text);
  console.log('PASS ' + text);
};
const timeout = setTimeout(() => {
  console.error('Author platform verification timed out');
  app.exit(1);
}, 90000);
app.setPath(
  'userData',
  require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'canvas-author-verification-'))
);
app.on('window-all-closed', () => {});
function page(url, platform) {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith('network-error')) return new Response('Unavailable', { status: 503 });
  if (pathname.startsWith('/s/'))
    return new Response(null, {
      status: 302,
      headers: {
        location:
          'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAATESTAUTHOR?scene=persona'
      }
    });
  if (pathname.includes('/personal/'))
    return new Response(
      `<!doctype html><meta charset="utf-8"><div id="content"></div><script>
    function listing(){content.innerHTML='<div class="item-test" onclick="if(event.target===this)selectFilms(this)"><span>AI短片</span></div><div class="masonry-layout-item" data-index="999"><div class="card-test" onclick="detail(999)"><img data-apm-action="feed-item-image">灵感图片</div></div><p>没有更多了</p>';}
    function selectFilms(tab){tab.classList.add('active-test');setTimeout(()=>{content.innerHTML='<div class="item-test active-test"><span>AI短片</span></div>'+ (location.pathname.includes('EMPTY')?'请先登录<p>暂无作品，回首页看看</p>':[0,1].map(i=>'<div class="masonry-layout-item" data-index="'+i+'"><div class="card-test" onclick="detail('+i+')"><img data-apm-action="short-video-card">同名作品</div></div>').join('')+'<p>没有更多了</p>');},800);}
    function goBack(){history.pushState({},'', '/ai-tool/personal/MS4wLjABAAAATESTAUTHOR');listing();}
    function detail(i){window.detailOpens=(window.detailOpens||0)+1;history.pushState({},'', '/ai-tool/work-detail/'+(100+i)+'?workDetailType=ShowcaseVideo&itemType=210');content.innerHTML='<section><video src="https://cdn.example.com/'+i+'.mp4" preload="none"></video><h2>同名作品</h2><button><img>测试作者</button>'+(i?'<button>查看创作过程</button>':'')+'<button aria-label="Back" onclick="goBack()">Back</button></section>';}
    listing();
    if(location.pathname.includes('FAST')) {
      const normalSelect=selectFilms;
      selectFilms=function(tab){normalSelect(tab);setTimeout(()=>{
        const models=Array.from({length:26},(_,i)=>({id:String(100+i),effectType:210,commonAttr:{title:'作品'+i,coverUrl:'https://cdn.example.com/cover.png'},author:{name:'真实作者'},video:{originVideo:{videoUrl:'https://cdn.example.com/'+i+'.mp4'}},canvasInfo:i%2?{projectId:'shared',reviewStatus:1}:undefined}));
        content.innerHTML='<div class="item-test active-test"><span>AI短片</span></div>'+models.slice(0,5).map((m,i)=>'<div class="masonry-layout-item" data-index="'+i+'"><div class="card-test" onclick="detail('+i+')"><img data-apm-action="short-video-card">'+m.commonAttr.title+'</div></div>').join('')+'<p>没有更多了</p>';
        const manager={data:{list:models.map(m=>({key:m.id,data:{type:'short-video',key:m.id}}))},find:(key)=>models.find(m=>m.id===key)};
        [...document.querySelectorAll('.masonry-layout-item')].forEach(row=>row.__reactFiber_fixture={memoizedProps:{},return:{memoizedProps:{masonryViewModelManager:manager}}});
      },810);};
    }
    </script>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  if (pathname.endsWith('.mp4'))
    return new Response(new Uint8Array(0), { headers: { 'content-type': 'video/mp4' } });
  const heading = platform === 'jimeng' ? 'h2' : 'h1';
  const published = pathname.endsWith('public');
  const login = pathname.endsWith('login');
  const script = `<script>function openFlow(){let f=document.createElement('div');f.className='react-flow';f.style.height='150px';f.__reactFiber_test={memoizedProps:{nodes:[{id:'text',type:'text',data:{text:'验证正文',name:'验证文本'}}],edges:[]}};document.querySelector('section').append(f);}</script>`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><section><video src="https://cdn.example.com/${platform}.mp4" preload="none" style="width:300px;height:160px"></video><${heading}>验证作品</${heading}>${login ? '欢迎登录' : ''}${published ? '<button data-testid="community-taptv-video-remix-btn" onclick="openFlow()">' + (platform === 'jimeng' ? '查看关联的画布' : '查看创作过程') + '</button>' : platform === 'liblib' ? '<button disabled>查看制作过程</button>' : ''}</section>${script}`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
function windowFor(platform) {
  let window = windows.get(platform);
  if (!window || window.isDestroyed()) {
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: {
        partition: 'persist:' + platform,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    windows.set(platform, window);
  }
  return window;
}
app
  .whenReady()
  .then(async () => {
    output = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-author-output-'));
    for (const platform of Object.keys(urls))
      session
        .fromPartition('persist:' + platform)
        .protocol.handle('https', (request) => page(request.url, platform));
    const scope = new TaskScope();
    const state = {
      task: null,
      queue: null,
      saveTask: null,
      downloadSetup: false,
      outputDirectory: output,
      exportOptions: { mode: 'full' }
    };
    const service = createExtractionService({
      root,
      app,
      scope,
      getState: () => state,
      updateState: (values) => Object.assign(state, values),
      getPlatformWindow: (platform) => {
        state.platformWindow = windowFor(platform);
        state.currentPlatform = platform;
        return state.platformWindow;
      },
      send: () => {},
      status: (message, phase) => {
        if (state.task) state.task.outcome = { message, phase };
      },
      getTheme: () => resolveTheme(null, false),
      hiddenRendering: true,
      finishExtraction: async (result) => {
        state.lastWorkMetadata = result.metadata;
        if (state.task) state.task.outcome = { phase: 'done', message: '完成' };
        return result;
      }
    });
    for (const platform of process.argv.includes('--profiles-only') ? [] : affected) {
      const r = await service.runExtraction(urls[platform] + 'private', {
        mode: 'full',
        timeout: 8500
      });
      assert.equal(r.metadata.canvasAccess, 'not-public');
      assert.equal(r.entries.length, 0);
      assert.equal(r.assets.length, 1);
      assert.equal(r.assets[0].role, 'full-video');
      const publicResult = await service.runExtraction(urls[platform] + 'public', {
        mode: 'full',
        timeout: 8500
      });
      assert.equal(publicResult.metadata.canvasAccess, 'public');
      assert.equal(publicResult.entries.length, 1);
      check(platform + '：作品视频降级与公开画布提取通过实际页面执行');
    }
    if (!process.argv.includes('--profiles-only')) {
      await assert.rejects(
        service.runExtraction(urls.liblib + 'login', { timeout: 1000 }),
        /尚未读到|超过等待/
      );
      await assert.rejects(
        service.runExtraction(urls.liblib + 'network-error', { timeout: 1000 }),
        /加载失败/
      );
      check('登录提示与网络失败保持可重试错误，不误判为未公开画布');
    }
    const readPage = createProfilePageReader(windowFor);
    const profile = await readJimeng(
      'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAATESTAUTHOR',
      null,
      new AbortController().signal,
      () => {},
      (address, read) => readPage(address, read, new AbortController().signal)
    );
    assert.deepEqual(
      profile.works.map((w) => w.id),
      ['100', '101']
    );
    assert.deepEqual(
      profile.works.map((w) => w.canvasAccess),
      ['not-public', 'public']
    );
    check('即梦作者列表通过站内卡片进入详情，按作品 ID 保留同名作品及公开状态');
    const shared = await readJimeng(
      'https://jimeng.jianying.com/s/hBHP6B5pXik/',
      null,
      new AbortController().signal,
      () => {},
      (address, read) => readPage(address, read, new AbortController().signal)
    );
    assert.equal(shared.url, profile.url);
    assert.deepEqual(
      shared.works.map((w) => w.id),
      ['100', '101']
    );
    check('即梦分享短链接经真实 302 跳转后与完整主页读取相同作品；不会读取灵感卡片');
    const empty = await readJimeng(
      'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAAEMPTYAUTHOR',
      null,
      new AbortController().signal,
      () => {},
      (address, read) => readPage(address, read, new AbortController().signal)
    );
    assert.deepEqual(empty.works, []);
    check('即梦未登录时平台实际返回暂无作品，正常返回空列表');
    const fastStarted = Date.now();
    const fast = await readJimeng(
      'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAAFASTAUTHOR',
      null,
      new AbortController().signal,
      () => {},
      (address, read) => readPage(address, read, new AbortController().signal)
    );
    assert.equal(fast.works.length, 26);
    assert.equal(fast.author, '真实作者');
    assert.equal(fast.works.filter((w) => w.canvasAccess === 'not-public').length, 13);
    assert.equal(fast.works.filter((w) => w.canvasAccess === 'public').length, 13);
    assert.equal(
      await windowFor('jimeng').webContents.executeJavaScript('window.detailOpens||0'),
      0
    );
    assert.ok(
      Date.now() - fastStarted < 4000,
      'Homepage list should not pay per-work detail waits'
    );
    check('即梦主页批量读取26部作品及公开状态，覆盖虚拟列表，未打开任何作品详情');

    for (const value of Object.values(urls)) assert.ok(canvasAddress(value + 'public'));
    assert.equal(canvasAddress('https://app.tapnow.plus/home/taptv'), '');
    const context = {
      key: 'platforms',
      works: affected.map((id) => ({ id, title: id, url: urls[id] + 'public' }))
    };
    canvasBrowser = new CanvasBrowserWindow({ getContext: () => context });
    await canvasBrowser.open();
    for (const platform of affected) {
      canvasBrowser.window.browserToolbar.activate(platform, false);
      const tab = canvasBrowser.window.browserToolbar.tabs.get(platform);
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await tab.contents.executeJavaScript('Boolean(document.querySelector(".react-flow"))'))
          break;
        if (attempt === 79) throw new Error(platform + ' canvas did not open');
        await wait(100);
      }
      assert.equal(tab.contents.session, session.fromPartition('persist:' + platform));
    }
    check(affected.length + '个平台画布标签调用各自打开规则并使用各自登录会话');
    const out = path.join(root, '开发辅助/验收记录/v1.3/author-platforms');
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify(
        {
          passed: true,
          mode: 'isolated-electron-fixtures',
          note: '使用官方路径与本地页面响应，验证实际渲染器和生产读取流程；不代表真实网站全量下载验收。',
          checks
        },
        null,
        2
      )
    );
    console.log('Author platforms: ' + checks.length + ' checks passed.');
  })
  .then(
    () => finish(0),
    (error) => {
      console.error(error);
      void finish(1);
    }
  );
async function finish(code) {
  if (code && windows.get('jimeng') && !windows.get('jimeng').isDestroyed())
    console.error(
      await windows
        .get('jimeng')
        .webContents.executeJavaScript(
          '({url:location.href,text:document.body.innerText.slice(0,1500),html:document.body.innerHTML.slice(0,1800)})'
        )
        .catch(() => null)
    );
  clearTimeout(timeout);
  canvasBrowser?.dispose();
  for (const window of windows.values()) if (!window.isDestroyed()) window.destroy();
  if (output && path.basename(output).startsWith('canvas-author-output-'))
    await fs.rm(output, { recursive: true, force: true });
  app.exit(code);
}
