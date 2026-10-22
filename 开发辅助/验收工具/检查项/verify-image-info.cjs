'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { clipboard, shell, session } = require('electron');
const { normalize } = require('../../../src/normalize.cjs');
const { ProjectStore } = require('../../../src/project-store.cjs');
const { verificationPath } = require('../../../src/app-paths.cjs');
const { png } = require('../../测试代码/fixtures/image-info.cjs');
module.exports = async ({ ui, root, independentBrowser }) => {
  const out = verificationPath(root, 'image-info');
  await fs.mkdir(out, { recursive: true });
  const run = (code) => ui.webContents.executeJavaScript(code),
    checks = [];
  const until = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await run(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('Timed out: ' + code);
  };
  const click = (selector) =>
    run('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const jobUrl = 'https://www.midjourney.com/jobs/170a5024-1733-44d0-8f4c-bd71515b2316',
    original =
      '一间现代中国住宅的客厅，柔和光影，自然光，日常生活痕迹。 --ar 16:9 --profile test --v 8.2 Job ID: 170a5024-1733-44d0-8f4c-bd71515b2316';
  const result = normalize(
    {
      source: 'react-flow-props',
      nodes: [
        {
          id: 'image-node',
          type: 'image',
          data: {
            name: '图片信息验证节点',
            action: 'image_generate',
            url: [
              'https://example.invalid/one.png',
              'https://example.invalid/two.png',
              'https://example.invalid/three.png',
              'https://example.invalid/four.png'
            ],
            params: { prompt: '画布提示词保持原文。', model: 'canvas-model' }
          }
        }
      ],
      edges: []
    },
    {
      platform: 'liblib',
      title: '图片信息验证作品',
      author: '验证',
      inputUrl: 'https://www.liblib.tv/detail/image-info-test'
    }
  );
  const project = new ProjectStore(await fs.mkdtemp(path.join(out, 'projects-')));
  await project.create(result, { kinds: ['image'], mode: 'full' }, false);
  assert.equal(result.assets.length, 4);
  await fs.writeFile(project.assetPath(result.assets[0]), png(original));
  await fs.writeFile(
    project.assetPath(result.assets[1]),
    png('第二张图片的独立提示词\nNegative prompt: 水印\nSteps: 20, Seed: 42, Model: second-model', {
      key: 'parameters'
    })
  );
  await fs.writeFile(project.assetPath(result.assets[3]), png('示例作者', { key: 'Author' }));
  for (const a of [result.assets[0], result.assets[1], result.assets[3]])
    Object.assign(a, { state: 'done', bytes: (await fs.stat(project.assetPath(a))).size });
  await project.checkpoint();
  const located = [],
    previousLocate = shell.showItemInFolder,
    previousOpen = independentBrowser.open,
    browserSession = session.fromPartition('image-info-job-fixture');
  let jobWindow;
  browserSession.protocol.handle(
    'https',
    () =>
      new Response('<h1>MJ job fixture</h1>', {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
  );
  independentBrowser.open = function (input) {
    assert.equal(input, jobUrl);
    jobWindow = previousOpen.call(this, input, { partition: 'image-info-job-fixture' });
    return jobWindow;
  };
  shell.showItemInFolder = (file) => located.push(file);
  try {
    const opened = await run(
      'window.lab.openLocalProject(' + JSON.stringify(project.directory) + ')'
    );
    assert.equal(opened.ok, true, opened.error);
    await until(`document.querySelector('[data-key="prompts:image-node"] .card-heading')`);
    // Background metadata recognition must be searchable before opening image information.
    await click('#tab-assets');
    const search = (value) =>
      run(
        `(()=>{const s=document.getElementById('search');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('input',{bubbles:true}));})()`
      );
    for (const query of ['mj', '  MJ  ', 'mIdJoUrNeY']) {
      await search(query);
      await until(
        `document.querySelectorAll('#entries [data-key]').length===1 && document.querySelector('#entries [data-key]')?.dataset.key===${JSON.stringify('assets:' + result.assets[0].id)}`
      );
    }
    await search('');
    await until(`document.querySelectorAll('#entries [data-key]').length===4`);
    await click('#tab-prompts');
    checks.push('MJ/Midjourney 忽略大小写与首尾空格，后台识别结果可直接搜索，清空恢复全部素材');
    await click('[data-key="prompts:image-node"] .card-heading');
    await until(`document.querySelector('.reading-card .media-stage > img')`);
    await until(
      `document.querySelector('.reading-card .reader-image-info:not([hidden]) .image-info-prompt')?.textContent.includes('一间现代')`
    );
    const inline = '.reading-card .reader-image-info';
    assert.deepEqual(
      await run(
        `Array.from(document.querySelectorAll('${inline} .image-info-actions button')).map(b=>b.textContent)`
      ),
      ['复制提示词', '复制全部信息', '重新读取']
    );
    assert.equal(
      await run(`document.querySelector('${inline} [data-action="close"]')===null`),
      true
    );
    assert.match(
      await run(`document.querySelector('${inline} .image-info-summary').textContent`),
      /Midjourney · V8.2/
    );
    assert.match(
      await run(`document.querySelector('${inline} .image-info-parameters').textContent`),
      /Job ID: 170a5024/
    );
    await click(inline + ' [data-action="copy-prompt"]');
    await until(`document.querySelector('${inline} .image-info-status').textContent==='已复制。'`);
    assert.equal(await clipboard.readText(), original);
    await click(inline + ' .image-info-more > summary > span');
    await until(
      `document.querySelector('${inline} .image-info-exiftool')?.dataset.loaded==='true'`
    );
    const inlineDetails = await run(
      `document.querySelector('${inline} .image-info-exiftool').textContent`
    );
    await click(inline + ' [data-action="copy-all"]');
    await until(`document.querySelector('${inline} .image-info-status').textContent==='已复制。'`);
    assert.equal(await clipboard.readText(), inlineDetails);
    await click(inline + ' .image-info-more > summary > span');
    const replacement = original.replace('一间现代中国住宅的客厅', '重新读取后的客厅');
    await fs.writeFile(project.assetPath(result.assets[0]), png(replacement));
    await click(inline + ' [data-action="reload"]');
    await until(
      `document.querySelector('${inline} .image-info-prompt')?.textContent.includes('重新读取后的客厅')`
    );
    await fs.writeFile(project.assetPath(result.assets[0]), png(original));
    await click(inline + ' [data-action="reload"]');
    await until(
      `document.querySelector('${inline} .image-info-prompt')?.textContent.includes('一间现代中国住宅')`
    );
    await fs.writeFile(
      path.join(out, 'reader-inline.png'),
      (await ui.webContents.capturePage()).toPNG()
    );
    checks.push(
      '阅读区按弹窗格式自动展示 MJ 信息，保留双复制、更多信息和重新读取，阅读区不显示关闭按钮'
    );
    assert.equal(await run(`document.querySelectorAll('.image-info-trigger').length`), 0);
    const geometry = await run(
      `(()=>{const c=document.querySelector('.reading-card'),b=c.querySelector('.image-output').getBoundingClientRect(),s=c.querySelector('.media-stage').getBoundingClientRect(),m=c.querySelector('.media-stage > .magnify').getBoundingClientRect();return {boxHeight:b.height,height:s.height,width:s.width,magX:m.left-s.left,magY:m.top-s.top,state:c.querySelector('.image-output').textContent,previous:c.querySelector('.reader-locate').previousElementSibling.className};})()`
    );
    assert.ok(Math.abs(geometry.boxHeight - geometry.height) < 2);
    assert.ok(Math.abs(geometry.width / geometry.height - 16 / 9) < 0.01);
    assert.ok(Math.abs(geometry.magX - 8) < 2 && Math.abs(geometry.magY - 8) < 2);
    assert.doesNotMatch(geometry.state, /已保存到本地|定位文件/);
    assert.match(geometry.previous, /download-one/);
    checks.push('删除图片信息文字入口和独立工具栏，图片恢复 v1.2 比例及原高度');
    const headerSnapshot = () =>
      run(
        `(()=>{const c=document.querySelector('.reading-card'),r=c.getBoundingClientRect(),h=c.querySelector('.detail-heading').getBoundingClientRect(),title=c.querySelector('.detail-title'),rect=e=>{const b=e.getBoundingClientRect();return [b.x-r.x,b.y-r.y,b.width,b.height].map(v=>Math.round(v*100)/100)};return {cardWidth:r.width,heading:[h.x-r.x,h.y-r.y,h.width,h.height],title:title.textContent,titleRect:rect(title),nameStyle:[getComputedStyle(title.querySelector('h3')).fontSize,getComputedStyle(title.querySelector('h3')).fontWeight],subStyle:[getComputedStyle(title.querySelector('.detail-sub')).fontSize,getComputedStyle(title.querySelector('.detail-sub')).color],buttons:Array.from(c.querySelectorAll('.detail-actions button')).map(b=>({label:b.classList.contains('collapse-reader')?'toggle':b.textContent,hidden:b.hidden,disabled:b.disabled,rect:rect(b),font:getComputedStyle(b).fontSize}))};})()`
      );
    const expandedHeader = await headerSnapshot();
    const expandedStrip = await run(
      `(()=>{const c=document.querySelector('.reading-card'),h=c.querySelector('.detail-heading').getBoundingClientRect(),b=c.querySelector('.reading-content').getBoundingClientRect();return {height:h.height,top:h.top-c.getBoundingClientRect().top,gap:b.top-h.bottom};})()`
    );
    assert.equal(expandedStrip.height, 44);
    assert.equal(expandedStrip.top, 0);
    assert.equal(expandedStrip.gap, 0);
    await click('.reading-card .collapse-reader');
    assert.deepEqual(await headerSnapshot(), expandedHeader);
    assert.equal(
      await run(`document.querySelector('.reading-card').getBoundingClientRect().height`),
      44
    );
    checks.push('以原收起栏为基准：两态标题栏均为44像素，无额外上下留白');
    checks.push('展开收起标题栏尺寸、信息、字体及按钮位置完全一致');
    assert.equal(
      await run(`document.querySelector('.reading-card .reader-locate').checkVisibility()`),
      true
    );
    assert.equal(
      await run(
        `document.querySelector('.reading-card .reader-locate').previousElementSibling.textContent`
      ),
      '已下载'
    );
    await click('.reading-card .reader-locate');
    for (let i = 0; i < 40 && !located.length; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(located.length, 1);
    await click('.reading-card .collapse-reader');
    checks.push('定位文件紧跟已下载，收起时继续显示并可定位');
    await click('.reading-card .magnify');
    assert.equal(
      await run(`document.querySelector('.reading-card .magnify').getAttribute('aria-pressed')`),
      'true'
    );
    await click('.reading-card .media-stage > img');
    assert.equal(await run(`document.getElementById('image-info-dialog').open`), false);
    await click('.reading-card .magnify');
    checks.push('定位文件独立定位，放大镜开启时不误弹图片信息');
    await click('.reading-card .media-stage > img');
    await until(
      `document.querySelector('#image-info-dialog .image-info-prompt')?.textContent.includes('一间现代')`
    );
    assert.match(
      await run(`document.querySelector('#image-info-dialog .image-info-summary').textContent`),
      /Midjourney · V8.2 · /
    );
    assert.match(
      await run(`document.querySelector('#image-info-dialog .image-info-summary').title`),
      /推测/
    );
    await click('#image-info-dialog .image-info-actions button');
    await until(
      `document.querySelector('#image-info-dialog [role="status"]').textContent==='已复制。'`
    );
    assert.equal(await clipboard.readText(), original);
    checks.push('阅读区图片点击打开信息，复制保留完整原文');
    assert.deepEqual(
      await run(
        `Array.from(document.querySelectorAll('#image-info-dialog .image-info-actions button')).map(b=>b.textContent)`
      ),
      ['复制提示词', '复制全部信息', '重新读取', '关闭']
    );
    assert.equal(
      await run(`document.querySelectorAll('#image-info-dialog h2,#image-info-dialog h3').length`),
      0
    );
    assert.match(
      await run(`document.querySelector('#image-info-dialog .image-info-parameters').textContent`),
      /--ar 16:9/
    );
    assert.equal(
      await run(
        `document.querySelector('#image-info-dialog .image-info-parameters').closest('details')===null`
      ),
      true
    );
    await click('#image-info-dialog .image-info-more > summary');
    await until(
      `document.querySelector('#image-info-dialog .image-info-exiftool')?.dataset.loaded==='true'`
    );
    const direct = await run(
      `document.querySelector('#image-info-dialog .image-info-exiftool').textContent`
    );
    assert.match(direct, /ExifTool Version Number\s*:/);
    assert.match(direct, /File Name\s*:/);
    assert.match(direct, /Description\s*:\s*一间现代/);
    assert.equal(
      await run(`document.querySelectorAll('#image-info-dialog .image-info-more details').length`),
      0
    );
    const moreStyle = await run(
      `(()=>{const a=getComputedStyle(document.querySelector('#image-info-dialog .image-info-more summary')),b=getComputedStyle(document.querySelector('#image-info-dialog .image-info-summary'));return {color:a.color,referenceColor:b.color,size:a.fontSize,referenceSize:b.fontSize,marker:a.listStyleType};})()`
    );
    assert.equal(moreStyle.color, moreStyle.referenceColor);
    assert.equal(moreStyle.size, moreStyle.referenceSize);
    assert.equal(moreStyle.marker, 'none');
    checks.push('更多信息与规格行字号颜色一致，无三角标记');
    assert.equal(
      await run(
        `document.querySelector('#image-info-dialog [data-action="open-mj-job"]').textContent`
      ),
      '打开官网'
    );
    const hitAreas = await run(`(()=>{
      const s=document.querySelector('#image-info-dialog .image-info-more > summary'),
        label=s.querySelector('span').getBoundingClientRect(),
        link=s.querySelector('button').getBoundingClientRect(),
        row=s.getBoundingClientRect(), parent=s.parentElement.getBoundingClientRect();
      return {gap:{x:Math.round((label.right+link.left)/2),y:Math.round(row.top+row.height/2)},
        blank:{x:Math.round(row.right+20),y:Math.round(row.top+row.height/2)},
        width:row.width,parentWidth:parent.width};
    })()`);
    assert.ok(hitAreas.width < hitAreas.parentWidth / 2);
    for (const point of [hitAreas.gap, hitAreas.blank]) {
      ui.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      ui.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(
        await run(`document.querySelector('#image-info-dialog .image-info-more').open`),
        true
      );
      assert.equal(jobWindow, undefined);
    }
    await click('#image-info-dialog .image-info-more > summary > span');
    assert.equal(
      await run(`document.querySelector('#image-info-dialog .image-info-more').open`),
      false
    );
    await click('#image-info-dialog .image-info-more > summary > span');
    assert.equal(
      await run(`document.querySelector('#image-info-dialog .image-info-more').open`),
      true
    );
    checks.push('更多信息和打开官网仅文字区域生效，标签间隔和右侧空白点击不触发操作');
    assert.equal(
      await run(`document.querySelector('#image-info-dialog [data-action="open-mj-job"]').title`),
      jobUrl
    );
    const detailsOpen = await run(
      `document.querySelector('#image-info-dialog .image-info-more').open`
    );
    await click('#image-info-dialog [data-action="open-mj-job"]');
    for (let i = 0; i < 160; i++) {
      if (
        jobWindow?.browserToolbar?.state().url === jobUrl &&
        [...jobWindow.browserToolbar.tabs.values()].some((tab) => tab.contents.getURL() === jobUrl)
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(jobWindow?.browserToolbar);
    assert.equal(jobWindow.browserToolbar.state().url, jobUrl);
    assert.equal(
      await run(`document.querySelector('#image-info-dialog .image-info-more').open`),
      detailsOpen
    );
    assert.equal(await run(`document.getElementById('image-info-dialog').open`), true);
    jobWindow.destroy();
    ui.show();
    ui.focus();
    checks.push('MJ 作品按钮从当前 Job ID 拼接地址，在程序内置浏览器打开且不切换更多信息');
    await click('#image-info-dialog [data-action=copy-all]');
    await until(
      `document.querySelector('#image-info-dialog [role="status"]').textContent==='已复制。'`
    );
    assert.equal(await clipboard.readText(), direct);
    await click('#image-info-dialog .image-info-more > summary');
    checks.push('紧凑文件名操作栏、常显参数与 ExifTool 直接字段文本');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await fs.writeFile(path.join(out, 'dialog.png'), (await ui.webContents.capturePage()).toPNG());
    await click('#image-info-dialog [data-action=close]');
    await run(
      `document.querySelector('.reading-card .media-stage').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`
    );
    await until(`document.getElementById('media-dialog').open`);
    await click('#media-dialog .preview-locate');
    for (let i = 0; i < 40 && located.length < 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(located.length, 2);
    await click('#media-dialog .media-stage > img');
    await until(
      `document.getElementById('image-info-dialog').open && document.querySelector('#image-info-dialog .image-info-prompt')?.textContent.includes('一间现代')`
    );
    await run(
      `(()=>{const d=document.getElementById('image-info-dialog'),r=d.getBoundingClientRect();d.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:r.left+12,clientY:r.top+12}));d.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,clientX:r.left+12,clientY:r.top+12}));window.dispatchEvent(new Event('blur'));})()`
    );
    assert.equal(await run(`document.getElementById('image-info-dialog').open`), true);
    // Native title-bar and external desktop clicks cannot generate client-area
    // backdrop events; also reject coordinates outside the renderer viewport.
    await run(
      `(()=>{const d=document.getElementById('image-info-dialog');for(const type of ['pointerdown','click'])d.dispatchEvent(new MouseEvent(type,{bubbles:true,button:0,clientX:-10,clientY:-10}));})()`
    );
    assert.equal(await run(`document.getElementById('image-info-dialog').open`), true);
    // A selection drag beginning in the card must not be treated as a backdrop click.
    await run(
      `(()=>{const d=document.getElementById('image-info-dialog'),p=d.querySelector('.image-info-prompt');p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));d.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,clientX:2,clientY:2}));})()`
    );
    assert.equal(await run(`document.getElementById('image-info-dialog').open`), true);
    await run(
      `(()=>{const d=document.getElementById('image-info-dialog');d.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:2,clientY:2}));d.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,clientX:2,clientY:2}));})()`
    );
    assert.equal(await run(`document.getElementById('image-info-dialog').open`), false);
    assert.equal(await run(`document.getElementById('media-dialog').open`), true);
    checks.push('仅程序内遮罩点击关闭图片信息，卡片内点击、失焦和外部坐标不关闭');
    await click('#media-dialog-close');
    checks.push('素材预览图片点击打开信息，关闭信息后保留原预览');
    await click('.reading-card .carousel-nav button:last-child');
    await click('.reading-card .media-stage > img');
    await until(
      `document.querySelector('#image-info-dialog .image-info-prompt')?.textContent.includes('第二张')`
    );
    assert.equal(
      await run(`document.querySelector('.reading-card .reader-image-info').hidden`),
      true
    );
    assert.match(
      await run(`document.querySelector('#image-info-dialog .image-info-summary').textContent`),
      /second-model/
    );
    assert.doesNotMatch(
      await run(`document.querySelector('#image-info-dialog .image-info-body').textContent`),
      /一间现代/
    );
    assert.equal(
      await run(`document.querySelector('#image-info-dialog [data-action="open-mj-job"]')===null`),
      true
    );
    checks.push('切换结果图后信息独立，模型与负面提示词正常显示');
    await click('#image-info-dialog [data-action=close]');
    assert.equal(
      await run(
        `document.querySelector('.reading-card .prompt-inner').textContent.includes('画布提示词保持原文。')`
      ),
      true
    );
    await click('.reading-card .carousel-nav button:last-child');
    assert.equal(await run(`document.querySelector('.reader-locate').hidden`), true);
    const unavailable = await run(
      'window.lab.imageInfo(' + JSON.stringify(result.assets[2].id) + ')'
    );
    assert.equal(unavailable.value.status, 'needs-download');
    checks.push('未下载图片不显示定位文件，保留原图读取状态');
    await click('.reading-card .carousel-nav button:last-child');
    await click('.reading-card .media-stage > img');
    await until(`document.querySelector('#image-info-dialog .image-info-more')`);
    assert.equal(
      await run(
        `document.querySelectorAll('#image-info-dialog .image-info-prompt,#image-info-dialog .image-info-negative,#image-info-dialog .image-info-parameters').length`
      ),
      0
    );
    assert.doesNotMatch(
      await run(`document.getElementById('image-info-dialog').textContent`),
      /未发现内嵌提示词/
    );
    assert.equal(
      await run(`document.querySelector('#image-info-dialog .image-info-body').children.length`),
      2
    );
    assert.equal(
      await run(`document.querySelector('#image-info-dialog [data-action=copy-prompt]').disabled`),
      true
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    await fs.writeFile(
      path.join(out, 'no-prompt.png'),
      (await ui.webContents.capturePage()).toPNG()
    );
    await click('#image-info-dialog [data-action=close]');
    checks.push('无提示词时仅保留文件名操作栏、规格、更多信息三行');
    const record = JSON.parse(
      await fs.readFile(path.join(project.directory, '.图片信息.json'), 'utf8')
    );
    assert.equal(Object.keys(record.entries).length, 3);
    for (const entry of Object.values(record.entries)) assert.ok(!entry.info.raw.SourceFile);
    const cached = await run('window.lab.imageInfo(' + JSON.stringify(result.assets[0].id) + ')');
    assert.equal(cached.value.cached, true);
    const forced = await run(
      'window.lab.imageInfo(' + JSON.stringify(result.assets[0].id) + ',{force:true})'
    );
    assert.equal(forced.ok, true, forced.error);
    assert.equal(Boolean(forced.value.cached), false);
    await click('#tab-assets');
    await search('mj');
    await until(`document.querySelectorAll('#entries [data-key]').length===1`);
    await fs.writeFile(project.assetPath(result.assets[0]), png('替换后无品牌信息的图片'));
    const refreshed = await run(
      'window.lab.imageInfo(' + JSON.stringify(result.assets[0].id) + ',{force:true})'
    );
    assert.equal(refreshed.ok, true, refreshed.error);
    await until(`document.querySelectorAll('#entries [data-key]').length===0`);
    await search('');
    await until(`document.querySelectorAll('#entries [data-key]').length===4`);
    checks.push('重新读取后品牌变化同步更新搜索，移除旧识别结果');
    const denied = await run(`window.lab.imageInfo('unknown-id')`);
    assert.equal(denied.ok, false);
    checks.push('作品缓存、强制重读及非法素材标识校验通过');
    assert.equal(located.length, 2);
    checks.push('两处图片点击均不定位文件，只有定位文件操作触发定位');
    const assetResult = structuredClone(result);
    assetResult.entries = [];
    for (const asset of assetResult.assets) asset.state = 'pending';
    const assetProject = new ProjectStore(await fs.mkdtemp(path.join(out, 'asset-project-')));
    await assetProject.create(assetResult, { kinds: ['image'], mode: 'full' }, false);
    await fs.writeFile(assetProject.assetPath(assetResult.assets[0]), png(original));
    assetResult.assets[0].state = 'done';
    await assetProject.checkpoint();
    const assetOpened = await run(
      'window.lab.openLocalProject(' + JSON.stringify(assetProject.directory) + ')'
    );
    assert.equal(assetOpened.ok, true, assetOpened.error);
    await click('#tab-assets');
    await until(
      `document.querySelector('[data-key="assets:${assetResult.assets[0].id}"] .card-heading')`
    );
    await click('[data-key="assets:' + assetResult.assets[0].id + '"] .card-heading');
    await until(
      `document.querySelector('.reading-card[data-scope="assets"] .reader-image-info:not([hidden])')`
    );
    assert.equal(
      await run(
        `document.querySelector('.reading-card[data-scope="assets"] .reader-prompt-placeholder').hidden`
      ),
      true
    );
    await fs.writeFile(
      path.join(out, 'reader-asset-inline.png'),
      (await ui.webContents.capturePage()).toPNG()
    );
    await click('.reading-card .media-stage > img');
    await until(
      `document.querySelector('#image-info-dialog .image-info-prompt')?.textContent.includes('一间现代')`
    );
    await fs.writeFile(assetProject.assetPath(assetResult.assets[0]), png(replacement));
    await click('#image-info-dialog [data-action="reload"]');
    await until(
      `document.querySelector('.reading-card .reader-image-info .image-info-prompt')?.textContent.includes('重新读取后的客厅')`
    );
    await click('#image-info-dialog [data-action="close"]');
    await click(inline + ' [data-action="open-mj-job"]');
    for (let i = 0; i < 160 && jobWindow?.browserToolbar?.state().url !== jobUrl; i++)
      await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(jobWindow.browserToolbar.state().url, jobUrl);
    jobWindow.destroy();
    checks.push(
      '纯素材阅读区直接展示内嵌信息并隐藏无提示词占位；弹窗重读同步更新阅读区，官网入口使用内置浏览器'
    );
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify({ passed: true, checks }, null, 2)
    );
    for (const check of checks) console.log('PASS ' + check);
  } finally {
    shell.showItemInFolder = previousLocate;
    independentBrowser.open = previousOpen;
    if (jobWindow && !jobWindow.isDestroyed()) jobWindow.destroy();
    browserSession.protocol.unhandle('https');
  }
};
