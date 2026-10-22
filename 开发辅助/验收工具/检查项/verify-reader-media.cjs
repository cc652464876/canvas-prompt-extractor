'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { shell, clipboard } = require('electron');
const { normalize } = require('../../../src/normalize.cjs');
const { ProjectStore } = require('../../../src/project-store.cjs');
const { verificationPath } = require('../../../src/app-paths.cjs');
module.exports = async ({ ui, root }) => {
  const out = verificationPath(root, 'reader-media');
  await fs.mkdir(out, { recursive: true });
  const run = (code) => ui.webContents.executeJavaScript(code),
    checks = [];
  const until = async (code) => {
    for (let i = 0; i < 200; i++) {
      if (await run(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('Timed out: ' + code);
  };
  const click = (selector) =>
    run('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const text = '独立文本正文。\n第二行保持原样。';
  const result = normalize(
    {
      source: 'react-flow-props',
      nodes: [
        {
          id: 'video-node',
          type: 'video',
          data: {
            name: '视频节点',
            action: 'video_generate',
            url: ['https://example.invalid/video.mp4'],
            params: { prompt: '视频提示词', model: 'video-model' }
          }
        },
        {
          id: 'audio-node',
          type: 'audio',
          data: {
            name: '音频素材',
            action: 'audio_resource',
            url: ['https://example.invalid/audio.wav']
          }
        },
        {
          id: 'text-node',
          type: 'text',
          data: { name: '文本节点', action: 'text_resource', content: [text] }
        }
      ],
      edges: []
    },
    {
      platform: 'liblib',
      title: '各类型阅读区验证',
      author: '验证',
      inputUrl: 'https://www.liblib.tv/detail/reader-media-test'
    }
  );
  const store = new ProjectStore(await fs.mkdtemp(path.join(out, 'projects-')));
  await store.create(result, { kinds: ['image', 'video', 'audio', 'text'], mode: 'full' }, false);
  assert.equal(result.assets.length, 2);
  for (const asset of result.assets) {
    const extension = asset.kind === 'video' ? '.mp4' : '.wav';
    await fs.copyFile(
      path.join(root, '开发辅助', '测试代码', 'fixtures', 'reader-media' + extension),
      store.assetPath(asset)
    );
    Object.assign(asset, { state: 'done', bytes: (await fs.stat(store.assetPath(asset))).size });
  }
  await store.checkpoint();
  const locations = [],
    previous = shell.showItemInFolder;
  shell.showItemInFolder = (file) => locations.push(file);
  try {
    const opened = await run(
      'window.lab.openLocalProject(' + JSON.stringify(store.directory) + ')'
    );
    assert.equal(opened.ok, true, opened.error);
    for (const kind of ['video', 'audio']) {
      await click('#clear-readers');
      await click('#tab-assets');
      const asset = result.assets.find((a) => a.kind === kind);
      await until(`document.querySelector('[data-key="assets:${asset.id}"] .card-heading')`);
      await click(`[data-key="assets:${asset.id}"] .card-heading`);
      await until(`document.querySelector('.reading-card ${kind}')`);
      assert.equal(
        await run(
          `document.querySelectorAll('.reading-card .media-tools,.reading-card .state-tag').length`
        ),
        0
      );
      assert.equal(await run(`document.querySelector('.reader-locate').hidden`), false);
      assert.equal(
        await run(`document.querySelector('.reader-locate').previousElementSibling.textContent`),
        '已下载'
      );
      const before = locations.length;
      await click('.reader-locate');
      for (let i = 0; i < 40 && locations.length === before; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(locations.at(-1), store.assetPath(asset));
      assert.equal(
        await run(
          `document.querySelectorAll('.reading-card .load-media,.reading-card .media-stage > .icon').length`
        ),
        0
      );
      await until(`document.querySelector('.reading-card ${kind}').readyState>=1`);
      assert.equal(await run(`document.querySelector('.reading-card ${kind}').controls`), true);
      assert.equal(await run(`document.querySelector('.reading-card ${kind}').paused`), true);
      await run(`document.querySelector('.reading-card ${kind}').play()`);
      await until(`document.querySelector('.reading-card ${kind}').currentTime>0`);
      assert.match(
        await run(`document.querySelector('.reading-card ${kind}').currentSrc`),
        /^labmedia:\/\/local\//
      );
      assert.equal(await run(`document.getElementById('image-info-dialog').open`), false);
      await click('.collapse-reader');
      assert.equal(
        await run(`document.querySelector('.reading-card').getBoundingClientRect().height`),
        44
      );
      assert.equal(await run(`document.querySelector('.reader-locate').checkVisibility()`), true);
      assert.equal(await run(`document.querySelector('.reading-card ${kind}').paused`), true);
      await click('.collapse-reader');
      assert.equal(
        await run(`document.querySelector('.detail-heading').getBoundingClientRect().height`),
        44
      );
      await run(
        `document.querySelector('.media-stage').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`
      );
      await until(`document.getElementById('media-dialog').open`);
      await until(`document.querySelector('#media-dialog ${kind}').readyState>=1`);
      assert.equal(await run(`document.querySelector('#media-dialog ${kind}').paused`), true);
      assert.equal(
        await run(
          `document.querySelectorAll('#media-dialog .load-media,#media-dialog .media-stage > .icon').length`
        ),
        0
      );
      assert.equal(
        await run(`document.querySelector('#media-dialog .preview-locate').hidden`),
        false
      );
      assert.equal(await run(`document.querySelectorAll('#media-dialog .media-tools').length`), 0);
      await click('#media-dialog-close');
      checks.push(kind + '：标题定位与收起状态统一，原生播放和预览正常，无图片信息误触');
    }
    await click('#clear-readers');
    await click('#tab-prompts');
    await until(`document.querySelector('[data-key="prompts:text-node"] .card-heading')`);
    await click('[data-key="prompts:text-node"] .card-heading');
    assert.equal(
      await run(`document.querySelector('.reading-card .download-one').textContent`),
      '下载文本'
    );
    await click('.download-one');
    await until(`document.querySelector('.download-one').textContent==='已下载'`);
    assert.equal(await run(`document.querySelector('.reader-locate').hidden`), false);
    const info = await run(`window.lab.textFile('text-node')`);
    assert.equal(info.value.saved, true);
    assert.equal(await fs.readFile(path.join(store.directory, info.value.fileName), 'utf8'), text);
    await click('.reader-locate');
    await click('.detail-actions button:nth-last-child(2)');
    await until(`document.getElementById('status').textContent.includes('正文已复制')`);
    assert.equal(await clipboard.readText(), text);
    await click('.collapse-reader');
    assert.equal(
      await run(`document.querySelector('.reading-card').getBoundingClientRect().height`),
      44
    );
    assert.equal(await run(`document.querySelector('.reader-locate').checkVisibility()`), true);
    await click('.collapse-reader');
    await run(
      `document.querySelector('.prompt-text').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`
    );
    await until(
      `document.getElementById('media-dialog').open && !document.querySelector('#media-dialog .preview-locate').hidden`
    );
    assert.equal(await run(`document.querySelector('#media-dialog-body pre').textContent`), text);
    assert.equal(
      await run(`document.querySelectorAll('#media-dialog video,#media-dialog audio').length`),
      0
    );
    await click('#media-dialog-close');
    await click('#clear-readers');
    await click('[data-key="prompts:text-node"] .card-heading');
    await until(`document.querySelector('.download-one').textContent==='已下载'`);
    const loaded = new ProjectStore(store.root);
    await loaded.load(store.directory);
    assert.equal((await loaded.textFileInfo('text-node')).saved, true);
    await fs.writeFile(path.join(store.directory, info.value.fileName), '外部修改');
    assert.equal((await loaded.textFileInfo('text-node')).saved, false);
    checks.push('text：保存后已下载与定位、重开识别、正文复制及纯文本预览正常');
    const denied = await run(`window.lab.textFile('unknown-node',true)`);
    assert.equal(denied.ok, false);
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify({ passed: true, checks }, null, 2)
    );
    for (const check of checks) console.log('PASS ' + check);
  } finally {
    shell.showItemInFolder = previous;
  }
};
