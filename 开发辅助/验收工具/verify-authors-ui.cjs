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
      let current,
        project,
        publications = 0,
        selectionRequests = 0;
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
                prompt: '固定提示词\n'.repeat(120),
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
          publications++;
          current = value;
          project = store;
          send('result', value);
          send('project', store.summary());
        }
      });
      const handlers = {
        info: () => ({ platforms: [], options, outputDirectory: out, accounts: [] }),
        author: (input) => service.open(input),
        'author-select': (ids) => {
          selectionRequests++;
          return service.select(ids);
        },
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
      const run = async (s) => {
        try {
          return await win.webContents.executeJavaScript(s);
        } catch (error) {
          throw new Error(error.message + '\nScript: ' + s + '\nConsole: ' + errors.join('\n'));
        }
      };
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
        assert.equal(await run(`document.getElementById('start').textContent`), '开始读取画布');
        for (const address of [
          'https://jimeng.jianying.com/s/hBHP6B5pXik/',
          'https://jimeng.jianying.com/ai-tool/personal/MS4wLjABAAAATESTAUTHOR',
          'https://app.tapnow.plus/creator/profile/test'
        ]) {
          await run(
            `document.getElementById('url').value=${JSON.stringify(address)};document.getElementById('url').dispatchEvent(new Event('input'))`
          );
          assert.equal(
            await run(`document.getElementById('jimeng-profile-note').hidden`),
            !address.includes('jimeng')
          );
        }
        check(
          'Jimeng short and canonical profile URLs show the login/list explanation without sending a request'
        );
        await service.open('https://liblib.tv/profile?uuid=' + 'a'.repeat(32));
        await until(() => run(`document.querySelectorAll('.work-card').length===10`));
        assert.equal(
          await run(`document.querySelector('#author-works .card-subheading').textContent`),
          '画布状态待确认'
        );
        await run(
          `document.getElementById('columns').value=8;document.getElementById('columns').dispatchEvent(new Event('input'));document.getElementById('author-select-all').click()`
        );
        await run("document.getElementById('author-read').click()");
        await until(() => current?.assets.length === 10 && !service.reading);
        assert.equal(
          await run(`document.querySelector('#author-works .card-subheading').textContent`),
          '画布已公开'
        );
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
        const downloadSnapshot = {
          active: true,
          paused: false,
          files: current.assets.slice(0, 2),
          speeds: {},
          failed: 0,
          authorWorkIds: current.authorProfile.loadedIds.slice(0, 2)
        };
        send('downloads', downloadSnapshot);
        await run(`
          document.getElementById('columns').value = 5;
          document.getElementById('columns').dispatchEvent(new Event('input'));
          document.getElementById('author-works').scrollIntoView({block:'center'});
        `);
        await wait(100);
        for (const selected of [false, true]) {
          const position = await run(`(() => {
            window.progressWorkCard = document.querySelector('.work-card');
            window.progressWorkCover = progressWorkCard.querySelector('.cover');
            progressWorkCard.focus({preventScroll:true});
            const rect = progressWorkCard.getBoundingClientRect();
            return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
          })()`);
          const requestsBeforeClick = selectionRequests;
          win.webContents.sendInputEvent({ type: 'mouseMove', ...position });
          win.webContents.sendInputEvent({
            type: 'mouseDown',
            button: 'left',
            clickCount: 1,
            ...position
          });
          for (let tick = 0; tick < 6; tick++) {
            send('downloads', { ...downloadSnapshot, speeds: { image: 1024 * (tick + 1) } });
            service.refresh({ assetsOnly: true });
            await wait(25);
          }
          assert.equal(
            await run(`progressWorkCard === document.querySelector('.work-card')`),
            true
          );
          assert.equal(
            await run(`progressWorkCover === document.querySelector('.work-card .cover')`),
            true
          );
          assert.equal(await run(`document.activeElement === progressWorkCard`), true);
          win.webContents.sendInputEvent({
            type: 'mouseUp',
            button: 'left',
            clickCount: 1,
            ...position
          });
          await until(() =>
            run(
              `document.querySelector('.work-card').getAttribute('aria-pressed') === '${selected}' && !document.querySelector('.work-card').disabled`
            )
          );
          assert.equal(selectionRequests, requestsBeforeClick + 1);
          assert.equal(service.snapshot().selectedIds.includes(works[0].templateUuid), selected);
        }
        check(
          '按住作者卡片期间连续更新下载进度与素材状态，卡片、封面和焦点保持不变；单击即可切换选择'
        );
        const unavailableSnapshot = {
          ...downloadSnapshot,
          failed: 1,
          files: downloadSnapshot.files.map((asset, index) => ({
            ...asset,
            state: index === 0 ? 'unavailable' : 'downloading',
            error: index === 0 ? '平台尚未提供可下载地址' : ''
          }))
        };
        send('downloads', unavailableSnapshot);
        await until(() => run(`!document.getElementById('failures').hidden`));
        assert.equal(await run(`document.getElementById('retry').hidden`), true);
        const failedSnapshot = {
          ...unavailableSnapshot,
          paused: true,
          files: unavailableSnapshot.files.map((asset, index) => ({
            ...asset,
            state: index === 0 ? 'failed' : asset.state,
            error: index === 0 ? '下载连接中断' : asset.error
          }))
        };
        send('downloads', failedSnapshot);
        await until(() => run(`!document.getElementById('retry').hidden`));
        for (let refresh = 0; refresh < 3; refresh++) {
          service.refresh();
          await run(`new Promise(resolve => requestAnimationFrame(resolve))`);
          assert.equal(await run(`document.getElementById('retry').hidden`), false);
          assert.equal(await run(`document.getElementById('retry').disabled`), true);
          assert.equal(await run(`document.getElementById('failures').hidden`), false);
          assert.equal(await run(`document.getElementById('download-attention').hidden`), false);
          assert.match(
            await run(`document.getElementById('failed-files').textContent`),
            /下载连接中断/
          );
        }
        check('作者列表反复刷新时保留失败提示、重试按钮与暂停提示；仅不可用素材不显示重试');
        for (const width of [1440, 1000, 800, 680]) {
          win.setContentSize(width, 1100);
          await wait(100);
          const layout = await run(`(() => {
            const rect = id => document.getElementById(id).getBoundingClientRect();
            const rows = rect('download-types'), audio = rect('progress-audio'),
              note = rect('download-context'), download = rect('download'), retry = rect('retry');
            return {
              noteBelow: note.top >= audio.bottom,
              noteInProgressColumn: note.left === rows.left && note.right <= rows.right + 1,
              buttonsInActionColumn: download.left > rows.right && retry.left === download.left,
              buttonsFit: retry.right <= innerWidth,
              actionAtTop: download.top < audio.top
            };
          })()`);
          assert.ok(Object.values(layout).every(Boolean), JSON.stringify({ width, layout }));
        }
        win.setContentSize(1440, 1100);
        await run(`document.getElementById('download-strip').scrollIntoView({block:'center'})`);
        await wait(150);
        await fs.writeFile(
          path.join(out, 'author-download-feedback-ui.png'),
          (await win.webContents.capturePage()).toPNG()
        );
        check('任务说明在音频进度条下方，下载与重试按钮在右侧固定列，四种窗口宽度无挤占');
        await run(`
          document.getElementById('columns').value = 5;
          document.getElementById('columns').dispatchEvent(new Event('input'));
          const cards = document.querySelectorAll('#entries .card-heading');
          cards[0].click();
          cards[1].click();
        `);
        await wait(100);
        await run(`
          window.downloadReaders = [...document.querySelectorAll('.reading-card')];
          window.downloadImage = downloadReaders[0].querySelector('.media-stage img');
          window.downloadScroll = downloadReaders[0].querySelector('.prompt-text');
          downloadScroll.scrollTop = 96;
          downloadReaders[1].querySelector('.collapse-reader').click();
          downloadReaders[0].dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
        `);
        assert.equal(await run(`downloadScroll.scrollTop`), 96);
        const publishedBeforeDownloads = publications;
        for (const [state, active] of [
          ['downloading', true],
          ['done', true],
          ['pending', true],
          ['done', false]
        ]) {
          current.assets[0].state = state;
          send('downloads', { ...downloadSnapshot, active, files: current.assets.slice(0, 2) });
          service.refresh({ assetsOnly: true });
          await wait(180);
          const readingState = await run(`({
            sameCards: [...document.querySelectorAll('.reading-card')].every((card, i) => card === downloadReaders[i]) && document.querySelectorAll('.reading-card').length === 2,
            sameImage: downloadImage === document.querySelector('.reading-card .media-stage img'),
            scroll: downloadScroll.scrollTop,
            collapsed: downloadReaders[1].classList.contains('is-collapsed'),
            focused: downloadReaders[0].classList.contains('focused'),
            saved: downloadReaders[0].querySelector('.download-one').textContent,
            locateHidden: downloadReaders[0].querySelector('.reader-locate').hidden
          })`);
          assert.equal(readingState.sameCards, true);
          assert.equal(readingState.sameImage, true);
          assert.equal(readingState.scroll, 96);
          assert.equal(readingState.collapsed, true);
          assert.equal(readingState.focused, true);
          assert.equal(readingState.locateHidden, state !== 'done');
          assert.equal(
            readingState.saved,
            { downloading: '下载中', done: '已下载', pending: '下载素材' }[state]
          );
          assert.equal(publications, publishedBeforeDownloads);
        }
        await run(`document.getElementById('clear-readers').click()`);
        assert.equal(await run(`document.querySelectorAll('.reading-card').length`), 0);
        check(
          '下载、完成与重新下载只更新素材状态，保留阅读卡片、媒体元素、正文滚动、焦点及收起状态；手动清空仍有效'
        );
        send('downloads', downloadSnapshot);
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
        const { publishedWork } = require('../../src/published-work.cjs');
        const { namespaceResult, mergeResults } = require('../../src/author-library.cjs');
        const videoWork = {
          id: 'published-only',
          title: '未公开画布的作品',
          url: 'https://app.tapnow.plus/home/taptv/3/published-only',
          canvasAccess: 'not-public',
          note: '画布未公开，仅可下载作品视频',
          state: 'ready',
          error: ''
        };
        const videoProfile = {
          platform: 'tapnow',
          uuid: 'author',
          author: '示例作者',
          url: 'https://app.tapnow.plus/creator/profile/author',
          works: [videoWork],
          selectedIds: [videoWork.id]
        };
        const videoResult = namespaceResult(
          publishedWork({
            platform: 'tapnow',
            inputUrl: videoWork.url,
            title: videoWork.title,
            author: videoProfile.author,
            fullVideo: {
              workId: videoWork.id,
              name: videoWork.title,
              url: 'https://cdn.example.com/work.mp4'
            }
          }),
          videoWork
        );
        send('author', videoProfile);
        send(
          'result',
          mergeResults(videoProfile, new Map([[videoWork.id, videoResult]]), [videoWork.id])
        );
        send('status', {
          message: '已读取 1 部作品；画布未公开，仅可下载作品视频。',
          phase: 'done'
        });
        win.setContentSize(1440, 1100);
        await run(
          `document.getElementById('columns').value=5;document.getElementById('columns').dispatchEvent(new Event('input'));document.getElementById('tab-assets').click()`
        );
        await wait(150);
        assert.match(
          await run(`document.querySelector('.work-card .card-subheading').textContent`),
          /画布未公开/
        );
        assert.equal(await run(`document.querySelectorAll('#entries .content-card').length`), 0);
        assert.equal(await run(`document.getElementById('open-canvas').disabled`), true);
        assert.equal(await run(`document.getElementById('save-prompts').disabled`), true);
        assert.equal(await run(`document.getElementById('download').disabled`), false);
        assert.equal(
          await run(`document.querySelector('[data-filter="video"] .counter').textContent`),
          '0'
        );
        check('未公开画布保留作品卡片与说明，隐藏画布素材，禁用画布及提示词按钮，成片仍可下载');
        await run(`document.getElementById('author-section').scrollIntoView({block:'center'})`);
        await fs.writeFile(
          path.join(out, 'author-video-only-ui.png'),
          (await win.webContents.capturePage()).toPNG()
        );
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
