'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');
const { normalize } = require('../../../src/normalize.cjs');
const { ProjectStore } = require('../../../src/project-store.cjs');

module.exports = async ({
  ui,
  root,
  finishExtraction,
  getResult,
  getStore,
  setOutputDirectory
}) => {
  const out = path.join(root, '开发辅助/验收记录/v1.4/color-tags');
  await fs.mkdir(out, { recursive: true });
  const run = (code) => ui.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const errors = [],
    checks = [];
  ui.webContents.on('console-message', (event) => {
    if (/ReferenceError|TypeError|SyntaxError/.test(event.message)) errors.push(event.message);
  });
  async function until(code) {
    for (let n = 0; n < 150; n++) {
      if (await run(code)) return;
      await wait(40);
    }
    throw new Error('Timed out: ' + code);
  }
  const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const check = (message) => {
    checks.push(message);
    console.log('PASS ' + message);
  };
  const options = { mode: 'full', kinds: ['image', 'video', 'audio', 'text'], split: true };
  setOutputDirectory(path.join(app.getPath('userData'), 'tag-projects'));
  await until(`document.getElementById('download-concurrency-trigger').disabled===false`);
  const original = normalize(
    {
      nodes: [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: 'image-' + i,
          type: 'image',
          data: {
            action: 'image_generate',
            name: '图片生成 ' + (i + 1),
            params: { prompt: '第 ' + (i + 1) + ' 张图片的提示词' },
            url: ['https://cdn.example.com/tag-' + i + '.png']
          }
        })),
        {
          id: 'no-media',
          type: 'video',
          data: {
            action: 'video_generate',
            name: '尚无媒体的节点',
            params: { prompt: '只有提示词，暂无媒体' }
          }
        },
        { id: 'text', type: 'text', data: { text: '标签也适用于独立文本。' } }
      ],
      edges: [],
      source: 'fixture'
    },
    {
      platform: 'liblib',
      inputUrl: 'https://www.liblib.tv/detail/color-tags-work',
      author: '颜色标签测试',
      title: '三处标签同步'
    }
  );
  const project = new ProjectStore(path.join(app.getPath('userData'), 'tag-projects'));
  await project.create(original, options, false);
  const png = Buffer.from(
    await run(`(() => {
    const c=document.createElement('canvas');c.width=640;c.height=360;
    const x=c.getContext('2d'),g=x.createLinearGradient(0,0,640,360);g.addColorStop(0,'#1e3a5f');g.addColorStop(1,'#52b7f4');
    x.fillStyle=g;x.fillRect(0,0,640,360);x.fillStyle='#ffffff';x.font='bold 36px sans-serif';x.fillText('COLOR TAGS',48,155);x.font='20px sans-serif';x.fillText('Cards · Readers · Preview',48,198);
    return c.toDataURL('image/png').split(',')[1];
  })()`),
    'base64'
  );
  for (const asset of original.assets) {
    await fs.writeFile(project.assetPath(asset), png);
    Object.assign(asset, {
      state: 'done',
      bytes: png.length,
      total: png.length,
      savedBytes: png.length
    });
  }
  await project.checkpoint();
  const first = '.content-card[data-key="prompts:image-0"]';
  const second = '.content-card[data-key="prompts:image-1"]';
  const reader = '.reading-card .detail-heading > .color-tag-dot';
  const preview = '#media-dialog .preview-actions > .color-tag-dot';
  const opened = await run(`window.lab.openLocalProject(${JSON.stringify(project.directory)})`);
  assert.equal(opened.ok, true, opened.error);
  await until(`document.querySelectorAll('#entries .content-card').length===7`);
  assert.equal(await run(`document.querySelectorAll('[data-tag-filter]').length`), 6);
  assert.equal(await run(`document.querySelector('[data-tag-filter="none"]')===null`), true);
  assert.equal(
    await run(`document.querySelector('[data-tag-filter]').dataset.tagFilter`),
    'excluded'
  );
  assert.equal(await run(`document.querySelectorAll('#entries .file-size').length`), 0);
  assert.equal(
    await run(`document.querySelectorAll('#entries .color-tag-dot[data-color-tag="none"]').length`),
    7
  );
  check('顶部仅显示黑、红、黄、绿、蓝、紫六种筛选；无标签保持默认灰点，菜单与筛选均没有灰色选项');
  async function tag(selector, color, expected = color) {
    await run(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`
    );
    await wait(60);
    await click(selector);
    await until(`document.querySelector('#color-tag-menu')?.matches(':popover-open')`);
    assert.equal(await run(`document.querySelector('#color-tag-menu').textContent`), '');
    assert.equal(
      await run(`document.querySelectorAll('#color-tag-menu [data-tag-choice]').length`),
      6
    );
    assert.equal(await run(`document.querySelector('[data-tag-choice="none"]')===null`), true);
    await click(`[data-tag-choice="${color}"]`);
    await until(
      `document.querySelector(${JSON.stringify(selector)})?.dataset.colorTag===${JSON.stringify(expected)}`
    );
  }
  await tag(first + ' .color-tag-dot', 'red');
  await tag(first + ' .color-tag-dot', 'red', 'none');
  await tag(first + ' .color-tag-dot', 'red');
  assert.equal(getResult().entries.find((e) => e.nodeId === 'image-0').colorTag, 'red');
  await click(first + ' .card-heading');
  await until(`document.querySelector(${JSON.stringify(reader)})?.dataset.colorTag==='red'`);
  assert.equal(
    await run(`document.querySelector('.reading-card').classList.contains('is-collapsed')`),
    false
  );
  await run(
    `window.tagReader=document.querySelector('.reading-card');window.tagReaderImage=tagReader.querySelector('img');`
  );
  await click(first + ' .preview-media');
  await until(`document.getElementById('media-dialog').open`);
  assert.equal(
    await run(`document.querySelector(${JSON.stringify(preview)}).dataset.colorTag`),
    'red'
  );
  await run(`window.tagPreviewImage=document.querySelector('#media-dialog-body img')`);
  await tag(preview, 'blue');
  await tag(preview, 'blue', 'none');
  assert.equal(
    await run(`document.querySelector(${JSON.stringify(reader)}).dataset.colorTag`),
    'none'
  );
  await tag(preview, 'blue');
  assert.equal(
    await run(
      `document.querySelector(${JSON.stringify(first + ' .color-tag-dot')}).dataset.colorTag`
    ),
    'blue'
  );
  assert.equal(
    await run(`document.querySelector(${JSON.stringify(reader)}).dataset.colorTag`),
    'blue'
  );
  assert.equal(
    await run(
      `tagReader===document.querySelector('.reading-card')&&tagReaderImage===tagReader.querySelector('img')&&tagPreviewImage===document.querySelector('#media-dialog-body img')`
    ),
    true
  );
  await fs.writeFile(
    path.join(out, 'preview-synced.png'),
    (await ui.webContents.capturePage()).toPNG()
  );
  await click('#media-dialog-close');
  for (const color of ['excluded', 'red', 'yellow', 'green', 'blue', 'purple']) {
    await tag(reader, color);
    await tag(reader, color, 'none');
    assert.equal(
      await run(
        `document.querySelector(${JSON.stringify(first + ' .color-tag-dot')}).dataset.colorTag`
      ),
      'none'
    );
    assert.equal(
      await run(`document.querySelector(${JSON.stringify(preview)}).dataset.colorTag`),
      'none'
    );
  }
  await tag(reader, 'blue');
  check('包括黑色在内的六种标签再次点击均取消为默认灰色，卡片、阅读区与预览同步恢复');
  await tag(reader, 'green');
  assert.equal(
    await run(
      `document.querySelector(${JSON.stringify(first + ' .color-tag-dot')}).dataset.colorTag`
    ),
    'green'
  );
  await tag(reader, 'blue');
  check('卡片、阅读区、预览窗口三处修改实时同步；修改时保留阅读卡片、图片元素与展开状态');
  await click(reader);
  await until(`document.querySelector('#color-tag-menu')?.matches(':popover-open')`);
  await run(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`
  );
  assert.equal(
    await run(`document.querySelector('#color-tag-menu').matches(':popover-open')`),
    false
  );
  assert.equal(
    await run(`document.querySelector('.reading-card').classList.contains('is-collapsed')`),
    false
  );
  await tag(second + ' .color-tag-dot', 'red');
  await click('[data-tag-filter="red"]');
  await click('[data-tag-filter="blue"]');
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#entries .color-tag-dot')].map(b=>b.dataset.colorTag).sort()`
    ),
    ['blue', 'red']
  );
  await click('#tab-assets');
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#entries .color-tag-dot')].map(b=>b.dataset.colorTag).sort()`
    ),
    ['blue', 'red']
  );
  await click('#tab-prompts');
  await click('[data-tag-filter="red"]');
  await click('[data-tag-filter="blue"]');
  assert.equal(await run(`document.querySelectorAll('#entries .content-card').length`), 7);
  await tag('.content-card[data-key="prompts:no-media"] .color-tag-dot', 'purple');
  check(
    '红色与蓝色多选按并集筛选，提示词和项目资产均生效；取消全部显示未排除素材与默认灰点，纯文本与无媒体节点也可标记'
  );
  await click(first + ' .color-tag-dot');
  await until(`document.querySelector('#color-tag-menu')?.matches(':popover-open')`);
  await fs.writeFile(
    path.join(out, 'color-palette.png'),
    (await ui.webContents.capturePage()).toPNG()
  );
  await click('[data-tag-choice="blue"]');
  await until(`!document.querySelector('#color-tag-menu').matches(':popover-open')`);
  const third = '.content-card[data-key="prompts:image-2"]';
  await click(third + ' .color-tag-dot');
  await click('[data-tag-choice="excluded"]');
  await until(`!document.querySelector(${JSON.stringify(third)})`);
  await tag(reader, 'excluded');
  assert.equal(await run(`document.querySelectorAll('#entries .content-card').length`), 5);
  await click('[data-tag-filter="red"]');
  await click('[data-tag-filter="blue"]');
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#entries .color-tag-dot')].map(b=>b.dataset.colorTag)`
    ),
    ['red']
  );
  await run(
    `window.exclusionRedFilter=document.querySelector('[data-tag-filter="red"]');window.exclusionBlueFilter=document.querySelector('[data-tag-filter="blue"]')`
  );
  await click('[data-tag-filter="excluded"]');
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#entries .color-tag-dot')].map(b=>b.dataset.colorTag)`
    ),
    ['excluded', 'excluded']
  );
  assert.equal(
    await run(
      `exclusionRedFilter===document.querySelector('[data-tag-filter="red"]')&&exclusionBlueFilter===document.querySelector('[data-tag-filter="blue"]')&&exclusionRedFilter.getAttribute('aria-pressed')==='true'&&exclusionBlueFilter.getAttribute('aria-pressed')==='true'`
    ),
    true
  );
  await click('[data-tag-filter="yellow"]');
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#entries .color-tag-dot')].map(b=>b.dataset.colorTag)`
    ),
    ['excluded', 'excluded']
  );
  await click('[data-tag-filter="yellow"]');
  await click('#tab-assets');
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#entries .color-tag-dot')].map(b=>b.dataset.colorTag)`
    ),
    ['excluded', 'excluded']
  );
  await click('#tab-prompts');
  assert.equal(
    await run(
      `(() => {const a=document.querySelector('[data-tag-filter="excluded"] span'),b=document.querySelector('[data-tag-filter="red"] span');return a.clientWidth===b.clientWidth&&a.clientHeight===b.clientHeight&&getComputedStyle(a).backgroundColor==='rgb(0, 0, 0)'})()`
    ),
    true
  );
  assert.equal(
    await run(
      `getComputedStyle(document.querySelector('[data-tag-filter="excluded"] span')).maskImage`
    ),
    'none'
  );
  await run(`document.getElementById('selection-toolbar').scrollIntoView({block:'start'})`);
  await wait(100);
  await fs.writeFile(
    path.join(out, 'excluded-filter.png'),
    (await ui.webContents.capturePage()).toPNG()
  );
  await click(first + ' .preview-media');
  await until(`document.getElementById('media-dialog').open`);
  assert.equal(
    await run(`document.querySelector(${JSON.stringify(preview)}).dataset.colorTag`),
    'excluded'
  );
  await tag(preview, 'blue');
  assert.equal(await run(`document.querySelectorAll('#entries .content-card').length`), 1);
  assert.equal(
    await run(`document.querySelector(${JSON.stringify(reader)}).dataset.colorTag`),
    'blue'
  );
  await click('#media-dialog-close');
  await click(third + ' .color-tag-dot');
  await click('[data-tag-choice="excluded"]');
  await until(`document.querySelectorAll('#entries .content-card').length===0`);
  assert.match(await run(`document.querySelector('#entries .empty-state').textContent`), /已排除/);
  await click('[data-tag-filter="excluded"]');
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#entries .color-tag-dot')].map(b=>b.dataset.colorTag).sort()`
    ),
    ['blue', 'red']
  );
  assert.equal(
    await run(
      `exclusionRedFilter.getAttribute('aria-pressed')==='true'&&exclusionBlueFilter.getAttribute('aria-pressed')==='true'`
    ),
    true
  );
  await click('[data-tag-filter="red"]');
  await click('[data-tag-filter="blue"]');
  assert.equal(await run(`document.querySelectorAll('#entries .content-card').length`), 7);
  await click(third + ' .color-tag-dot');
  await click('[data-tag-choice="excluded"]');
  await until(`document.querySelectorAll('#entries .content-card').length===6`);
  await wait(100);
  check(
    '已排除素材默认及颜色多选均隐藏；黑点优先只看排除项并保留颜色选择，预览改为蓝色、再次点击黑色取消标签均三处同步，退出黑点恢复原筛选'
  );
  const saved = JSON.parse(await fs.readFile(project.summary().manifestPath, 'utf8'));
  const perCanvas = JSON.parse(
    await fs.readFile(path.join(project.directory, 'color-tags.json'), 'utf8')
  );
  assert.equal(Object.values(perCanvas.tags).includes('excluded'), true);
  assert.equal(Object.values(perCanvas.tags).includes('blue'), true);
  assert.equal(Object.values(perCanvas.tags).includes('none'), false);
  await assert.rejects(fs.access(path.join(app.getPath('userData'), 'color-tags.json')), {
    code: 'ENOENT'
  });
  assert.equal(saved.result.entries.find((e) => e.nodeId === 'image-2').colorTag, 'excluded');
  assert.equal(saved.result.entries.find((e) => e.nodeId === 'image-0').colorTag, 'blue');
  assert.equal(saved.result.assets.find((a) => a.nodeIds.includes('image-0')).colorTag, 'blue');
  const bad = await run(
    `window.lab.setColorTag({scope:'prompts',id:'image-0',key:'wrong-project',color:'red'})`
  );
  assert.equal(bad.ok, false);
  await finishExtraction(
    normalize(
      {
        nodes: [
          {
            id: 'image-0',
            type: 'image',
            data: {
              action: 'image_generate',
              name: '图片生成 1',
              params: { prompt: '在线重新读取' },
              url: ['https://cdn.example.com/tag-0.png']
            }
          }
        ],
        edges: [],
        source: 'fixture'
      },
      original.metadata
    ),
    options
  );
  await until(`document.querySelector('#entries .color-tag-dot')?.dataset.colorTag==='blue'`);
  check('标签写入本地项目，原始节点与生成素材均保留；重新提取仍恢复已保存颜色，过期项目请求被拒绝');
  await run(
    `document.getElementById('columns').value=11;document.getElementById('columns').dispatchEvent(new Event('input'));`
  );
  assert.equal(
    await run(`document.querySelector('#entries .color-tag-dot')?.dataset.colorTag`),
    'blue'
  );
  for (const width of [1440, 1000, 800, 680, 560]) {
    ui.setContentSize(width, 1100);
    await wait(80);
    assert.equal(
      await run(`document.documentElement.scrollWidth<=innerWidth`),
      true,
      'overflow at ' + width
    );
  }
  const unsaved = normalize(
    {
      nodes: [
        { id: 'first', type: 'text', data: { text: '第一次标记时自动建立画布文件夹' } },
        { id: 'second', type: 'text', data: { text: '并行标记另一个节点' } }
      ],
      edges: [],
      source: 'fixture'
    },
    {
      platform: 'liblib',
      inputUrl: 'https://www.liblib.tv/detail/unsaved-tags',
      author: '标签验证',
      title: '首次标记'
    }
  );
  await finishExtraction(unsaved, options);
  await until(`document.querySelectorAll('#entries .content-card').length===2`);
  assert.equal(getStore().directory, null);
  const writes = await run(
    `Promise.all([...document.querySelectorAll('#entries .color-tag-dot')].map((b,i)=>window.lab.setColorTag({scope:'prompts',id:i?'second':'first',key:b.dataset.colorTagKey,color:i?'green':'red'})))`
  );
  assert.equal(
    writes.every((r) => r.ok),
    true,
    JSON.stringify(writes)
  );
  const autoDirectory = getStore().directory;
  const autoTags = JSON.parse(
    await fs.readFile(path.join(autoDirectory, 'color-tags.json'), 'utf8')
  );
  assert.deepEqual(Object.values(autoTags.tags).sort(), ['green', 'red']);
  const reopenedOriginal = await run(
    `window.lab.openLocalProject(${JSON.stringify(project.directory)})`
  );
  assert.equal(reopenedOriginal.ok, true, reopenedOriginal.error);
  const moved = path.join(path.dirname(autoDirectory), '移动后的画布');
  await fs.rename(autoDirectory, moved);
  const reopenedMoved = await run(`window.lab.openLocalProject(${JSON.stringify(moved)})`);
  assert.equal(reopenedMoved.ok, true, reopenedMoved.error);
  await until(`document.querySelectorAll('#entries .color-tag-dot').length===2`);
  assert.deepEqual(
    await run(
      `[...document.querySelectorAll('#entries .color-tag-dot')].map(b=>b.dataset.colorTag).sort()`
    ),
    ['green', 'red']
  );
  await assert.rejects(fs.access(path.join(app.getPath('userData'), 'color-tags.json')), {
    code: 'ENOENT'
  });
  check(
    '标签仅写入当前画布的color-tags.json；首次标记自动建目录，连续并发修改均保留，整个文件夹移动并重新打开后恢复，程序目录没有新增汇总文件'
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify({ passed: true, checks, errors }, null, 2)
  );
  check('文字索引模式保留圆点，五种窗口宽度无横向溢出，颜色菜单支持键盘关闭且不误收起阅读区');
};
