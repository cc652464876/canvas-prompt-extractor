'use strict';
const path = require('node:path'),
  fs = require('node:fs/promises'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
if (!process.versions.electron) {
  require('../../scripts/build.cjs')().then(() => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = require('node:child_process').spawn(require('electron'), [__filename], {
      env,
      stdio: 'inherit',
      windowsHide: true
    });
    child.on('exit', (code) => (process.exitCode = code || 0));
  });
} else {
  const { app, BrowserWindow, ipcMain, protocol } = require('electron');
  const { createAuthorService } = require('../../src/services/author.cjs');
  const out = path.join(root, '开发辅助/验收记录/v1.3');
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'labmedia',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ]);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  app
    .whenReady()
    .then(async () => {
      await fs.mkdir(out, { recursive: true });
      const errors = [],
        checks = [];
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
        'base64'
      );
      protocol.handle(
        'labmedia',
        () => new Response(png, { headers: { 'content-type': 'image/png' } })
      );
      const win = new BrowserWindow({
        show: false,
        width: 1440,
        height: 1100,
        webPreferences: {
          preload: path.join(root, 'src/preload.cjs'),
          offscreen: true,
          backgroundThrottling: false
        }
      });
      win.webContents.on('console-message', (e) => {
        if (e.level === 'error' || e.level === 3) errors.push(e.message);
      });
      let current, project;
      const send = (type, payload) => win.webContents.send('lab:event', { type, payload });
      const works = Array.from({ length: 10 }, (_, i) => ({
        templateUuid: (i + 1).toString(16).padStart(32, '0'),
        name: '示例作品 ' + (i + 1),
        nickname: '测试作者',
        ownerUuid: 'a'.repeat(32)
      }));
      const options = { kinds: ['image', 'video', 'audio', 'text'], split: true, mode: 'full' };
      const service = createAuthorService({
        fetcher: async () => Response.json({ code: 0, data: { list: works, total: 10 } }),
        cancelRead: () => {},
        getRoot: () => out,
        getOptions: () => options,
        send,
        readWork: async (url) => {
          await wait(15);
          return {
            schemaVersion: 2,
            metadata: { platform: 'liblib', author: '测试作者', title: '示例作品', inputUrl: url },
            diagnostics: { warnings: [], nodeCount: 1, counts: { image_text: 1 } },
            edges: [],
            nodeSummaries: [{ nodeId: 'node' }],
            entries: [
              {
                nodeId: 'node',
                name: '场景示例',
                kind: 'image_text',
                prompt: '固定提示词',
                group: '',
                model: '示例模型',
                position: {},
                references: [],
                referenceTexts: [],
                outputAssetIds: ['asset']
              }
            ],
            assets: [
              {
                id: 'asset',
                name: '场景素材',
                kind: 'image',
                source: 'generated',
                nodeIds: ['node'],
                state: 'pending',
                fileName: '素材.png',
                url: 'https://fixture.invalid/image.png',
                previewUrl: 'https://fixture.invalid/image.png'
              }
            ]
          };
        },
        publish: (value, store) => {
          current = value;
          project = store;
          send('result', value);
          send('project', store.summary());
        }
      });
      const handlers = {
        info: () => ({ platforms: [], options, outputDirectory: out, accounts: [] }),
        author: (input) => service.open(input),
        'author-select': (ids) => service.select(ids),
        'author-read': () => service.start(),
        'author-retry': (id) => service.retry(id),
        theme: () => ({}),
        update: () => ({ options }),
        'login-state': () => ({}),
        'thumbnail-info': () => false,
        'cache-thumbnail': () => true,
        'copy-text': () => true
      };
      for (const [channel, handler] of Object.entries(handlers))
        ipcMain.handle('lab:' + channel, async (_e, ...args) => {
          try {
            return { ok: true, value: await handler(...args) };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        });
      const run = (s) => win.webContents.executeJavaScript(s);
      async function until(fn) {
        for (let i = 0; i < 200; i++) {
          if (await fn()) return;
          await wait(20);
        }
        throw new Error('UI state timeout');
      }
      const check = (s) => {
        checks.push(s);
        console.log('PASS ' + s);
      };
      try {
        await win.loadFile(path.join(root, 'src/ui/index.html'));
        assert.equal(await run(`document.getElementById('start').textContent`), '开始读取网页');
        await service.open('https://liblib.tv/profile?uuid=' + 'a'.repeat(32));
        await until(() => run(`document.querySelectorAll('.work-card').length===10`));
        await run(
          `document.getElementById('columns').value=8;document.getElementById('columns').dispatchEvent(new Event('input'));document.getElementById('author-select-all').click()`
        );
        await run("document.getElementById('author-read').click()");
        await until(() => current?.assets.length === 10 && !service.reading);
        await wait(180);
        const geometry = await run(
          `(()=>{const w=[...document.querySelectorAll('.work-card')].map(n=>n.getBoundingClientRect()),a=document.querySelector('#entries .content-card').getBoundingClientRect(),s=document.querySelector('.search-field').getBoundingClientRect(),t=document.querySelector('.board-visibility').getBoundingClientRect(),buttons=[...document.querySelectorAll('.board-visibility button')].map(n=>n.getBoundingClientRect().width);return{first:w.filter(r=>r.top===w[0].top).length,second:w.filter(r=>r.top===w[8].top).length,assetsStart:a.top,worksEnd:w[9].bottom,workWidth:w[0].width,assetWidth:a.width,workHeight:w[0].height,assetHeight:a.height,searchWidth:s.width,toggleWidth:t.width,buttons}})()`
        );
        assert.equal(geometry.first, 8);
        assert.equal(geometry.second, 2);
        assert.ok(geometry.assetsStart > geometry.worksEnd);
        assert.equal(geometry.workWidth, geometry.assetWidth);
        assert.equal(geometry.workHeight, geometry.assetHeight);
        assert.equal(geometry.searchWidth, geometry.toggleWidth);
        assert.equal(geometry.buttons[0], geometry.buttons[1]);
        check(
          'Ten works wrap 8 + 2, assets start on a new row, equal card sizes and equal search/toggle widths'
        );
        assert.equal(
          await run(`document.getElementById('save-prompts').textContent`),
          '保存提示词（10）'
        );
        await run(`document.getElementById('works-toggle').click()`);
        assert.equal(await run(`document.getElementById('author-works').hidden`), true);
        assert.equal(await run(`document.getElementById('board-body').hidden`), false);
        await run(`document.getElementById('board-toggle').click()`);
        assert.equal(
          await run(`document.querySelectorAll('.board-visibility button.active').length`),
          0
        );
        await run(
          `document.getElementById('works-toggle').click();document.getElementById('board-toggle').click()`
        );
        assert.equal(
          await run(`document.querySelectorAll('.board-visibility button.active').length`),
          2
        );
        check('Both joined view controls toggle independently and expose their active state');
        for (const density of [1, 5, 10, 11]) {
          await run(
            `document.getElementById('columns').value=${density};document.getElementById('columns').dispatchEvent(new Event('input'))`
          );
          await wait(100);
          const size = await run(
            `({work:document.querySelector('.work-card').getBoundingClientRect().height,asset:document.querySelector('#entries .content-card').getBoundingClientRect().height,text:document.getElementById('author-works').dataset.text})`
          );
          if (density !== 11) assert.equal(size.work, size.asset);
          else assert.equal(size.text, 'true');
        }
        check('Density changes resize work and asset cards together, including text index mode');
        send('downloads', {
          active: true,
          paused: false,
          files: current.assets.slice(0, 2),
          speeds: {},
          failed: 0,
          authorWorkIds: current.authorProfile.loadedIds.slice(0, 2)
        });
        await run(`document.getElementById('author-clear').click()`);
        await wait(100);
        assert.equal(current.assets.length, 0);
        assert.match(
          await run(`document.getElementById('download-context').textContent`),
          /2 部作品/
        );
        assert.match(await run(`document.getElementById('download').textContent`), /停止下载（2）/);
        check(
          'Clearing preview selection keeps the active download task and progress denominators fixed'
        );
        send('downloads', { active: false, paused: false, files: [], speeds: {}, failed: 0 });
        await wait(50);
        assert.equal(await run(`document.getElementById('save-prompts').disabled`), true);
        assert.equal(await run(`document.getElementById('download').disabled`), true);
        service.select([works[0].templateUuid]);
        await wait(100);
        assert.equal(
          await run(`document.getElementById('save-prompts').textContent`),
          '保存提示词（1）'
        );
        assert.equal(await run(`document.querySelectorAll('.work-card.is-selected').length`), 1);
        const colors = await run(
          `({selected:getComputedStyle(document.querySelector('.work-card.is-selected')).backgroundColor,unselected:getComputedStyle(document.querySelector('.work-card:not(.is-selected)')).backgroundColor})`
        );
        assert.notEqual(colors.selected, colors.unselected);
        check('Selection changes update quantities and selected/unselected card backgrounds');
        for (const width of [1440, 1000, 800, 680]) {
          win.setContentSize(width, 1100);
          await wait(100);
          assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`), true);
        }
        assert.deepEqual(errors, []);
        assert.ok(project);
        await fs.writeFile(
          path.join(out, 'author-ui-report.json'),
          JSON.stringify({ passed: true, checks, geometry, colors, errors }, null, 2)
        );
      } finally {
        win.destroy();
      }
      app.quit();
    })
    .catch((e) => {
      console.error(e);
      app.exit(1);
    });
}
