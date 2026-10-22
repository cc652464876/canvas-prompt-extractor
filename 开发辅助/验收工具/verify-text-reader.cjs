'use strict';
const { verificationPath } = require('../../src/app-paths.cjs');
const path = require('node:path'),
  fs = require('node:fs/promises'),
  assert = require('node:assert/strict');
if (!process.versions.electron)
  throw new Error('Run this verification with the existing Electron runtime.');
const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');
const { normalize, markdown, filterResult } = require('../../src/normalize.cjs');
const fixtures = require('../测试代码/fixtures/text-platforms.cjs');
const { ProjectStore, WORK_INFO } = require('../../src/project-store.cjs');
const root = path.resolve(__dirname, '../..'),
  out = verificationPath(root, 'text-reader');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'labmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
]);
app.setPath(
  'userData',
  require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'v11-text-reader-'))
);
app.whenReady().then(async () => {
  let ui;
  const checks = [],
    errors = [],
    copies = [];
  try {
    await fs.mkdir(out, { recursive: true });
    const projectRoot = await fs.mkdtemp(path.join(out, 'text-actions-'));
    let store = new ProjectStore(projectRoot);
    await require('../../scripts/build.cjs')();
    const ses = session.fromPartition('text-reader-fixture');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#dbe4e5"/><text x="40" y="285" fill="#344b55" font-size="32">Text reference verification</text></svg>';
    ses.protocol.handle(
      'labmedia',
      () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })
    );
    for (const channel of ['theme', 'update', 'reveal', 'cache-thumbnail', 'thumbnail-info'])
      ipcMain.handle('lab:' + channel, () => ({ ok: true, value: null }));
    ipcMain.handle('lab:copy-text', (_event, text) => {
      copies.push(text);
      return { ok: true, value: true };
    });
    ipcMain.handle('lab:save-text', async (_event, nodeId) => {
      if (!store.directory)
        await store.create(store.result, { kinds: ['text'], mode: 'full' }, false);
      const saved = await store.saveText(nodeId);
      ui.webContents.send('lab:event', { type: 'project', payload: saved });
      return { ok: true, value: saved };
    });
    ipcMain.handle('lab:text-file', async (_event, nodeId) => ({
      ok: true,
      value: await store.textFileInfo(nodeId)
    }));
    ipcMain.handle('lab:info', () => ({
      ok: true,
      value: { outputDirectory: '测试数据', options: { mode: 'full' } }
    }));
    ui = new BrowserWindow({
      show: false,
      width: 1440,
      height: 960,
      webPreferences: {
        preload: path.join(root, 'src/preload.cjs'),
        session: ses,
        backgroundThrottling: false,
        offscreen: true
      }
    });
    ui.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 3) errors.push(e.message);
    });
    const run = (code) => ui.webContents.executeJavaScript(code),
      j = JSON.stringify;
    const until = async (code) => {
      for (let i = 0; i < 100; i++) {
        if (await run(code)) return;
        await wait(30);
      }
      throw new Error('Timed out: ' + code);
    };
    const click = async (selector) => {
      await run(`document.querySelector(${j(selector)}).click()`);
      await wait(100);
    };
    const check = (name) => {
      checks.push(name);
      console.log('PASS ' + name);
    };
    const send = async (result) => {
      ui.webContents.send('lab:event', { type: 'result', payload: result });
      await until(`document.querySelector('.card-heading')`);
    };
    const shot = async (name) => {
      await run(`document.getElementById('reader-section').scrollIntoView({block:'start'})`);
      await wait(100);
      await fs.writeFile(
        path.join(out, name + '.png'),
        (await ui.webContents.capturePage()).toPNG()
      );
    };
    await ui.loadFile(path.join(root, 'src/ui/index.html'));
    await until(`document.querySelectorAll('#export-types input').length===4`);
    const lib = fixtures.liblib(),
      r = normalize(lib.snapshot, lib.metadata);
    store.result = r;
    await send(r);
    assert.equal(await run(`document.querySelector('.version').textContent`), 'v1.3');
    assert.match(
      await run(`document.getElementById('content-summary').textContent`),
      /文本节点 2 个 · 直接提示词 0 条 · 有关联文本的生成节点 2 个/
    );
    check('Version and nonduplicated text/direct/consumer counts');
    await click('[data-key="prompts:wibgBN2cmT"] .card-heading');
    assert.equal(await run(`document.querySelector('.linked-text').open`), true);
    assert.equal(
      await run(`document.querySelector('.linked-text pre').textContent`),
      fixtures.imageText
    );
    assert.match(
      await run(`document.querySelector('.text-provenance').textContent`),
      /当前生成配置引用/
    );
    assert.equal(await run(`document.querySelectorAll('.ref-thumb').length`), 1);
    check('LibTV text-only image opens full text, provenance and reference media');
    await click('.linked-text-actions button');
    assert.equal(copies.at(-1), fixtures.imageText);
    check('Copy linked text returns exactly its body');
    await click('.linked-text-actions button:last-child');
    const geometry = await run(
      `(()=>{const c=document.querySelector('.reading-card.focused'),t=c.querySelector('.text-col').getBoundingClientRect(),r=c.querySelector('.reading-content').getBoundingClientRect();return {text:c.querySelector('.prompt-inner').textContent,visual:getComputedStyle(c.querySelector('.visual-col')).display,ratio:t.width/r.width,links:c.querySelectorAll('.citing-links button').length,label:c.querySelector('.citing-label').textContent};})()`
    );
    assert.ok(geometry.text.includes(fixtures.imageText));
    assert.equal(geometry.visual, 'none');
    assert.ok(geometry.ratio > 0.95);
    assert.equal(geometry.links, 1);
    assert.equal(geometry.label, '关联节点');
    check('Source text has a full-width reader and navigable consumer');
    await run(`document.getElementById('reading-board').style.minHeight='1800px'`);
    for (const width of [1440, 960]) {
      ui.setSize(width, 960);
      await wait(200);
      for (const layout of ['side', 'stack', 'dual']) {
        await click('#read-layouts [data-layout=' + layout + ']');
        for (const offset of [250, 800]) {
          await run(
            `window.scrollTo(0, document.getElementById('reader-section').offsetTop + ${offset})`
          );
          await wait(50);
          const toolbar = await run(
            `(()=>{const bar=document.querySelector('.reader-toolbar'),r=bar.getBoundingClientRect(),b=document.getElementById('clear-readers'),p=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,background:getComputedStyle(bar).backgroundColor,pageBackground:getComputedStyle(document.body).backgroundColor,clearClickable:b.contains(document.elementFromPoint(p.left+p.width/2,p.top+p.height/2))};})()`
          );
          assert.ok(Math.abs(toolbar.top) < 1, JSON.stringify({ width, layout, toolbar }));
          assert.ok(toolbar.bottom < 960);
          assert.equal(toolbar.background, toolbar.pageBackground);
          assert.equal(toolbar.clearClickable, true);
        }
      }
    }
    ui.setSize(1440, 960);
    await run(`document.getElementById('reading-board').style.minHeight='';window.scrollTo(0,0)`);
    await wait(200);
    check(
      'Reader toolbar stays visible and clear remains clickable across layouts and narrow windows'
    );
    assert.equal(
      await run(`document.querySelector('.reading-card.focused .download-one').disabled`),
      false
    );
    assert.equal(
      await run(`document.querySelector('.reading-card.focused .download-one').textContent`),
      '下载文本'
    );
    await click('.reading-card.focused .download-one');
    const files = await fs.readdir(store.directory);
    const textFile = files.find((name) => name.startsWith('文本_') && name.endsWith('.txt'));
    assert.equal(
      await fs.readFile(path.join(store.directory, textFile), 'utf8'),
      fixtures.imageText
    );
    assert.ok(files.includes(WORK_INFO));
    assert.equal(
      files.some((name) => name.endsWith('.md') && name !== WORK_INFO),
      false
    );
    check(
      'Reader individually downloads exact text and creates info Markdown without exporting other prompts'
    );
    await run(
      `document.querySelector('.reading-card.focused .prompt-text').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`
    );
    await until(`document.getElementById('media-dialog').open`);
    assert.equal(
      await run(`document.querySelector('#media-dialog-body pre').textContent`),
      fixtures.imageText
    );
    assert.equal(
      await run(
        `document.querySelectorAll('#media-dialog-body video,#media-dialog-body audio').length`
      ),
      0
    );
    await click('#media-dialog-reader');
    assert.equal(await run(`document.getElementById('media-dialog').open`), false);
    check('Text right-click opens full preview and can return to its existing reader');
    const textNode = r.entries.find(
      (entry) => entry.kind === 'text' && entry.prompt === fixtures.imageText
    );
    const textCard = '[data-key="prompts:' + textNode.nodeId + '"]';
    await run(
      `document.querySelector(${j(textCard)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`
    );
    await until(`document.getElementById('media-dialog').open`);
    assert.equal(
      await run(`document.querySelector('#media-dialog-body pre').textContent`),
      fixtures.imageText
    );
    await click('#media-dialog-close');
    check('Board text cards support right-click preview');
    const fill = '#download-types [data-kind="image"] .progress-fill';
    const normal = await run(
      `getComputedStyle(document.querySelector(${j(fill)})).backgroundImage`
    );
    for (const asset of r.assets) if (asset.kind === 'image') asset.state = 'done';
    ui.webContents.send('lab:event', { type: 'assets', payload: r.assets });
    await wait(350);
    assert.equal(await run(`document.querySelector(${j(fill)}).style.width`), '100%');
    assert.equal(
      await run(`getComputedStyle(document.querySelector(${j(fill)})).backgroundImage`),
      normal
    );
    check('Completed progress stays at 100% with the original theme color');
    await click('#clear-readers');
    await click('#tab-assets');
    const image = r.assets.find((a) => a.nodeIds.includes('wibgBN2cmT'));
    await click('[data-key="assets:' + image.id + '"] .card-heading');
    assert.equal(await run(`document.querySelectorAll('.reading-card').length`), 1);
    assert.equal(await run(`document.querySelector('.reading-card').dataset.scope`), 'prompts');
    check('Asset and prompt boards share the same linked-text reader');
    await shot('libtv-image');
    await click('#clear-readers');
    await click('#tab-prompts');
    await click('[data-key="prompts:vkKOAJDhuy"] .card-heading');
    assert.equal(
      await run(`document.querySelector('.linked-text pre').textContent`),
      fixtures.videoText
    );
    assert.equal(
      await run("document.querySelector('.linked-text pre').textContent.startsWith('```')"),
      false
    );
    assert.equal(await run(`document.querySelectorAll('.ref-thumb').length`), 1);
    check('LibTV video preserves mixed media and text, without code-fence wrappers');
    await shot('libtv-video');
    const jm = fixtures.jimeng(),
      jr = normalize(jm.snapshot, jm.metadata);
    await send(jr);
    await click('[data-key="prompts:node_c42pcgb9bm"] .card-heading');
    assert.equal(await run(`document.querySelector('.linked-text').open`), true);
    assert.ok(
      await run(
        `document.querySelector('.linked-text pre').textContent.startsWith('v1.1 读取验证')`
      )
    );
    assert.equal(jr.entries.find((e) => e.kind === 'text').connectionStatus, 'shared');
    check('Jimeng canonical text prefix and sourceInstanceId references resolve correctly');
    await click('[data-key="prompts:node_4nfg55ejxq"] .card-heading');
    assert.equal(
      await run(`document.querySelector('.reading-card.focused .linked-text').open`),
      false
    );
    assert.ok(
      await run(
        `document.querySelector('.reading-card.focused .prompt-inner').textContent.includes('v1.1 视频直接提示词')`
      )
    );
    check('Direct prompt and linked text stay separate; extra text starts collapsed');
    await click('[data-key="prompts:node_zbjqzq5xnn"] .card-heading');
    assert.equal(
      await run(`document.querySelector('.reading-card.focused .citing-links').children.length`),
      2
    );
    assert.ok(
      await run(
        `document.querySelector('.reading-card.focused .text-role').textContent.includes('共享文本')`
      )
    );
    await shot('jimeng-shared');
    check('One shared text reader links to both consumers');
    for (const layout of ['side', 'stack', 'dual']) {
      await click('[data-layout="' + layout + '"]');
      for (const width of [1440, 700]) {
        ui.setSize(width, 960);
        await wait(180);
        assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`), false);
      }
    }
    ui.setSize(1440, 960);
    await wait(100);
    check('Text readers remain usable across three layouts and narrow windows');
    const weak = normalize(
      {
        nodes: [
          { id: 'note', type: 'text', data: { name: '作者备注', content: ['备注原文'] } },
          {
            id: 'image',
            type: 'image',
            data: {
              name: '图片',
              action: 'image_generate',
              params: { prompt: '', model: 'nebula-ultra' }
            }
          }
        ],
        edges: [{ source: 'note', target: 'image' }]
      },
      lib.metadata
    );
    await send(weak);
    await click('[data-key="prompts:image"] .card-heading');
    assert.ok(
      await run(`document.querySelector('.text-provenance').textContent.includes('仅连线关联')`)
    );
    check('Edge-only associations are visibly marked as unconfirmed');
    const broken = normalize(
      {
        nodes: [
          { id: 'bad', type: 'text', data: { name: '未解析文本', content: { unsupported: true } } },
          {
            id: 'image',
            type: 'image',
            data: {
              name: '图片',
              action: 'image_generate',
              params: { prompt: '', textList: [{ nodeId: 'bad' }] }
            }
          }
        ],
        edges: [{ source: 'bad', target: 'image' }]
      },
      lib.metadata
    );
    await send(broken);
    await click('[data-key="prompts:image"] .card-heading');
    assert.ok(
      await run(`document.querySelector('.linked-text-body').textContent.includes('正文读取失败')`)
    );
    assert.equal(await run(`document.querySelector('.linked-text-actions button').disabled`), true);
    check('Unreadable text is not presented as absent or copied as an empty prompt');
    const doc = markdown(filterResult(jr, ['image', 'video']));
    assert.equal(doc.split('v1.1 读取验证').length - 1, 1);
    await fs.writeFile(path.join(out, 'shared-export.md'), doc);
    for (const [name, result] of [
      ['liblib', r],
      ['jimeng', jr]
    ])
      await fs.writeFile(
        path.join(out, name + '-normalized.json'),
        JSON.stringify(result, null, 2)
      );
    check('Selected-category Markdown deduplicates shared text and retains provenance');
    const sampleArg = process.argv.find((arg) => arg.startsWith('--sample-project='));
    if (sampleArg) {
      const { loadLocalProject } = require('../../src/local-project.cjs');
      const sample = await loadLocalProject(sampleArg.slice('--sample-project='.length));
      store = new ProjectStore(await fs.mkdtemp(path.join(out, 'sample-text-actions-')));
      store.result = sample.result;
      await send(sample.result);
      for (const kind of ['video', 'image', 'audio']) await click('[data-filter="' + kind + '"]');
      const entry = sample.result.entries.find(
        (item) => item.kind === 'text' && item.prompt.trim()
      );
      assert.ok(entry);
      const selector = '[data-key="prompts:' + entry.nodeId + '"]';
      await run(
        `document.querySelector(${j(selector)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`
      );
      await until(`document.getElementById('media-dialog').open`);
      assert.equal(
        await run(`document.querySelector('#media-dialog-body pre').textContent`),
        entry.prompt
      );
      const previewGeometry = await run(`(()=>{
        const head=document.querySelector('#media-dialog .preview-heading').getBoundingClientRect();
        const text=document.querySelector('#media-dialog .text-preview').getBoundingClientRect();
        return {gap:text.top-head.bottom,height:text.height,overflow:document.querySelector('#media-dialog').scrollWidth>document.querySelector('#media-dialog').clientWidth+1};
      })()`);
      assert.ok(previewGeometry.gap >= 0, 'Preview text must start below its heading');
      assert.ok(previewGeometry.height > 300, 'Full text preview needs a readable scroll area');
      assert.equal(previewGeometry.overflow, false);
      await wait(180);
      await fs.writeFile(
        path.join(out, 'sample-text-preview.png'),
        (await ui.webContents.capturePage()).toPNG()
      );
      ui.setSize(700, 960);
      await wait(180);
      assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`), false);
      assert.equal(
        await run(
          `document.getElementById('media-dialog').scrollWidth>document.getElementById('media-dialog').clientWidth+1`
        ),
        false
      );
      ui.setSize(1440, 960);
      await wait(180);
      await click('#media-dialog-reader');
      await click('.reading-card.focused .download-one');
      const saved = (await fs.readdir(store.directory)).find((name) => name.startsWith('文本_'));
      assert.equal(await fs.readFile(path.join(store.directory, saved), 'utf8'), entry.prompt);
      assert.ok(await fs.stat(path.join(store.directory, WORK_INFO)));
      await shot('sample-text-reader');
      check(
        'User-provided offline project previews and individually saves its complete original text'
      );
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify(
        {
          passed: true,
          checks,
          errors,
          platformSource:
            'Live-observed text/draft fields; synthetic local media previews; no generation or credentials'
        },
        null,
        2
      )
    );
    console.log(JSON.stringify({ passed: true, checks: checks.length }));
    app.exit(0);
  } catch (error) {
    await fs
      .writeFile(
        path.join(out, 'report.json'),
        JSON.stringify({ passed: false, checks, errors, error: error.stack }, null, 2)
      )
      .catch(() => {});
    console.error(error.stack);
    app.exit(1);
  }
});
