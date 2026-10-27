'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async ({ ui, root, authorService, getResult, getStore, savePrompts }) => {
  const out = path.join(root, '开发辅助/验收记录/v1.3');
  await fs.mkdir(out, { recursive: true });
  const run = (s) => ui.webContents.executeJavaScript(s),
    errors = [],
    checks = [];
  ui.webContents.on('console-message', (e) => {
    if (
      (e.level === 'error' || e.level === 3) &&
      /ReferenceError|TypeError|SyntaxError/.test(e.message)
    )
      errors.push(e.message);
  });
  async function until(fn, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await fn()) return;
      await wait(150);
    }
    throw new Error('Timed out waiting for author verification');
  }
  function check(text) {
    checks.push(text);
    console.log('PASS ' + text);
  }
  await run(
    `document.getElementById('url').value='https://liblib.tv/profile?uuid=555929c6461b41a2a6ae244803bfd03c';document.getElementById('url').dispatchEvent(new Event('input'))`
  );
  await wait(700);
  assert.equal(authorService.active, false);
  await run(`document.getElementById('start').click()`);
  await until(() => authorService.active, 35000);
  assert.equal(authorService.snapshot().author, '哈基乱剪');
  assert.ok(authorService.snapshot().works.length >= 5);
  await until(() => run(`document.querySelectorAll('#author-works .work-card').length>=5`));
  assert.equal(authorService.snapshot().selectedIds.length, authorService.snapshot().works.length);
  check('Real author address waits for a click and opens with all works selected');
  const works = authorService.snapshot().works.slice(0, 2);
  await run(`window.lab.selectWorks(${JSON.stringify(works.map((work) => work.id))})`);
  await run('window.lab.readWorks()');
  const started = Date.now();
  while (authorService.reading) {
    if (Date.now() - started > 180000) throw new Error('Author work reads exceeded 180 seconds');
    await wait(1000);
    if ((Date.now() - started) % 15000 < 1000)
      console.log(
        'Reading selected works:',
        JSON.stringify(
          authorService
            .snapshot()
            .works.filter((w) => works.some((s) => s.id === w.id))
            .map((w) => ({ title: w.title, state: w.state, error: w.error }))
        )
      );
  }
  const snapshot = authorService.snapshot();
  assert.deepEqual(snapshot.selectedIds, [works[0].id, works[1].id]);
  const failed = snapshot.works.filter(
    (w) => snapshot.selectedIds.includes(w.id) && w.state !== 'ready'
  );
  assert.deepEqual(failed, []);
  assert.equal(getResult().authorProfile.loadedIds.length, 2);
  assert.ok(getResult().assets.length > 0);
  assert.ok(getResult().entries.length > 0);
  check('Two real LibTV works load their own prompts and assets into one selection');
  await run(
    `document.getElementById('columns').value=8;document.getElementById('columns').dispatchEvent(new Event('input'));document.getElementById('tab-assets').click()`
  );
  await wait(500);
  const geometry = await run(
    `(()=>{const a=document.querySelector('.board-search-row .search-field').getBoundingClientRect(),b=document.querySelector('.board-visibility').getBoundingClientRect(),w=document.querySelector('#author-works .work-card').getBoundingClientRect(),c=document.querySelector('#entries .content-card').getBoundingClientRect();return {searchWidth:a.width,toggleWidth:b.width,workWidth:w.width,assetWidth:c.width,workHeight:w.height,assetHeight:c.height}})()`
  );
  assert.ok(Math.abs(geometry.searchWidth - geometry.toggleWidth) < 1);
  assert.equal(geometry.workWidth, geometry.assetWidth);
  assert.ok(Math.abs(geometry.workHeight - geometry.assetHeight) < 2);
  assert.equal(await run(`document.getElementById('save-prompts').textContent`), '保存提示词（2）');
  check('Search and joined visibility controls split the right module equally; card sizes match');
  await savePrompts({ kinds: ['video', 'image', 'audio', 'text'], split: true, mode: 'full' });
  const saved = getStore().summary();
  assert.equal(path.basename(saved.directory), 'liblib_哈基乱剪');
  for (const record of getStore().records)
    assert.ok(await fs.stat(record.store.summary().manifestPath));
  check('Real prompts save separately inside author / work folders');
  await run(`document.querySelector('.board-toolbar').scrollIntoView({block:'start'})`);
  await wait(500);
  await fs.writeFile(
    path.join(out, 'author-live-board.png'),
    (await ui.webContents.capturePage()).toPNG()
  );
  await run(`document.querySelector('[data-work-id="${works[0].id}"]').click()`);
  await wait(300);
  assert.equal(getResult().authorProfile.selectedIds.length, 1);
  assert.ok(getResult().assets.every((a) => a.workId === works[1].id));
  await run(
    `document.getElementById('tab-prompts').click();document.querySelector('#entries .card-heading').click()`
  );
  await until(() =>
    run(`document.querySelector('.work-source')?.textContent.includes('${works[1].title}')`)
  );
  check('Switching to one work updates assets and the reader identifies its source');
  await run(`document.getElementById('author-clear').click()`);
  await wait(200);
  assert.equal(getResult().assets.length, 0);
  assert.equal(await run(`document.getElementById('save-prompts').disabled`), true);
  assert.equal(await run(`document.getElementById('download').disabled`), true);
  check('Clearing selection removes old assets and disables saving and downloading');
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, 'author-live-report.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        geometry,
        works: works.map((w) => ({ id: w.id, title: w.title })),
        directory: saved.directory,
        errors
      },
      null,
      2
    )
  );
  console.log('Author live verification passed');
};
