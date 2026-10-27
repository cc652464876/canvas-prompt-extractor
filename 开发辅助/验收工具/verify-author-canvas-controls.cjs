'use strict';
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAuthorService } = require('../../src/services/author.cjs');
const { publishedWork } = require('../../src/published-work.cjs');
const root = path.resolve(__dirname, '../..');
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'labmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
]);
app.setPath(
  'userData',
  require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'author-canvas-ui-'))
);
const watchdog = setTimeout(() => app.exit(1), 30000);
let win;
app
  .whenReady()
  .then(async () => {
    protocol.handle(
      'labmedia',
      () =>
        new Response(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
            'base64'
          ),
          { headers: { 'content-type': 'image/png' } }
        )
    );
    const errors = [],
      checks = [];
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1100,
      webPreferences: {
        preload: path.join(root, 'src/preload.cjs'),
        offscreen: true,
        backgroundThrottling: false
      }
    });
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 3) errors.push(event.message);
    });
    const uuid = 'a'.repeat(32);
    const statuses = [
      'not-public',
      'public',
      'unknown',
      'public',
      'not-public',
      'public',
      'not-public',
      'public',
      'public'
    ];
    const rows = statuses.map((access, index) => ({
      templateUuid: String(index + 1).padStart(32, '0'),
      ownerUuid: uuid,
      nickname: '画布状态测试作者',
      name: '同名作品 ' + (index + 1),
      ...(access === 'unknown' ? {} : { snapshotId: access === 'public' ? index + 1 : null }),
      finalOutput: 'https://cdn.example.com/' + index + '.mp4'
    }));
    const options = { kinds: ['image', 'video', 'audio', 'text'], split: true, mode: 'full' };
    let result,
      rejectSelection = false,
      localProfile = null,
      updateRequests = 0,
      stopRequests = 0;
    const send = (type, payload) => win.webContents.send('lab:event', { type, payload });
    const service = createAuthorService({
      fetcher: async () => Response.json({ code: 0, data: { list: rows, total: rows.length } }),
      readWork: async (url) =>
        publishedWork({
          platform: 'liblib',
          inputUrl: url,
          title: '同名作品 3',
          author: '画布状态测试作者',
          fullVideo: { url: 'https://cdn.example.com/2.mp4' }
        }),
      cancelRead: () => {},
      getRoot: () => app.getPath('userData'),
      getOptions: () => options,
      send,
      publish: (value, store) => {
        result = value;
        send('result', value);
        send('project', store.summary());
      }
    });
    const handlers = {
      info: () => ({
        platforms: [],
        options,
        outputDirectory: app.getPath('userData'),
        accounts: []
      }),
      'author-select': (ids) => {
        if (rejectSelection) {
          rejectSelection = false;
          throw new Error('测试选择同步失败');
        }
        return service.select(ids);
      },
      'author-read': () => service.start(),
      'check-updates': () => {
        updateRequests++;
        localProfile = { ...localProfile, readingCanvases: true };
        send('author', localProfile);
        return localProfile;
      },
      cancel: () => {
        stopRequests++;
        localProfile = { ...localProfile, readingCanvases: false };
        send('author', localProfile);
        return true;
      },
      theme: () => ({}),
      update: () => ({ options }),
      'login-state': () => ({}),
      'thumbnail-info': () => false,
      'cache-thumbnail': () => true
    };
    for (const [name, handler] of Object.entries(handlers))
      ipcMain.handle('lab:' + name, async (_event, ...args) => {
        try {
          return { ok: true, value: await handler(...args) };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
    const run = (script) => win.webContents.executeJavaScript(script);
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function until(script) {
      for (let i = 0; i < 200; i++) {
        if (await run(script)) return;
        await wait(20);
      }
      throw new Error('UI timeout: ' + script);
    }
    const click = (id) => run(`document.getElementById(${JSON.stringify(id)}).click()`);
    const ids = () =>
      run(`[...document.querySelectorAll('.work-card')].map(node=>node.dataset.workId)`);
    const check = (message) => {
      checks.push(message);
      console.log('PASS ' + message);
    };
    await win.loadFile(path.join(root, 'src/ui/index.html'));
    await service.open('https://www.liblib.tv/profile?uuid=' + uuid);
    await until(
      `document.querySelectorAll('.work-card').length===9 && !document.getElementById('author-canvas-filter').disabled`
    );
    await run(
      `document.getElementById('columns').value=8;document.getElementById('columns').dispatchEvent(new Event('input'))`
    );
    const footer = await run(
      `(()=>{const card=document.querySelector('.work-card'),s=card.querySelector('.work-canvas-access'),c=card.querySelector('.work-selection'),a=s.getBoundingClientRect(),b=c.getBoundingClientRect();return {status:s.textContent,selection:c.textContent,shown:getComputedStyle(s).display,left:a.left,right:b.right,footer:card.querySelector('.card-footer').getBoundingClientRect().toJSON(),separate:a.right<=b.left}})()`
    );
    assert.equal(footer.status, '画布未公开');
    assert.equal(footer.selection, '已选择');
    assert.notEqual(footer.shown, 'none');
    assert.equal(footer.left, footer.footer.left);
    assert.equal(footer.right, footer.footer.right);
    assert.equal(footer.separate, true);
    check('密集选集卡片底部左侧显示画布状态，选择状态靠右');
    await click('author-canvas-sort');
    const expected = [1, 3, 5, 7, 8, 2, 0, 4, 6].map((index) => rows[index].templateUuid);
    assert.deepEqual(await ids(), expected);
    await run(
      `document.getElementById('columns').value=4;document.getElementById('columns').dispatchEvent(new Event('input'))`
    );
    const geometry = await run(
      `[...document.querySelectorAll('.work-card')].map(n=>({id:n.dataset.workId,x:n.getBoundingClientRect().left,y:n.getBoundingClientRect().top}))`
    );
    assert.equal(geometry[5].x, geometry[0].x);
    assert.ok(geometry[5].y > geometry[4].y);
    assert.equal(geometry[6].x, geometry[0].x);
    assert.ok(geometry[6].y > geometry[5].y);
    assert.deepEqual(
      service.snapshot().works.map((work) => work.id),
      rows.map((row) => row.templateUuid)
    );
    await click('author-canvas-sort');
    assert.deepEqual(
      await ids(),
      rows.map((row) => row.templateUuid)
    );
    await click('author-canvas-sort');
    check('画布排序保持组内原有顺序，待确认及未公开各自换行，可恢复原顺序');
    await click('author-canvas-filter');
    await until(
      `document.querySelectorAll('.work-card').length===6 && !document.getElementById('author-canvas-filter').disabled`
    );
    assert.equal(service.snapshot().selectedIds.length, 6);
    assert.equal(result.authorProfile.selectedIds.length, 6);
    assert.equal(
      await run(`document.getElementById('author-canvas-filter').textContent`),
      '显示未公开画布'
    );
    await click('author-clear');
    await until(
      `document.querySelectorAll('.work-card.is-selected').length===0 && !document.getElementById('author-select-all').disabled`
    );
    await click('author-select-all');
    await until(
      `document.querySelectorAll('.work-card.is-selected').length===6 && !document.getElementById('author-canvas-filter').disabled`
    );
    assert.deepEqual(
      service.snapshot().selectedIds,
      rows.filter((_row, index) => statuses[index] !== 'not-public').map((row) => row.templateUuid)
    );
    check('隐藏未公开作品同步取消其选择，全部选中仅包括可见作品并保留待确认作品');
    await click('author-canvas-filter');
    await until(
      `document.querySelectorAll('.work-card').length===9 && !document.getElementById('author-select-all').disabled`
    );
    assert.equal(service.snapshot().selectedIds.length, 6);
    await click('author-select-all');
    await until(
      `document.querySelectorAll('.work-card.is-selected').length===9 && !document.getElementById('author-canvas-filter').disabled`
    );
    assert.equal(service.snapshot().selectedIds.length, 9);
    check('显示未公开作品后，全部选中恢复覆盖所有作品');
    const out = path.join(root, '开发辅助/验收记录/v1.3/author-canvas-controls');
    await fs.mkdir(out, { recursive: true });
    win.setContentSize(1440, 1900);
    await run(
      `document.getElementById('columns').value=8;document.getElementById('columns').dispatchEvent(new Event('input'));document.getElementById('author-section').scrollIntoView({block:'center'})`
    );
    await wait(100);
    const crop = await run(
      `(()=>{const r=document.getElementById('author-section').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`
    );
    await fs.writeFile(
      path.join(out, 'sorted-dense.png'),
      (await win.webContents.capturePage(crop)).toPNG()
    );
    rejectSelection = true;
    await click('author-canvas-filter');
    await until(
      `document.querySelectorAll('.work-card').length===9 && !document.getElementById('author-canvas-filter').disabled`
    );
    assert.equal(service.snapshot().selectedIds.length, 9);
    assert.equal(
      await run(`document.getElementById('author-canvas-filter').textContent`),
      '隐藏未公开画布'
    );
    check('选择同步失败时恢复显示，避免隐藏的作品仍被选中');
    await click('author-canvas-filter');
    await until(
      `document.querySelectorAll('.work-card').length===6 && !document.getElementById('author-canvas-filter').disabled`
    );
    service.select([rows[2].templateUuid]);
    service.start();
    await until(
      `document.querySelectorAll('.work-card').length===5 && !document.getElementById('author-canvas-filter').disabled && document.querySelectorAll('.work-card.is-selected').length===0`
    );
    assert.equal(service.snapshot().works[2].canvasAccess, 'not-public');
    assert.deepEqual(service.snapshot().selectedIds, []);
    assert.deepEqual(result.authorProfile.selectedIds, []);
    check('读取中发现画布未公开时，自动隐藏并同步取消选择');
    for (const width of [1440, 1000, 800, 680]) {
      win.setContentSize(width, 1100);
      await wait(60);
      assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`), true);
    }
    await service.open('https://www.liblib.tv/profile?uuid=' + uuid);
    await until(
      `document.querySelectorAll('.work-card').length===6 && !document.getElementById('author-canvas-filter').disabled`
    );
    assert.equal(service.snapshot().selectedIds.length, 6);
    check('重新读取同一作者保留筛选并同步选择，窄窗口无横向溢出');
    service.clear();
    await until(`document.getElementById('author-section').hidden`);
    await service.open('https://www.liblib.tv/profile?uuid=' + uuid);
    await until(
      `document.querySelectorAll('.work-card').length===9 && !document.getElementById('author-canvas-filter').disabled`
    );
    assert.equal(
      await run(`document.getElementById('author-canvas-sort').getAttribute('aria-pressed')`),
      'false'
    );
    assert.equal(
      await run(`document.getElementById('author-canvas-filter').getAttribute('aria-pressed')`),
      'false'
    );
    check('退出选集后重新打开恢复默认显示与原有顺序');
    service.clear();
    rows.splice(0, rows.length, ...rows.filter((row) => row.snapshotId === null));
    await service.open('https://www.liblib.tv/profile?uuid=' + uuid);
    await until(
      `document.querySelectorAll('.work-card').length===3 && !document.getElementById('author-canvas-filter').disabled`
    );
    await click('author-canvas-filter');
    await until(
      `document.querySelectorAll('.work-card').length===0 && !document.getElementById('author-canvas-filter').disabled`
    );
    assert.deepEqual(service.snapshot().selectedIds, []);
    assert.equal(await run(`document.getElementById('author-select-all').disabled`), true);
    assert.match(
      await run(`document.querySelector('#author-works .empty-state').textContent`),
      /已隐藏/
    );
    await click('author-canvas-filter');
    await until(`document.querySelectorAll('.work-card').length===3`);
    await click('author-select-all');
    await until(
      `document.querySelectorAll('.work-card.is-selected').length===3 && !document.getElementById('author-canvas-filter').disabled`
    );
    assert.equal(service.snapshot().selectedIds.length, 3);
    check('全部作品未公开时，隐藏后为空且无选择，仍可显示回来并全部选中');
    localProfile = {
      ...service.snapshot(),
      localProject: true,
      directory: path.join(app.getPath('userData'), 'local-collection')
    };
    send('result', { ...result, localProject: true });
    send('author', localProfile);
    await until(`document.getElementById('author-read').textContent==='检测画布更新（3）'`);
    assert.equal(await run(`document.getElementById('start').textContent`), '开始读取画布');
    for (const width of [1440, 1000, 800, 680, 560]) {
      win.setContentSize(width, 1100);
      await wait(60);
      const button = await run(`(() => {
        const button = document.getElementById('author-read');
        const rect = button.getBoundingClientRect();
        return {
          visible: !button.hidden && getComputedStyle(button).display !== 'none' && rect.width > 0,
          fits: rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth,
          disabled: button.disabled,
          previous: button.previousElementSibling.id,
          sizes: ['start', 'open-local-project', 'open-canvas', 'folder', 'directory', 'save-prompts', 'download', 'author-read'].map(id => {
            const rect = document.getElementById(id).getBoundingClientRect();
            return {id, width:rect.width, height:rect.height};
          })
        };
      })()`);
      assert.equal(button.visible, true);
      assert.equal(button.fits, true);
      assert.equal(button.disabled, false);
      assert.equal(button.previous, 'author-canvas-filter');
      for (const size of button.sizes) {
        assert.equal(
          size.width,
          button.sizes[0].width,
          JSON.stringify({ width, sizes: button.sizes })
        );
        assert.equal(
          size.height,
          button.sizes[0].height,
          JSON.stringify({ width, sizes: button.sizes })
        );
      }
    }
    send('author', { ...localProfile, selectedIds: [] });
    await until(`document.getElementById('author-read').disabled`);
    send('author', localProfile);
    await until(`!document.getElementById('author-read').disabled`);
    await click('author-read');
    await until(`document.getElementById('author-read').textContent==='停止检测'`);
    assert.equal(updateRequests, 1);
    assert.equal(await run(`document.getElementById('author-read').disabled`), false);
    assert.equal(await run(`document.getElementById('author-clear').disabled`), true);
    assert.equal(await run(`document.querySelector('.work-card').disabled`), true);
    await click('author-read');
    await until(`document.getElementById('author-read').textContent==='检测画布更新（3）'`);
    assert.equal(stopRequests, 1);
    assert.equal(await run(`document.getElementById('author-clear').disabled`), false);
    win.setContentSize(1440, 1100);
    await run(`document.getElementById('author-section').scrollIntoView({block:'center'})`);
    await wait(100);
    const localCrop = await run(`(() => {
      const r = document.getElementById('author-section').getBoundingClientRect();
      return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};
    })()`);
    await fs.writeFile(
      path.join(out, 'local-read-button.png'),
      (await win.webContents.capturePage(localCrop)).toPNG()
    );
    win.setContentSize(1440, 1500);
    await run(`window.scrollTo(0,0)`);
    await wait(100);
    await fs.writeFile(
      path.join(out, 'uniform-action-buttons.png'),
      (await win.webContents.capturePage()).toPNG()
    );
    check(
      '顶部恢复开始读取画布；五种窗口宽度下八个操作按钮等宽等高；本地选集检测与停止路由正确，空选择及检测期间锁定选择'
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify({ passed: true, checks, footer, geometry, errors }, null, 2)
    );
  })
  .then(
    () => {
      clearTimeout(watchdog);
      win?.destroy();
      app.quit();
    },
    (error) => {
      console.error(error);
      clearTimeout(watchdog);
      app.exit(1);
    }
  );
