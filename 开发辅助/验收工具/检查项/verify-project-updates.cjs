'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { DownloadQueue } = require('../../../src/download-queue.cjs');
const { AuthorStore, namespaceResult } = require('../../../src/author-library.cjs');
const { collectionName } = require('../../../src/project-files.cjs');
module.exports = async ({ ui, getStore, getResult, setOutputDirectory, authorService }) => {
  const source = 'C:/Users/cc719/OneDrive/Desktop/liblib_Li鱼_家具产品宣传广告';
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-live-updates-'));
  const target = path.join(temporary, path.basename(source));
  const fingerprint = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => [
          e.name,
          createHash('sha256')
            .update(await fs.readFile(path.join(directory, e.name)))
            .digest('hex')
        ])
    );
  };
  const original = await fingerprint(source);
  const run = (code) => ui.webContents.executeJavaScript(code);
  const errors = [];
  ui.webContents.on('console-message', (event) => {
    if (/ReferenceError|TypeError|SyntaxError/.test(event.message)) errors.push(event.message);
  });
  const until = async (code, timeout = 25000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await run(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out: ' + code);
  };
  try {
    await fs.cp(source, target, { recursive: true });
    setOutputDirectory(temporary);
    await until(`document.querySelectorAll('#export-types input').length===4`);
    const opened = await run(`window.lab.openLocalProject(${JSON.stringify(target)})`);
    assert.equal(opened.ok, true, opened.error);
    assert.equal(await run(`document.getElementById('start').textContent`), '开始读取画布');
    assert.equal(getResult().assets.filter((a) => a.state === 'done').length, 4);
    console.log('PASS 指定 C 盘项目可打开，按钮显示“开始读取画布”，4 个已有素材可用');
    await until(
      `!document.getElementById('author-update-notice').hidden && !document.getElementById('author-update-notice').textContent.includes('正在')`,
      50000
    );
    const countNotice = await run(`document.getElementById('author-update-notice').textContent`);
    console.log('AUTHOR COUNT: ' + countNotice);
    assert.match(countNotice, /已记录作者作品数量|作者作品数量无变化|作者作品数量有变化/);
    const checked = await run(
      `window.lab.checkUpdates({mode:'full',kinds:['image','video','audio','text'],split:true})`
    );
    assert.equal(checked.ok, true, checked.error);
    assert.equal(getStore().directory, path.resolve(target));
    assert.equal(getResult().diagnostics.nodeCount, 5);
    assert.equal(getResult().assets.filter((a) => a.state === 'done').length, 4);
    console.log(
      'PASS 真实网址重新读取完成，仍复用原目录和 4 个已有素材；changed=' + checked.value.changed
    );
    const first = await run(
      `window.lab.save({mode:'full',kinds:['image','video','audio','text'],split:true})`
    );
    assert.equal(first.ok, true, first.error);
    const before = getStore().documents;
    const second = await run(
      `window.lab.save({mode:'full',kinds:['image','video','audio','text'],split:true})`
    );
    assert.equal(second.ok, true, second.error);
    assert.deepEqual(getStore().documents, before);
    assert.equal(
      (await fs.readdir(target)).some((n) => n.startsWith('历史_')),
      false
    );
    console.log('PASS 连续保存提示词复用原文件，未生成历史前缀文件');
    let requests = 0;
    const queue = new DownloadQueue({
      catalog: getResult().assets,
      fetcher: async () => {
        requests++;
        throw new Error('已有完整文件不应重复下载');
      },
      filePath: (a) => getStore().assetPath(a),
      onProgress: () => {},
      onSettled: () => {},
      interval: 0
    });
    await queue.start(getResult().assets, ['image', 'video', 'audio']);
    assert.equal(requests, 0);
    console.log('PASS 重复下载的队列发出 0 次媒体请求');
    const work = {
      id: '94da194049354a42a71b568aec4b64f3',
      title: '家具产品宣传广告',
      url: getResult().metadata.inputUrl
    };
    const profile = {
      platform: 'liblib',
      uuid: '332d1bb1752b4818bcbc18e262d9b6f1',
      author: 'Li鱼',
      url: 'https://www.liblib.tv/profile?uuid=332d1bb1752b4818bcbc18e262d9b6f1',
      works: [work]
    };
    const collection = new AuthorStore(temporary, profile, {}, [
      { work, result: namespaceResult(getResult(), work), store: null }
    ]);
    collection.options = { mode: 'full', kinds: ['image', 'video', 'audio', 'text'], split: true };
    await collection.prepare();
    const child = collection.records[0].store;
    for (const asset of child.result.assets) {
      const originalAsset = getResult().assets.find((a) => a.fileName === asset.fileName);
      assert.ok(originalAsset);
      await fs.copyFile(path.join(target, originalAsset.fileName), child.assetPath(asset));
      const stat = await fs.stat(child.assetPath(asset));
      Object.assign(asset, {
        state: 'done',
        bytes: stat.size,
        total: stat.size,
        savedBytes: stat.size
      });
    }
    await child.checkpoint();
    const openedCollection = await run(
      `window.lab.openLocalProject(${JSON.stringify(path.join(collection.directory, collectionName(profile)))})`
    );
    assert.equal(openedCollection.ok, true, openedCollection.error);
    assert.equal(await run(`document.getElementById('start').textContent`), '开始读取画布');
    const collectionChecked = await run(
      `window.lab.checkUpdates({mode:'full',kinds:['image','video','audio','text'],split:true})`
    );
    assert.equal(collectionChecked.ok, true, collectionChecked.error);
    const deadline = Date.now() + 120000;
    while (authorService.reading) {
      if (Date.now() > deadline) throw new Error('Collection check timed out');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(
      authorService.snapshot().works[0].updateState,
      'unchanged',
      JSON.stringify(authorService.snapshot().works[0])
    );
    assert.equal(getResult().assets.filter((a) => a.state === 'done').length, 4);
    console.log('PASS 打开作品集后，主按钮可检测所选画布并复用原 4 个素材');
    assert.deepEqual(await fingerprint(source), original);
    assert.deepEqual(errors, []);
    console.log('PASS 用户原始 C 盘目录内容未修改；无 UI 脚本错误');
    const screenshot = path.join(temporary, '更新检测验收.png');
    await fs.writeFile(screenshot, (await ui.webContents.capturePage()).toPNG());
    console.log('SCREENSHOT ' + screenshot);
    console.log('SAMPLE ' + target);
  } catch (error) {
    console.error('LIVE VERIFICATION FAILED:', error);
    throw error;
  }
};
