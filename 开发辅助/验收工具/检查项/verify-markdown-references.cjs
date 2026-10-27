'use strict';
const assert = require('node:assert/strict');

module.exports = async function verifyMarkdownReferences({
  ui,
  run,
  click,
  until,
  entry,
  asset,
  check
}) {
  const frameId = '86b9a39c730d43f0a7e6a7713fd91f08',
    filename = 'IMG_GEN_20260611184226_7995dd69_1',
    prompt =
      '# 角色替换\n\n修改视频，将@[' +
      frameId +
      ']的人物替换成@[' +
      filename +
      ']，保持场景。**保留加粗**\n\n@[未知引用]保留原文。\n\n`@[代码示例]`\n\n<script>window.untrustedMarkdown = true</script>',
    refs = [
      {
        nodeId: 'markdown-frame',
        name: '原视频截帧.png',
        type: 'image',
        url: 'https://fixture.invalid/' + frameId + '.png',
        assetIds: ['markdown-frame-asset']
      },
      {
        nodeId: 'markdown-character',
        name: '角色三视图.png',
        type: 'image',
        url: 'https://fixture.invalid/' + filename + '.png',
        assetIds: ['markdown-character-asset']
      }
    ],
    source = entry('markdown-demo', 'Markdown 引用与缩放', prompt, refs),
    fixture = {
      metadata: { platform: 'neowow', title: 'Markdown 回归检查' },
      diagnostics: { warnings: [] },
      entries: [source],
      assets: [
        asset('markdown-frame-asset', ['markdown-frame'], '原视频截帧.png'),
        asset('markdown-character-asset', ['markdown-character'], '角色三视图.png')
      ]
    };
  ui.webContents.send('lab:event', { type: 'result', payload: fixture });
  await until(`document.querySelector('[data-key="prompts:markdown-demo"]')`);
  await click('[data-key="prompts:markdown-demo"] .card-heading');

  async function references(selector) {
    await until(`document.querySelectorAll('${selector} .inline-ref img').length === 2`);
    await until(
      `[...document.querySelectorAll('${selector} .inline-ref img')].every(img => img.naturalWidth > 0)`
    );
    assert.deepEqual(
      await run(
        `([...document.querySelectorAll('${selector} .inline-ref')].map(chip => ({ name: chip.getAttribute('aria-label'), text: chip.textContent })))`
      ),
      [
        { name: '原视频截帧.png', text: '原视频截帧.png' },
        { name: '角色三视图.png', text: '角色三视图.png' }
      ]
    );
    const text = await run(`document.querySelector('${selector}').textContent`);
    assert.ok(!text.includes(frameId));
    assert.ok(!text.includes(filename));
    assert.ok(text.includes('@[未知引用]'));
    assert.equal(await run('window.untrustedMarkdown'), undefined);
  }

  await references('.reading-card .markdown-content');
  assert.equal(
    await run(`document.querySelector('.markdown-content strong').textContent`),
    '保留加粗'
  );
  await click('.reading-card [data-mode=markdown]');
  await references('.reading-card .markdown-source');
  assert.ok(
    await run(`document.querySelector('.markdown-source').textContent.includes('**保留加粗**')`)
  );
  assert.ok(
    await run(`document.querySelector('.markdown-source').textContent.startsWith('# 角色替换')`)
  );
  await click('.reading-card [data-mode=preview]');
  await references('.reading-card .markdown-content');
  await click('.reading-card .prompt-expand');
  await until('document.getElementById("prompt-dialog").open');
  for (const mode of ['preview', 'markdown', 'preview']) {
    await click('#prompt-dialog [data-mode=' + mode + ']');
    const selector =
      '#prompt-dialog .' + (mode === 'preview' ? 'markdown-content' : 'markdown-source');
    await references(selector);
    for (const size of [14, 28]) {
      await run(
        `{ const slider = document.querySelector('#prompt-dialog .prompt-text-size'); slider.value = '${size}'; slider.dispatchEvent(new Event('input')); }`
      );
      const metrics = await run(`(() => {
        const content = document.querySelector('${selector}'), prose = content.querySelector('p') || content,
          chip = content.querySelector('.inline-ref'), img = chip.querySelector('img');
        return { prose: getComputedStyle(prose).fontSize, line: getComputedStyle(prose).lineHeight, label: getComputedStyle(chip.querySelector('.ref-chip-label')).fontSize, image: img.getBoundingClientRect().width, main: getComputedStyle(document.documentElement).getPropertyValue('--prompt-font-size').trim() };
      })()`);
      assert.equal(metrics.prose, size + 'px');
      assert.equal(metrics.label, size + 'px');
      assert.equal(metrics.line, (size === 14 ? 24 : 48) + 'px');
      assert.equal(metrics.image, size === 14 ? 16 : 32);
      assert.equal(metrics.main, '14px');
    }
  }
  await click('#prompt-dialog [data-mode=markdown]');
  await click('#prompt-dialog .prompt-window-button');
  await references('.reading-card .markdown-source');
  assert.equal(
    await run(
      `getComputedStyle(document.querySelector('.reading-card .markdown-source')).fontSize`
    ),
    '14px'
  );
  assert.equal(source.prompt, prompt);
  assert.deepEqual(source.references, refs);
  check(
    'Preview prose and reference labels scale together; Markdown retains thumbnail/name references in the reader, dialog and after restore while source text stays unchanged'
  );
};
