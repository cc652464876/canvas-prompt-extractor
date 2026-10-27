'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ProjectStore } = require('../../../src/project-store.cjs');
const { normalize } = require('../../../src/normalize.cjs');
const { isTransparentRead } = require('../../../src/platform-presentation.cjs');
const { loadLocalProject } = require('../../../src/local-project.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({
  ui,
  root,
  canvasBrowser,
  authorService,
  session,
  dialog,
  getResult,
  getLocal
}) => {
  const out = path.join(root, '开发辅助/验收记录/v1.3/canvas-browser');
  await fs.mkdir(out, { recursive: true });
  const library = await fs.mkdtemp(path.join(out, 'sample-'));
  const run = (code) => ui.webContents.executeJavaScript(code);
  const canvas = (code) => canvasBrowser.window.browserToolbar.webContents.executeJavaScript(code);
  const checks = [],
    errors = [];
  const until = async (read, label) => {
    for (let i = 0; i < 120; i++) {
      if (await read()) return;
      await wait(35);
    }
    throw new Error('Timed out: ' + label);
  };
  const pass = (text) => {
    checks.push(text);
    console.log('PASS ' + text);
  };
  ui.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) errors.push(event.message);
  });
  let network = 0;
  const requests = [];
  const siteSession = session.fromPartition('persist:liblib');
  siteSession.protocol.handle('https', (request) => {
    if (new URL(request.url).pathname === '/favicon.ico')
      return new Response(null, { status: 404 });
    network++;
    requests.push(request.url);
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>官方画布入口测试</title>
      <style>body{background:#121212;color:#ddd;font:16px sans-serif;padding:50px}.react-flow{height:500px;background:#202020;padding:30px}</style>
      <button onclick="this.remove();document.querySelector('.react-flow').hidden=false;window.opened=(window.opened||0)+1">查看制作过程</button>
      <div class="react-flow" hidden>官方画布测试页（只替代网络响应，不调用提取）<input id="state" value="初始值"></div>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    'base64'
  );
  for (let i = 1; i <= 2; i++) {
    const result = normalize(
      {
        nodes: [
          {
            id: 'text',
            type: 'text',
            position: { x: 100, y: 160 },
            data: {
              name: '创作说明',
              content: '保持主体一致，先组织静帧，再规划镜头运动。\n用于官方画布联动验证。'
            }
          },
          {
            id: 'image',
            type: 'image',
            position: { x: 600, y: 160 },
            data: { name: '参考图片', url: ['https://cdn.example.com/sample.png'] }
          }
        ],
        edges: [{ id: 'edge', source: 'text', target: 'image' }]
      },
      {
        platform: 'liblib',
        title: '本地示例作品 ' + i,
        author: '验收作者',
        inputUrl:
          'https://www.liblib.tv/detail/' +
          (i === 1 ? '94da194049354a42a71b568aec4b64f3' : String(i).padStart(32, '0')),
        workIdentity:
          'liblib-template:' +
          (i === 1 ? '94da194049354a42a71b568aec4b64f3' : String(i).padStart(32, '0'))
      }
    );
    const store = new ProjectStore(library);
    await store.create(result, { mode: 'full', kinds: ['text', 'image'], split: true }, false);
    for (const asset of result.assets) {
      await fs.writeFile(store.assetPath(asset), png);
      Object.assign(asset, { state: 'done', bytes: png.length, total: png.length });
    }
    await store.checkpoint();
  }
  const manifest = path.join(library, '.项目索引.json');
  const open = (target) => run('window.lab.openLocalProject(' + JSON.stringify(target) + ')');
  const response = await open(manifest);
  assert.equal(response.ok, true, response.error);
  assert.equal(getLocal(), true);
  assert.equal(authorService.snapshot().works.length, 2);
  assert.equal(getResult().authorProfile.loadedIds.length, 2);
  assert.equal(new Set(getResult().entries.map((e) => e.nodeId)).size, getResult().entries.length);
  pass('作者索引一次载入两部作品，重复节点标识隔离，保持本地模式');
  const dimensions = await run(
    `['open-canvas','folder'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})`
  );
  assert.equal(dimensions[0].width, dimensions[1].width);
  assert.equal(dimensions[0].height, dimensions[1].height);
  assert.equal(dimensions[0].y, dimensions[1].y);
  assert.ok(dimensions[0].x < dimensions[1].x);
  pass('打开画布入口位于文件夹按钮左侧，同宽同高');
  assert.equal(await run("document.getElementById('open-canvas').textContent"), '打开画布');
  assert.equal(network, 0, '打开本地项目不应联网');
  await run(`document.getElementById('open-canvas').click()`);
  await until(
    () => canvasBrowser.window && !canvasBrowser.window.webContents.isLoading(),
    'canvas window'
  );
  canvasBrowser.window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) errors.push(event.message);
  });
  await until(() => canvas(`document.querySelectorAll('[role=tab]').length===2`), 'two tabs');
  const chosenIds = [...authorService.snapshot().selectedIds];
  for (const id of chosenIds) {
    await canvas('window.browserToolbar.action("activate",' + JSON.stringify(id) + ')');
    await until(async () => {
      const page = canvasBrowser.pages.get(id);
      return (
        page &&
        !page.view.webContents.isLoading() &&
        (await page.view.webContents.executeJavaScript('window.opened===1'))
      );
    }, 'official canvas opened');
  }
  await canvas('window.browserToolbar.action("activate",' + JSON.stringify(chosenIds[0]) + ')');
  assert.equal(canvasBrowser.state().visible, true);
  assert.equal(network, 2);
  for (const page of canvasBrowser.pages.values()) {
    assert.equal(page.view.webContents.session, siteSession);
    assert.equal(
      await page.view.webContents.executeJavaScript('typeof window.browserToolbar'),
      'undefined'
    );
  }
  assert.equal(
    (await canvas(`window.browserToolbar.action('save-document',{})`)).error,
    '不支持的浏览器操作。'
  );
  pass('独立窗口两个官方网页标签，共用 LibTV 登录会话，自动进入制作过程，不暴露本地编辑接口');
  const windowId = canvasBrowser.window.id;
  await canvasBrowser.open();
  assert.equal(canvasBrowser.window.id, windowId);
  assert.equal(canvasBrowser.model.tabs.length, 2);
  pass('重复打开复用同一窗口，不重复创建标签');
  const ids = [...authorService.snapshot().selectedIds];
  const firstPage = canvasBrowser.pages.get(ids[0]);
  const firstContentsId = firstPage.view.webContents.id;
  await firstPage.view.webContents.executeJavaScript(
    "document.getElementById('state').value='保留浏览状态'"
  );
  await canvas('window.browserToolbar.action("activate",' + JSON.stringify(ids[1]) + ')');
  assert.equal(firstPage.view.getVisible(), false);
  assert.equal(firstPage.view.webContents.isAudioMuted(), true);
  await canvas('window.browserToolbar.action("activate",' + JSON.stringify(ids[0]) + ')');
  assert.equal(firstPage.view.webContents.id, firstContentsId);
  assert.equal(
    await firstPage.view.webContents.executeJavaScript("document.getElementById('state').value"),
    '保留浏览状态'
  );
  assert.equal(network, 2);
  pass('标签切换复用官网页面，保留浏览状态，后台标签静音');
  await canvas('window.browserToolbar.action("close-tab",' + JSON.stringify(ids[0]) + ')');
  assert.deepEqual(authorService.snapshot().selectedIds, ids);
  await canvasBrowser.refresh();
  assert.equal(canvasBrowser.model.tabs.length, 1);
  await canvasBrowser.open();
  assert.equal(canvasBrowser.model.tabs.length, 2);
  pass('关闭标签保留作品勾选，普通刷新不重开，入口按钮可恢复');
  await canvas('window.browserToolbar.action("new-tab")');
  const userTab = canvasBrowser.window.browserToolbar.activeId;
  assert.equal(canvasBrowser.window.browserToolbar.tabs.size, 3);
  assert.equal(canvasBrowser.model.tabs.length, 2);
  await until(
    () =>
      canvas(
        'document.activeElement.id === "address" && document.getElementById("address").value === ""'
      ),
    'new tab focuses address'
  );
  await canvasBrowser.refresh();
  assert.ok(canvasBrowser.window.browserToolbar.tabs.has(userTab));
  await canvas('window.browserToolbar.action("close-tab",' + JSON.stringify(userTab) + ')');
  assert.deepEqual(authorService.snapshot().selectedIds, ids);
  await canvas('window.browserToolbar.action("close-tab",' + JSON.stringify(ids[0]) + ')');
  await canvas('window.browserToolbar.action("restore-tab")');
  await until(
    () => canvasBrowser.model.tabs.length === 2 && canvasBrowser.pages.has(ids[0]),
    'restore managed work tab'
  );
  assert.equal(canvasBrowser.window.browserToolbar.tabs.get(ids[0]).managed, true);
  assert.deepEqual(authorService.snapshot().selectedIds, ids);
  pass('画布使用共用浏览器的新建标签页，普通标签独立于作品勾选，恢复作品标签保留联动');
  await run('window.lab.selectWorks(' + JSON.stringify([ids[1]]) + ')');
  await until(
    () => canvasBrowser.model.tabs.length === 1 && canvasBrowser.model.tabs[0].id === ids[1],
    'selection removes tab'
  );
  await run('window.lab.selectWorks([])');
  await until(
    () => isTransparentRead(canvasBrowser.window) && !canvasBrowser.model.tabs.length,
    'transparent empty window'
  );
  assert.equal(canvasBrowser.window.getOpacity(), 0);
  assert.equal(canvasBrowser.window.isFocusable(), false);
  await run('window.lab.selectWorks(' + JSON.stringify(ids) + ')');
  await until(
    () => canvasBrowser.model.tabs.length === 2 && !isTransparentRead(canvasBrowser.window),
    'selection restores tabs'
  );
  pass('取消选择移除标签，清空后透明且不抢焦点，重新选择恢复');
  await canvas(
    'window.browserToolbar.action("reorder",' + JSON.stringify([...ids].reverse()) + ')'
  );
  assert.deepEqual(
    canvasBrowser.model.tabs.map((w) => w.id),
    [...ids].reverse()
  );
  pass('标签顺序可调整，保持作品选择不变');
  const previousActive = canvasBrowser.model.activeId;
  canvasBrowser.pages.get(canvasBrowser.model.activeId).view.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: 'Tab',
    modifiers: ['control']
  });
  canvasBrowser.pages.get(canvasBrowser.model.activeId).view.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: 'Tab',
    modifiers: ['control']
  });
  await until(() => canvasBrowser.model.activeId !== previousActive, 'Ctrl+Tab switches');
  canvasBrowser.pages.get(canvasBrowser.model.activeId).view.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: 'W',
    modifiers: ['control']
  });
  canvasBrowser.pages.get(canvasBrowser.model.activeId).view.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: 'W',
    modifiers: ['control']
  });
  await until(() => canvasBrowser.model.tabs.length === 1, 'Ctrl+W closes tab');
  assert.deepEqual(authorService.snapshot().selectedIds, ids);
  await canvasBrowser.open();
  pass('Ctrl+Tab 切换、Ctrl+W 关闭标签，作品勾选保持不变');
  await canvas(`window.browserToolbar.action('hide')`);
  assert.equal(isTransparentRead(canvasBrowser.window), true);
  assert.deepEqual(authorService.snapshot().selectedIds, ids);
  await canvasBrowser.open();
  assert.equal(isTransparentRead(canvasBrowser.window), false);
  assert.equal(canvasBrowser.window.id, windowId);
  pass('关闭窗口保留会话，透明穿透后可通过入口恢复');
  await canvas(
    'new Promise(resolve=>{requestAnimationFrame(()=>requestAnimationFrame(resolve));setTimeout(resolve,250)})'
  );
  await wait(200);
  await fs.writeFile(
    path.join(out, 'canvas-tabs.png'),
    (
      await canvasBrowser.window.browserToolbar.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true
      })
    ).toPNG()
  );
  await fs.writeFile(
    path.join(out, 'main-entry.png'),
    (await ui.webContents.capturePage()).toPNG()
  );
  const one = (await fs.readdir(library, { withFileTypes: true })).find((e) => e.isDirectory());
  assert.equal((await open(path.join(library, one.name))).ok, true);
  await canvasBrowser.refresh();
  assert.equal(canvasBrowser.model.tabs.length, 1);
  assert.equal(authorService.active, false);
  const before = getResult();
  await fs.writeFile(path.join(out, 'unsafe-index.json'), '{}');
  const invalid = path.join(out, 'invalid');
  await fs.mkdir(invalid, { recursive: true });
  await fs.writeFile(path.join(invalid, '.项目索引.json'), JSON.stringify({ bad: '../outside' }));
  await assert.rejects(loadLocalProject(invalid), /无效/);
  assert.equal((await open(path.join(invalid, '.项目索引.json'))).ok, false);
  assert.equal(getResult(), before);
  pass('单作品打开保持兼容，非法作者目录被拒绝且不破坏当前项目');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [manifest] });
  assert.equal((await open('')).ok, true);
  pass('文件选择入口支持作者索引');
  assert.ok(
    requests.every(
      (url) =>
        new URL(url).hostname === 'www.liblib.tv' && new URL(url).pathname.startsWith('/detail/')
    ),
    '只访问所选作品官方链接'
  );
  assert.ok(network <= 12, '页面切换和恢复不重复加载');
  // Browser reset destroys all auxiliary windows; their page views must be released too.
  canvasBrowser.window.destroy();
  assert.equal(canvasBrowser.pages.size, 0);
  await canvasBrowser.open();
  assert.notEqual(canvasBrowser.window.id, windowId);
  await until(async () => {
    const page = canvasBrowser.pages.get(canvasBrowser.model.activeId);
    return (
      page &&
      !page.contents.isLoading() &&
      (await page.contents.executeJavaScript('window.opened===1'))
    );
  }, 'reopen after destruction');
  pass('窗口被销毁时释放网页，重新打开仍可正常进入官方画布');
  if (process.env.CANVAS_BROWSER_LIVE === '1') {
    siteSession.protocol.unhandle('https');
    assert.equal(
      (await open('I:/自由画布下载/liblib_Li鱼_家具产品宣传广告/.画布项目.json')).ok,
      true
    );
    await canvasBrowser.open();
    const page = canvasBrowser.pages.get(canvasBrowser.model.activeId);
    for (let i = 0; i < 100; i++) {
      if (
        await page.contents.executeJavaScript(
          '[...document.querySelectorAll(\'.react-flow,iframe[src*="/ai-canvas/"]\')].some(el=>el.getClientRects().length>0)'
        )
      )
        break;
      if (i === 99) {
        console.log(
          'Official state:',
          await page.contents.executeJavaScript(
            'JSON.stringify({url:location.href,title:document.title,body:document.body?.innerText.slice(0,900),viewport:[innerWidth,innerHeight]})'
          )
        );
        throw new Error('家具官网画布未就绪：' + page.error);
      }
      await wait(300);
    }

    pass('家具广告官网实际页面可直达公开画布，未调用提取或生成');
  }
  canvasBrowser.dispose();
  await wait(50);
  assert.deepEqual(errors, []);
  pass('链接范围和页面检查通过，无页面错误');
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify({ passed: true, checks, network, errors }, null, 2)
  );
  console.log('Canvas browser verification passed: ' + checks.length + ' checks.');
};
